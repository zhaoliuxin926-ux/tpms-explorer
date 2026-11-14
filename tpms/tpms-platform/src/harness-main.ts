/**
 * harness-main.ts — Agent 驾驶舱入口（方向 B1，2026-11-11 → 2026-11-13 全量升级）
 *
 * 双壳拓扑：本页（驾驶舱壳，对话主视角）内嵌 index.html（工程壳）iframe。
 * - 对话循环复用 core/agent-run（M3 多轮 + M4 有界修复菜单 + Per-Prompt 预算 + 多轮滑窗历史）；
 * - 工具面全齐（list/estimate/mesh/design_verify/pareto），其中 write/verify 经 iframe-bridge 驱动主壳单源执行体；
 * - 确定性会话与指代绑定（session-core.mjs 单源）："把第 N 个构建出来"在进 LLM/规则前确定性解析并绑到 periods=3 + L=3×cellSize；
 * - 无 key/规则模式支持逆设计 Pareto 扫描、性能估算与制造检查；并实时维护多物理场三元核验与参数联动 CAE 手册。
 */
import { runAgent, type ToolImpl, type AgentEvent } from './core/agent-run';
import { agentListExec, agentEstimateExec, agentParetoExec } from './core/agent-tools-shared';
import {
  newSession,
  recordPareto,
  recordExecution,
  resolveReference,
  candidateToMeshArgs,
  type AgentSessionState,
  type SessionCandidate,
} from './core/agent-contract';
import { BridgeClient, type BridgeResult, type BridgeSimulateMode, type BridgeExportFmt } from './core/iframe-bridge';
import {
  createBrowserProvider, loadAgentCfg, saveAgentCfg, getByoKey, setByoKey,
  BrowserLlmError, DEFAULT_ENDPOINTS, DEFAULT_MODELS, type AgentCfg,
} from './core/llm-provider-browser';
import { parseNL } from './core/nl-agent';
import { forwardModel } from './physics/inverse-design';
import { gibsonAshby, plateauStress, BASE_MODULUS, BASE_YIELD_STRENGTH } from './physics/gibson-ashby';
import { fitExperimentalCurve, type Iso13314Metrics } from './physics/experimental-fit';
import { forchheimerTwoPoint } from './physics/forchheimer';
import type { TpmType } from './types';

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
const bridge = new BridgeClient(() => document.getElementById('stage-frame') as HTMLIFrameElement | null);
bridge.attach();

const GYROID_R48_CFD_A = 0.46123269585707205;
const GYROID_R48_CFD_B = 3.1663;
const MAX_HISTORY_MSGS = 8;

interface StageStateSnapshot {
  type: string;
  porosity: number;
  periods: number;
  specimenSizeMm: number | null;
  structureMode: string;
  containerShape: string;
  material: string;
}

let browserSession: AgentSessionState = newSession();
let conversationHistory: Array<Record<string, unknown>> = [];
let lastStageState: StageStateSnapshot = {
  type: 'gyroid',
  porosity: 75,
  periods: 3,
  specimenSizeMm: null,
  structureMode: 'solid_network',
  containerShape: 'cube',
  material: 'auto',
};
let lastVerifySummary: Record<string, unknown> | null = null;
let lastVerifySig = '';
let lastParetoArgs: Record<string, unknown> = {};
let forchheimerDirty = false;

const ABAQUS_GYROID_P60_EXPL_CSV = `# source=abaqus-explicit-sim
# porosity=0.60
# type=gyroid
# lengthMm=12.5664
# widthMm=12.5664
# thicknessMm=12.5664
displacement_mm,force_N
0.000000,0.0000
0.006558,28.0751
0.048420,171.6165
0.150599,510.5893
0.327648,908.2839
0.585440,1161.9918
0.922238,1297.7471
1.330260,1368.5054
1.795386,1417.7974
2.300877,1456.2043
2.827780,1492.9060
3.354315,1526.8538
3.859972,1566.5367
4.325031,1628.6154
4.732716,1701.4566
5.069633,1778.3096
5.327415,1878.5058
5.504381,1950.6284
5.606498,2002.3067
5.648318,2026.4793
5.654860,2022.4044`;

const ABAQUS_DIAMOND_P60_EXPL_CSV = `# source=abaqus-explicit-sim
# porosity=0.60
# type=diamond
# lengthMm=12.5664
# widthMm=12.5664
# thicknessMm=12.5664
displacement_mm,force_N
0.000000,0.0000
0.006549,23.8630
0.048416,145.1115
0.150528,432.4290
0.327634,906.6487
0.585533,1227.5098
0.922449,1303.3398
1.329981,1328.1306
1.795383,1331.5743
2.300942,1322.7023
2.827637,1311.5051
3.354392,1297.0180
3.860123,1275.1163
4.325411,1262.1925
4.732987,1262.5460
5.069703,1300.9107
5.327488,1331.8397
5.504475,1373.2827
5.606585,1389.0846
5.648417,1411.0760
5.654963,1410.8559`;

function stageSig(st: StageStateSnapshot = lastStageState): string {
  return `${st.type}|${st.porosity}|${st.periods}|${st.specimenSizeMm ?? 'auto'}|${st.structureMode}|${st.containerShape}`;
}

function pushHistoryTurn(userMsg: string, assistantMsg: string): void {
  conversationHistory.push(
    { role: 'user', content: userMsg },
    { role: 'assistant', content: assistantMsg.slice(0, 600) },
  );
  if (conversationHistory.length > MAX_HISTORY_MSGS) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_MSGS);
  }
}

function updateSessionPill(): void {
  const pill = $('session-pill');
  if (!pill) return;
  pill.textContent = `r${browserSession.recommendations.length} · e${browserSession.executions.length}`;
}

// ── 画布坞：iframe 就绪 + 状态条 ────────────────────────────────
const frame = $('stage-frame') as HTMLIFrameElement | null;
frame?.addEventListener('load', () => {
  $('frame-loading')?.style.setProperty('display', 'none');
  void refreshStat();
});

function applyStageState(rawState?: Record<string, unknown>, summaryText?: string): void {
  if (rawState) {
    lastStageState = {
      type: String(rawState.type ?? lastStageState.type),
      porosity: Number(rawState.porosity ?? lastStageState.porosity),
      periods: Number(rawState.periods ?? lastStageState.periods),
      specimenSizeMm: rawState.specimenSizeMm == null ? null : Number(rawState.specimenSizeMm),
      structureMode: String(rawState.structureMode ?? lastStageState.structureMode),
      containerShape: String(rawState.containerShape ?? lastStageState.containerShape),
      material: String(rawState.material ?? lastStageState.material),
    };
    if (lastVerifySummary && lastVerifySig !== stageSig(lastStageState)) {
      lastVerifySummary = null;
    }
  }
  const elState = $('stat-state');
  if (elState) {
    if (summaryText) elState.textContent = summaryText;
    else if (rawState) {
      const sizeTxt = lastStageState.specimenSizeMm != null ? ` L=${lastStageState.specimenSizeMm}mm` : '';
      elState.textContent = `${lastStageState.type} p=${lastStageState.porosity}% k=${lastStageState.periods}${sizeTxt} ${lastStageState.structureMode} ${lastStageState.containerShape}`;
    }
  }
  renderSimTriangle();
  renderCaeRunbook();
  if (!forchheimerDirty) seedForchheimerAndRun();
}

async function refreshStat(): Promise<void> {
  try {
    const s = await bridge.request('get-state', {}, 15_000) as BridgeResult;
    applyStageState(s?.state, s?.summary);
  } catch {
    renderSimTriangle();
    renderCaeRunbook();
    if (!forchheimerDirty) seedForchheimerAndRun();
  }
}

// ── 轨迹流渲染 ──────────────────────────────────────────────
function el<T extends HTMLElement>(cls: string, tag = 'div'): T {
  const d = document.createElement(tag);
  d.className = cls;
  return d as T;
}
function streamAppend(node: HTMLElement): void {
  const s = $('stream');
  if (!s) return;
  $('empty-hint')?.remove();
  s.appendChild(node);
  s.scrollTop = s.scrollHeight;
}
function addUser(text: string): void { const d = el('user'); d.textContent = text; streamAppend(d); }
let curRound = 0;
let curRepairMode = false;
function openEntry(kind: 'tool' | 'ok' | 'fail' | 'repair'): HTMLElement {
  const d = el(`entry ${kind}`);
  const t = el('tick', 'span'); t.textContent = kind === 'tool' ? '→' : kind === 'ok' ? '✓' : kind === 'fail' ? '✗' : 'M';
  const r = el('round'); r.innerHTML = `ROUND ${curRound}${curRepairMode ? ' · <b>修复菜单</b>' : ''}`;
  d.append(t, r);
  streamAppend(d);
  return d;
}
function addCard(entry: HTMLElement, name: string, badge?: string, badgeFail = false): { card: HTMLElement; args: HTMLElement; res: HTMLElement } {
  const card = el('card');
  const nm = el('name'); nm.textContent = name;
  if (badge) { const b = el(`badge${badgeFail ? ' fail' : ''}`, 'span'); b.textContent = badge; nm.appendChild(b); }
  const args = el('args');
  const res = el('res');
  card.append(nm, args, res);
  entry.appendChild(card);
  return { card, args, res };
}
function addFinal(text: string): void { const d = el('final'); d.textContent = text; streamAppend(d); }
function addErr(code: string, msg: string): void {
  const d = el('errcard');
  const b = document.createElement('b'); b.textContent = `[${code}] `;
  d.appendChild(b);
  d.appendChild(document.createTextNode(msg));
  streamAppend(d);
}

// ── 候选构建（卡片按钮与指代绑定共用的确定性执行路径）────────────────────
async function executeCandidateAction(
  recId: string,
  ordinal: number,
  candidate: SessionCandidate,
  withVerify: boolean,
  sourceTag: string,
): Promise<void> {
  const meshArgs = candidateToMeshArgs(candidate);
  const d = openEntry('tool');
  const { args, res } = addCard(
    d,
    withVerify ? 'session-reference + verify' : 'session-reference',
    `${recId} #${ordinal} · ${candidate.meetsTarget ? '达标' : '最近妥协'}`,
  );
  args.textContent = JSON.stringify(meshArgs);
  res.textContent = '确定性绑定构建中（periods=3，L=3×cellSize）…';
  try {
    const applied = await bridge.request('apply', meshArgs);
    if (applied.state) applyStageState(applied.state);
    recordExecution(browserSession, {
      recId,
      ordinal,
      candidate,
      args: meshArgs,
      withVerify,
      source: sourceTag,
    });
    updateSessionPill();
    d.classList.remove('tool');
    d.classList.add(applied.ok ? 'ok' : 'fail');
    res.textContent = `${applied.summary}\n来源：tpms_pareto 解析代理（非 FE 精确）`;
    if (withVerify) {
      const vd = openEntry('tool');
      const vCard = addCard(vd, 'tpms_design_verify', `联动验证 #${ordinal}`);
      const vArgs = { type: meshArgs.type, porosity: meshArgs.porosity, periods: meshArgs.periods };
      vCard.args.textContent = JSON.stringify(vArgs);
      const vr = await bridge.request('verify', vArgs);
      vd.classList.remove('tool');
      vd.classList.add(vr.ok && !vr.verifyFail ? 'ok' : 'fail');
      vCard.res.textContent = vr.summary.slice(0, 400);
      vCard.res.classList.toggle('bad', vr.verifyFail === true);
      renderDiag(vr.summary);
    }
    await refreshStat();
    const reply = `已按确定性绑定应用 ${recId} 第 ${ordinal} 项：${candidate.type} p=${Math.round(candidate.porosity * 100)}% periods=3 specimenSizeMm=${meshArgs.specimen_size_mm}mm（单胞 ${candidate.cellSize}mm）。口径说明：推荐指标基于 Gibson-Ashby×Kozeny-Carman 解析代理，非 FE 精确。`;
    addFinal(reply);
    pushHistoryTurn(`${sourceTag} #${ordinal}`, reply);
  } catch (e) {
    d.classList.remove('tool');
    d.classList.add('fail');
    res.classList.add('bad');
    res.textContent = `执行失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

function renderParetoCandidates(card: HTMLElement, summary: string, rawArgs: Record<string, unknown>): boolean {
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>;
    if (parsed.command !== 'pareto' || !Array.isArray(parsed.recommendations)) return false;
    recordPareto(browserSession, rawArgs, parsed);
    updateSessionPill();
    const latestRec = browserSession.recommendations[browserSession.recommendations.length - 1];
    const recId = latestRec?.id ?? `r${browserSession.recommendations.length}`;
    const list = el('cand-list');
    for (const rawC of parsed.recommendations as Array<Record<string, unknown>>) {
      const rank = Number(rawC.rank ?? 1);
      const cand: SessionCandidate = {
        rank,
        type: String(rawC.type ?? 'gyroid'),
        porosity: Number(rawC.porosity ?? 0.75),
        cellSize: Number(rawC.cellSize ?? 3),
        E_GPa: Number(rawC.E_GPa ?? 0),
        kappa_m2: Number(rawC.kappa_m2 ?? 0),
        dist_log10: Number(rawC.dist_log10 ?? 0),
        meetsTarget: rawC.meetsTarget !== false && parsed.reachable !== false,
      };
      const item = el('cand-item');
      const head = el('cand-head');
      const title = document.createElement('span');
      title.textContent = `#${rank} ${cand.type} · p=${Math.round(cand.porosity * 100)}% · k=${cand.cellSize}mm`;
      const badge = el(`badge${cand.meetsTarget ? '' : ' fail'}`, 'span');
      badge.textContent = cand.meetsTarget ? '双维达标' : '最近妥协';
      head.append(title, badge);

      const meta = el('cand-meta');
      const kExp = Number(cand.kappa_m2).toExponential(1);
      meta.textContent = `E=${cand.E_GPa} GPa · κ=${kExp} m² · Sv=${rawC.sv_per_mm ?? '?'} /mm · 总宽 3³=${(3 * cand.cellSize).toFixed(0)}mm`;

      const actions = el('cand-actions');
      const buildBtn = el<HTMLButtonElement>('cbtn', 'button');
      buildBtn.type = 'button';
      buildBtn.textContent = `构建 #${rank}`;
      buildBtn.addEventListener('click', () => {
        void executeCandidateAction(recId, rank, cand, false, '候选卡片构建');
      });

      const verifyBtn = el<HTMLButtonElement>('cbtn sec', 'button');
      verifyBtn.type = 'button';
      verifyBtn.textContent = `构建+制造检查 #${rank}`;
      verifyBtn.addEventListener('click', () => {
        void executeCandidateAction(recId, rank, cand, true, '候选卡片构建验证');
      });

      actions.append(buildBtn, verifyBtn);
      item.append(head, meta, actions);
      list.appendChild(item);
    }
    card.appendChild(list);
    return true;
  } catch {
    return false;
  }
}

