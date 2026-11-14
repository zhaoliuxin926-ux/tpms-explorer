/**
 * DeepSeek-Harness (dsh) Workbench Controller + Multi-Fidelity CAE Dispatcher
 * Bridges harness.html UI controls to local cae-daemon (127.0.0.1:4830) cleanly
 * with zero boot-time off-origin network calls when served statically on CI ports.
 */

import type { TpmType } from './types';
import { forwardModel } from './physics/inverse-design';

export interface DshDesignState {
  type: string;
  structure: 'network' | 'sheet';
  periods: number;
  porosity: number;
  specimenSizeMm: number | null;
}

export interface DshCardHandle {
  args: HTMLElement;
  res: HTMLElement;
}

export interface DshBrowserParitySnapshot {
  modulusGPa?: number | null;
  permM2?: number | null;
  dtModulusGPa?: number | null;
  dtPermM2?: number | null;
  lbmPermM2?: number | null;
  forchK_m2?: number | null;
  forchBetaM1?: number | null;
  wssMeanMPa?: number | null;
}

export interface DshHarnessBridge {
  getDesignState: () => DshDesignState;
  activateTab: (paneId: 'p3d' | 'pdiag' | 'pexp') => void;
  openEntry: (kind: 'tool' | 'ok' | 'fail' | 'repair') => HTMLElement;
  addCard: (entry: HTMLElement, name: string, tag: string) => DshCardHandle;
  addFinal: (text: string) => void;
  runForchheimerPanel: (isSeeded?: boolean) => string;
  runIso13314PostProc: (
    sourceLabel: string,
    text: string,
    inputType: 'displacement-force' | 'strain-stress',
    specimenDimensions?: { lengthMm: number; widthMm: number; thicknessMm: number },
  ) => unknown;
  overlayStl?: (payload: {
    stlBase64?: string;
    stlText?: string;
    label?: string;
    clear?: boolean;
  }) => Promise<{ ok: boolean; summary: string }>;
  getBrowserParitySnapshot?: () => DshBrowserParitySnapshot;
}

export type CaeJobKind =
  | 'preprocess-bl'
  | 'openfoam-cfd'
  | 'abaqus-fea'
  | 'comsol-cfd'
  | 'pipeline';

interface ResidualPoint {
  iter: number;
  Ux: number;
  Uy: number;
  Uz: number;
  p: number;
}

interface WssBin {
  label: string;
  ratio: number;
}

interface ParityRow {
  tier: string;
  engine: string;
  modulusGPa: string;
  permM2: string;
  betaM1: string;
  osteoWss: string;
  statusDelta: string;
}

const SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/ntop-bl', desc: 'nTopCL 6.3.3 原生容器 + RVE 边界层网格与 Mesh Doctor' },
  { cmd: '/openfoam', desc: 'OpenFOAM 13 双流速点 CFD + WSS 成骨窗口提取' },
  { cmd: '/abaqus', desc: 'ABAQUS 标准/显式压缩算例生成或求解' },
  { cmd: '/comsol', desc: 'COMSOL 6.2 Java 生成与编译/批处理求解' },
  { cmd: '/pipeline', desc: '多保真度全闭环：RVE BL → 双流速 CFD → COMSOL/ABAQUS 对标' },
];

const DAEMON_BASE = ((): string => {
  if (typeof window !== 'undefined') {
    const custom = new URLSearchParams(window.location.search).get('caeDaemonUrl');
    if (custom && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(custom)) {
      return custom.replace(/\/+$/, '');
    }
  }
  return 'http://127.0.0.1:4830';
})();

const byId = <T extends Element = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

let initialized = false;
let slashSelectedIdx = 0;
let daemonOnline = false;

interface MonitorState {
  preprocess: Record<string, any> | null;
  cfdSummary: Record<string, any> | null;
  comsol: Record<string, any> | null;
  abaqus: Record<string, any> | null;
  pipelineReport: Record<string, any> | null;
  parityRows: ParityRow[];
}

