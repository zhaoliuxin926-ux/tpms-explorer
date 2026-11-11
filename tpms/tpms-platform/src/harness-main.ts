/**
 * harness-main.ts — Agent 驾驶舱入口（方向 B1，2026-11-11）
 *
 * 双壳拓扑：本页（驾驶舱壳，对话主视角）内嵌 index.html（工程壳）iframe。
 * - 对话循环复用 core/agent-run（M3 多轮 + M4 有界修复菜单 + Per-Prompt 预算）；
 * - 写态工具（mesh/verify）经 core/iframe-bridge 驱动工程壳内同一套执行体（双壳单源）；
 * - 只读工具（list/estimate）直接用共享实现；
 * - 无 key/规则模式：parseNL 解析意图 → 经桥应用到工程壳（零后端规则兜底）。
 */
import { runAgent, type ToolImpl, type AgentEvent } from './core/agent-run';
import { agentListExec, agentEstimateExec } from './core/agent-tools-shared';
import { BridgeClient } from './core/iframe-bridge';
import {
  createBrowserProvider, loadAgentCfg, saveAgentCfg, getByoKey, setByoKey,
  BrowserLlmError, DEFAULT_ENDPOINTS, DEFAULT_MODELS, type AgentCfg,
} from './core/llm-provider-browser';
import { parseNL } from './core/nl-agent';

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
const bridge = new BridgeClient(() => document.getElementById('stage-frame') as HTMLIFrameElement | null);
bridge.attach();

// ── 画布坞：iframe 就绪 + 状态条 ────────────────────────────────
const frame = $('stage-frame') as HTMLIFrameElement | null;
frame?.addEventListener('load', () => { $('frame-loading')?.style.setProperty('display', 'none'); refreshStat(); });

async function refreshStat(): Promise<void> {
  try {
    const s = await bridge.request('get-state', {}, 4_000) as { summary?: string };
    if (s?.summary) { const el = $('stat-state'); if (el) el.textContent = s.summary; }
  } catch { /* 工程壳未就绪时静默 */ }
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

// ── 诊断/导出标签内容 ───────────────────────────────────────
function renderDiag(summary: string): void {
  try {
    const j = JSON.parse(summary) as Record<string, unknown>;
    const cells: Array<[string, string, string?]> = [
      ['verdict', String(j.verdict), j.verdict === 'pass' ? 'ok' : 'bad'],
      ['最小壁厚（medial）', j.minWallMm == null ? 'n/a' : `${j.minWallMm} mm`],
      ['主域孔喉', j.minThroatMm == null ? 'n/a' : `${j.minThroatMm} mm`],
      ['封闭孔腔', `${j.closedDomains} 域`],
      ['孔隙连通', `${j.mainPoreFraction}%`],
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
  ['tpms_design_verify', { name: 'tpms_design_verify', write: false, exec: (a) => bridge.request('verify', a) }],
]);

const pendingToolCards = new Map<string, HTMLElement[]>();
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
    // 结果回填到 tool-start 卡（同名队列配对；无卡兜底新开）
    const q = pendingToolCards.get(e.name);
    const hostEntry = q?.shift();
    let res: HTMLElement;
    if (hostEntry) {
      res = hostEntry.querySelector('.res') as HTMLElement;
      hostEntry.classList.remove('tool');
      hostEntry.classList.add(e.result.ok ? 'ok' : 'fail');
      if (e.result.verifyFail) {
        const nm = hostEntry.querySelector('.name') as HTMLElement;
        const b = el('badge fail', 'span'); b.textContent = 'verdict: fail';
        nm.appendChild(b);
      }
    } else {
      const d = openEntry(e.result.ok ? 'ok' : 'fail');
      res = addCard(d, e.name, e.result.verifyFail ? 'verdict: fail' : undefined, e.result.verifyFail).res;
    }
    res.textContent = e.result.summary.slice(0, 400);
    res.classList.toggle('bad', e.result.verifyFail === true);
    setBudget(e.budgetUsed);
    if (e.name === 'tpms_design_verify') { renderDiag(e.result.summary); void refreshStat(); }
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
    void refreshStat();
  }
}

// ── 无 key 规则兜底（parseNL 解析 → 经桥应用到工程壳）─────────────
function rulesFallback(text: string, why?: string): void {
  if (why) addErr('回退规则', why);
  const it = parseNL(text);
  const patches: Record<string, unknown> = { ...it.patches };
  const por = patches.porosity as number | null | undefined;
  if (por != null && por <= 1) patches.porosity = por * 100;
  const has = Object.keys(patches).length > 0;
  const d = openEntry(has ? 'ok' : 'tool');
  const { args, res } = addCard(d, '本地规则解析', has ? '只读建议→应用' : 'help');
  args.textContent = has ? JSON.stringify(patches) : text.slice(0, 80);
  res.textContent = it.reply;
  if (has) {
    void bridge.request('apply', patches).then((r) => { res.textContent += `\n→ ${r.summary.slice(0, 120)}`; void refreshStat(); })
      .catch((e: unknown) => { res.textContent += `\n→ 应用失败：${e instanceof Error ? e.message : String(e)}`; });
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
  const cfg = loadAgentCfg();
  if (cfg.kind === 'rules' || (cfg.kind === 'openai' && !getByoKey())) {
    addUser(text);
    if (cfg.kind === 'openai') addErr('无 Key', '未配置 API Key（设置里填写），走本地规则兜底');
    rulesFallback(text);
    return;
  }
  addUser(text);
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
  tabs.forEach((x) => x.classList.remove('on'));
  t.classList.add('on');
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('on', p.id === t.dataset.pane));
}));
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