// ── 诊断 / 三元核验 / CAE 五段式运行手册 ───────────────────────────────
function renderSimTriangle(): void {
  const host = $('sim-triangle');
  const tag = $('sim-tri-tag');
  if (!host) return;
  const eps = Math.min(0.95, Math.max(0.05, lastStageState.porosity / 100));
  const rho = 1 - eps;
  const mat = lastStageState.material === 'auto' ? 'tc4' : lastStageState.material;
  const baseE = BASE_MODULUS[mat] ?? BASE_MODULUS.tc4;
  const baseS = BASE_YIELD_STRENGTH[mat] ?? BASE_YIELD_STRENGTH.tc4;
  const ga = gibsonAshby(rho, lastStageState.type);
  const plateau = plateauStress(rho, lastStageState.type);
  const cellMm = lastStageState.specimenSizeMm != null
    ? lastStageState.specimenSizeMm / Math.max(1, lastStageState.periods)
    : 1;
  const fwd = forwardModel(lastStageState.type as TpmType, eps, cellMm, 1);
  const kcMm2 = fwd.kappaM2 * 1e6;

  if (tag) {
    const sizeLabel = lastStageState.specimenSizeMm != null ? `L=${lastStageState.specimenSizeMm}mm` : `k=${lastStageState.periods}(1mm/cell)`;
    tag.textContent = `${lastStageState.type} · p=${lastStageState.porosity}% · ${sizeLabel} · ${mat}`;
  }

  const cards: Array<{ title: string; badge: string; value: string; sub: string }> = [
    {
      title: '固体力学（解析 vs FEA）',
      badge: lastStageState.type === 'gyroid' ? 'FEA 幂律同源' : 'Gibson-Ashby',
      value: `E*=${(ga.E_Es * baseE).toFixed(2)} GPa · σy=${(ga.sigma_Es * baseS).toFixed(1)} MPa`,
      sub: `σ_pl=${plateau != null ? (plateau * baseS).toFixed(1) : 'n/a'} MPa。超过 5% 大应变塑性坍塌需切换 Explicit C3D10M（诚实边界 #18）。`,
    },
    {
      title: '流体输运（KC vs OpenFOAM R48）',
      badge: lastStageState.type === 'gyroid' ? 'R48 实测校准' : 'Kozeny-Carman',
      value: lastStageState.type === 'gyroid'
        ? `κ_KC=${kcMm2.toFixed(4)} · R48=${(GYROID_R48_CFD_A * Math.pow(eps, GYROID_R48_CFD_B)).toFixed(4)} mm²`
        : `κ_KC=${kcMm2.toFixed(4)} mm² · Sv=${fwd.svRatio.toFixed(2)}/mm`,
      sub: (() => {
        const tort = lastVerifySummary?.tortuosity as { tau?: Array<number | null> } | undefined;
        const tauTxt = tort?.tau ? `τ(x/y/z)=${tort.tau.map((v) => (v == null ? '∞' : v.toFixed(2))).join('/')}` : 'τ 待运行制造检查实测';
        return `${tauTxt}；R48 幂律拟合 ε∈[0.50,0.80] 仅适用于 gyroid 定尺度单胞。`;
      })(),
    },
    {
      title: '几何可制造（体素审计 + 水密门）',
      badge: lastVerifySummary ? String(lastVerifySummary.verdict) : '未验证',
      value: lastVerifySummary
        ? `壁厚 ${lastVerifySummary.minWallMm ?? 'n/a'} mm · 连通 ${lastVerifySummary.mainPoreFraction ?? '?'}%`
        : `容器 ${lastStageState.containerShape} · 拓扑 ${lastStageState.structureMode}`,
      sub: lastVerifySummary
        ? `孔喉 ${lastVerifySummary.minThroatMm ?? 'n/a'} mm · 封闭腔 ${lastVerifySummary.closedDomains ?? 0} 域（R${lastVerifySummary.R ?? '?'}）。`
        : '发送「验证当前设计壁厚」运行 3D medial 壁厚与连通性审计。',
    },
  ];

  host.innerHTML = '';
  for (const item of cards) {
    const c = el('tri-card');
    const tl = el('tl');
    const tSpan = document.createElement('span'); tSpan.textContent = item.title;
    const bSpan = el('badge', 'span'); bSpan.textContent = item.badge;
    tl.append(tSpan, bSpan);
    const tv = el('tv'); tv.textContent = item.value;
    const ts = el('ts'); ts.textContent = item.sub;
    c.append(tl, tv, ts);
    host.appendChild(c);
  }
}

function renderCaeRunbook(): void {
  const pre = $('cae-cmd');
  const badge = $('cae-mode-badge');
  const note = $('cae-mode-note');
  if (!pre) return;
  const strainEl = $('cae-strain') as HTMLInputElement | null;
  const strainRaw = Number(strainEl?.value ?? 0.05);
  const strain = Number.isFinite(strainRaw) ? Math.min(0.60, Math.max(0.01, strainRaw)) : 0.05;
  const isLarge = strain > 0.05;
  const porFrac = Math.min(0.95, Math.max(0.05, lastStageState.porosity / 100)).toFixed(2);
  const p0Type = lastStageState.type === 'diamond' ? 'diamond' : 'gyroid';
  const structFlag = lastStageState.structureMode === 'shell' ? 'sheet' : 'network';
  const tag = `${p0Type}_k${lastStageState.periods}_p${Math.round(lastStageState.porosity)}`;

  const setupCmd = isLarge
    ? `python sim/p2_static_setup.py sim/out/${tag}.inp --strain ${strain.toFixed(2)} --nlgeom --plastic --contact --explicit 2.0 --mass-dt 2e-7`
    : `python sim/p2_static_setup.py sim/out/${tag}.inp --strain ${strain.toFixed(2)}`;
  const feat = isLarge ? 'NLGEOM+PLASTIC+CONTACT+EXPL2ms' : 'LE';

  pre.textContent = [
    `# [1] 生成水密 STL（p0_generate 当前支持 gyroid/diamond）`,
    `python sim/p0_generate.py --type ${p0Type} --structure ${structFlag} --k ${lastStageState.periods} --R 48 --por ${porFrac} --out sim/out/${tag}.stl`,
    ``,
    `# [2] 四面体体网格（gmsh C3D10 → INP）`,
    `python sim/p1_mesh.py sim/out/${tag}.stl --lmax 0.5`,
    ``,
    `# [3] ABAQUS 前处理组装（ε=${(strain * 100).toFixed(1)}%${isLarge ? ' → 自动切 Explicit C3D10M' : ' → Standard 小应变'}）`,
    setupCmd,
    ``,
    `# [4] ABAQUS 求解 + 应力应变 CSV 提取`,
    `abaqus job=${tag}_${feat}_static cpus=4 interactive && python sim/p2_extract_csv.py sim/out/${tag}_${feat}_static.odb`,
    ``,
    `# [5] 流体负空间提取 / OpenFOAM R48 Darcy 扫描（WSL）`,
    `python sim/p3_fluid_domain.py --k 1 --R 48 --por ${porFrac} && wsl bash sim/cfd/tpms_cell/run_K_scan.sh lvl2`,
  ].join('\n');

  if (badge) {
    badge.textContent = isLarge ? 'Explicit C3D10M（>5% 大应变）' : 'Standard 线弹性/小应变（≤5%）';
    badge.classList.toggle('fail', isLarge);
  }
  if (note) {
    const typeCaveat = lastStageState.type !== 'gyroid' && lastStageState.type !== 'diamond'
      ? ` 当前视口为 ${lastStageState.type}，p0_generate.py 仅支持 gyroid/diamond，其他曲面族请先从 3D 视口导出水密 STL 后直接执行步骤 [2]。`
      : '';
    note.textContent = isLarge
      ? `诚实边界 #18：目标应变 ${(strain * 100).toFixed(1)}% > 5% 时纯静态隐式易在孔壁塑性铰分岔处不收敛，已切换 Explicit C3D10M + 全域自接触；后处理须核对 ALLKE/ALLIE < 10%。${typeCaveat}`
      : `ε ≤ 5% 处于 Standard 弹性模量/屈服点稳定提取区（诚实边界 #18）；本面板命令参数与当前设计实时联动。${typeCaveat}`;
  }
}

function renderDiag(summary: string): void {
  try {
    const j = JSON.parse(summary) as Record<string, unknown>;
    lastVerifySummary = j;
    lastVerifySig = stageSig(lastStageState);
    const tort = j.tortuosity as { tau?: Array<number | null> } | undefined;
    const tauStr = tort?.tau ? tort.tau.map((v) => (v == null ? '∞' : v.toFixed(2))).join(' / ') : 'n/a';
    const cells: Array<[string, string, string?]> = [
      ['verdict', String(j.verdict), j.verdict === 'pass' ? 'ok' : 'bad'],
      ['最小壁厚（medial）', j.minWallMm == null ? 'n/a' : `${j.minWallMm} mm`],
      ['主域孔喉', j.minThroatMm == null ? 'n/a' : `${j.minThroatMm} mm`],
      ['封闭孔腔', `${j.closedDomains} 域`],
      ['孔隙连通', `${j.mainPoreFraction}%`],
      ['三向迂曲度 τ(x/y/z)', tauStr],
      ['体素分辨率', `R${j.R}`],
      ['壁厚阈值', `${j.minWallThresholdMm} mm`],
    ];
    const grid = $('diag');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [k, v, cls] of cells) {
      const c = el('cell');
      const kd = el('k'); kd.textContent = k;
      const vd = el(`v${cls ? ' ' + cls : ''}`); vd.textContent = v;
      c.append(kd, vd);
      grid.appendChild(c);
    }
    grid.hidden = false;
    $('diag-empty')?.style.setProperty('display', 'none');
    renderSimTriangle();
  } catch { /* 非 verify JSON 忽略 */ }
}

function addFileCard(name: string, ok: boolean, meta = ''): void {
  const list = $('filelist');
  if (!list) return;
  $('exp-empty')?.style.setProperty('display', 'none');
  list.hidden = false;
  const f = el('file');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '15'); icon.setAttribute('height', '15');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7');
  icon.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/>';
  const nm = el('fname'); nm.textContent = name;
  const st = el(`st${ok ? '' : ' rej'}`, 'span'); st.textContent = ok ? '水密门通过' : '已拒产';
  f.append(icon, nm);
  if (meta) { const m = el('meta'); m.textContent = meta; f.appendChild(m); }
  f.appendChild(st);
  list.prepend(f);
}

// ── 运行时（秒表/停止/预算表/事件渲染）────────────────────────
let stopped = false;
let clockTimer: number | null = null;
let clockSec = 0;
function setBusy(busy: boolean): void {
  const dot = $('status-dot');
  const stopBtn = $('stop-btn');
  if (busy) {
    dot?.classList.add('busy');
    stopBtn?.removeAttribute('hidden');
    clockSec = 0;
    const clock = $('clock');
    if (clock) clock.textContent = '0s';
    clockTimer = window.setInterval(() => { clockSec++; const c = $('clock'); if (c) c.textContent = `${clockSec}s`; }, 1_000);
  } else {
    dot?.classList.remove('busy');
    stopBtn?.setAttribute('hidden', '');
    if (clockTimer != null) { window.clearInterval(clockTimer); clockTimer = null; }
  }
}
function setBudget(used: number): void {
  const u = $('budget-used'); if (u) u.textContent = String(used);
  const b = $('budget-bar'); if (b) b.style.width = `${Math.min(100, (used / 4096) * 100)}%`;
}

const toolImpls = new Map<string, ToolImpl>([
  ['tpms_list', { name: 'tpms_list', write: false, exec: () => agentListExec() }],
  ['tpms_estimate', { name: 'tpms_estimate', write: false, exec: (a) => agentEstimateExec(a) }],
  ['tpms_mesh', { name: 'tpms_mesh', write: true, exec: (a) => bridge.request('apply', a) }],
  ['tpms_scenario', { name: 'tpms_scenario', write: true, exec: (a) => bridge.request('scenario', { design: String(a.design ?? 'current.json') }) }],
  ['tpms_design_verify', { name: 'tpms_design_verify', write: false, exec: (a) => bridge.request('verify', a) }],
  ['tpms_pareto', { name: 'tpms_pareto', write: false, exec: (a) => { lastParetoArgs = a; return agentParetoExec(a); } }],
]);

const pendingToolCards = new Map<string, HTMLElement[]>();
let activeUserText = '';