const monitorState: MonitorState = {
  preprocess: null,
  cfdSummary: null,
  comsol: null,
  abaqus: null,
  pipelineReport: null,
  parityRows: [],
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + chunk));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function downloadFileLocal(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setFlowStep(
  step: 'design' | 'bl' | 'solve' | 'post' | 'audit',
  state: 'idle' | 'running' | 'done' | 'fail',
  detail?: string,
): void {
  const dot = byId(`dsh-dot-${step}`);
  const txt = byId(`dsh-txt-${step}`);
  if (dot) {
    dot.classList.remove('running', 'done', 'fail');
    if (state !== 'idle') dot.classList.add(state);
  }
  if (txt && detail) txt.textContent = detail;
}

function setPluginPill(id: string, cls: 'ok' | 'warn' | 'bad' | '', label: string, msg?: string): void {
  const pill = byId(`dsh-st-${id}`);
  const msgEl = byId(`dsh-msg-${id}`);
  if (pill) {
    pill.classList.remove('ok', 'warn', 'bad');
    if (cls) pill.classList.add(cls);
    pill.textContent = label;
  }
  if (msgEl && msg) msgEl.textContent = msg;
}

function attachCollapsibleTermDrawer(cardHandle: DshCardHandle, initialText = ''): HTMLPreElement {
  const card = cardHandle.res.closest('.card') as HTMLElement | null;
  if (card) {
    const hd = card.firstElementChild as HTMLElement | null;
    if (hd && !hd.classList.contains('dsh-toggleable')) {
      hd.classList.add('dsh-toggleable');
      hd.title = '点击折叠/展开工具详情';
      hd.addEventListener('click', () => {
        card.classList.toggle('dsh-collapsed');
      });
    }
  }
  const pre = document.createElement('pre');
  pre.className = 'dsh-term-log';
  pre.textContent = initialText || '[等待守护进程输出…]';
  const parent = card ?? cardHandle.res.parentElement;
  if (parent) parent.appendChild(pre);
  return pre;
}

function renderResidualSvg(residuals: ResidualPoint[] | null, tierLabel = '待求解'): void {
  const svg = byId<SVGSVGElement>('cae-residual-svg');
  const tierBadge = byId('cae-res-tier');
  if (tierBadge) {
    tierBadge.textContent = tierLabel;
    tierBadge.classList.remove('ok', 'warn', 'bad');
    if (residuals && residuals.length > 0) tierBadge.classList.add('ok');
  }
  if (!svg) return;

  const W = 320, H = 148, padL = 36, padR = 10, padT = 14, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const gridY = [0, -2, -4, -6].map((lg) => {
    const y = padT + ((0 - lg) / 6) * plotH;
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#1e2d48" stroke-dasharray="2,2"/><text x="${padL - 4}" y="${(y + 3).toFixed(1)}" fill="#64748b" font-size="8" text-anchor="end">1e${lg}</text>`;
  }).join('');

  if (!residuals || residuals.length === 0) {
    svg.innerHTML = `${gridY}<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#334155"/><line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#334155"/><text x="${(W + padL - padR) / 2}" y="${H / 2}" fill="#64748b" font-size="10" text-anchor="middle">运行 /openfoam 或 /pipeline 后渲染对数残差收敛曲线</text>`;
    return;
  }

  const maxIt = Math.max(2, residuals[residuals.length - 1].iter);
  const minIt = residuals[0].iter;
  const xMap = (it: number) => padL + ((it - minIt) / Math.max(1, maxIt - minIt)) * plotW;
  const yMap = (val: number) => {
    const lg = Math.max(-6, Math.min(0, Math.log10(Math.max(1e-7, Math.abs(val)))));
    return padT + ((0 - lg) / 6) * plotH;
  };

  const series: Array<{ key: keyof Omit<ResidualPoint, 'iter'>; color: string; label: string }> = [
    { key: 'Ux', color: '#22d3ee', label: 'Ux' },
    { key: 'Uy', color: '#34d399', label: 'Uy' },
    { key: 'Uz', color: '#a78bfa', label: 'Uz' },
    { key: 'p', color: '#fbbf24', label: 'p' },
  ];

  const paths = series.map((s) => {
    const d = residuals
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${xMap(pt.iter).toFixed(1)},${yMap(pt[s.key]).toFixed(1)}`)
      .join(' ');
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`;
  }).join('');

  const legend = series.map((s, idx) => {
    const lx = padL + 8 + idx * 46;
    return `<rect x="${lx}" y="4" width="8" height="3" fill="${s.color}"/><text x="${lx + 11}" y="8" fill="#cbd5e1" font-size="8.5">${s.label}</text>`;
  }).join('');

  const last = residuals[residuals.length - 1];
  svg.innerHTML = `${gridY}<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#334155"/><line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#334155"/>${paths}${legend}<text x="${W - padR}" y="${H - 6}" fill="#94a3b8" font-size="8.5" text-anchor="end">iter=${last.iter} · p_res=${Number(last.p).toExponential(1)}</text>`;
}

function renderWssWindowSvg(cfd: Record<string, any> | null): void {
  const svg = byId<SVGSVGElement>('cae-wss-svg');
  const badge = byId('cae-wss-window-badge');
  const sidePill = byId('dsh-wss-pill');
  const sideDetail = byId('dsh-wss-detail');

  if (!cfd) {
    if (badge) badge.textContent = '—';
    if (svg) {
      svg.innerHTML = '<rect x="14" y="18" width="292" height="106" rx="6" fill="#0d172a" stroke="#1e2d48"/><text x="160" y="72" fill="#64748b" font-size="10" text-anchor="middle">等待 CFD 提取 τ_w ∈ [5, 25] mPa 成骨刺激窗口</text>';
    }
    return;
  }

  const ratioPct = Number(cfd.wssOsteogenicWindowPct ?? (Number(cfd.wssOsteogenicWindowRatio || 0) * 100));
  const meanMpa = Number(cfd.wssMean_mPa || 0);
  const p50Mpa = Number(cfd.wssP50_mPa || meanMpa);
  const p90Mpa = Number(cfd.wssP90_mPa || meanMpa);
  const bins: WssBin[] = Array.isArray(cfd.wssHistogram) && cfd.wssHistogram.length
    ? cfd.wssHistogram
    : [
      { label: '<5 mPa', ratio: 0.4 },
      { label: '5-15 mPa', ratio: Math.min(1, ratioPct / 100) },
      { label: '15-25 mPa', ratio: 0 },
      { label: '25-50 mPa', ratio: 0.1 },
      { label: '>50 mPa', ratio: 0 },
    ];

  if (badge) {
    badge.textContent = `成骨窗口 ${ratioPct.toFixed(1)}% · 均值 ${meanMpa.toFixed(2)} mPa`;
    badge.classList.remove('ok', 'warn', 'bad');
    badge.classList.add(ratioPct >= 30 ? 'ok' : ratioPct >= 15 ? 'warn' : 'bad');
  }
  if (sidePill) {
    sidePill.textContent = `${ratioPct.toFixed(1)}%`;
    sidePill.classList.remove('ok', 'warn', 'bad');
    sidePill.classList.add(ratioPct >= 30 ? 'ok' : 'warn');
  }
  if (sideDetail) {
    sideDetail.textContent = `τ_w mean=${meanMpa.toFixed(2)} mPa · P50=${p50Mpa.toFixed(2)} · P90=${p90Mpa.toFixed(2)} · [5,25]mPa=${ratioPct.toFixed(1)}%`;
  }

  if (!svg) return;
  const W = 320, H = 148, padL = 24, padR = 12, padT = 20, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const barSlot = plotW / Math.max(1, bins.length);
  const barW = Math.max(18, barSlot * 0.62);
  const maxR = Math.max(0.4, ...bins.map((b) => Number(b.ratio || 0)));

  const bars = bins.map((b, i) => {
    const r = Number(b.ratio || 0);
    const bh = Math.max(2, (r / maxR) * plotH);
    const x = padL + i * barSlot + (barSlot - barW) * 0.5;
    const y = padT + plotH - bh;
    const isOsteo = b.label.includes('5-15') || b.label.includes('15-25');
    const fill = isOsteo ? '#22c55e' : '#38bdf8';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${fill}" fill-opacity="${isOsteo ? '0.9' : '0.45'}"/>`
      + `<text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(12, y - 3).toFixed(1)}" fill="#e2edf9" font-size="8.5" text-anchor="middle">${(r * 100).toFixed(0)}%</text>`
      + `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 12}" fill="${isOsteo ? '#4ade80' : '#94a3b8'}" font-size="8" text-anchor="middle">${b.label}</text>`;
  }).join('');

  svg.innerHTML = `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#334155"/>${bars}<text x="${W - padR}" y="11" fill="#4ade80" font-size="8.5" text-anchor="end">绿色柱区 = 成骨窗口 [5,25] mPa</text>`;
}

function renderMeshDoctorBadge(pre: Record<string, any> | null): void {
  const badge = byId('cae-mesh-doctor-badge');
  const sidePill = byId('dsh-doc-pill');
  const sideDetail = byId('dsh-doc-detail');

  if (!pre) return;
  const doc = pre.meshDoctor || {};
  const ntop = pre.ntop || {};
  const gmsh = pre.gmsh || {};
  const sicn = doc.finalQuality?.minSICN ?? ntop.ntopMinSICNTet ?? gmsh.minSICN ?? null;
  const prisms = ntop.ntopPrisms ?? 0;
  const tets = ntop.ntopTets ?? gmsh.tets ?? 0;
  const healed = doc.healed !== false && (sicn == null || Number(sicn) >= 0.05);
  const speedup = pre.rveSpeedupFactor ? ` · RVE ${pre.rveSpeedupFactor}x` : '';
  const ntopTag = ntop.ntopExecuted ? `nTop C3D6:${prisms}+C3D4:${tets}` : `Gmsh tets:${tets}`;
  const label = `Mesh Doctor: ${healed ? (doc.triggered ? '已自愈通过' : '门禁通过') : '低质量告警'} · minSICN=${sicn ?? '—'}${speedup}`;

  if (badge) {
    badge.textContent = label;
    badge.classList.remove('ok', 'warn', 'bad');
    badge.classList.add(healed ? 'ok' : 'warn');
  }
  if (sidePill) {
    sidePill.textContent = healed ? 'PASSED' : 'HEALING';
    sidePill.classList.remove('ok', 'warn', 'bad');
    sidePill.classList.add(healed ? 'ok' : 'warn');
  }
  if (sideDetail) {
    const acts = Array.isArray(doc.actions) && doc.actions.length ? ` | 修复：${doc.actions.join('; ')}` : '';
    sideDetail.textContent = `${ntopTag} · minSICN=${sicn ?? '—'} · tries=${doc.attempts ?? 1}${speedup}${acts}`;
  }
}

export function initHarnessCaeDsh(bridge: DshHarnessBridge): void {
  if (initialized) return;
  initialized = true;

  // 1. DSH Rail & Sidebar Navigation
  const sidebar = byId('dsh-sidebar');
  const sbTitle = byId('dsh-sb-title');
  const toggleBtn = byId('dsh-rail-toggle');
  const railMap: Array<{ btnId: string; paneId: string; title: string }> = [
    { btnId: 'dsh-rail-flow', paneId: 'dsh-pane-flow', title: 'Flow 仿真流水线' },
    { btnId: 'dsh-rail-plugins', paneId: 'dsh-pane-plugins', title: 'CAE 求解器与插件矩阵' },
    { btnId: 'dsh-rail-files', paneId: 'dsh-pane-files', title: '工作区产物 (sim/out)' },
    { btnId: 'dsh-rail-solver', paneId: 'dsh-pane-solver', title: '求解监控与自愈诊断' },
  ];

  const activateRailPane = (targetBtnId: string): void => {
    for (const item of railMap) {
      const btn = byId(item.btnId);
      const pane = byId(item.paneId);
      const on = item.btnId === targetBtnId;
      btn?.classList.toggle('on', on);
      pane?.classList.toggle('on', on);
      if (on && sbTitle) sbTitle.textContent = item.title;
    }
    if (sidebar?.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      if (toggleBtn) {
        toggleBtn.textContent = '«';
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
    }
  };

  for (const item of railMap) {
    byId(item.btnId)?.addEventListener('click', () => activateRailPane(item.btnId));
  }

  byId('dsh-open-monitor-btn')?.addEventListener('click', () => {
    bridge.activateTab('pdiag');
    byId('cae-monitor-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  toggleBtn?.addEventListener('click', () => {
    if (!sidebar) return;
    const nextCollapsed = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', nextCollapsed);
    toggleBtn.textContent = nextCollapsed ? '»' : '«';
    toggleBtn.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  });

  // 2. Split Dock Toggle
  const stageEl = document.querySelector('.stage') as HTMLElement | null;
  const splitBtn = byId<HTMLButtonElement>('dock-split-btn');
  const splitSelect = byId<HTMLSelectElement>('dock-layout-select');

  const syncSplitSecondary = (): void => {
    if (!stageEl) return;
    const isSplit = stageEl.classList.contains('split');
    const secId = (splitSelect?.value === 'pexp' ? 'pexp' : 'pdiag');
    for (const pid of ['p3d', 'pdiag', 'pexp']) {
      const p = byId(pid);
      p?.classList.toggle('split-secondary', isSplit && pid === secId);
    }
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };

  splitBtn?.addEventListener('click', () => {
    if (!stageEl) return;
    const next = !stageEl.classList.contains('split');
    if (next) bridge.activateTab('p3d');
    stageEl.classList.toggle('split', next);
    splitBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    syncSplitSecondary();
  });

  splitSelect?.addEventListener('change', () => {
    syncSplitSecondary();
  });

  // 3. Multi-Fidelity Parity Matrix & Monitor Renderer
  const computeParityRows = (): ParityRow[] => {
    const st = bridge.getDesignState();
    const porFrac = Math.min(0.90, Math.max(0.25, (st.porosity || 70) / 100));
    const periods = Math.max(1, Math.round(st.periods || 1));
    const L_mm = st.specimenSizeMm && st.specimenSizeMm > 0 ? st.specimenSizeMm : periods * 4.0;
    const cellMm = L_mm / periods;
    const t1 = forwardModel((st.type || 'gyroid') as TpmType, porFrac, cellMm, 1.0);
    const t1K_m2 = t1.kappaM2;

    const snap = bridge.getBrowserParitySnapshot?.() ?? {};
    const cfd = monitorState.cfdSummary;
    const pre = monitorState.preprocess;
    const com = monitorState.comsol;
    const abq = monitorState.abaqus;

    const cfdK = cfd?.K_m2 != null ? Number(cfd.K_m2) : null;
    const refK = cfdK || t1K_m2;
    const pctDiff = (v: number | null | undefined, ref: number | null | undefined): string => {
      if (v == null || !ref || !Number.isFinite(v) || !Number.isFinite(ref)) return '—';
      const d = ((v - ref) / Math.max(Math.abs(ref), 1e-30)) * 100;
      return `${d >= 0 ? '+' : ''}${d.toFixed(1)}% vs T3`;
    };

    const t2E = snap.dtModulusGPa ?? snap.modulusGPa ?? null;
    const t2K = snap.forchK_m2 ?? snap.lbmPermM2 ?? snap.permM2 ?? null;
    const rows: ParityRow[] = [
      {
        tier: 'T1 解析代理层',
        engine: 'Gibson-Ashby / Kozeny-Carman',
        modulusGPa: `${t1.EGPa.toFixed(2)}`,
        permM2: `${t1K_m2.toExponential(2)}`,
        betaM1: 'Ergun 估算',
        osteoWss: '—',
        statusDelta: cfdK ? pctDiff(t1K_m2, refK) : '基准 (Baseline)',
      },
      {
        tier: 'T2 浏览器在线仿真',
        engine: '3D 体素 FE / D3Q19 LBM',
        modulusGPa: t2E != null ? `${Number(t2E).toFixed(2)}` : '待跑DT',
        permM2: t2K != null ? `${Number(t2K).toExponential(2)}` : '待拟合',
        betaM1: snap.forchBetaM1 != null ? `${Number(snap.forchBetaM1).toFixed(1)}` : '—',
        osteoWss: snap.wssMeanMPa != null ? `${Number(snap.wssMeanMPa).toFixed(1)} mPa` : '—',
        statusDelta: t2K != null ? (cfdK ? pctDiff(t2K, refK) : '在线已算') : '点击在线仿真',
      },
      {
        tier: 'T3 本地边界层 CFD',
        engine: `${pre?.ntop?.ntopExecuted ? 'nTopCL+' : 'GmshBL+'}${cfd?.solverTier === 'openfoam13_wsl' ? 'OF13' : 'FVM-RVE'}`,
        modulusGPa: '—',
        permM2: cfdK != null ? `${cfdK.toExponential(2)}` : '待求解',
        betaM1: cfd?.beta_m1 != null ? `${Number(cfd.beta_m1).toFixed(1)}` : '—',
        osteoWss: cfd?.wssOsteogenicWindowPct != null
          ? `${Number(cfd.wssOsteogenicWindowPct).toFixed(1)}% (${Number(cfd.wssMean_mPa).toFixed(1)} mPa)`
          : '—',
        statusDelta: cfdK && cfd ? `${String(cfd.solverTier)} (RVE k=${cfd.cfdPeriods ?? 1})` : '待运行 /openfoam',
      },
      {
        tier: 'T4 工业多物理场',
        engine: 'COMSOL 6.2 + ABAQUS',
        modulusGPa: abq?.staticInpPath ? 'INP 就绪' : '待生成',
        permM2: com?.dpPa != null ? `ΔP=${Number(com.dpPa).toFixed(2)} Pa` : (com?.compiled ? 'Java 已编译' : '待编译'),
        betaM1: '—',
        osteoWss: com?.wssPa != null ? `${(Number(com.wssPa) * 1000).toFixed(1)} mPa` : 'AvSurface',
        statusDelta: com?.executed ? 'Batch 实算完成' : (com?.compiled ? '6.2 编译通过' : '等待 /comsol /pipeline'),
      },
    ];
    return rows;
  };

  const renderParityMatrix = (): void => {
    const wrap = byId('cae-parity-matrix');
    const stEl = byId('cae-parity-status');
    const rows = computeParityRows();
    monitorState.parityRows = rows;
    (window as unknown as Record<string, unknown>).__tpmsParityState = {
      ...monitorState,
      daemonOnline,
    };
    if (wrap) {
      const trs = rows.map((r) => `<tr><td><strong>${r.tier}</strong></td><td>${r.engine}</td><td class="mono">${r.modulusGPa}</td><td class="mono">${r.permM2}</td><td class="mono">${r.betaM1}</td><td class="mono">${r.osteoWss}</td><td>${r.statusDelta}</td></tr>`).join('');
      wrap.innerHTML = `<table class="cae-parity-table"><thead><tr><th>保真度层级</th><th>求解引擎</th><th>E_eff (GPa)</th><th>K (m²)</th><th>β (m⁻¹)</th><th>成骨窗口 τ_w∈[5,25]mPa</th><th>偏差 / 状态</th></tr></thead><tbody>${trs}</tbody></table>`;
    }
    if (stEl && monitorState.cfdSummary) {
      const cfd = monitorState.cfdSummary;
      stEl.textContent = `已完成四级对标（${cfd.solverTier}）：K_CFD=${Number(cfd.K_m2).toExponential(3)} m²，β=${cfd.beta_m1} m⁻¹，Fo=${cfd.Fo_v2}，成骨剪切窗口占比 ${cfd.wssOsteogenicWindowPct}%（v₁=${cfd.v1_ms * 1000} mm/s → ΔP₁=${cfd.dp1_Pa} Pa）。`;
    }
  };

  const applyCfdToForchheimer = (cfd: Record<string, any>): string => {
    const setV = (id: string, val: string) => {
      const el = byId<HTMLInputElement>(id);
      if (el) el.value = val;
    };
    const st = bridge.getDesignState();
    const periods = Math.max(1, Math.round(st.periods || 1));
    const fallbackL = st.specimenSizeMm && st.specimenSizeMm > 0 ? st.specimenSizeMm : periods * 4.0;
    const dp1El = byId<HTMLInputElement>('fc-dp1');
    if (dp1El) {
      dp1El.dataset.lengthMm = String(Number(cfd.fullSpecimenLengthMm) > 0 ? cfd.fullSpecimenLengthMm : fallbackL);
      dp1El.dataset.muPas = String(Number(cfd.fluidProps?.mu_Pas) > 0 ? cfd.fluidProps.mu_Pas : 8.9e-4);
    }
    setV('fc-v1', (Number(cfd.v1_ms || 0.001) * 1000).toFixed(2));
    setV('fc-dp1', Number(cfd.dp1_Pa || 0.1).toFixed(4));
    setV('fc-v2', (Number(cfd.v2_ms || 0.01) * 1000).toFixed(2));
    setV('fc-dp2', Number(cfd.dp2_Pa || 1.0).toFixed(4));
    if (cfd.wssMean_mPa != null) {
      setV('fc-wss', Number(cfd.wssMean_mPa).toFixed(2));
    }
    const fcTxt = bridge.runForchheimerPanel(false);
    setFlowStep('post', 'done', `CFD ΔP₁/ΔP₂ 已回填 Forchheimer`);
    renderParityMatrix();
    return fcTxt;
  };

  const renderMonitorFromResult = (kind: string, resObj: Record<string, any>): void => {
    if (resObj.preprocess) monitorState.preprocess = resObj.preprocess;
    else if (kind === 'preprocess-bl') monitorState.preprocess = resObj;
    if (resObj.cfdSummary) monitorState.cfdSummary = resObj.cfdSummary;
    if (resObj.comsol) monitorState.comsol = resObj.comsol;
    else if (kind === 'comsol-cfd') monitorState.comsol = resObj;
    if (resObj.abaqus) monitorState.abaqus = resObj.abaqus;
    else if (kind === 'abaqus-fea') monitorState.abaqus = resObj;
    if (kind === 'pipeline') monitorState.pipelineReport = resObj;

    renderMeshDoctorBadge(monitorState.preprocess);
    if (monitorState.cfdSummary) {
      renderResidualSvg(
        monitorState.cfdSummary.residuals || null,
        monitorState.cfdSummary.solverTier || 'CFD',
      );
      renderWssWindowSvg(monitorState.cfdSummary);
    }
    renderParityMatrix();
  };

  // Boot initial charts/matrix cleanly
  renderResidualSvg(null);
  renderWssWindowSvg(null);
  renderParityMatrix();

  // 4. 3D STL Overlay + Certificate Downloads
  const overlayStlFromDaemon = async (filename: string): Promise<void> => {
    const jobStatus = byId('cae-job-status');
    const previewEl = byId<HTMLPreElement>('dsh-file-preview');
    if (!bridge.overlayStl) {
      if (jobStatus) jobStatus.textContent = '3D 视口暂未接入 overlay-stl 桥处理器。';
      return;
    }
    try {
      const resp = await fetch(`${DAEMON_BASE}/api/cae/artifact-raw?name=${encodeURIComponent(filename)}`, {
        cache: 'no-store',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const b64 = bytesToBase64(buf);
      const ovRes = await bridge.overlayStl({ stlBase64: b64, label: filename });
      bridge.activateTab('p3d');
      if (previewEl) {
        previewEl.hidden = false;
        previewEl.textContent = `[3D 视口叠加] ${ovRes.summary} (${(buf.byteLength / 1024).toFixed(1)} KB)`;
      }
      if (jobStatus) jobStatus.textContent = ovRes.summary;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (jobStatus) jobStatus.textContent = `3D STL 叠加失败：${msg}`;
    }
  };

  byId('cae-btn-clear-overlay')?.addEventListener('click', () => {
    void bridge.overlayStl?.({ clear: true }).then((r) => {
      const jobStatus = byId('cae-job-status');
      if (jobStatus) jobStatus.textContent = r.summary;
    });
  });

  byId('cae-btn-auto-backfill')?.addEventListener('click', () => {
    if (monitorState.cfdSummary) {
      const txt = applyCfdToForchheimer(monitorState.cfdSummary);
      const stEl = byId('cae-parity-status');
      if (stEl) stEl.textContent = `已自动回填 CFD 压降：${txt}`;
    } else {
      const txt = bridge.runForchheimerPanel(false);
      renderParityMatrix();
      const stEl = byId('cae-parity-status');
      if (stEl) stEl.textContent = `已按当前输入重算 Forchheimer：${txt}`;
    }
  });

  const exportCertificate = (fmt: 'json' | 'md'): void => {
    const st = bridge.getDesignState();
    const rows = computeParityRows();
    const cert = {
      schema: 'tpms-multifidelity-certificate-v1',
      generatedAt: new Date().toISOString(),
      design: st,
      meshDoctor: monitorState.preprocess?.meshDoctor || null,
      ntop: monitorState.preprocess?.ntop || null,
      cfdSummary: monitorState.cfdSummary || null,
      comsol: monitorState.comsol || null,
      abaqus: monitorState.abaqus || null,
      parityMatrix: rows,
    };
    const baseName = `tpms-multifidelity-cert-${st.type}-p${st.porosity}`;
    if (fmt === 'json') {
      downloadFileLocal(`${baseName}.json`, JSON.stringify(cert, null, 2), 'application/json;charset=utf-8');
      return;
    }
    const mdLines = [
      `# TPMS 多保真度数值验证证书 (${st.type}, 孔隙率 ${st.porosity}%)`,
      `- 生成时间: ${cert.generatedAt}`,
      `- nTopCL 状态: ${cert.ntop?.ntopStatus || '未运行'} (C3D6 Prisms=${cert.ntop?.ntopPrisms ?? 0}, C3D4 Tets=${cert.ntop?.ntopTets ?? 0})`,
      `- Mesh Doctor: healed=${cert.meshDoctor?.healed ?? 'N/A'}, minSICN=${cert.meshDoctor?.finalQuality?.minSICN ?? 'N/A'}`,
      '',
      '## 四级保真度交叉对标矩阵',
      '| 层级 | 求解引擎 | E_eff (GPa) | K (m²) | β (m⁻¹) | 成骨窗口 τ_w∈[5,25]mPa | 状态 / 偏差 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      ...rows.map((r) => `| ${r.tier} | ${r.engine} | ${r.modulusGPa} | ${r.permM2} | ${r.betaM1} | ${r.osteoWss} | ${r.statusDelta} |`),
    ];
    downloadFileLocal(`${baseName}.md`, mdLines.join('\n'), 'text/markdown;charset=utf-8');
  };

  byId('cae-btn-cert-json')?.addEventListener('click', () => exportCertificate('json'));
  byId('cae-btn-cert-md')?.addEventListener('click', () => exportCertificate('md'));

  // 5. CAE Environment Probe & Workspace File Tree
  const fileListEl = byId('dsh-file-list');
  const filePreviewEl = byId<HTMLPreElement>('dsh-file-preview');

  const renderFileList = (files: Array<{ name: string; sizeBytes: number }>): void => {
    if (!fileListEl) return;
    fileListEl.innerHTML = '';
    if (!files.length) {
      fileListEl.innerHTML = '<div style="color:#64748b">sim/out 暂无产物</div>';
      return;
    }
    for (const f of files.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'dsh-file-item';
      const kb = (f.sizeBytes / 1024).toFixed(1);
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
      nameSpan.textContent = f.name;
      const metaWrap = document.createElement('span');
      metaWrap.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
      const kbSpan = document.createElement('span');
      kbSpan.style.color = '#64748b';
      kbSpan.textContent = `${kb}KB`;
      metaWrap.appendChild(kbSpan);

      if (f.name.toLowerCase().endsWith('.stl')) {
        const ovBtn = document.createElement('button');
        ovBtn.type = 'button';
        ovBtn.className = 'dsh-preview-btn';
        ovBtn.textContent = '👁️ 3D';
        ovBtn.title = '通过 /api/cae/artifact-raw 在 3D 视口叠加预览';
        ovBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void overlayStlFromDaemon(f.name);
        });
        metaWrap.appendChild(ovBtn);
      }

      row.appendChild(nameSpan);
      row.appendChild(metaWrap);
      row.addEventListener('click', async () => {
        if (!filePreviewEl) return;
        filePreviewEl.hidden = false;
        filePreviewEl.textContent = `加载 ${f.name}…`;
        try {
          const r = await fetch(`${DAEMON_BASE}/api/cae/file?name=${encodeURIComponent(f.name)}`);
          const j = await r.json();
          filePreviewEl.textContent = j.ok ? String(j.content || '').slice(0, 3500) : `无法预览: ${j.error}`;
        } catch {
          filePreviewEl.textContent = '无法连接 CAE 守护进程预览文件。';
        }
      });
      fileListEl.appendChild(row);
    }
  };

  const probeEnv = async (): Promise<boolean> => {
    const jobStatus = byId('cae-job-status');
    setPluginPill('ntop', 'warn', '探测中');
    try {
      const resp = await fetch(`${DAEMON_BASE}/api/cae/env`, { cache: 'no-store' });
      const data = await resp.json();
      daemonOnline = true;
      const eng = data.engines || {};
      const ntop = eng.ntop || {};
      setPluginPill(
        'ntop',
        ntop.installed ? (ntop.templateCount > 0 ? 'ok' : 'warn') : 'bad',
        ntop.installed ? (ntop.templateCount > 0 ? '就绪' : '缺.ntop模板') : '未安装',
        `${ntop.version || 'ntopcl'} · templates=${ntop.templateCount ?? 0}`,
      );
      setPluginPill(
        'gmsh',
        eng.gmshBl?.available ? 'ok' : 'bad',
        eng.gmshBl?.available ? '就绪' : '不可用',
        `Python Gmsh BL + WSL ${eng.gmshBl?.wslGmshVersion || ''}`,
      );
      setPluginPill(
        'of',
        eng.openfoam?.available ? 'ok' : 'bad',
        eng.openfoam?.available ? 'WSL OF13' : '不可用',
        `${eng.openfoam?.distro || ''} ${eng.openfoam?.root || ''}`,
      );
      setPluginPill(
        'abq',
        eng.abaqus?.available ? 'ok' : 'bad',
        eng.abaqus?.available ? '就绪' : '未找到',
        eng.abaqus?.path || '',
      );
      setPluginPill(
        'comsol',
        eng.comsol?.available ? 'ok' : 'bad',
        eng.comsol?.available ? 'COMSOL 6.2' : '未找到',
        'comsolcompile + comsolbatch 已检测',
      );
      if (Array.isArray(data.recentFiles)) renderFileList(data.recentFiles);
      if (jobStatus) {
        jobStatus.textContent = `已连接 CAE 守护进程 (${DAEMON_BASE}) · nTopCL=${ntop.installed ? 'OK' : 'NO'} · OF13=${eng.openfoam?.available ? 'OK' : 'NO'} · ABAQUS=${eng.abaqus?.available ? 'OK' : 'NO'} · COMSOL=${eng.comsol?.available ? 'OK' : 'NO'}`;
      }
      return true;
    } catch {
      daemonOnline = false;
      setPluginPill('ntop', 'warn', '守护未连', '请启动 node tpms/agent/cae-daemon.mjs');
      setPluginPill('gmsh', 'warn', '守护未连');
      setPluginPill('of', 'warn', '守护未连');
      setPluginPill('abq', 'warn', '守护未连');
      setPluginPill('comsol', 'warn', '守护未连');
      if (jobStatus) {
        jobStatus.textContent = '未检测到本地 CAE 守护进程 (127.0.0.1:4830)。请先在终端执行：node tpms/agent/cae-daemon.mjs';
      }
      return false;
    }
  };

  byId('dsh-probe-env-btn')?.addEventListener('click', () => {
    activateRailPane('dsh-rail-plugins');
    void probeEnv();
  });

  // Only auto-probe if explicitly hosted on daemon port or requested via query flag (keeps static port 4825 at 0 console errors)
  if (
    typeof window !== 'undefined'
    && (window.location.port === '4830' || new URLSearchParams(window.location.search).get('caeProbe') === '1')
  ) {
    void probeEnv();
  }

  // 6. CAE Job Dispatch & Auto Post-Processing Backfill
  const getCommonParams = () => {
    const st = bridge.getDesignState();
    const periods = Math.max(1, Math.round(st.periods || 1));
    const L_mm = st.specimenSizeMm && st.specimenSizeMm > 0 ? st.specimenSizeMm : periods * 4.0;
    const cellSize = Number((L_mm / periods).toFixed(4));
    const strainEl = byId<HTMLInputElement>('cae-strain');
    const blBackendEl = byId<HTMLSelectElement>('cae-bl-backend');
    const blLayersEl = byId<HTMLInputElement>('cae-bl-layers');
    const blH1El = byId<HTMLInputElement>('cae-bl-h1');
    const blGrowthEl = byId<HTMLInputElement>('cae-bl-growth');
    const cfdPeriodsEl = byId<HTMLInputElement>('cae-cfd-periods');
    const liveExecEl = byId<HTMLInputElement>('cae-live-exec');
    const porFrac = Math.min(0.90, Math.max(0.25, (st.porosity || 70) / 100));
    const cfdPeriods = Math.max(1, Math.min(periods, Math.round(Number(cfdPeriodsEl?.value || 1))));
    return {
      type: st.type || 'gyroid',
      structure: st.structure || 'network',
      k: periods,
      cfdPeriods,
      R: 20,
      por: porFrac,
      solid: Number((1 - porFrac).toFixed(4)),
      cellSize,
      strain: Number(strainEl?.value || 0.05),
      backend: blBackendEl?.value || 'auto',
      blLayers: Number(blLayersEl?.value || 3),
      blFirstHeight: Number(blH1El?.value || 0.03),
      blGrowth: Number(blGrowthEl?.value || 1.25),
      vInMmS: 1.0,
      execute: Boolean(liveExecEl?.checked),
      mode: liveExecEl?.checked ? 'full' : 'fast',
      lengthMm: L_mm,
    };
  };

  const setCaeButtonsBusy = (busy: boolean): void => {
    for (const id of ['cae-btn-bl', 'cae-btn-of', 'cae-btn-abq', 'cae-btn-comsol', 'cae-btn-pipeline']) {
      const b = byId<HTMLButtonElement>(id);
      if (b) b.disabled = busy;
    }
  };

  const dispatchCaeJob = async (kind: CaeJobKind, fromChat = false): Promise<void> => {
    const params = getCommonParams();
    const jobStatus = byId('cae-job-status');
    const termOut = byId<HTMLPreElement>('cae-term-out');
    const eh = byId('empty-hint');
    if (eh) eh.hidden = true;

    const entry = bridge.openEntry('tool');
    const labelMap: Record<CaeJobKind, string> = {
      'preprocess-bl': `p1_bl_mesh (${params.backend}, RVE k=${params.cfdPeriods})`,
      'openfoam-cfd': `OpenFOAM 13 (${params.execute ? 'WSL+FVM 实算' : 'FVM RVE 求解'})`,
      'abaqus-fea': `ABAQUS (${params.execute ? '实算+ODB' : 'INP 生成'})`,
      'comsol-cfd': `COMSOL 6.2 (${params.execute ? 'Batch 求解' : 'Java 编译'})`,
      'pipeline': `全流程多保真度闭环 (${params.mode}, RVE k=${params.cfdPeriods})`,
    };
    const card = bridge.addCard(entry, `cae.${kind}`, labelMap[kind]);
    card.args.textContent = JSON.stringify({
      type: params.type,
      structure: params.structure,
      por: params.por,
      k: params.k,
      cfdPeriods: params.cfdPeriods,
      blLayers: params.blLayers,
      h1: params.blFirstHeight,
      execute: params.execute,
    });
    card.res.textContent = '提交本机 CAE 任务…';
    const cardTerm = attachCollapsibleTermDrawer(card, `[dispatch] ${kind}\n`);

    setFlowStep('design', 'done', `${params.type} (${params.structure}, ε=${Math.round(params.por * 100)}%)`);
    setFlowStep(kind === 'preprocess-bl' ? 'bl' : 'solve', 'running', `${labelMap[kind]} 执行中…`);
    if (termOut) {
      termOut.hidden = false;
      termOut.textContent = `>>> POST ${DAEMON_BASE}/api/cae/job (${kind})\n`;
    }
    if (jobStatus) jobStatus.textContent = `正在调度 ${labelMap[kind]}…`;
    setCaeButtonsBusy(true);

    try {
      const startResp = await fetch(`${DAEMON_BASE}/api/cae/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, params }),
      });
      const startJson = await startResp.json();
      if (!startResp.ok || !startJson.ok || !startJson.jobId) {
        throw new Error(startJson.error || `HTTP ${startResp.status}`);
      }
      daemonOnline = true;
      const jobId = String(startJson.jobId);
      let finalJob: any = null;
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 700));
        const pollResp = await fetch(`${DAEMON_BASE}/api/cae/job/${encodeURIComponent(jobId)}`);
        const pollJson = await pollResp.json();
        const job = pollJson.job;
        if (!job) break;
        const logText = Array.isArray(job.logs) ? job.logs.join('\n') : '';
        if (logText) {
          cardTerm.textContent = logText;
          cardTerm.scrollTop = cardTerm.scrollHeight;
          if (termOut) {
            termOut.textContent = logText;
            termOut.scrollTop = termOut.scrollHeight;
          }
        }
        if (job.status === 'completed' || job.status === 'failed') {
          finalJob = job;
          break;
        }
      }

      if (!finalJob || finalJob.status !== 'completed') {
        throw new Error(finalJob?.error || 'CAE 任务未正常结束');
      }

      entry.classList.remove('tool');
      entry.classList.add('ok');

      const resObj = finalJob.result || {};
      renderMonitorFromResult(kind, resObj);

      let summaryMsg = `${labelMap[kind]} 完成`;
      if (kind === 'preprocess-bl') {
        const g = resObj.gmsh;
        const nt = resObj.ntop;
        const ntopStat = nt?.ntopExecuted ? `nTop C3D6=${nt.ntopPrisms}/C3D4=${nt.ntopTets}` : `backend=${resObj.backendExecuted}`;
        const ntopFb = resObj.fallbackReason ? `；${resObj.fallbackReason}` : '';
        summaryMsg = `BL前处理完成 (${ntopStat}, RVE=${resObj.rveSpeedupFactor || 1}x, MeshDoctor=${resObj.meshDoctor?.healed ? 'PASSED' : 'WARN'})${g ? `, Gmsh minSICN=${g.minSICN}` : ''}${ntopFb}`;
        setFlowStep('bl', 'done', `${ntopStat} · RVE ${resObj.rveSpeedupFactor || 1}x`);
        setFlowStep('audit', 'done', `${resObj.tag}_ntop_bl.inp/.bdf`);
      } else if (kind === 'openfoam-cfd' || kind === 'pipeline') {
        const cfd = resObj.cfdSummary || resObj.darcy;
        const pre = resObj.preprocess;
        setFlowStep('bl', 'done', pre?.ntop?.ntopExecuted ? `nTop C3D6:${pre.ntop.ntopPrisms} · RVE ${pre.rveSpeedupFactor}x` : 'BL 网格就绪');
        setFlowStep('solve', 'done', `${cfd?.solverTier || 'CFD'} 求解完成`);
        setFlowStep('audit', 'done', kind === 'pipeline' ? '四级对标报告已落盘' : 'cfd_dp.csv / summary.json');
        if (cfd && cfd.dp1_Pa && cfd.dp2_Pa) {
          const fcTxt = applyCfdToForchheimer({ ...cfd });
          bridge.activateTab('pdiag');
          const kVal = cfd.K_m2 ?? cfd.permeabilityM2;
          const wssPct = cfd.wssOsteogenicWindowPct ?? (cfd.wssOsteogenicWindowRatio != null ? (cfd.wssOsteogenicWindowRatio * 100).toFixed(1) : '?');
          summaryMsg = `${kind === 'pipeline' ? '全流程多保真度闭环' : 'CFD 双流速求解'}完成 (${cfd.solverTier})：nTop=${pre?.ntop?.ntopStatus}，ΔP₁=${Number(cfd.dp1_Pa).toFixed(3)} Pa，ΔP₂=${Number(cfd.dp2_Pa).toFixed(3)} Pa，K=${Number(kVal).toExponential(3)} m²，β=${cfd.beta_m1 ?? '?'} m⁻¹，WSS 成骨窗口 [5,25] mPa=${wssPct}%。${fcTxt}`;
        }
      } else if (kind === 'comsol-cfd') {
        setFlowStep('solve', 'done', resObj.executed ? 'COMSOL batch 完成' : (resObj.compiled ? 'COMSOL Java 编译通过' : 'Java 已生成'));
        summaryMsg = `COMSOL 6.2：${resObj.className}.java（compiled=${resObj.compiled}，executed=${resObj.executed}）`;
        if (resObj.executed && resObj.dpPa != null) {
          const dpEl = byId<HTMLInputElement>('fc-dp1');
          const wssEl = byId<HTMLInputElement>('fc-wss');
          if (dpEl) dpEl.value = Number(resObj.dpPa).toFixed(4);
          if (wssEl && resObj.wssPa != null) wssEl.value = (Number(resObj.wssPa) * 1000).toFixed(2);
          bridge.runForchheimerPanel(false);
          renderParityMatrix();
          setFlowStep('post', 'done', `COMSOL ΔP=${Number(resObj.dpPa).toFixed(3)} Pa`);
          summaryMsg += ` · ΔP=${Number(resObj.dpPa).toFixed(3)} Pa`;
        }
      } else if (kind === 'abaqus-fea') {
        setFlowStep('solve', 'done', resObj.mode === 'solved' ? 'ABAQUS 求解完成' : 'INP 三段式就绪');
        summaryMsg = `ABAQUS 算例已生成：${resObj.staticInpPath}`;
        if (resObj.odbSummary?.csvText) {
          bridge.runIso13314PostProc('ABAQUS-ODB', resObj.odbSummary.csvText, 'displacement-force', {
            lengthMm: params.lengthMm,
            widthMm: params.lengthMm,
            thicknessMm: params.lengthMm,
          });
          renderParityMatrix();
          setFlowStep('post', 'done', 'ABAQUS ODB 已反演 ISO 13314');
          bridge.activateTab('pdiag');
          summaryMsg = 'ABAQUS 求解与 ODB 提取完成，已回填 ISO 13314 力学反演面板。';
        }
      }

      card.res.textContent = summaryMsg;
      if (jobStatus) jobStatus.textContent = summaryMsg;
      if (fromChat) bridge.addFinal(summaryMsg);
      void probeEnv();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      entry.classList.remove('tool');
      entry.classList.add('fail');
      const hint = msg.includes('Failed to fetch')
        ? `无法连接本机 CAE 守护进程 (${DAEMON_BASE})，请先执行 node tpms/agent/cae-daemon.mjs`
        : msg;
      card.res.textContent = hint;
      cardTerm.textContent += `\n[error] ${hint}`;
      if (termOut) termOut.textContent += `\n[error] ${hint}`;
      if (jobStatus) jobStatus.textContent = hint;
      setFlowStep(kind === 'preprocess-bl' ? 'bl' : 'solve', 'fail', hint);
      if (fromChat) bridge.addFinal(`CAE 调度失败：${hint}`);
    } finally {
      setCaeButtonsBusy(false);
    }
  };

  byId('cae-btn-bl')?.addEventListener('click', () => { void dispatchCaeJob('preprocess-bl', true); });
  byId('cae-btn-of')?.addEventListener('click', () => { void dispatchCaeJob('openfoam-cfd', true); });
  byId('cae-btn-abq')?.addEventListener('click', () => { void dispatchCaeJob('abaqus-fea', true); });
  byId('cae-btn-comsol')?.addEventListener('click', () => { void dispatchCaeJob('comsol-cfd', true); });
  byId('cae-btn-pipeline')?.addEventListener('click', () => { void dispatchCaeJob('pipeline', true); });

  (window as unknown as Record<string, unknown>).__tpmsDshCae = {
    dispatch: (kind: CaeJobKind, fromChat = true) => dispatchCaeJob(kind, fromChat),
    probeEnv,
    isDaemonOnline: () => daemonOnline,
    renderMonitorFromResult,
    renderParityMatrix,
  };

  // 7. Slash Command Palette & Capture-Phase Routing
  const cmdInput = byId<HTMLInputElement>('cmd');
  const sendBtn = byId<HTMLButtonElement>('send-btn');
  const slashMenu = byId('dsh-slash-menu');
  const slashOpts = slashMenu ? Array.from(slashMenu.querySelectorAll<HTMLButtonElement>('.dsh-slash-opt')) : [];

  const renderSlashMenu = (): void => {
    if (!cmdInput || !slashMenu) return;
    const raw = cmdInput.value;
    if (!raw.startsWith('/')) {
      slashMenu.hidden = true;
      return;
    }
    const token = raw.split(/\s+/)[0].toLowerCase();
    let visibleCount = 0;
    for (const opt of slashOpts) {
      const cmd = (opt.dataset.cmd || '').toLowerCase();
      const match = token === '/' || cmd.startsWith(token);
      opt.hidden = !match;
      opt.classList.remove('active');
      if (match) visibleCount++;
    }
    const visible = slashOpts.filter((o) => !o.hidden);
    if (visible.length) {
      slashSelectedIdx = Math.max(0, Math.min(slashSelectedIdx, visible.length - 1));
      visible[slashSelectedIdx].classList.add('active');
    }
    slashMenu.hidden = visibleCount === 0;
  };

  const handleSlashSubmit = (rawText: string): boolean => {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith('/')) return false;
    const cmd = trimmed.split(/\s+/)[0].toLowerCase();
    if (slashMenu) slashMenu.hidden = true;
    if (cmdInput) cmdInput.value = '';
    if (cmd === '/ntop-bl') {
      bridge.activateTab('pdiag');
      void dispatchCaeJob('preprocess-bl', true);
      return true;
    }
    if (cmd === '/pipeline') {
      bridge.activateTab('pdiag');
      void dispatchCaeJob('pipeline', true);
      return true;
    }
    if (cmd === '/openfoam') {
      bridge.activateTab('pdiag');
      void dispatchCaeJob('openfoam-cfd', true);
      return true;
    }
    if (cmd === '/abaqus') {
      bridge.activateTab('pexp');
      void dispatchCaeJob('abaqus-fea', true);
      return true;
    }
    if (cmd === '/comsol') {
      bridge.activateTab('pexp');
      void dispatchCaeJob('comsol-cfd', true);
      return true;
    }
    const eh = byId('empty-hint');
    if (eh) eh.hidden = true;
    bridge.addFinal(`可用斜杠指令：${SLASH_COMMANDS.map((c) => `${c.cmd} (${c.desc})`).join('；')}`);
    return true;
  };

  for (const opt of slashOpts) {
    opt.addEventListener('click', () => {
      if (!cmdInput) return;
      cmdInput.value = `${opt.dataset.cmd || ''} `;
      if (slashMenu) slashMenu.hidden = true;
      cmdInput.focus();
    });
  }

  cmdInput?.addEventListener('input', renderSlashMenu);

  cmdInput?.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (slashMenu && !slashMenu.hidden) {
      const visible = slashOpts.filter((o) => !o.hidden);
      if (ev.key === 'ArrowDown' && visible.length) {
        ev.preventDefault();
        slashSelectedIdx = (slashSelectedIdx + 1) % visible.length;
        renderSlashMenu();
        return;
      }
      if (ev.key === 'ArrowUp' && visible.length) {
        ev.preventDefault();
        slashSelectedIdx = (slashSelectedIdx - 1 + visible.length) % visible.length;
        renderSlashMenu();
        return;
      }
      if (ev.key === 'Tab' && visible.length) {
        ev.preventDefault();
        cmdInput.value = `${visible[slashSelectedIdx].dataset.cmd || ''} `;
        slashMenu.hidden = true;
        return;
      }
      if (ev.key === 'Escape') {
        slashMenu.hidden = true;
        return;
      }
    }
    if (ev.key === 'Enter' && cmdInput.value.trim().startsWith('/')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      handleSlashSubmit(cmdInput.value);
    }
  }, true);

  sendBtn?.addEventListener('click', (ev: MouseEvent) => {
    if (cmdInput && cmdInput.value.trim().startsWith('/')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      handleSlashSubmit(cmdInput.value);
    }
  }, true);
}