function renderEvent(e: AgentEvent): void {
  if (e.type === 'round') { curRound = e.round; curRepairMode = e.repairMode; }
  else if (e.type === 'tool-start') {
    const d = openEntry('tool');
    const { args } = addCard(d, e.name);
    args.textContent = e.digest;
    const q = pendingToolCards.get(e.name) ?? [];
    q.push(d);
    pendingToolCards.set(e.name, q);
  } else if (e.type === 'tool-end') {
    const q = pendingToolCards.get(e.name);
    const hostEntry = q?.shift();
    let res: HTMLElement;
    let hostCard: HTMLElement;
    if (hostEntry) {
      res = hostEntry.querySelector('.res') as HTMLElement;
      hostCard = hostEntry.querySelector('.card') as HTMLElement;
      hostEntry.classList.remove('tool');
      hostEntry.classList.add(e.result.ok ? 'ok' : 'fail');
      if (e.result.verifyFail) {
        const nm = hostEntry.querySelector('.name') as HTMLElement;
        const b = el('badge fail', 'span'); b.textContent = 'verdict: fail';
        nm.appendChild(b);
      }
    } else {
      const d = openEntry(e.result.ok ? 'ok' : 'fail');
      const created = addCard(d, e.name, e.result.verifyFail ? 'verdict: fail' : undefined, e.result.verifyFail);
      res = created.res;
      hostCard = created.card;
    }
    res.textContent = e.result.summary.slice(0, 400);
    res.classList.toggle('bad', e.result.verifyFail === true);
    setBudget(e.budgetUsed);
    if (e.name === 'tpms_design_verify') { renderDiag(e.result.summary); void refreshStat(); }
    if (e.name === 'tpms_pareto' && e.result.ok) {
      renderParetoCandidates(hostCard, e.result.summary, lastParetoArgs);
    }
    if (e.name === 'tpms_mesh') {
      if (e.result.state) applyStageState(e.result.state);
      else void refreshStat();
    }
    if (e.name === 'tpms_scenario') {
      if (e.result.state) applyStageState(e.result.state);
      else void refreshStat();
      try {
        const sc = JSON.parse(e.result.summary) as { design?: string; watertight?: boolean; deliverables?: string[] };
        if (sc.design) {
          addFileCard(`${sc.design} (${sc.deliverables?.[0] ?? 'M5 场景包'})`, sc.watertight !== false, 'M5 场景核验');
        }
      } catch { /* 非 JSON 忽略 */ }
    }
    if (e.name === 'tpms_mesh' && e.result.summary.includes('已导出 ')) {
      const m = /已导出 ([\w.-]+\.stl)/.exec(e.result.summary);
      if (m) addFileCard(m[1], true);
    }
    if (e.name === 'tpms_mesh' && e.result.summary.includes('导出被水密门拒绝')) {
      const m = /out[=:：]\s*([\w.-]+\.stl)/.exec(e.result.summary);
      addFileCard(m?.[1] ?? '(未命名).stl', false);
    }
  } else if (e.type === 'repair-applied') {
    const d = openEntry('repair');
    const { args, res } = addCard(d, 'apply_repair', '有界补丁');
    args.textContent = JSON.stringify(e.patches);
    res.textContent = e.reason;
    void refreshStat();
  } else if (e.type === 'budget-stop') {
    addErr('E5 预算熔断', `本次指令算力预算超限（Σ=${e.used}/${e.limit}）——请减小周期数或分步下达`);
  } else if (e.type === 'rejected') {
    addErr('契约拦截', e.errors.slice(0, 2).join('；'));
  } else if (e.type === 'stopped') {
    addFinal('已手动停止。');
  } else if (e.type === 'final') {
    addFinal(e.text);
    setBudget(e.budgetUsed);
    if (activeUserText) pushHistoryTurn(activeUserText, e.text);
    void refreshStat();
  }
}

// ── 本地规则逆设计与估算辅助（零 Key 可跑通帕累托选型 + 物理估算）───────────────────
function normalizeSup(raw: string): string {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return raw.replace(/[⁻−]/g, '-').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(sup.indexOf(c)));
}

function parseParetoTargets(raw: string): { target_e_gpa: number; target_k_nm2: number; top: number } | null {
  const txt = normalizeSup(raw);
  const looksPareto = /(?:帕累托|pareto|逆设计|选型|推荐.*(?:构型|方案|前)|该选什么)/i.test(txt)
    || (/\be\b.*(?:gpa|模量)/i.test(txt) && /(?:κ|kappa|渗透率)/i.test(txt));
  if (!looksPareto) return null;

  const mE = txt.match(/(?:e\s*(?:≥|>=|=|>|＞|至少|为)?\s*|模量\s*(?:≥|>=|=|>|至少|为)?\s*)(\d+(?:\.\d+)?)\s*(?:gpa)?/i);
  const mK = txt.match(/(?:κ|kappa|渗透率)\s*(?:≥|>=|=|>|＞|至少|为)?\s*(\d+(?:\.\d+)?)\s*(?:[×x*]\s*10\^?(-?\d+)|e([+-]?\d+))?/i);
  if (!mE || !mK) return null;

  const eGpa = Number(mE[1]);
  const coef = Number(mK[1]);
  const expStr = mK[2] ?? mK[3];
  const exp = expStr != null ? Number(expStr) : -9;
  const kNm2 = coef * Math.pow(10, exp + 9);
  if (!Number.isFinite(eGpa) || eGpa <= 0 || !Number.isFinite(kNm2) || kNm2 <= 0) return null;

  const mTop = txt.match(/(?:前|top)\s*(\d+)/i);
  const top = mTop ? Math.min(10, Math.max(1, Number(mTop[1]))) : 3;
  return { target_e_gpa: eGpa, target_k_nm2: Number(kNm2.toFixed(6)), top };
}

async function runRulesPareto(args: { target_e_gpa: number; target_k_nm2: number; top: number }, userText: string): Promise<void> {
  const d = openEntry('tool');
  const { card, args: aEl, res } = addCard(d, 'tpms_pareto', '本地逆设计扫描');
  aEl.textContent = JSON.stringify(args);
  res.textContent = '正在扫描 26 族 × 孔隙率 0.55..0.90 × 单胞 2..5 mm（832 点 Pareto 前沿）…';
  const r = await agentParetoExec(args);
  d.classList.remove('tool');
  d.classList.add(r.ok ? 'ok' : 'fail');
  if (!r.ok) {
    res.classList.add('bad');
    res.textContent = r.summary;
    return;
  }
  const parsed = JSON.parse(r.summary) as { reachable: boolean; recommendations: Array<Record<string, unknown>> };
  res.textContent = `扫描 832 点 → 前沿候选 Top-${args.top}（${parsed.reachable ? '目标可达' : '不可达，已给最近妥协'}），可点击下方卡片构建或直接说「把第一个构建出来」。`;
  renderParetoCandidates(card, r.summary, args);
  const summaryReply = `已为目标 E≥${args.target_e_gpa} GPa、κ≥${args.target_k_nm2}×10⁻⁹ m² 生成 Top-${args.top} 帕累托推荐（Gibson-Ashby×Kozeny-Carman 解析代理，非 FE 精确）。`;
  addFinal(summaryReply);
  pushHistoryTurn(userText, summaryReply);
}

async function runRulesEstimate(type: string, porosityFrac: number, userText: string): Promise<void> {
  const args = { type, porosity: porosityFrac };
  const d = openEntry('tool');
  const { args: aEl, res } = addCard(d, 'tpms_estimate', '物理 + R48 校准');
  aEl.textContent = JSON.stringify(args);
  const r = await agentEstimateExec(args);
  d.classList.remove('tool');
  d.classList.add(r.ok ? 'ok' : 'fail');
  res.textContent = r.summary;
  lastStageState = { ...lastStageState, type, porosity: porosityFrac > 1 ? porosityFrac : Math.round(porosityFrac * 100) };
  renderSimTriangle();
  renderCaeRunbook();
  if (r.ok) {
    const p = JSON.parse(r.summary) as Record<string, unknown>;
    const cfdNote = p.kappa_cfd_r48_mm2 != null ? `；OpenFOAM R48 定尺度单胞拟合 κ=${p.kappa_cfd_r48_mm2} mm²（KC 比 ${p.kc_ratio}×）` : '';
    const reply = `${type}（p=${Math.round(Number(p.porosity) * 100)}%）解析估算：E*=${p.E_GPa} GPa，σy=${p.yield_MPa} MPa，Sv=${p.sv_per_mm}/mm，κ_KC=${p.kappa_kc_mm2} mm²${cfdNote}（解析近似，非 FE 精确）。`;
    addFinal(reply);
    pushHistoryTurn(userText, reply);
  }
}

// ── 在线数值仿真 / ISO 13314 + Forchheimer 后处理 / CAE 交付与 M5 场景 ──────
let lastSimCurve: Array<{ strain: number; stressMPa: number; peeq: number; activeElems: number }> | null = null;
let lastSimDtMeta: {
  effectiveModulusGPa?: number;
  maxStressMPa?: number;
  plateauStressMPa?: number;
  dtVsRefRatio?: number;
  collapsed?: boolean;
  collapseStrain?: number | null;
  maxPEEQ?: number;
  elapsedMs?: number;
  vertexColored?: boolean;
} | null = null;
const lastSimSnapshot: Record<string, unknown> = {};
let lastIsoPostProcSummary: CalibrationMetricsSummary | null = null;
let lastForchSummary: {
  lengthMm: number;
  kIntMm2: number;
  A: number;
  B: number;
  inertialPct: [number, number];
  kAppMm2: [number, number];
  wssMPa: number;
} | null = null;
let lastPipelineReport: Record<string, unknown> | null = null;

function drawTissueCanvas(tData: Record<string, unknown>): void {
  const canvas = $('iso-canvas') as HTMLCanvasElement | null;
  const curve = Array.isArray(tData.curve)
    ? tData.curve as Array<{ day: number; meanO2: number; viability: number; necrosisPct: number; mineralPct: number }>
    : [];
  const badge = $('pp-source-badge');
  const status = $('iso-status');
  if (badge) badge.textContent = `28天骨长入 (R=${tData.R ?? '?'})`;
  if (status) {
    status.textContent = `骨长入反应-扩散轨迹：0–${tData.days ?? 28}d 平均氧 ${tData.finalMeanO2} · 存活率 ${tData.finalViabilityPct}% · 骨矿化 ${tData.finalMineralPct}%${tData.vertexColored ? '（3D 视口已着染 O₂ 浓度场）' : ''}。`;
  }
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0, 0, W, H);
  if (curve.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('暂无 28 天骨长入采样点', 20, H / 2);
    return;
  }
  const padL = 46;
  const padR = 16;
  const padT = 26;
  const padB = 28;
  const pw = W - padL - padR;
  const ph = H - padT - padB;
  const xMax = Math.max(1, curve[curve.length - 1].day || 28);
  const minMax = Math.max(10, ...curve.map((c) => Number(c.mineralPct) || 0));

  ctx.strokeStyle = 'rgba(148,163,184,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = padT + (ph * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(W - padR, yy);
    ctx.stroke();
  }
  const plotSeries = (color: string, getY: (c: typeof curve[number]) => number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    curve.forEach((c, idx) => {
      const x = padL + (c.day / xMax) * pw;
      const v = Math.max(0, Math.min(1, getY(c)));
      const y = padT + ph * (1 - v);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  plotSeries('#38bdf8', (c) => Number(c.meanO2));
  plotSeries('#34d399', (c) => Number(c.viability));
  plotSeries('#f59e0b', (c) => (Number(c.mineralPct) || 0) / minMax);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillText(`0–${xMax} 天骨组织长入演化`, padL, 16);
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('— O₂', W - 180, 16);
  ctx.fillStyle = '#34d399';
  ctx.fillText('— 存活率', W - 135, 16);
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('— 骨矿化', W - 75, 16);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText('0d', padL, H - 8);
  ctx.fillText(`${Math.round(xMax / 2)}d`, padL + pw * 0.48, H - 8);
  ctx.fillText(`${xMax}d`, W - padR - 22, H - 8);
  ctx.fillText('100%', 6, padT + 8);
  ctx.fillText('0', 22, padT + ph);
}

function drawPhononicCanvas(phData: Record<string, unknown>): void {
  const canvas = $('iso-canvas') as HTMLCanvasElement | null;
  const pathX = Array.isArray(phData.pathX) ? (phData.pathX as number[]) : [];
  const bandsHz = Array.isArray(phData.bandsHz) ? (phData.bandsHz as number[][]) : [];
  const bandgaps = Array.isArray(phData.bandgaps) ? (phData.bandgaps as Array<{ lowerHz: number; upperHz: number; bgPct: number }>) : [];
  const ticks = Array.isArray(phData.ticks) ? (phData.ticks as Array<{ label: string; x: number }>) : [];
  const badge = $('pp-source-badge');
  const status = $('iso-status');
  if (badge) badge.textContent = `声子色散能带 (N=${phData.N ?? 7})`;
  if (status) {
    const gapDesc = bandgaps.length
      ? `${bandgaps.length} 个完全带隙 (${(bandgaps[0].lowerHz / 1000).toFixed(1)}–${(bandgaps[0].upperHz / 1000).toFixed(1)} kHz, BG=${bandgaps[0].bgPct}%)`
      : '路径上无完全禁带';
    status.textContent = `Bloch-Floquet 声子晶体色散曲线（Γ-X-M-R-Γ）：Γ 零模态=${phData.zeroModesAtGamma}、声速比=${phData.waveSpeedRatio}、${gapDesc}。`;
  }
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0, 0, W, H);
  if (!pathX.length || !bandsHz.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('暂无能带色散数据', 20, H / 2);
    return;
  }
  const padL = 52;
  const padR = 16;
  const padT = 24;
  const padB = 28;
  const pw = W - padL - padR;
  const ph = H - padT - padB;
  const xMax = pathX[pathX.length - 1] || 1;
  let fMax = 1;
  for (const b of bandsHz) for (const f of b) if (f > fMax) fMax = f;
  const yOf = (hz: number) => padT + ph * (1 - hz / fMax);

  for (const g of bandgaps) {
    const yTop = yOf(g.upperHz);
    const yBot = yOf(g.lowerHz);
    ctx.fillStyle = 'rgba(250,204,21,0.22)';
    ctx.fillRect(padL, yTop, pw, Math.max(2, yBot - yTop));
  }
  ctx.strokeStyle = 'rgba(148,163,184,0.22)';
  ctx.lineWidth = 1;
  for (const tk of ticks) {
    const x = padL + tk.x * pw;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + ph);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(tk.label, x - 4, H - 8);
  }
  const colors = ['#38bdf8', '#38bdf8', '#f59e0b', '#a78bfa', '#a78bfa', '#34d399', '#34d399', '#f472b6'];
  bandsHz.forEach((branch, bi) => {
    ctx.strokeStyle = colors[bi % colors.length];
    ctx.lineWidth = bi < 3 ? 1.8 : 1.2;
    ctx.beginPath();
    for (let k = 0; k < branch.length && k < pathX.length; k++) {
      const x = padL + (pathX[k] / xMax) * pw;
      const y = yOf(branch[k]);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px system-ui,sans-serif';
  ctx.fillText(`Bloch-Floquet 声子能带 · N=${phData.N ?? 7} · 禁带=${bandgaps.length}`, padL, 16);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px monospace';
  ctx.fillText(`${(fMax / 1000).toFixed(0)}kHz`, 4, padT + 8);
  ctx.fillText('0Hz', 14, padT + ph);
}

function activateTab(paneId: 'p3d' | 'pdiag' | 'pexp'): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((x) => {
    x.classList.toggle('on', x.dataset.pane === paneId);
  });
  document.querySelectorAll('.tabpane').forEach((p) => {
    p.classList.toggle('on', p.id === paneId);
  });
}

function renderKVGrid(gridId: string, cells: Array<[string, string, string?]>): void {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = '';
  for (const [k, v, cls] of cells) {
    const c = el('cell');
    const kd = el('k'); kd.textContent = k;
    const vd = el(`v${cls ? ' ' + cls : ''}`); vd.textContent = v;
    c.append(kd, vd);
    grid.appendChild(c);
  }
  grid.hidden = false;
}

function drawPostProcCanvas(opts: {
  points: Array<{ x: number; y: number }>;
  title: string;
  xLabel: string;
  yLabel: string;
  plateau?: number;
  edFrac?: number | null;
}): void {
  const canvas = $('iso-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1322';
  ctx.fillRect(0, 0, W, H);

  if (opts.points.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('暂无曲线采样点', 20, H / 2);
    return;
  }

  const padL = 52;
  const padR = 16;
  const padT = 24;
  const padB = 30;
  const pw = W - padL - padR;
  const ph = H - padT - padB;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMax = 1e-6;
  for (const p of opts.points) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  if (xMax <= xMin) xMax = xMin + 1;
  yMax *= 1.12;
  const sx = (x: number) => padL + ((x - xMin) / (xMax - xMin)) * pw;
  const sy = (y: number) => padT + ph - (Math.max(0, y) / yMax) * ph;

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yy = padT + (ph * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    const yVal = yMax * (1 - i / 4);
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(yVal >= 100 ? yVal.toFixed(0) : yVal.toFixed(1), 6, yy + 3);
  }

  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, H - padB);
  ctx.lineTo(W - padR, H - padB);
  ctx.stroke();

  if (opts.plateau != null && Number.isFinite(opts.plateau) && opts.plateau > 0) {
    const py = sy(opts.plateau);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.font = '10px monospace';
    ctx.fillText(`σ_pl=${opts.plateau.toFixed(1)} MPa`, padL + 6, Math.max(padT + 10, py - 4));
    ctx.restore();
  }

  if (opts.edFrac != null && Number.isFinite(opts.edFrac)) {
    const ex = sx(opts.edFrac * 100);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#34d399';
    ctx.beginPath(); ctx.moveTo(ex, padT); ctx.lineTo(ex, H - padB); ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.font = '10px monospace';
    ctx.fillText(`εd=${(opts.edFrac * 100).toFixed(1)}%`, Math.min(W - 72, ex + 4), padT + 12);
    ctx.restore();
  }

  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  opts.points.forEach((p, idx) => {
    const px = sx(p.x);
    const py = sy(p.y);
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '11px monospace';
  ctx.fillText(opts.title, padL, 14);
  ctx.fillStyle = '#64748b';
  ctx.font = '10px monospace';
  ctx.fillText(opts.xLabel, W - padR - 64, H - 8);
  ctx.fillText(opts.yLabel, 6, padT - 8);
}

function renderDtPostProc(): void {
  if (!lastSimCurve || lastSimCurve.length < 2) {
    void runSimulateFlow('compression', false);
    return;
  }
  const badge = $('pp-source-badge');
  const status = $('iso-status');
  if (badge) badge.textContent = '在线 DT (0–3.5%)';
  drawPostProcCanvas({
    points: lastSimCurve.map((p) => ({ x: p.strain * 100, y: p.stressMPa })),
    title: `Digital Twin PCG · ${lastStageState.type} p=${lastStageState.porosity}% (R=8 单胞)`,
    xLabel: '应变 ε (%)',
    yLabel: '应力 (MPa)',
    plateau: lastSimDtMeta?.plateauStressMPa,
  });
  if (status) {
    status.textContent = '当前为 R=8 单胞 0–3.5% 弹塑性 DT 压缩曲线；ISO 13314 完整平台/密实化反演需 ε_max ≥ 40%，可切换 ABAQUS EXPL 或粘贴 ≥40% CSV。';
  }
  const lastPt = lastSimCurve[lastSimCurve.length - 1];
  renderKVGrid('iso-metrics', [
    ['DT 有效模量 E*', lastSimDtMeta?.effectiveModulusGPa != null ? `${lastSimDtMeta.effectiveModulusGPa} GPa` : 'n/a'],
    ['DT 峰值应力', lastSimDtMeta?.maxStressMPa != null ? `${lastSimDtMeta.maxStressMPa} MPa` : 'n/a'],
    ['GA 平台参考 σ_pl', lastSimDtMeta?.plateauStressMPa != null ? `${lastSimDtMeta.plateauStressMPa} MPa` : 'n/a'],
    ['DT / 基准比', lastSimDtMeta?.dtVsRefRatio != null ? `${lastSimDtMeta.dtVsRefRatio}×` : 'n/a'],
    ['末点 PEEQ', lastSimDtMeta?.maxPEEQ != null ? `${(lastSimDtMeta.maxPEEQ * 100).toFixed(2)}%` : `${(lastPt.peeq * 100).toFixed(2)}%`],
    ['求解耗时', lastSimDtMeta?.elapsedMs != null ? `${lastSimDtMeta.elapsedMs} ms` : 'n/a'],
  ]);
}

function extractHeaderDims(text: string): { lengthMm: number; widthMm: number; thicknessMm: number } | undefined {
  const mL = /^#\s*lengthMm\s*=\s*([0-9.]+)/im.exec(text);
  const mW = /^#\s*widthMm\s*=\s*([0-9.]+)/im.exec(text);
  const mT = /^#\s*thicknessMm\s*=\s*([0-9.]+)/im.exec(text);
  const lengthMm = mL ? Number(mL[1]) : NaN;
  const widthMm = mW ? Number(mW[1]) : lengthMm;
  const thicknessMm = mT ? Number(mT[1]) : widthMm;
  if (lengthMm > 0 && widthMm > 0 && thicknessMm > 0) {
    return { lengthMm, widthMm, thicknessMm };
  }
  return undefined;
}

function runIso13314PostProc(
  sourceLabel: string,
  text: string,
  inputType: 'displacement-force' | 'strain-stress',
  specimenDimensions?: { lengthMm: number; widthMm: number; thicknessMm: number },
): CalibrationMetricsSummary | null {
  const badge = $('pp-source-badge');
  const status = $('iso-status');
  try {
    const resolvedDims = inputType === 'displacement-force'
      ? (specimenDimensions ?? extractHeaderDims(text))
      : specimenDimensions;
    const res = fitExperimentalCurve({ text, inputType, specimenDimensions: resolvedDims });
    const m: Iso13314Metrics = res.metrics;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < res.cleanedCurve.strain.length; i++) {
      pts.push({ x: res.cleanedCurve.strain[i] * 100, y: res.cleanedCurve.stress[i] });
    }
    if (badge) badge.textContent = sourceLabel;
    drawPostProcCanvas({
      points: pts,
      title: `${sourceLabel} · ISO 13314 (${pts.length} 点)`,
      xLabel: '应变 ε (%)',
      yLabel: '应力 (MPa)',
      plateau: m.plateauStress,
      edFrac: m.densificationStrain,
    });
    if (status) {
      status.textContent = `ISO 13314 反演完成（${sourceLabel} · Toe 虚拟原点补偿 ${(m.virtualOriginStrain * 100).toFixed(2)}%，采样 ${pts.length} 点）。`;
    }
    const eStr = m.elasticModulusE >= 1000
      ? `${(m.elasticModulusE / 1000).toFixed(2)} GPa`
      : `${m.elasticModulusE.toFixed(1)} MPa`;
    const edStr = m.densificationStrain != null
      ? `${(m.densificationStrain * 100).toFixed(1)}% (已识别)`
      : `未达密实化 (末点 ${(m.energyAbsorptionEndStrain * 100).toFixed(1)}%)`;
    renderKVGrid('iso-metrics', [
      ['准弹性模量 E*', eStr],
      ['屈服强度 Rp0.2', `${m.proofStressRp02.toFixed(2)} MPa`],
      ['第一屈服峰值', `${m.firstPeakStress.toFixed(2)} MPa @ ${(m.firstPeakStrain * 100).toFixed(1)}%`],
      ['平台应力 σ_pl', `${m.plateauStress.toFixed(2)} MPa`],
      ['密实化应变 εd', edStr],
      ['吸能密度 Wv', `${m.energyAbsorptionW.toFixed(2)} MJ/m³`],
      ['峰值效率 η_max', m.maxEfficiencyEta.toFixed(3)],
      ['Toe 原点补偿', `${(m.virtualOriginStrain * 100).toFixed(2)}%`],
    ]);
    const isoSummary: CalibrationMetricsSummary = {
      sourceLabel,
      elasticModulusStr: eStr,
      rp02: m.proofStressRp02,
      plateau: m.plateauStress,
      edStr,
      energyW: m.energyAbsorptionW,
    };
    lastIsoPostProcSummary = isoSummary;
    return isoSummary;
  } catch (e: unknown) {
    if (badge) badge.textContent = `${sourceLabel} · 失败`;
    if (status) status.textContent = `ISO 13314 反演拒绝：${e instanceof Error ? e.message : String(e)}`;
    const grid = $('iso-metrics');
    if (grid) grid.hidden = true;
    return null;
  }
}

interface CalibrationMetricsSummary {
  sourceLabel: string;
  elasticModulusStr: string;
  rp02: number;
  plateau: number;
  edStr: string;
  energyW: number;
}

function seedForchheimerAndRun(): void {
  const eps = Math.min(0.95, Math.max(0.05, lastStageState.porosity / 100));
  const L_mm = lastStageState.specimenSizeMm ?? Math.max(1, lastStageState.periods) * 1.0;
  const cellMm = L_mm / Math.max(1, lastStageState.periods);
  const kMm2 = lastStageState.type === 'gyroid'
    ? GYROID_R48_CFD_A * Math.pow(eps, GYROID_R48_CFD_B)
    : forwardModel(lastStageState.type as TpmType, eps, cellMm, 1).kappaM2 * 1e6;
  const kM2 = Math.max(1e-13, kMm2 * 1e-6);
  const L_m = L_mm * 1e-3;
  const areaM2 = L_m * L_m;
  const mu = 1.45e-3;
  const A_theo = (mu * L_m) / (areaM2 * kM2);
  const v1 = 1.0;
  const v2 = 10.0;
  const q1 = v1 * 1e-3 * areaM2;
  const q2 = v2 * 1e-3 * areaM2;
  const B_theo = (0.04 * A_theo) / Math.max(1e-12, q2);
  const dp1 = A_theo * q1 + B_theo * q1 * q1;
  const dp2 = A_theo * q2 + B_theo * q2 * q2;
  const wssVal = Math.min(48, Math.max(4, 14 / Math.sqrt(Math.max(0.02, kMm2))));

  const v1El = $('fc-v1') as HTMLInputElement | null;
  const dp1El = $('fc-dp1') as HTMLInputElement | null;
  const v2El = $('fc-v2') as HTMLInputElement | null;
  const dp2El = $('fc-dp2') as HTMLInputElement | null;
  const wssEl = $('fc-wss') as HTMLInputElement | null;
  if (v1El) v1El.value = v1.toFixed(1);
  if (dp1El) {
    dp1El.value = dp1.toFixed(3);
    delete dp1El.dataset.lengthMm;
    delete dp1El.dataset.muPas;
  }
  if (v2El) v2El.value = v2.toFixed(1);
  if (dp2El) dp2El.value = dp2.toFixed(3);
  if (wssEl) wssEl.value = wssVal.toFixed(1);
  runForchheimerPanel(true);
}

function runForchheimerPanel(isSeeded = false): string {
  const v1 = Number(($('fc-v1') as HTMLInputElement | null)?.value ?? 0);
  const dp1El = $('fc-dp1') as HTMLInputElement | null;
  const dp1 = Number(dp1El?.value ?? 0);
  const v2 = Number(($('fc-v2') as HTMLInputElement | null)?.value ?? 0);
  const dp2 = Number(($('fc-dp2') as HTMLInputElement | null)?.value ?? 0);
  const wss = Number(($('fc-wss') as HTMLInputElement | null)?.value ?? 0);
  const status = $('fc-status');
  const dsLen = !isSeeded && dp1El?.dataset.lengthMm ? Number(dp1El.dataset.lengthMm) : NaN;
  const dsMu = !isSeeded && dp1El?.dataset.muPas ? Number(dp1El.dataset.muPas) : NaN;
  const L_mm = Number.isFinite(dsLen) && dsLen > 0
    ? dsLen
    : (lastStageState.specimenSizeMm ?? Math.max(1, lastStageState.periods) * 1.0);
  const muPas = Number.isFinite(dsMu) && dsMu > 0 ? dsMu : 1.45e-3;
  const L_m = L_mm * 1e-3;
  const areaM2 = L_m * L_m;

  try {
    const fc = forchheimerTwoPoint({
      q1: (v1 * 1e-3) * areaM2,
      dp1,
      q2: (v2 * 1e-3) * areaM2,
      dp2,
      mu: muPas,
      length: L_m,
      area: areaM2,
    });
    const kMm2 = fc.kInt * 1e6;
    const wssBand = wss >= 5 && wss <= 25
      ? '骨长入理想剪应力带 (5–25 mPa)'
      : wss < 5 ? '偏低 (<5 mPa，成骨刺激弱)' : '偏高 (>25 mPa，防细胞冲刷)';
    const wssCls = wss >= 5 && wss <= 25 ? 'ok' : 'bad';
    lastForchSummary = {
      lengthMm: L_mm,
      kIntMm2: kMm2,
      A: fc.A,
      B: fc.B,
      inertialPct: [fc.inertialFraction[0] * 100, fc.inertialFraction[1] * 100],
      kAppMm2: [fc.kApp[0] * 1e6, fc.kApp[1] * 1e6],
      wssMPa: wss,
    };
    renderKVGrid('fc-metrics', [
      ['固有渗透率 K_int', `${kMm2.toFixed(4)} mm²`, 'ok'],
      ['Stokes 阻抗 A', `${fc.A.toExponential(2)} Pa·s/m³`],
      ['惯性系数 B', `${fc.B.toExponential(2)} Pa·s²/m⁶`],
      ['惯性占比 (v₁/v₂)', `${(fc.inertialFraction[0] * 100).toFixed(1)}% / ${(fc.inertialFraction[1] * 100).toFixed(1)}%`],
      ['表观渗透率 K_app', `${(fc.kApp[0] * 1e6).toFixed(4)} / ${(fc.kApp[1] * 1e6).toFixed(4)} mm²`],
      ['面积均 WSS 窗', `${wss.toFixed(1)} mPa · ${wssBand}`, wssCls],
    ]);
    const summaryText = `${isSeeded ? '已按当前参数预置典型灌流压降' : '已重算实测压降'}（L=${L_mm.toFixed(1)}mm，μ=${(muPas * 1000).toFixed(2)} mPa·s）：K_int=${kMm2.toFixed(4)} mm²，v₂ 惯性占比 ${(fc.inertialFraction[1] * 100).toFixed(1)}%。`;
    if (status) status.textContent = summaryText;
    return summaryText;
  } catch (e: unknown) {
    const msg = `Forchheimer 计算失败：${e instanceof Error ? e.message : String(e)}`;
    if (status) status.textContent = msg;
    const g = $('fc-metrics');
    if (g) g.hidden = true;
    return msg;
  }
}

function renderSimLiveResult(data: Record<string, unknown>, mode: BridgeSimulateMode): string {
  const tag = $('sim-live-tag');
  const status = $('sim-live-status');
  const cells: Array<[string, string, string?]> = [];
  const notes: string[] = [];

  const comp = data.compression as Record<string, unknown> | undefined;
  if (comp) {
    lastSimCurve = Array.isArray(comp.curve)
      ? comp.curve as Array<{ strain: number; stressMPa: number; peeq: number; activeElems: number }>
      : null;
    lastSimDtMeta = {
      effectiveModulusGPa: Number(comp.effectiveModulusGPa),
      maxStressMPa: Number(comp.maxStressMPa),
      plateauStressMPa: Number(comp.plateauStressMPa),
      dtVsRefRatio: Number(comp.dtVsRefRatio),
      collapsed: Boolean(comp.collapsed),
      collapseStrain: comp.collapseStrain == null ? null : Number(comp.collapseStrain),
      maxPEEQ: Number(comp.maxPEEQ),
      elapsedMs: Number(comp.elapsedMs),
      vertexColored: Boolean(comp.vertexColored),
    };
    cells.push(
      ['压缩数字孪生', `R=${comp.R} ${comp.solveScope}`],
      ['DT 有效模量 E*', `${comp.effectiveModulusGPa} GPa`, comp.collapsed ? 'bad' : 'ok'],
      ['DT 峰值 / GA 平台', `${comp.maxStressMPa} / ${comp.plateauStressMPa} MPa`],
      ['DT / 基准比', `${comp.dtVsRefRatio}× (${comp.elapsedMs} ms)`],
      ['3D 应力云图', comp.vertexColored ? 'Cool-Warm ε_vM 已着染' : '未着色', comp.vertexColored ? 'ok' : undefined],
    );
    notes.push(`压缩 DT E*=${comp.effectiveModulusGPa} GPa、峰值 ${comp.maxStressMPa} MPa${comp.vertexColored ? '（已把等效应力 Cool-Warm 云图渲染至 3D 视口）' : ''}`);
    lastSimSnapshot.compression = comp;
  }

  const homog = data.homogenization as Record<string, unknown> | undefined;
  if (homog) {
    cells.push(
      ['均匀化 E_x/E_y/E_z', `${homog.Ex_GPa} / ${homog.Ey_GPa} / ${homog.Ez_GPa} GPa`],
      ['均匀化 E_100 / 各向异性', `${homog.E100_GPa} GPa · A=${homog.anisotropyRatio}`],
    );
    notes.push(`均匀化 E100=${homog.E100_GPa} GPa、各向异性比 ${homog.anisotropyRatio}`);
    lastSimSnapshot.homogenization = homog;
  }

  const yi = data.yieldImpact as Record<string, unknown> | undefined;
  if (yi) {
    const sf = Number(yi.safetyFactor);
    cells.push(
      ['屈服安全系数 SF', `${sf} (${yi.criticalCriterion})`, sf >= 1 ? 'ok' : 'bad'],
      ['SEA / εd / f₁', `${yi.sea_J_per_g} J/g · ${yi.epsilonD_pct}% · ${yi.f1_Hz} Hz`],
    );
    notes.push(`四准则安全系数 SF=${sf}（主导=${yi.criticalCriterion}），SEA=${yi.sea_J_per_g} J/g`);
    lastSimSnapshot.yieldImpact = yi;
  }

  const pr = data.printability as Record<string, unknown> | undefined;
  if (pr) {
    const crit = Number(pr.criticalAreaPct);
    cells.push(
      ['临界悬垂 (<45°)', `${crit}% (${pr.tris} tris)`, crit > 30 ? 'bad' : 'ok'],
      ['最优摆盘建议', `${pr.bestDir} → ${pr.bestCriticalAreaPct}%`],
    );
    notes.push(`悬垂风险面积 ${crit}%（最优摆盘 ${pr.bestDir} 可降至 ${pr.bestCriticalAreaPct}%）`);
    lastSimSnapshot.printability = pr;
  } else if (data.printabilityError) {
    cells.push(['悬垂审计', String(data.printabilityError), 'bad']);
  }

  const lpbf = data.lpbf as Record<string, unknown> | undefined;
  if (lpbf) {
    lastSimSnapshot.lpbf = lpbf;
    cells.push(
      ['LPBF 工艺窗口', `${lpbf.window} (P=${lpbf.powerW}W · v=${lpbf.speedMs}m/s)`, lpbf.window === 'in_window' ? 'ok' : 'bad'],
      ['熔池 / 峰值温度', `${lpbf.peakTemperatureK} K · ${lpbf.meltPoolVoxels} vox`],
      ['冷速 / 凝固 G×R', `${Number(lpbf.coolingRateKs).toExponential(2)} K/s · G×R=${lpbf.gR}`],
      ['残余应力 / 翘曲', `${lpbf.residualStressMPa} MPa · ${lpbf.distortionUm} µm`],
    );
    notes.push(`LPBF 热力(${lpbf.window})：Tmax=${lpbf.peakTemperatureK} K、残余应力 ${lpbf.residualStressMPa} MPa、翘曲 ${lpbf.distortionUm} µm`);
  }

  const tissue = data.tissue as Record<string, unknown> | undefined;
  if (tissue) {
    lastSimSnapshot.tissue = tissue;
    const viab = Number(tissue.finalViabilityPct);
    cells.push(
      ['骨长入周期 / 网格', `${tissue.days} 天 · R=${tissue.R}`],
      ['终态平均 O₂ / 心表比', `${tissue.finalMeanO2} · ratio=${tissue.coreToShellO2Ratio}`],
      ['细胞存活 / 缺氧坏死', `${viab}% / ${tissue.finalNecrosisPct}%`, viab >= 70 ? 'ok' : 'bad'],
      ['骨矿化 / 3D 氧云图', `${tissue.finalMineralPct}% · ${tissue.vertexColored ? 'Cool-Warm O₂ 已着染' : '未着色'}`, tissue.vertexColored ? 'ok' : undefined],
    );
    notes.push(`28天骨长入：存活=${viab}%、矿化=${tissue.finalMineralPct}%、心/表氧比=${tissue.coreToShellO2Ratio}${tissue.vertexColored ? '（3D 视口已着染 O₂ 云图）' : ''}`);
  }

  const ls = data.levelset as Record<string, unknown> | undefined;
  if (ls) {
    lastSimSnapshot.levelset = ls;
    cells.push(
      ['水平集演化', `R=${ls.R} · ${ls.steps} 步 (wFlow=${ls.wFlow})`],
      ['柔度变化', `${ls.complianceDropPct}% (${ls.initialCompliance}→${ls.finalCompliance})`, Number(ls.complianceDropPct) >= 0 ? 'ok' : undefined],
      ['终态固相 / |∇Φ|', `${ls.finalSolidPct}% · |∇Φ|=${ls.gradNormMean}`],
      ['3D 拓扑重构', ls.appliedToViewport ? `已更新视口 (${ls.vertCount}v/${ls.triCount}f)` : '仅指标计算', ls.appliedToViewport ? 'ok' : undefined],
    );
    notes.push(`水平集重构：柔度变化 ${ls.complianceDropPct}%、固相 ${ls.finalSolidPct}%${ls.appliedToViewport ? `（重构曲面 ${ls.vertCount} 顶点已更新至 3D 视口）` : ''}`);
  }

  const ph = data.phononic as Record<string, unknown> | undefined;
  if (ph) {
    lastSimSnapshot.phononic = ph;
    const gaps = Array.isArray(ph.bandgaps) ? (ph.bandgaps as Array<Record<string, unknown>>) : [];
    const gapStr = gaps.length
      ? gaps.map((g) => `${(Number(g.lowerHz) / 1000).toFixed(1)}–${(Number(g.upperHz) / 1000).toFixed(1)} kHz (${g.bgPct}%)`).join(' / ')
      : '无完全禁带';
    cells.push(
      ['Bloch-Floquet 网格', `N=${ph.N} · ρ̄=${ph.relativeDensity}`],
      ['Γ 零模态 / 声速比', `${ph.zeroModesAtGamma} 平动支 · c/c0=${ph.waveSpeedRatio}`],
      ['声学隔振禁带', gapStr, gaps.length ? 'ok' : undefined],
    );
    notes.push(`声子能带(N=${ph.N})：Γ零模态=${ph.zeroModesAtGamma}、声速比=${ph.waveSpeedRatio}、${gapStr}`);
  }

  if (tag) tag.textContent = `${mode} 完成`;
  if (status) {
    status.textContent = `已完成工程壳求解：${notes.join('；')}。（口径诚实边界：在线求解采用 R=8/R=16/N=7/解耦热力近似，全尺高精度需离线 ABAQUS/OpenFOAM）。`;
  }
  renderKVGrid('sim-live-grid', cells);
  (window as unknown as { __tpmsDshCae?: { renderParityMatrix?: () => void } }).__tpmsDshCae?.renderParityMatrix?.();
  return notes.join('；');
}

queueMicrotask(() => {
  const bootDsh = () => {
    void import('./harness-cae-dsh').then(({ initHarnessCaeDsh }) => {
      initHarnessCaeDsh({
        getDesignState: () => ({
          type: lastStageState.type,
          structure: ((lastStageState as unknown as Record<string, unknown>).structure === 'sheet' ? 'sheet' : 'network'),
          periods: lastStageState.periods,
          porosity: lastStageState.porosity,
          specimenSizeMm: lastStageState.specimenSizeMm,
        }),
        activateTab,
        openEntry: (kind) => openEntry(kind),
        addCard: (entry, name, tag) => addCard(entry, name, tag),
        addFinal: (text) => addFinal(text),
        runForchheimerPanel,
        runIso13314PostProc,
        overlayStl: (payload) => bridge.request('overlay-stl', payload, 30_000),
        getBrowserParitySnapshot: () => {
          const homog = lastSimSnapshot.homogenization as Record<string, unknown> | undefined;
          const comp = lastSimSnapshot.compression as Record<string, unknown> | undefined;
          const fcDp1 = $('fc-dp1') as HTMLInputElement | null;
          const isBackfilledFromCfd = Boolean(fcDp1?.dataset.lengthMm);
          return {
            modulusGPa: homog?.E100_GPa != null ? Number(homog.E100_GPa) : null,
            dtModulusGPa: comp?.effectiveModulusGPa != null ? Number(comp.effectiveModulusGPa) : null,
            forchK_m2: !isBackfilledFromCfd && lastForchSummary ? lastForchSummary.kIntMm2 * 1e-6 : null,
            wssMeanMPa: !isBackfilledFromCfd && lastForchSummary ? lastForchSummary.wssMPa : null,
          };
        },
      });
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootDsh, { once: true });
  } else {
    bootDsh();
  }
});

async function runSimulateFlow(mode: BridgeSimulateMode, fromChat = false): Promise<void> {
  const status = $('sim-live-status');
  const tag = $('sim-live-tag');
  if (tag) tag.textContent = `${mode} 求解中…`;
  if (status) status.textContent = `正在工程壳中执行 ${mode} 数值求解…`;

  let entry: HTMLElement | null = null;
  let cardRes: HTMLElement | null = null;
  if (fromChat) {
    entry = openEntry('tool');
    const c = addCard(entry, `simulate(${mode})`, '工程壳求解');
    c.args.textContent = JSON.stringify({ mode });
    c.res.textContent = '工程壳数值计算中…';
    cardRes = c.res;
  }

  try {
    const r = await bridge.request('simulate', { mode }, 60_000);
    if (r.state) applyStageState(r.state);
    if (!r.ok || !r.data) {
      if (tag) tag.textContent = `${mode} 失败`;
      if (status) status.textContent = `求解失败：${r.summary}`;
      if (entry && cardRes) {
        entry.classList.remove('tool');
        entry.classList.add('fail');
        cardRes.textContent = r.summary;
      }
      if (fromChat) addFinal(`在线仿真执行失败：${r.summary}`);
      return;
    }

    const msg = renderSimLiveResult(r.data, mode);
    if ((mode === 'compression' || mode === 'all-fast') && lastSimCurve?.length) {
      renderDtPostProc();
    }
    if (mode === 'tissue' && r.data.tissue && typeof r.data.tissue === 'object') {
      drawTissueCanvas(r.data.tissue as Record<string, unknown>);
    }
    if (mode === 'phononic' && r.data.phononic && typeof r.data.phononic === 'object') {
      drawPhononicCanvas(r.data.phononic as Record<string, unknown>);
    }
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add('ok');
      cardRes.textContent = r.summary;
    }
    if (fromChat) {
      if (mode === 'compression' || mode === 'levelset') activateTab('p3d');
      else activateTab('pdiag');
      const reply = `已完成在线数值求解（${mode}）：${msg}。${
        mode === 'compression'
          ? '已为 3D 视口着染等效应力 Cool-Warm 云图，并在「诊断」标签绘制 0–3.5% 数字孪生压缩曲线。'
          : mode === 'levelset'
            ? '已将拓扑重构后的水密表面写回 3D 视口。'
            : mode === 'tissue'
              ? '已为 3D 视口着染终态 O₂ 浓度云图，并在「诊断」画布绘制 0–28 天生长动力学曲线。'
              : '详情与曲线已更新在「诊断」标签。'
      }`;
      addFinal(reply);
      pushHistoryTurn(`在线仿真 ${mode}`, reply);
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    if (tag) tag.textContent = '异常';
    if (status) status.textContent = `求解异常：${err}`;
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add('fail');
      cardRes.textContent = err;
    }
  }
}

async function runScenarioFlow(design: string, fromChat = false): Promise<void> {
  const status = $('scenario-status');
  if (status) status.textContent = `正在执行 M5 场景 ${design}…`;
  let entry: HTMLElement | null = null;
  let cardRes: HTMLElement | null = null;
  if (fromChat) {
    entry = openEntry('tool');
    const c = addCard(entry, 'tpms_scenario', design);
    c.args.textContent = JSON.stringify({ design });
    c.res.textContent = '执行场景构建 + 水密核验 + 体素审计…';
    cardRes = c.res;
  }

  try {
    const r = await bridge.request('scenario', { design }, 60_000);
    if (r.state) applyStageState(r.state);
    else await refreshStat();
    const d = (r.data ?? {}) as Record<string, unknown>;
    const watertight = d.watertight !== false;
    const deliverables = Array.isArray(d.deliverables) ? d.deliverables as string[] : ['M5 场景包'];
    const voxel = (d.voxel ?? {}) as Record<string, unknown>;
    const est = (d.estimate ?? {}) as Record<string, unknown>;

    if (r.ok && d.design) {
      addFileCard(`${String(d.design)} (${deliverables[0]})`, watertight, 'M5 场景核验');
    }
    const line = r.ok
      ? `场景 ${design} 完成：${String(d.label ?? '')} · 水密=${watertight ? '通过' : '拒绝'} · minWall=${voxel.minWallMm ?? 'n/a'}mm · 45°悬垂=${d.overhang45CriticalPct ?? 'n/a'}% · E*=${est.E_GPa ?? '?'} GPa。`
      : `场景执行失败：${r.summary}`;
    if (status) status.textContent = line;
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add(r.ok && watertight ? 'ok' : 'fail');
      cardRes.textContent = r.summary.slice(0, 400);
    }
    if (fromChat) {
      activateTab('pexp');
      addFinal(line);
      pushHistoryTurn(`运行场景 ${design}`, line);
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    if (status) status.textContent = `场景异常：${err}`;
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add('fail');
      cardRes.textContent = err;
    }
  }
}

async function runExportCaeFlow(fmt: BridgeExportFmt, fromChat = false): Promise<void> {
  const status = $('scenario-status');
  if (status) status.textContent = `正在执行水密门并导出 ${fmt}…`;
  let entry: HTMLElement | null = null;
  let cardRes: HTMLElement | null = null;
  if (fromChat) {
    entry = openEntry('tool');
    const c = addCard(entry, `export-cae(${fmt})`, '水密门同源导出');
    c.args.textContent = JSON.stringify({ fmt });
    c.res.textContent = '体素水密门核验及网格封装中…';
    cardRes = c.res;
  }

  try {
    const r = await bridge.request('export-cae', { fmt }, 90_000);
    const fname = String((r.data?.filename) ?? `tpms.${fmt}`);
    const passed = r.ok && !r.verifyFail;
    addFileCard(fname, passed, `CAE/${fmt}`);
    if (status) status.textContent = r.summary;
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add(passed ? 'ok' : 'fail');
      cardRes.textContent = r.summary;
    }
    if (fromChat) {
      activateTab('pexp');
      const reply = passed
        ? `水密门通过，已触发导出 ${fname}：${r.summary}`
        : `导出被水密门阻断（未放行 ${fmt}）：${r.summary}`;
      addFinal(reply);
      pushHistoryTurn(`导出 ${fmt}`, reply);
    }
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    if (status) status.textContent = `导出异常：${err}`;
    if (entry && cardRes) {
      entry.classList.remove('tool');
      entry.classList.add('fail');
      cardRes.textContent = err;
    }
  }
}

async function runAutonomousPipeline(
  opts: { target_e_gpa: number; target_k_nm2: number; top?: number; maxRepairs?: number },
  userText?: string,
  autoExportReport = false,
): Promise<void> {
  const top = Math.min(10, Math.max(opts.top ?? 4, 10));
  const maxRepairs = opts.maxRepairs ?? 3;
  const targetE = opts.target_e_gpa;
  const targetK = opts.target_k_nm2;
  const attempts: Array<Record<string, unknown>> = [];

  const d1 = openEntry('tool');
  const c1 = addCard(d1, 'pipeline_pareto', '流水线 1/4 · 832 点逆设计寻优');
  c1.args.textContent = JSON.stringify({ target_e_gpa: targetE, target_k_nm2: targetK, top });
  c1.res.textContent = '扫描 26 族 Pareto 前沿并记录会话推荐台账…';

  const pr = await agentParetoExec({ target_e_gpa: targetE, target_k_nm2: targetK, top });
  d1.classList.remove('tool');
  d1.classList.add(pr.ok ? 'ok' : 'fail');
  if (!pr.ok) {
    c1.res.classList.add('bad');
    c1.res.textContent = pr.summary;
    addFinal(`自治流水线在逆设计步骤中止：${pr.summary}`);
    return;
  }
  renderParetoCandidates(c1.card, pr.summary, { target_e_gpa: targetE, target_k_nm2: targetK, top });
  const parsedPareto = JSON.parse(pr.summary) as { reachable: boolean; recommendations: Array<Record<string, unknown>> };
  c1.res.textContent = `Pareto 前沿候选 ${parsedPareto.recommendations.length} 项（${parsedPareto.reachable ? '目标可达' : '近邻妥协'}）。`;

  const latestRec = browserSession.recommendations[browserSession.recommendations.length - 1];
  const candidates = latestRec?.candidates ?? [];
  if (!candidates.length) {
    addFinal('自治流水线未能产出有效 Pareto 候选，已中止。');
    return;
  }

  const d2 = openEntry('tool');
  const c2 = addCard(d2, 'pipeline_verify', '流水线 2/4 · 候选顺延构建与水密审计');
  c2.args.textContent = JSON.stringify({ maxAttempts: Math.min(candidates.length, maxRepairs + 1) });
  c2.res.textContent = '依次构建候选并执行体素壁厚/孔喉/封闭腔/迂曲度核验…';

  let lockedCand: SessionCandidate = candidates[0];
  let lockedArgs: Record<string, unknown> = candidateToMeshArgs(lockedCand);
  let verifyPassed = false;
  let lastVerifyText = '';
  let bestWallMm = -1;
  let bestVerifyParsed: Record<string, unknown> | null = null;
  let lastAppliedRank = -1;
  const thinFails: Array<{ type: string; porosity: number; cellSize: number }> = [];

  const maxAttempts = Math.min(candidates.length, maxRepairs + 1);
  let tested = 0;
  const remaining = [...candidates];
  const failedFamilies = new Set<string>();
  while (remaining.length > 0 && tested < maxAttempts) {
    // 优先选择尚未尝试过的曲面族（若当前族刚失败，先跨越到其他候选族如 diamond/gyroid）
    let pickIdx = remaining.findIndex((c) => !failedFamilies.has(c.type));
    if (pickIdx < 0) pickIdx = 0;
    const [cand] = remaining.splice(pickIdx, 1);
    const skipThinner = thinFails.some(
      (f) => f.type === cand.type && cand.cellSize <= f.cellSize && cand.porosity >= f.porosity,
    );
    if (skipThinner) {
      attempts.push({
        rank: cand.rank,
        type: cand.type,
        porosityPct: Number((cand.porosity * 100).toFixed(1)),
        cellSizeMm: cand.cellSize,
        passed: false,
        skipped: '同族更高孔隙/更薄构型已跳过',
      });
      continue;
    }

    tested++;
    const meshArgs = candidateToMeshArgs(cand);
    let passed = false;
    let wallMm: number | null = null;
    try {
      // agentVerifyExec 内部已先执行 agentMeshExec 应用参数，无需重复 apply
      const vr = await bridge.request('verify', { ...meshArgs, resolution: 32 }, 60_000);
      if (vr.state) applyStageState(vr.state);
      lastAppliedRank = cand.rank;
      renderDiag(vr.summary);
      lastVerifyText = vr.summary;
      passed = vr.ok && !vr.verifyFail;
      try {
        const vj = JSON.parse(vr.summary) as Record<string, unknown>;
        if (typeof vj.minWallMm === 'number') wallMm = vj.minWallMm;
        const thr = typeof vj.minWallThresholdMm === 'number' ? vj.minWallThresholdMm : 0.4;
        if (wallMm !== null && wallMm < thr) {
          thinFails.push({ type: cand.type, porosity: cand.porosity, cellSize: cand.cellSize });
        }
        if (wallMm !== null && wallMm > bestWallMm) {
          bestWallMm = wallMm;
          bestVerifyParsed = vj;
          lockedCand = cand;
          lockedArgs = meshArgs;
        }
      } catch {
        /* summary 非 JSON 时按普通文本处理 */
      }
    } catch (err) {
      lastVerifyText = err instanceof Error ? err.message : String(err);
      c2.res.textContent = `候选 #${cand.rank} ${cand.type} 核验受限：${lastVerifyText}`;
      attempts.push({
        rank: cand.rank,
        type: cand.type,
        porosityPct: Number((cand.porosity * 100).toFixed(1)),
        cellSizeMm: cand.cellSize,
        passed: false,
        error: lastVerifyText,
      });
      break;
    }

    attempts.push({
      rank: cand.rank,
      type: cand.type,
      porosityPct: Number((cand.porosity * 100).toFixed(1)),
      cellSizeMm: cand.cellSize,
      minWallMm: wallMm,
      passed,
    });
    if (passed) {
      lockedCand = cand;
      lockedArgs = meshArgs;
      verifyPassed = true;
      c2.res.textContent = `候选 #${cand.rank} ${cand.type} (p=${Math.round(cand.porosity * 100)}%) 通过水密/体素制造核验。`;
      break;
    }
    failedFamilies.add(cand.type);
    c2.res.textContent = `候选 #${cand.rank} ${cand.type} 未通过门禁，顺延下一候选 (${tested}/${maxAttempts})…`;
  }

  if (!verifyPassed && lastAppliedRank !== lockedCand.rank) {
    try {
      const ap = await bridge.request('apply', lockedArgs, 30_000);
      if (ap.state) applyStageState(ap.state);
      if (bestVerifyParsed) renderDiag(JSON.stringify(bestVerifyParsed));
    } catch {
      /* 保留最后已应用状态 */
    }
  }
  recordExecution(browserSession, {
    recId: latestRec?.id ?? `r${browserSession.recommendations.length}`,
    ordinal: lockedCand.rank,
    candidate: lockedCand,
    args: lockedArgs,
    withVerify: true,
    source: verifyPassed ? 'autonomous_pipeline' : 'autonomous_pipeline_warn',
  });
  updateSessionPill();
  if (!verifyPassed) {
    c2.res.textContent = `已试算 ${tested} 项非支配候选均触发壁厚/工艺告警，已带告警锁定最优候补 #${lockedCand.rank} ${lockedCand.type} (p=${Math.round(lockedCand.porosity * 100)}%)。`;
  }
  d2.classList.remove('tool');
  d2.classList.add(verifyPassed ? 'ok' : 'fail');

  const d3 = openEntry('tool');
  const c3 = addCard(d3, 'pipeline_simulate', '流水线 3/4 · 多物理场联算 + Cool-Warm 云图');
  c3.args.textContent = JSON.stringify({ mode: 'all-fast', locked: { type: lockedCand.type, porosity: lockedCand.porosity } });
  c3.res.textContent = '执行压缩 DT + 均匀化 + 四准则屈服 + 45° 悬垂求解…';
  let simMsg = '仿真未执行';
  const simR = await bridge.request('simulate', { mode: 'all-fast' }, 60_000);
  if (simR.state) applyStageState(simR.state);
  d3.classList.remove('tool');
  if (simR.ok && simR.data) {
    d3.classList.add('ok');
    simMsg = renderSimLiveResult(simR.data, 'all-fast');
    c3.res.textContent = simMsg;
  } else {
    d3.classList.add('fail');
    c3.res.textContent = simR.summary;
    simMsg = `仿真失败：${simR.summary}`;
  }

  if (lastSimCurve?.length) renderDtPostProc();
  seedForchheimerAndRun();
  renderSimTriangle();
  renderCaeRunbook();

  lastPipelineReport = {
    startedAt: new Date().toISOString(),
    targets: { target_e_gpa: targetE, target_k_nm2: targetK },
    paretoReachable: parsedPareto.reachable,
    attempts,
    lockedCandidate: { ...lockedCand, meshArgs: lockedArgs },
    verifyPassed,
    verifySummary: lastVerifySummary ?? lastVerifyText,
    simSummary: simMsg,
  };

  activateTab('pdiag');
  const finalReply = [
    `已完成端到端自治仿真流水线（目标 E≥${targetE} GPa、κ≥${targetK}×10⁻⁹ m²）：`,
    `① 代理推荐层：832 点扫描得 #${lockedCand.rank} ${lockedCand.type}（p=${Math.round(lockedCand.porosity * 100)}%, E_est=${lockedCand.E_GPa} GPa, κ_KC=${lockedCand.kappa_m2.toExponential(2)} m²，非 FE 精确）；`,
    `② 网格与体素验收层：尝试 ${attempts.length} 项候选，最终${verifyPassed ? '通过' : '带告警锁定'}（水密/壁厚/孔喉/三向迂曲度见「诊断」）；`,
    `③ 在线多物理场与后处理层：${simMsg}；已同步 DT 压缩曲线与 Forchheimer K_int=${lastForchSummary ? lastForchSummary.kIntMm2.toFixed(4) : '?'} mm² 灌流分析。`,
  ].join('\n');
  addFinal(finalReply);
  pushHistoryTurn(userText ?? `自治流水线 E>=${targetE} k>=${targetK}`, finalReply);
  if (autoExportReport) {
    exportHarnessReport('md', false);
  }
}

function buildHarnessEngineeringReport(): { report: Record<string, unknown>; markdown: string } {
  const s = lastStageState;
  const now = new Date().toISOString();
  const abaqusCmd = `abaqus job=tpms_${s.type}_p${s.porosity} input=tpms-${s.type}-p${s.porosity}-voxel.inp cpus=4 interactive`;
  const foamCmd = `blockMesh && snappyHexMesh -overwrite && simpleFoam`;
  const boundaries = [
    '1. 逆设计 Pareto 目标使用 Gibson-Ashby × Kozeny-Carman 832 点解析代理（Gyroid/Diamond 已做 FEA-R48 双点/三点幂律标定，其余 24 族为文献带估值），非全参有限元反演。',
    '2. 在线压缩数字孪生（DT）使用 R=8 单胞周期体素弹塑性近似（0–3.5% 应变），大变形压溃平台与全尺寸试样须使用导出的 .inp 运行离线 ABAQUS Explicit。',
    '3. LPBF 热力采用 N=32 解耦傅里叶瞬态热传导+热弹性应力估算；28天骨组织生长采用 R=20 反应-扩散准稳态近似；水平集重构运行于 R=16 离散场；声子能带使用 N=7 Bloch 集中弹簧质量网络近似。',
    '4. 渗透率高精度标定以 OpenFOAM R48 稳态 Navier-Stokes 出口（ofmesh）为准；Forchheimer 工作台分离固有渗透率 K_int 与惯性压降系数 B。',
  ];

  const report: Record<string, unknown> = {
    schema: 'tpms-sim-report-v1',
    generatedAt: now,
    design: { ...s },
    session: {
      recommendationCount: browserSession.recommendations.length,
      executionCount: browserSession.executions.length,
      recommendations: browserSession.recommendations,
      executions: browserSession.executions,
    },
    pipeline: lastPipelineReport,
    manufacturingVerify: lastVerifySummary,
    simulations: { ...lastSimSnapshot },
    postProcessing: {
      iso13314: lastIsoPostProcSummary,
      forchheimer: lastForchSummary,
    },
    reproCommands: {
      abaqus: abaqusCmd,
      openfoam: foamCmd,
    },
    honestBoundaries: boundaries,
  };

  const md = [
    `# TPMS 工程仿真可复现验收报告`,
    ``,
    `- 生成时间：\`${now}\``,
    `- 协议口径：\`tpms-sim-report-v1\``,
    ``,
    `## 1. 设计几何与尺寸契约`,
    `- 曲面族：\`${s.type}\` · 模式：\`${s.structureMode}\` · 容器：\`${s.containerShape}\` · 材料：\`${s.material}\``,
    `- 孔隙率：\`${s.porosity}%\` · 周期数：\`${s.periods}\` · 试样名义尺寸：\`${s.specimenSizeMm ?? s.periods} mm\``,
    ``,
    `## 2. 会话逆设计与候选绑定轨迹`,
    `- 推荐批次数：${browserSession.recommendations.length} · 确定性绑定构建数：${browserSession.executions.length}`,
    lastPipelineReport
      ? `- 最近自治流水线：尝试 ${Array.isArray(lastPipelineReport.attempts) ? lastPipelineReport.attempts.length : 0} 次 · 验收${lastPipelineReport.verifyPassed ? '通过' : '告警'} · ${String(lastPipelineReport.simSummary ?? '')}`
      : `- 最近自治流水线：尚未运行（可点击「全自动逆设计→仿真流水线」）`,
    ``,
    `## 3. 制造性与体素水密审计`,
    lastVerifySummary
      ? `\`\`\`json\n${JSON.stringify(lastVerifySummary, null, 2)}\n\`\`\``
      : `- 尚无当前状态的 verify 体素审计快照（请在对话中或流水线触发制造检查）。`,
    ``,
    `## 4. 在线多物理场与拓扑优化台账`,
    Object.keys(lastSimSnapshot).length
      ? `\`\`\`json\n${JSON.stringify(lastSimSnapshot, null, 2)}\n\`\`\``
      : `- 尚未执行在线多物理场求解。`,
    ``,
    `## 5. ISO 13314 实验反演与 Forchheimer CFD 双点分离`,
    `- ISO 13314：${lastIsoPostProcSummary ? `${lastIsoPostProcSummary.sourceLabel} · E*=${lastIsoPostProcSummary.elasticModulusStr} · Rp0.2=${lastIsoPostProcSummary.rp02.toFixed(1)} MPa · σ_pl=${lastIsoPostProcSummary.plateau.toFixed(1)} MPa · Wv=${lastIsoPostProcSummary.energyW.toFixed(2)} MJ/m³` : '尚未加载标定曲线'}`,
    `- Forchheimer：${lastForchSummary ? `L=${lastForchSummary.lengthMm.toFixed(1)}mm · K_int=${lastForchSummary.kIntMm2.toFixed(4)} mm² · 惯性占比=${lastForchSummary.inertialPct.map((v) => v.toFixed(1) + '%').join('/')} · WSS=${lastForchSummary.wssMPa.toFixed(1)} mPa` : '未计算'}`,
    ``,
    `## 6. 离线可复现命令与诚实物理边界声明`,
    `- ABAQUS：\n  \`${abaqusCmd}\``,
    `- OpenFOAM：\n  \`${foamCmd}\``,
    ...boundaries.map((b) => `- ${b}`),
    ``,
  ].join('\n');

  return { report, markdown: md };
}

function exportHarnessReport(format: 'md' | 'json', fromChat = false): void {
  const { report, markdown } = buildHarnessEngineeringReport();
  const s = lastStageState;
  const filename = `tpms-report-${s.type}-p${s.porosity}.${format}`;
  const content = format === 'json' ? JSON.stringify(report, null, 2) : markdown;
  const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8';

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  addFileCard(filename, true, format === 'md' ? '工程验收报告' : '仿真数据台账');
  const status = $('scenario-status');
  if (status) status.textContent = `已生成并导出可复现仿真验收报告 ${filename}（含设计契约、物理台账与诚实边界声明）。`;
  if (fromChat) {
    activateTab('pexp');
    const msg = `已导出可复现仿真报告 ${filename}，并附完整多物理场台账、后处理结果与模型诚实边界声明。`;
    addFinal(msg);
    pushHistoryTurn(`导出仿真报告 ${format}`, msg);
  }
}

// ── 无 key 规则兜底（支持逆设计/估算/构建/制造检查/场景/仿真/后处理/CAE导出/自治流水线/报告）─────────────
function rulesFallback(text: string, why?: string): void {
  if (why) addErr('回退规则', why);
  const paretoArgs = parseParetoTargets(text);

  // 0. 端到端自治逆设计→验证→仿真→后处理流水线路由
  const wantPipeline = /(?:全流程|流水线|端到端|一条龙|自治|全自动.*(?:设计|仿真|报告))/i.test(text);
  const wantAutoReport = /(?:出|生成|导出|下载|带).*报告/i.test(text);
  if (wantPipeline && (paretoArgs || /(?:支架|设计|优化|寻优|骨)/i.test(text))) {
    const pArgs = paretoArgs ?? { target_e_gpa: 3.0, target_k_nm2: 2.0, top: 4 };
    void runAutonomousPipeline({ ...pArgs, maxRepairs: 3 }, text, wantAutoReport);
    return;
  }

  if (/(?:生成|导出|输出|下载).*(?:验收)?报告|仿真台账/i.test(text)) {
    exportHarnessReport(/json/i.test(text) ? 'json' : 'md', true);
    return;
  }

  if (paretoArgs) {
    void runRulesPareto(paretoArgs, text);
    return;
  }

  // 1. M5 场景预设路由
  if (/(?:运行|执行|跑).*场景|scenario|bone_scaffold|gyroid_implant|diamond_load|primitive_flow|iwp_stiff/i.test(text)) {
    const fileMatch = /([\w-]+\.json)/i.exec(text);
    const design = fileMatch
      ? fileMatch[1]
      : /植入/.test(text) ? 'gyroid_implant.json'
      : /承重|diamond/i.test(text) ? 'diamond_load.json'
      : /渗透|schwarz|primitive|flow/i.test(text) ? 'primitive_flow.json'
      : /高刚度|iwp/i.test(text) ? 'iwp_stiff.json'
      : /当前/.test(text) ? 'current.json'
      : 'bone_scaffold.json';
    void runScenarioFlow(design, true);
    return;
  }

  // 2. CAE / CFD / 脚本 / G-code 一键导出路由
  const it = parseNL(text);
  const patches: Record<string, unknown> = { ...it.patches };
  const por = patches.porosity as number | null | undefined;
  if (por != null && por <= 1) patches.porosity = por * 100;
  const has = Object.keys(patches).length > 0;

  // 2a. Phase 5 多保真度本地 CAE 全闭环自然语言路由（nTopCL / Mesh Doctor / OpenFOAM / COMSOL / WSS 窗口）
  const dshCaeApi = (window as unknown as {
    __tpmsDshCae?: { dispatch?: (kind: string, fromChat?: boolean) => Promise<void> };
  }).__tpmsDshCae;
  if (dshCaeApi?.dispatch && /(?:ntop|边界层网格|mesh\s*doctor|openfoam.*求解|comsol.*求解|多保真度对标|wss.*成骨窗口|全流程.*对标)/i.test(text)) {
    const kind = /(?:多保真度对标|全流程.*对标|全闭环)/i.test(text)
      ? 'pipeline'
      : /(?:comsol)/i.test(text)
        ? 'comsol-cfd'
        : /(?:abaqus.*求解)/i.test(text)
          ? 'abaqus-fea'
          : /(?:ntop|边界层网格|mesh\s*doctor)/i.test(text) && !/(?:openfoam|cfd|wss|流体|流速)/i.test(text)
            ? 'preprocess-bl'
            : 'openfoam-cfd';
    activateTab('pdiag');
    void (async () => {
      if (has) {
        const r = await bridge.request('apply', patches);
        if (r.state) applyStageState(r.state);
      }
      await dshCaeApi.dispatch?.(kind, true);
    })();
    return;
  }

  if (/(?:导出|打包|生成).*(?:abaqus|\.inp|openfoam|polymesh|交付包|验证套件|cae|rve|gcode|g-code|切片|python|\.py|matlab|\.m\b|bibtex|\.bib|设计文件)/i.test(text)
    || (!has && /(?:导出|生成)\s*(?:水密\s*)?stl/i.test(text))) {
    const fmt: BridgeExportFmt = /openfoam|polymesh/i.test(text) ? 'ofmesh'
      : /rve/i.test(text) ? 'rvestl'
      : /套件|suite/i.test(text) ? 'caesuite'
      : /abaqus|\.inp/i.test(text) ? 'inp'
      : /gcode|g-code|切片/i.test(text) ? 'gcode'
      : /python|\.py/i.test(text) ? 'py'
      : /matlab|\.m\b/i.test(text) ? 'm'
      : /bibtex|\.bib/i.test(text) ? 'bibtex'
      : /设计文件|design/i.test(text) ? 'design'
      : /交付包|cae|打包/i.test(text) ? 'pkg'
      : 'stl';
    if (has) {
      void bridge.request('apply', patches).then(async (r) => {
        if (r.state) applyStageState(r.state);
        await runExportCaeFlow(fmt, true);
      });
    } else {
      void runExportCaeFlow(fmt, true);
    }
    return;
  }

  // 3. 在线仿真 / 高阶多物理场 / 自动后处理路由
  if (/(?:压缩仿真|压缩数字孪生|数字孪生|应力云图|各向异性|均匀化|屈服包络|冲击吸能|悬垂角|最优摆盘|全项快检|跑仿真|数值仿真|iso\s*13314|forchheimer|后处理|lpbf|激光|热力|熔池|残余应力|翘曲|骨长入|组织长入|成骨|氧浓度|氧云图|细胞存活|矿化|28\s*天|水平集|level\s*-?set|拓扑优化|声子晶体|能带|禁带|隔振|bloch)/i.test(text)) {
    if (/abaqus.*gyroid|gyroid.*abaqus/i.test(text)) {
      activateTab('pdiag');
      const m = runIso13314PostProc('ABAQUS Gyroid p60 EXPL', ABAQUS_GYROID_P60_EXPL_CSV, 'displacement-force');
      const reply = m ? `已加载并反演 ABAQUS Gyroid p60 Explicit 基准曲线：E*=${m.elasticModulusStr}，Rp0.2=${m.rp02.toFixed(1)} MPa，σ_pl=${m.plateau.toFixed(1)} MPa，Wv=${m.energyW.toFixed(2)} MJ/m³。` : 'ABAQUS Gyroid 曲线反演失败。';
      addFinal(reply);
      pushHistoryTurn(text, reply);
      return;
    }
    if (/abaqus.*diamond|diamond.*abaqus/i.test(text)) {
      activateTab('pdiag');
      const m = runIso13314PostProc('ABAQUS Diamond p60 EXPL', ABAQUS_DIAMOND_P60_EXPL_CSV, 'displacement-force');
      const reply = m ? `已加载并反演 ABAQUS Diamond p60 Explicit 基准曲线：E*=${m.elasticModulusStr}，Rp0.2=${m.rp02.toFixed(1)} MPa，σ_pl=${m.plateau.toFixed(1)} MPa，Wv=${m.energyW.toFixed(2)} MJ/m³。` : 'ABAQUS Diamond 曲线反演失败。';
      addFinal(reply);
      pushHistoryTurn(text, reply);
      return;
    }
    if (/forchheimer/i.test(text)) {
      activateTab('pdiag');
      const msg = runForchheimerPanel(false);
      addFinal(msg);
      pushHistoryTurn(text, msg);
      return;
    }
    const mode: BridgeSimulateMode = /lpbf|激光|热力|熔池|残余应力|翘曲/i.test(text) ? 'lpbf'
      : /骨长入|组织长入|成骨|氧浓度|氧云图|细胞存活|矿化|28\s*天/i.test(text) ? 'tissue'
      : /水平集|level\s*-?set|拓扑优化/i.test(text) ? 'levelset'
      : /声子晶体|能带|禁带|隔振|bloch/i.test(text) ? 'phononic'
      : /全项|所有|全面|快检/.test(text) ? 'all-fast'
      : /均匀化|各向异性/.test(text) ? 'homogenization'
      : /屈服|冲击|吸能|包络/.test(text) ? 'yield-impact'
      : /悬垂|摆盘|打印方位|overhang/i.test(text) ? 'printability'
      : 'compression';
    if (has) {
      void bridge.request('apply', patches).then(async (r) => {
        if (r.state) applyStageState(r.state);
        await runSimulateFlow(mode, true);
      });
    } else {
      void runSimulateFlow(mode, true);
    }
    return;
  }

  const wantVerify = /(?:制造检查|检查可制造性|验证.*壁厚|检查壁厚)/.test(text);
  const isPureEstimate = /^(?:请|麻烦|帮我)?\s*(?:估算|计算|评估)/.test(text.trim())
    && !/(?:构建|建|生成|改成|调整|导出|检查|验证)/.test(text)
    && !wantVerify;

  if (isPureEstimate) {
    const estType = String(patches.type ?? lastStageState.type);
    const estPor = patches.porosity != null ? Number(patches.porosity) / 100 : lastStageState.porosity / 100;
    void runRulesEstimate(estType, estPor, text);
    return;
  }

  const d = openEntry(has ? 'ok' : wantVerify ? 'tool' : 'tool');
  const { args, res } = addCard(d, '本地规则解析', has ? '只读建议→应用' : wantVerify ? 'verify' : 'help');
  args.textContent = has ? JSON.stringify(patches) : text.slice(0, 80);
  res.textContent = it.reply;

  if (has) {
    void bridge.request('apply', patches).then(async (r) => {
      if (r.state) applyStageState(r.state);
      res.textContent += `\n→ ${r.summary.slice(0, 140)}`;
      if (wantVerify) {
        const vr = await bridge.request('verify', patches);
        res.textContent += `\n→ verify: ${vr.summary.slice(0, 180)}`;
        renderDiag(vr.summary);
      }
      if (!r.state) await refreshStat();
      pushHistoryTurn(text, res.textContent);
    }).catch((e: unknown) => {
      res.textContent += `\n→ 应用失败：${e instanceof Error ? e.message : String(e)}`;
    });
  } else if (wantVerify) {
    void bridge.request('verify', {}).then(async (vr) => {
      d.classList.remove('tool');
      d.classList.add(vr.ok && !vr.verifyFail ? 'ok' : 'fail');
      res.textContent = vr.summary.slice(0, 320);
      renderDiag(vr.summary);
      await refreshStat();
      pushHistoryTurn(text, vr.summary);
    }).catch((e: unknown) => {
      d.classList.remove('tool');
      d.classList.add('fail');
      res.textContent = `验证失败：${e instanceof Error ? e.message : String(e)}`;
    });
  }
  if (it.actions.includes('export-stl') && has) {
    void bridge.request('apply', { ...patches, out: `harness-${String(patches.type ?? 'design')}.stl` }).then((r) => {
      const m = /已导出 ([\w.-]+\.stl)/.exec(r.summary);
      if (m) addFileCard(m[1], true);
    }).catch(() => { /* 导出失败已由轨迹呈现 */ });
  }
}

// ── 发送路径 ─────────────────────────────────────────────
let running = false;
async function sendDecided(): Promise<void> {
  const input = $('cmd') as HTMLInputElement | null;
  if (!input || !input.value.trim() || running) return;
  const text = input.value;
  input.value = '';

  // S2 确定性指代绑定优先（规则版与 LLM 版共享同一会话单源，杜绝模型臆造参数）
  const refRes = resolveReference(browserSession, text);
  if (refRes.status === 'reject') {
    addUser(text);
    const d = openEntry('fail');
    const { args, res } = addCard(d, '会话指代拦截', '确定性拒绝', true);
    args.textContent = text;
    res.classList.add('bad');
    res.textContent = refRes.reason;
    return;
  }
  if (refRes.status === 'resolved') {
    addUser(text);
    await executeCandidateAction(refRes.recId, refRes.ordinal, refRes.candidate, false, '会话指代绑定');
    return;
  }

  const cfg = loadAgentCfg();
  if (cfg.kind === 'rules' || (cfg.kind === 'openai' && !getByoKey())) {
    addUser(text);
    if (cfg.kind === 'openai') addErr('无 Key', '未配置 API Key（设置里填写），走本地规则兜底');
    rulesFallback(text);
    return;
  }

  addUser(text);
  activeUserText = text;
  running = true;
  stopped = false;
  setBusy(true);
  const onStop = () => { stopped = true; };
  $('stop-btn')?.addEventListener('click', onStop, { once: true });
  try {
    const provider = createBrowserProvider(cfg, getByoKey());
    await runAgent(text, {
      complete: (m, t) => provider.complete(m as never, t as never),
      toolImpls,
      history: conversationHistory,
      repairExec: (patches) => bridge.request('apply', patches),
      onEvent: renderEvent,
      isStopped: () => stopped,
    });
  } catch (e) {
    if (e instanceof BrowserLlmError) {
      const hint = e.code === 'ERR_CORS_OR_NETWORK'
        ? `${e.message}——智谱开放平台不支持浏览器直连，可用 DeepSeek/OpenRouter 或本地 Ollama`
        : e.message;
      addErr(e.code, hint);
      rulesFallback(text, 'LLM 通道错误，本次改走规则兜底');
    } else {
      addErr('异常', e instanceof Error ? e.message : String(e));
    }
  } finally {
    running = false;
    activeUserText = '';
    setBusy(false);
    $('stop-btn')?.removeEventListener('click', onStop);
  }
}

// ── UI 接线 ────────────────────────────────────────────────
$('send-btn')?.addEventListener('click', () => { void sendDecided(); });
$('cmd')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void sendDecided(); });
document.querySelectorAll('.chip').forEach((c) => {
  c.addEventListener('click', () => { const i = $('cmd') as HTMLInputElement | null; if (i) { i.value = c.textContent ?? ''; i.focus(); } });
});
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
tabs.forEach((t) => t.addEventListener('click', () => {
  activateTab((t.dataset.pane as 'p3d' | 'pdiag' | 'pexp') ?? 'p3d');
}));

$('session-reset-btn')?.addEventListener('click', () => {
  browserSession = newSession();
  conversationHistory = [];
  lastParetoArgs = {};
  lastPipelineReport = null;
  forchheimerDirty = false;
  updateSessionPill();
  seedForchheimerAndRun();
  setBudget(0);
  const s = $('stream');
  if (s) {
    s.innerHTML = '';
    const empty = el('empty');
    empty.id = 'empty-hint';
    empty.innerHTML = '驾驶舱新会话就绪——输入逆设计目标或参数指令，Agent 将在右侧画布构建并验证。<br><code>pareto → 指代/卡片构建 → verify → CAE 手册</code> 全程可追溯。';
    s.appendChild(empty);
  }
});

// Phase 2 & 3: 在线数值求解引擎与自治流水线按钮绑定
$('sim-btn-comp')?.addEventListener('click', () => { void runSimulateFlow('compression', false); });
$('sim-btn-homog')?.addEventListener('click', () => { void runSimulateFlow('homogenization', false); });
$('sim-btn-yield')?.addEventListener('click', () => { void runSimulateFlow('yield-impact', false); });
$('sim-btn-print')?.addEventListener('click', () => { void runSimulateFlow('printability', false); });
$('sim-btn-all')?.addEventListener('click', () => { void runSimulateFlow('all-fast', false); });
$('sim-btn-lpbf')?.addEventListener('click', () => { void runSimulateFlow('lpbf', false); });
$('sim-btn-tissue')?.addEventListener('click', () => { void runSimulateFlow('tissue', false); });
$('sim-btn-levelset')?.addEventListener('click', () => { void runSimulateFlow('levelset', false); });
$('sim-btn-phononic')?.addEventListener('click', () => { void runSimulateFlow('phononic', false); });
$('sim-btn-pipeline')?.addEventListener('click', () => {
  void runAutonomousPipeline({ target_e_gpa: 3.0, target_k_nm2: 2.0, top: 4, maxRepairs: 3 }, '一键自治逆设计→验证→仿真→后处理流水线', false);
});

// Phase 2: 自动后处理工作台（ISO 13314 + Forchheimer CFD）
$('pp-btn-dt')?.addEventListener('click', () => { renderDtPostProc(); });
$('pp-btn-gyroid')?.addEventListener('click', () => {
  runIso13314PostProc('ABAQUS Gyroid p60 EXPL', ABAQUS_GYROID_P60_EXPL_CSV, 'displacement-force');
});
$('pp-btn-diamond')?.addEventListener('click', () => {
  runIso13314PostProc('ABAQUS Diamond p60 EXPL', ABAQUS_DIAMOND_P60_EXPL_CSV, 'displacement-force');
});
$('pp-btn-csv-toggle')?.addEventListener('click', () => {
  const box = $('pp-csv-box');
  if (box) box.hidden = !box.hidden;
});
$('pp-csv-run')?.addEventListener('click', () => {
  const text = ($('pp-csv-text') as HTMLTextAreaElement | null)?.value ?? '';
  const inputType = (($('pp-csv-type') as HTMLSelectElement | null)?.value ?? 'displacement-force') as 'displacement-force' | 'strain-stress';
  const l0 = Number(($('pp-csv-l0') as HTMLInputElement | null)?.value ?? 12.5664);
  const area = Number(($('pp-csv-area') as HTMLInputElement | null)?.value ?? 157.91);
  const side = Math.sqrt(Math.max(0.01, area));
  runIso13314PostProc(
    '自定义实验 CSV',
    text,
    inputType,
    inputType === 'displacement-force' ? { lengthMm: l0, widthMm: side, thicknessMm: side } : undefined,
  );
});

$('fc-run-btn')?.addEventListener('click', () => {
  forchheimerDirty = true;
  runForchheimerPanel(false);
});
for (const id of ['fc-v1', 'fc-dp1', 'fc-v2', 'fc-dp2', 'fc-wss']) {
  $(id)?.addEventListener('input', () => {
    forchheimerDirty = true;
    runForchheimerPanel(false);
  });
}

// Phase 2: M5 场景执行与 CAE / CFD 一键导出矩阵
$('scenario-run-btn')?.addEventListener('click', () => {
  const sel = ($('scenario-select') as HTMLSelectElement | null)?.value ?? 'bone_scaffold.json';
  void runScenarioFlow(sel, false);
});
$('exp-btn-pkg')?.addEventListener('click', () => { void runExportCaeFlow('pkg', false); });
$('exp-btn-inp')?.addEventListener('click', () => { void runExportCaeFlow('inp', false); });
$('exp-btn-of')?.addEventListener('click', () => { void runExportCaeFlow('ofmesh', false); });
$('exp-btn-rve')?.addEventListener('click', () => { void runExportCaeFlow('rvestl', false); });
$('exp-btn-suite')?.addEventListener('click', () => { void runExportCaeFlow('caesuite', false); });
$('exp-btn-stl')?.addEventListener('click', () => { void runExportCaeFlow('stl', false); });
$('exp-btn-report-md')?.addEventListener('click', () => { exportHarnessReport('md', false); });
$('exp-btn-report-json')?.addEventListener('click', () => { exportHarnessReport('json', false); });
$('exp-btn-py')?.addEventListener('click', () => { void runExportCaeFlow('py', false); });
$('exp-btn-gcode')?.addEventListener('click', () => { void runExportCaeFlow('gcode', false); });

$('cae-strain')?.addEventListener('input', () => { renderCaeRunbook(); });
$('cae-copy-btn')?.addEventListener('click', () => {
  const txt = $('cae-cmd')?.textContent ?? '';
  if (!txt) return;
  void navigator.clipboard?.writeText(txt).then(() => {
    const btn = $('cae-copy-btn');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '已复制';
      window.setTimeout(() => { btn.textContent = old; }, 1200);
    }
  }).catch(() => {});
});

// provider/设置面板（与主壳同一套存储与纪律）
const providerSel = $('provider') as HTMLSelectElement | null;
const cfg0 = loadAgentCfg();
if (providerSel) providerSel.value = cfg0.kind;
const endpointHint = (): void => {
  const b = $('baseurl') as HTMLInputElement | null;
  const m = $('model') as HTMLInputElement | null;
  if (!b || !m || !providerSel) return;
  if (providerSel.value === 'rules') { b.placeholder = '—（本地规则模式）'; m.placeholder = '—'; return; }
  const k = providerSel.value === 'openai' ? 'openai' : 'ollama';
  b.placeholder = `Base URL（默认 ${DEFAULT_ENDPOINTS[k]}）`;
  m.placeholder = `模型（默认 ${DEFAULT_MODELS[k]}）`;
};
endpointHint();
if (cfg0.baseUrl) { const b = $('baseurl') as HTMLInputElement | null; if (b) b.value = cfg0.baseUrl; }
if (cfg0.model) { const m = $('model') as HTMLInputElement | null; if (m) m.value = cfg0.model; }
{ const r = $('key-remember') as HTMLInputElement | null; if (r) r.checked = cfg0.rememberKey; }
providerSel?.addEventListener('change', () => { endpointHint(); saveAgentCfg({ ...loadAgentCfg(), kind: providerSel.value as AgentCfg['kind'] }); });
$('cfg-btn')?.addEventListener('click', () => $('cfgrow')?.classList.toggle('open'));
$('cfg-save')?.addEventListener('click', () => {
  const kind = (providerSel?.value ?? 'rules') as AgentCfg['kind'];
  const cfg: AgentCfg = {
    kind,
    baseUrl: ($('baseurl') as HTMLInputElement | null)?.value.trim() || undefined,
    model: ($('model') as HTMLInputElement | null)?.value.trim() || undefined,
    rememberKey: ($('key-remember') as HTMLInputElement | null)?.checked ?? false,
  };
  saveAgentCfg(cfg);
  const k = $('key-input') as HTMLInputElement | null;
  if (k) setByoKey(k.value.trim(), cfg.rememberKey);
  addFinal('Agent 设置已保存（Key 仅存本浏览器，不进分享链接/导出件）。');
});

updateSessionPill();
renderSimTriangle();
renderCaeRunbook();
seedForchheimerAndRun();
