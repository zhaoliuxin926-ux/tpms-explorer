/**
 * TPMS Platform — 主应用入口
 * 工业级、科研可复现的 TPMS 参数化设计与分析平台。
 */

import * as THREE from 'three';
import { MeshPhysicalMaterial } from 'three';
import { initThree, type ThreeContext } from './three-setup';
import { getState, setState, applyPreset, buildShareURL, pushHistory, undo, redo } from './state';
import { initStateFromURL } from './url-params';
import { WorkerBridge } from './worker/worker-bridge';
import TpmsWorker from './worker/tpms-worker.ts?worker';
import type { WorkerResponse, AppState, BuildParams, MaterialPreset } from './types';
import type { ColoringMode, SliceAxis } from './types';
import { computePhysicsMetrics, estimateAnisotropicStiffness, BASE_MODULUS, BASE_YIELD_STRENGTH } from './physics/gibson-ashby';
import { analyzeTortuosity3D } from './physics/tortuosity';
import { buildSurface } from './geometry/surface-nets';
import { computeVertexColors } from './geometry/vertex-coloring';
import { evaluateFieldGPU, probeGpuAvailability, type GpuFieldConfig } from './geometry/webgpu-evaluator';
import { analyzeSection, analyzeIslands3D } from './physics/percolation-analysis';
import { EQUATION_PRESETS, validateEquation } from './core/equation-parser';
import { mapGeometry } from './core/manifold-mapping';
import { sampleDirectionalGrid, directionalModulus, orthotropicCompliance } from './physics/homogenization';
import type { PhysicsMetrics } from './types';
import {
  exportBinarySTL,
  exportMultiSolidSTL,
  exportGLB,
  export3MF,
  exportVTK,
  exportVTI,
  exportPythonScript,
  exportMatlabScript,
  generateBibTeX,
  generateJSONSidecar,
} from './export';
import { evaluateField, getCompiledCustomFormula, getTpmsFunction } from './core/tpms-functions';
import { analyzeHierarchical } from './core/hierarchical-functions';
import { computeCrush, computeModal } from './physics/impact-energy';
import { generateDemoCT, sampleDeviation, deviationColors } from './geometry/ct-reconstruction';
import { solveInverse, INVERSE_PRESETS, type InverseReport, type DesignTargets } from './physics/inverse-design';
import { buildVoxelModel, exportAbaqusInp, exportOpenfoamPolyMesh, exportVerificationSuite } from './export';
import { downloadBlob } from './export/download';
import { DISPLAY_SCALE, wcToMmFactor, hdResolution, l2Resolution } from './core/units';
import { runCompressionDigitalTwin } from './physics/digital-twin-compression';
import { simulateLPBF } from './physics/lpbf-thermo-mechanical';
import { parseNL, type NLIntent } from './core/nl-agent';
import {
  deriveScaffoldYieldConfigs,
  buildEnvelopeMesh,
  safetyFactor,
  criticalMode,
  YIELD_CRITERIA_LABEL,
  type YieldCriterionKind,
} from './physics/yield-surface';
import { createYieldViewer, type YieldViewer } from './viewers/yield-viewer';
import { solvePhononicBands, type PhononicResult } from './physics/phononic-bandgap';
import { isSolidAt, type SectionAnalysisParams } from './physics/percolation-analysis';
import { simulateTissueGrowth, type TissueResult } from './physics/tissue-growth';
import {
  expertName,
  expertCount,
  mixtureWeights,
  nearestExpertIndex,
  neuralAnchor,
  sanitizeLatent,
} from './core/neural-implicit-field';
import { DEFAULT_STATE } from './types';
import { mapElementFieldToVertexColors } from './physics/gpu-plasticity-webgpu';
import { sampleCoolWarmInto } from './geometry/vertex-coloring';
import { BoundingBoxAnnotation } from './measure/bounding-box-annotation';
import { CaliperTool } from './measure/caliper';
import { exportSliceSVG } from './measure/svg-slice-exporter';
import {
  updateFormulaDisplay,
  updateTips,
  updateBadges,
  updateStructureDesc,
  showPresetCard,
  initPresetCard,
  initGlossary,
  initOnboard,
  refreshWeightUI,
  MATERIAL_LABEL,
  initTipToggle,
} from './ui-helpers';

// ── 全局变量 ─────────────────────────────────────────────
let ctx: ThreeContext;
let bridge: WorkerBridge;
let baseGeo: THREE.BufferGeometry | null = null;
let meshFill: THREE.Mesh | null = null;
let meshStrut: THREE.LineSegments | null = null;
let lastPorosityEstimate = 0;
let lastMeshSolidFraction: number | null = null;
let nmWarned = false;   // 采样定理警示防刷屏：占比回落后才允许再次提示
let lastPhysicsMetrics: PhysicsMetrics | null = null;
let lastIsoUsed = 0;
// 当前 baseGeo 的构建分辨率（导出前用于判断是否需要同步升级到高清）
let lastBuildResolution = 0;
let animId: number;
let bboxAnnotation: BoundingBoxAnnotation | null = null;
let caliperTool: CaliperTool | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let isFirstBuild = true;

// 材质缓存
const materialCache = new Map<string, MeshPhysicalMaterial>();

/** Geometry 结果 LRU 缓存：参数回退时瞬间恢复 */
const geoCache = new Map<string, { positions: Float32Array; normals: Float32Array; indices: Uint32Array; vertCount: number; faceCount: number; }>();
const MAX_GEO_CACHE = 12;

function cacheKey(s: Readonly<AppState>, R: number): string {
  return `${s.type}|${s.model}|${s.cellSize}|${R}|${s.porosity}|${s.structureMode}|${s.containerShape}|${s.thickness}|${s.gradientDir}|${s.hybrid.enabled ? `H${s.hybrid.typeB}@${s.hybrid.axis}c${s.hybrid.blendCenter}w${s.hybrid.blendWidth}f${s.hybrid.blendFunction}` : ''}|${s.customFormula}|${s.weights.join(',')}|EP${s.endplateMm}|M${s.manifold.kind}|${s.stress.preset !== 'none' ? `SD${s.stress.preset}s${s.stress.strength}a${s.stress.anisotropy}` : ''}|${s.hierarchical.enabled ? `HR${s.hierarchical.microType}n${s.hierarchical.frequency}l${s.hierarchical.amplitude}` : ''}|${s.neural.enabled ? `NR${s.neural.z.map((v) => v.toFixed(2)).join(',')}` : ''}`;
}

// ── 多级分形统计（v3.0 阶段 V）：双重比表面积 + 微孔连通率 ──
let hierStatsTimer: ReturnType<typeof setTimeout> | null = null;

// ── 神经拓扑状态行（v7.0 Stage I）：最近锚点 + 混合熵 ──
function updateNeuralStatus(): void {
  const el = document.getElementById('neural-status');
  if (!el) return;
  const s = getState();
  if (!s.neural.enabled) { el.textContent = ''; return; }
  try {
    const z = sanitizeLatent(s.neural.z);
    const mix = mixtureWeights(z);
    const near = nearestExpertIndex(z);
    const entropy = -mix.reduce((a, p) => a + (p > 1e-9 ? p * Math.log(p) : 0), 0);
    const atAnchor = mix[near] > 0.999;
    el.textContent = atAnchor
      ? `锚点态：${expertName(near)}（单专家快路径 · 熵 0.00）`
      : `流形插值：近 ${expertName(near)} · 混合熵 ${entropy.toFixed(2)} / ${Math.log(expertCount()).toFixed(2)}`;
  } catch {
    el.textContent = '潜在码非法（已钳制）';
  }
}
function scheduleHierarchicalStats(): void {
  if (hierStatsTimer) clearTimeout(hierStatsTimer);
  hierStatsTimer = setTimeout(() => {
    const s = getState();
    if (!s.hierarchical.enabled) return;
    try {
      const st = analyzeHierarchical({
        type: s.type, microType: s.hierarchical.microType,
        frequency: s.hierarchical.frequency, amplitude: s.hierarchical.amplitude,
        weights: s.weights, periods: s.cellSize, iso: baseIso(s), customFormula: s.customFormula,
      }, 48);
      const el = document.getElementById('hier-stats');
      if (el) {
        el.textContent = `S 总 ${(st.ssaTotal).toFixed(2)} · S 宏观 ${(st.ssaMacro).toFixed(2)} · 微孔附加 ${(st.ssaMicroAdded).toFixed(2)} · 微孔连通率 ${(st.microConnectivity * 100).toFixed(1)}%`;
      }
    } catch { /* 公式病态时静默（卡片保留旧值） */ }
  }, 400);
}

// ── WebGPU 场计算加速（v3.0 阶段 I）────────────────────────
// GPU 只接管 Surface Nets 第 2 步的 V 场填充（三角函数热循环），
// 网格化/平滑/法线仍走既有 Worker 管道；任何失败无感回退 CPU。
// seq + cacheKey 双守卫：等待 GPU 期间状态变化 ⇒ 本次作废，防旧参数覆写新状态。
let gpuUsable: boolean | null = null;   // null = 尚未探测
let gpuSeq = 0;

function gpuConfigOf(params: BuildParams): GpuFieldConfig {
  return {
    type: params.type,
    weights: params.weights,
    periods: params.periods,
    thickness: params.thickness,
    iso: params.iso,
    customFormula: params.customFormula,
    hybrid: { ...params.hybrid, axis: params.hybrid.axis ?? 'x' },
  };
}

function setGpuStatusText(text: string): void {
  const el = document.getElementById('gpu-status');
  if (el) el.textContent = text;
}

/** 完整重建派发（rebuild 非 preview 路径与 HD 升级共用）：GPU 可用则预计算场后入队 */
function dispatchFullBuild(params: BuildParams, stateKey: string): void {
  const s = getState();
  // 神经场走 SIREN 前向（WebGPU 指令 IR 不感知）——enabled 时强制 CPU 管线
  if (!s.gpuAccelerate || gpuUsable === false || params.resolution < 48 || params.neural?.enabled) {
    bridge.build(params);
    return;
  }
  const seq = ++gpuSeq;
  void (async () => {
    const res = await evaluateFieldGPU(gpuConfigOf(params), params.resolution);
    if (seq !== gpuSeq || cacheKey(getState(), params.resolution) !== stateKey) return;
    if (!res) {
      gpuUsable = false;
      setGpuStatusText('WebGPU 不可用 · CPU 管线回退');
      bridge.build(params);
      return;
    }
    gpuUsable = true;
    setGpuStatusText(`WebGPU V 场 ${res.gpuMs.toFixed(1)} ms · ${params.resolution}³`);
    bridge.build({ ...params, gpuVField: res.v });
  })();
}

// 启动时探测一次可用性（仅状态条展示；真实判定仍以首次 evaluateFieldGPU 结果为准）
void probeGpuAvailability().then((ok) => {
  gpuUsable = ok;
  setGpuStatusText(ok ? 'WebGPU 可用 · 完整重建自动启用' : 'WebGPU 不可用 · CPU 管线');
});

// ── 主题切换（明 / 暗 / 系统）─────────────────────────────
const THEME_KEY = 'tpms-theme-platform';
type ThemePref = 'light' | 'dark' | 'system';

function applyTheme(pref: ThemePref): void {
  const resolved: 'light' | 'dark' =
    pref === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
  document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((btn) => {
    const active = btn.dataset.themeSet === pref;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initTheme(): void {
  let saved: ThemePref = 'system';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') saved = v;
  } catch { /* ignore */ }
  applyTheme(saved);
  document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.themeSet as ThemePref;
      applyTheme(pref);
    });
  });
  // 用户选择“跟随系统”时，实时响应系统偏好变化
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    let pref: ThemePref = 'system';
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') pref = v;
    } catch { /* ignore */ }
    if (pref === 'system') applyTheme('system');
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof (mq as unknown as { addListener?: (cb: () => void) => void }).addListener === 'function') {
    (mq as unknown as { addListener: (cb: () => void) => void }).addListener(onChange);
  }
}

// ── 初始化 ─────────────────────────────────────────────
window.addEventListener('load', () => {
  // 1) URL 参数恢复（必须在 initThree 之前，避免双重建）
  const urlState = initStateFromURL();
  if (Object.keys(urlState).length > 0) {
    setState(urlState);
  }

  // 2) Three.js 场景
  const container = document.getElementById('canvas-container')!;
  ctx = initThree(container);

  // 3) Worker 通信桥
  bridge = new WorkerBridge(new TpmsWorker());
  bridge.setCallbacks(onWorkerResult, onWorkerError);

  // 4) UI 事件绑定
  bindUIEvents();

  // 5) 初始化纯 UI 层
  initGlossary();
  initOnboard();
  initPresetCard();
  initTipToggle();
  initTheme();

  // 6) 同步 UI 状态与文本
  const s = getState();
  // URL 参数（如 ?autoRotate=0）恢复的旋转开关需同步到 controls
  //（initThree 默认开启 autoRotate，不同步则 state 关了模型仍在转）
  ctx.controls.autoRotate = s.autoRotate;
  syncUI(s);
  updateBadges(s.type, s.model, s.material, s.structureMode);
  updateStructureDesc(s.structureMode);
  updateFormulaDisplay(s.type, s.weights, 0);
  updateTips(s.type, s.porosity, s.thickness, null);

  // 7) 初始重建
  rebuild(false);

  // 8) 启动按需渲染：任意相机变化（拖拽/缩放/自动旋转）触发重绘
  ctx.controls.addEventListener('change', requestRender);
  requestRender();
});

// ── 按需渲染（P2-3，对齐单文件版方案）──────────────────────
// 空闲（无自动旋转、阻尼已静止、无交互）时彻底停止 RAF，省 GPU；
// controls.update() 返回 true（阻尼/自动旋转仍在推进）则自动续帧。
let rafScheduled = false;
function requestRender(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  animId = requestAnimationFrame(renderFrame);
}
function renderFrame(): void {
  rafScheduled = false;
  const moving = ctx.controls.update();
  ctx.composer.render();
  if (moving) requestRender();
}

// 页面卸载时取消动画帧，避免内存泄漏
window.addEventListener('beforeunload', () => cancelAnimationFrame(animId));

// ── 动态冲击/模态统计（v4.0 阶段 IV）──────────────────────
function updateImpactStats(): void {
  const s = getState();
  const el = {
    sea: document.getElementById('stat-sea'),
    epsd: document.getElementById('stat-epsd'),
    f1: document.getElementById('stat-f1'),
  };
  try {
    const sigmaYs = BASE_YIELD_STRENGTH[s.material] ?? BASE_YIELD_STRENGTH.tc4;
    const rho = 1 - s.porosity / 100;
    const cr = computeCrush(rho, s.type, sigmaYs);
    const md = computeModal(rho, s.type, s.cellSize);
    if (el.sea) el.sea.textContent = `${cr.seaJPerG.toFixed(1)} J/g`;
    if (el.epsd) el.epsd.textContent = `${(cr.epsilonD * 100).toFixed(0)}%`;
    if (el.f1) el.f1.textContent = `${md.f1.toFixed(0)} Hz`;
  } catch {
    if (el.sea) el.sea.textContent = '—';
  }
}

// ── WebGPU 弹塑性压溃仿真（v6.0 阶段 I）──────────────────────
// 体素化当前 TPMS（与 surface-nets 同约定：场排序二分到目标固相率），
// 位移加载压至 4%，von Mises 逐帧映射顶点色（Cool-Warm 同源 LUT）。
let plasRunning = false;

function voxelizeCurrentTPMS(R: number): Uint8Array {
  const st = getState();
  const fn = getTpmsFunction(st.type, st.customFormula);
  const kk = st.cellSize;
  const V = new Float64Array(R * R * R);
  for (let iz = 0; iz < R; iz++) {
    const wz = kk * (-Math.PI + (2 * Math.PI * (iz + 0.5)) / R);
    for (let iy = 0; iy < R; iy++) {
      const wy = kk * (-Math.PI + (2 * Math.PI * (iy + 0.5)) / R);
      for (let ix = 0; ix < R; ix++) {
        const wx = kk * (-Math.PI + (2 * Math.PI * (ix + 0.5)) / R);
        V[ix + iy * R + iz * R * R] = fn(wx, wy, wz, st.weights);
      }
    }
  }
  const sorted = Float64Array.from(V).sort();
  const targetSolid = Math.max(0.02, Math.min(0.98, 1 - st.porosity / 100));
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(targetSolid * sorted.length)));
  const iso = sorted[idx];
  // 容器裁剪（与 surface-nets boundAt 同域：cylinder px²+py²<1 且 |pz|<1）
  // 端板融合（mm→wc 域换算，镜像 surface-nets 端板语义）——曾缺失导致圆柱/端板模型被按立方无端板模拟
  const epWc = st.endplateMm > 0 ? st.endplateMm / wcToMmFactor(st.cellSize) : 0;
  const solid = new Uint8Array(R * R * R);
  for (let iz = 0; iz < R; iz++) {
    const pz = -1 + (2 * (iz + 0.5)) / R;
    for (let iy = 0; iy < R; iy++) {
      const py = -1 + (2 * (iy + 0.5)) / R;
      for (let ix = 0; ix < R; ix++) {
        const px = -1 + (2 * (ix + 0.5)) / R;
        const i = ix + iy * R + iz * R * R;
        const inside = st.containerShape === 'cylinder'
          ? (px * px + py * py < 1 && Math.abs(pz) < 1)
          : (Math.abs(px) < 1 && Math.abs(py) < 1 && Math.abs(pz) < 1);
        const ep = epWc > 0 && (pz >= 1 - epWc || pz <= -1 + epWc);
        solid[i] = inside && (V[i] < iso || ep) ? 1 : 0;
      }
    }
  }
  return solid;
}

function drawPlasticityCurve(res: ReturnType<typeof runCompressionDigitalTwin>): void {
  const cv = document.getElementById('plas-curve') as HTMLCanvasElement | null;
  if (!cv) return;
  cv.style.display = 'block';
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(148,163,184,0.4)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  const fMax = Math.max(...res.curve.map((c) => c.reaction)) || 1;
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  res.curve.forEach((c, i) => {
    const px = 14 + ((W - 28) * c.strain) / (res.curve[res.curve.length - 1].strain || 1);
    const py = H - 12 - ((H - 26) * c.reaction) / fMax;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.fillStyle = 'rgba(100,116,139,0.9)';
  ctx.font = '10px sans-serif';
  ctx.fillText('工程应变 ε →', W - 76, H - 3);
  ctx.save();
  ctx.translate(9, 58);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('反力 F（压缩）', 0, 0);
  ctx.restore();
}

function runPlasticityDemo(): boolean {
  if (plasRunning) return false;
  const btn = document.getElementById('btn-plasticity');
  const out = document.getElementById('plas-result');
  plasRunning = true;
  if (btn) (btn as HTMLButtonElement).disabled = true;
  const st0 = getState();
  if (st0.structureMode !== 'solid_network') {
    // 诚实守卫：壳类模式的固相定义是 |V−bias|<t/2（双壁），体素化口径仅支持 solid_network——
    // 曾静默按错误几何求解（2026-08-29 对抗审查定案）
    flashToast('弹塑性压溃目前仅支持实体网络模式（当前为 ' + st0.structureMode + '），已跳过');
    return false;
  }
  if (out) { out.style.display = 'block'; out.textContent = '体素化 + 组装中…（R=6 · 8 载荷步 · 主线程同步求解约 1–2 分钟，期间视图无响应）'; }
  flashToast('弹塑性压溃：主线程同步求解约 1–2 分钟（R=6·8 步），期间视图暂不响应');
  // 让 toast 先绘制
  setTimeout(() => {
    try {
      const st0 = getState();
      const R = 6;
      const solid = voxelizeCurrentTPMS(R);
      const mat = st0.material === 'auto' ? 'tc4' : st0.material;
      const syRel = (BASE_YIELD_STRENGTH[mat] ?? 880) / (BASE_MODULUS[mat] ?? 110);
      const t0 = performance.now();
      const res = runCompressionDigitalTwin({
        R, solid, porosity: st0.porosity / 100, sigmaYRatio: syRel, failureStrain: 0.02,
        hardening: 0.05, steps: 8, maxStrain: 0.04, tol: 1e-5,
      });
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      const last = { maxPEEQ: res.peeq.length ? res.peeq.reduce((a, b) => Math.max(a, b), 0) : 0 };
      // ── 视口动画：von Mises → Cool-Warm 顶点色 ──
      const geo = baseGeo;
      const pos = geo?.getAttribute('position')?.array as Float32Array | undefined;
      const colorAttr = geo?.getAttribute('color') as THREE.BufferAttribute | undefined;
      const origColors = colorAttr ? (colorAttr.array as Float32Array).slice() : null;
      if (geo && pos) {
        let vmMaxAll = 0;
        for (let i = 0; i < res.vonMises.length; i++) vmMaxAll = Math.max(vmMaxAll, res.vonMises[i]);
        // 无 color 属性时补一个（着色管线会在下次重建时自然接管）
        if (!geo.getAttribute('color')) {
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
        }
        const colors = mapElementFieldToVertexColors(pos, R, res.vonMises, 0, vmMaxAll || 1, sampleCoolWarmInto);
        (geo.getAttribute('color').array as Float32Array).set(colors);
        geo.getAttribute('color').needsUpdate = true;
        requestRender();
        // 4s 后恢复原着色（期间任意参数变更触发的重建会自然覆盖）
        setTimeout(() => {
          if (origColors && colorAttr && geo.getAttribute('color')) {
            (colorAttr.array as Float32Array).set(origColors);
            colorAttr.needsUpdate = true;
            requestRender();
          }
        }, 4000);
      }
      drawPlasticityCurve(res);
      if (out) {
        out.textContent = `数字孪生压溃 R=${R} · ${res.allConverged ? '全步收敛 ✓' : `⚠ ${res.collapsed ? `坍塌 @ε=${res.collapseStrain?.toFixed(3)}` : '未收敛步'}`} · ${dt}s · `
          + `σ_pl/E=${Number.isFinite(res.plateauStress) ? res.plateauStress.toExponential(2) : '—'} · GA 预测比 ${res.gaPrediction.toFixed(3)}（DT/GA=${Number.isFinite(res.calibrationRatio) ? res.calibrationRatio.toFixed(2) : '—'}）`
          + ` · 断裂死亡 ${res.totalDead} 单元 · PEEQ ${last.maxPEEQ.toExponential(2)}（材料 ${mat}：σy/E=${syRel.toFixed(4)}）`;
      }
    } catch (err) {
      if (out) out.textContent = `求解失败：${err instanceof Error ? err.message : String(err)}`;
      flashToast(`弹塑性压溃失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      plasRunning = false;
      if (btn) (btn as HTMLButtonElement).disabled = false;
    }
  }, 40);
  return true;
}

document.getElementById('btn-plasticity')?.addEventListener('click', runPlasticityDemo);

// ── LPBF 工艺模拟（v6.0 阶段 IV）──────────────────────
// ── AI 设计助手（v6.0 阶段 V）──────────────────────
let nlPendingExport: 'stl' | '3mf' | null = null;

function nlAppend(text: string): void {
  const log = document.getElementById('nl-log');
  if (log) { log.textContent += (log.textContent ? '\n' : '') + text; log.scrollTop = log.scrollHeight; }
}

function nlDoExport(fmt: 'stl' | '3mf'): void {
  const sNow = getState();
  const base = `tpms-${sNow.type}-p${sNow.porosity}`;
  if (!baseGeo) throw new Error('几何尚未就绪');
  const pos = baseGeo.attributes.position.array as Float32Array;
  const idx = baseGeo.index!.array as Uint32Array;
  const scale = wcToMmFactor(sNow.cellSize);
  if (fmt === 'stl') exportBinarySTL(pos, idx, `${base}.stl`, scale);
  else export3MF(pos, idx, `${base}.3mf`, scale, { configName: base, porosity: sNow.porosity, endplateMm: sNow.endplateMm, structureMode: sNow.structureMode });
  nlAppend(`助手：已导出 ${base}.${fmt} ✓`);
}

/** 重建完成后若挂起 NL 导出则执行（缓存路径与 worker 路径都会调用） */
function runPendingNLExport(): void {
  if (!nlPendingExport) return;
  const fmt = nlPendingExport;
  nlPendingExport = null;
  try { nlDoExport(fmt); } catch (err) { nlAppend(`助手：导出失败——${err instanceof Error ? err.message : String(err)}`); }
}

function applyNLIntent(intent: NLIntent): void {
  nlAppend('你：' + (document.getElementById('nl-input') as HTMLInputElement).value);
  if (intent.kind === 'help' || intent.kind === 'unknown') { nlAppend('助手：' + intent.reply); return; }
  const p = intent.patches;
  const patches: Partial<AppState> = {};
  if (p.type) patches.type = p.type as AppState['type'];
  if (p.porosity !== undefined) patches.porosity = p.porosity;
  if (p.cellSize !== undefined) patches.cellSize = p.cellSize;
  if (p.thickness !== undefined) patches.thickness = p.thickness;
  if (p.material) patches.material = p.material as AppState['material'];
  if (p.structureMode) patches.structureMode = p.structureMode as AppState['structureMode'];
  if (p.endplateMm !== undefined) patches.endplateMm = p.endplateMm;
  if (p.containerShape) patches.containerShape = p.containerShape as AppState['containerShape'];
  // 骨支架预设只补缺省项，不覆盖用户显式指定的参数（曾强制 tc4 覆盖显式 polymer，2026-08-29 定案）
  const bonePreset = intent.actions.includes('preset-bone');
  if (bonePreset) {
    if (patches.material === undefined) patches.material = 'tc4';
    if (patches.structureMode === undefined) patches.structureMode = 'solid_network';
  }
  const stateChanged = intent.actions.includes('reset') || Object.keys(patches).length > 0;
  if (intent.actions.includes('reset')) {
    setState({ ...DEFAULT_STATE });
    scheduleRebuild(false);
    nlAppend('助手：已恢复默认参数 ✓');
  } else if (Object.keys(patches).length > 0) {
    setState(patches);
    scheduleRebuild(false);   // 关键：NL 改参必须触发重建（曾缺失 → 视图不更新、导出旧几何）
    nlAppend(`助手：已应用 ${intent.reply}（置信度 ${Math.round(intent.confidence * 100)}%）`);
  } else {
    nlAppend('助手：' + intent.reply);
  }
  for (const a of intent.actions) {
    if (a === 'export-stl' || a === 'export-3mf') {
      if (stateChanged) {
        // 参数变了 → 几何是旧的（worker 异步重建），挂起到重建完成自动导出
        nlPendingExport = a === 'export-stl' ? 'stl' : '3mf';
        nlAppend('助手：参数已应用，几何重建完成后自动导出 ' + (a === 'export-stl' ? 'STL' : '3MF') + '…');
      } else {
        try { nlDoExport(a === 'export-stl' ? 'stl' : '3mf'); }
        catch (err) { nlAppend(`助手：导出失败——${err instanceof Error ? err.message : String(err)}`); }
      }
    } else if (a === 'run-simulation') {
      const started = runPlasticityDemo();
      nlAppend(started
        ? '助手：已触发数字孪生压溃仿真（主线程求解约 1–2 分钟，期间界面无响应）'
        : '助手：仿真未启动（需实体网络模式，或已有仿真在运行）');
    } else if (bonePreset && a === 'preset-bone') {
      nlAppend('助手：已套用骨支架口径（Ti-6Al-4V · 实体网络，仅补缺省项）');
    }
  }
}

function wireNLChat(): void {
  const fab = document.getElementById('nl-fab');
  const panel = document.getElementById('nl-panel');
  const input = document.getElementById('nl-input') as HTMLInputElement | null;
  const send = () => {
    if (!input || !input.value.trim()) return;
    const intent = parseNL(input.value);
    applyNLIntent(intent);
    input.value = '';
  };
  fab?.addEventListener('click', () => { if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none'; });
  document.getElementById('nl-send')?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  document.querySelectorAll('.nl-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (input) input.value = (chip as HTMLElement).dataset.q ?? '';
      send();
    });
  });
}
wireNLChat();

document.getElementById('btn-lpbf')?.addEventListener('click', () => {
  const out = document.getElementById('lpbf-result');
  const power = Number((document.getElementById('lpbf-power') as HTMLInputElement)?.value ?? 200);
  const speed = Number((document.getElementById('lpbf-speed') as HTMLInputElement)?.value ?? 0.8);
  try {
    const res = simulateLPBF({ N: 32, dx: 25e-6, power, speed, totalTime: 1.2e-3 });
    if (out) {
      out.style.display = 'block';
      out.textContent = `窗口：${res.window} · 峰值 ${res.peakTemperature.toFixed(0)}K（熔池 ${res.meltPoolVoxels} 体素）· `
        + `R=${res.coolingRate.toExponential(1)}K/s · G×R=${res.gR.toExponential(1)}K²/s · `
        + `σ_res=${(res.residualStress / 1e6).toFixed(0)}MPa · 翘曲 ${(res.distortion * 1e6).toFixed(2)}µm · `
        + `能量平衡 ${(res.energyBalance * 100).toFixed(3)}%`;
    }
  } catch (err) {
    if (out) out.textContent = `模拟失败：${err instanceof Error ? err.message : String(err)}`;
  }
});

// ── 【v7.0 Stage II】多轴屈服包络面：参数推导 + 3D 预览 + 安全系数 ──
let yieldViewer: YieldViewer | null = null;
document.getElementById('btn-yield')?.addEventListener('click', () => {
  const out = document.getElementById('yield-result');
  const canvas = document.getElementById('yield-canvas') as HTMLCanvasElement | null;
  try {
    const s = getState();
    const rho = lastMeshSolidFraction ?? (1 - s.porosity / 100);
    const matKey = s.material === 'auto' ? 'tc4' : s.material;
    const d = deriveScaffoldYieldConfigs(rho, s.type, s.porosity / 100, matKey);
    const kind = (document.getElementById('yield-criterion') as HTMLSelectElement).value as YieldCriterionKind;
    const cfg = kind === 'hill48' ? d.hill : kind === 'tsaiwu' ? d.tsaiwu : kind === 'gurson' ? d.gurson : d.dp;
    const sigma0: [number, number, number] = [
      Number((document.getElementById('yield-s1') as HTMLInputElement).value) || 0,
      Number((document.getElementById('yield-s2') as HTMLInputElement).value) || 0,
      Number((document.getElementById('yield-s3') as HTMLInputElement).value) || 0,
    ];
    const mesh = buildEnvelopeMesh(kind, cfg);
    const sfRes = safetyFactor(kind, cfg, sigma0);
    const crit = criticalMode([
      { kind: 'hill48', config: d.hill },
      { kind: 'tsaiwu', config: d.tsaiwu },
      { kind: 'gurson', config: d.gurson },
      { kind: 'drucker-prager', config: d.dp },
    ], sigma0);
    // 3D 预览（惰性创建渲染器；重复点击复用并更新几何）
    if (canvas) {
      canvas.style.display = 'block';
      if (!yieldViewer || yieldViewer.disposed) yieldViewer = createYieldViewer(canvas);
      yieldViewer.update(mesh.positions, mesh.indices, sigma0);
    }
    if (out) {
      out.style.display = 'block';
      const sfTxt = sfRes.sf >= 100 ? '≥100' : sfRes.sf.toFixed(2);
      const critTxt = crit ? `${YIELD_CRITERIA_LABEL[crit.kind]}（SF ${crit.result.sf >= 100 ? '≥100' : crit.result.sf.toFixed(2)}）` : '—';
      out.textContent = `${YIELD_CRITERIA_LABEL[kind]}：包络半径带 ${mesh.rMin.toFixed(2)}~${mesh.rMax.toFixed(2)} MPa · `
        + `安全系数 SF=${sfTxt}（应力模长 ${sfRes.stressNorm.toFixed(2)} MPa）· 临界失效模式：${critTxt}`;
      const sfVal = crit ? crit.result.sf : sfRes.sf;
      out.textContent += sfVal < 1 ? ' ⚠ 应力状态已在包络外（失效）' : sfVal < 1.5 ? ' ⚠ 裕度偏低' : '';
      out.textContent += ` · 推导口径：ρ̄=${rho.toFixed(2)} σ_pl=${d.sigmaPl.toFixed(1)} MPa`;
    }
  } catch (err) {
    if (out) { out.style.display = 'block'; out.textContent = `屈服面评估失败：${err instanceof Error ? err.message : String(err)}`; }
  }
});

// ── 【v7.0 Stage III】声子能带色散图 + 禁带识别 ──
document.getElementById('btn-phonon')?.addEventListener('click', () => {
  const out = document.getElementById('phonon-result');
  const canvas = document.getElementById('phonon-canvas') as HTMLCanvasElement | null;
  const s = getState();
  const unsupported = s.type === 'custom' || s.type === 'lidinoid' || s.type === 'splitp' || s.hybrid.enabled;
  if (unsupported) {
    if (out) { out.style.display = 'block'; out.textContent = '声子能带暂不支持 custom/lidinoid/splitp/混合场（固相判定语义源限制）'; }
    return;
  }
  try {
    // 体素化固相掩码（与平台最终场同语义：percolation isSolidAt 单一语义源）
    const N = 6;
    const params: SectionAnalysisParams = {
      type: s.type, customFormula: s.customFormula, weights: s.weights,
      periods: s.cellSize, mode: s.structureMode, gradientDir: s.gradientDir,
      container: 'cube', isoUsed: lastIsoUsed, endplateMm: 0,
    };
    const solid = new Uint8Array(N * N * N);
    for (let iz = 0; iz < N; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const x = ((ix + 0.5) / N) * 2 - 1, y = ((iy + 0.5) / N) * 2 - 1, z = ((iz + 0.5) / N) * 2 - 1;
      solid[ix + iy * N + iz * N * N] = isSolidAt(params, x, y, z) ? 1 : 0;
    }
    const matKey = s.material === 'auto' ? 'tc4' : s.material;
    const rhoS = matKey === 'polymer' ? 1200 : matKey === 'thermal' ? 3000 : 4430;
    const E0 = (matKey === 'polymer' ? 3.5 : matKey === 'thermal' ? 70 : 110) * 1e9;
    const res = solvePhononicBands({ N, solid, rhoS, matrixEPa: E0, cellSizeM: (s.cellSize) * 1e-3, numBands: 10, kPointsPerSeg: 4, maxIter: 120 });

    // 绘制能带图
    if (canvas) {
      canvas.style.display = 'block';
      const ctx2 = canvas.getContext('2d');
      if (ctx2) {
        const W = canvas.width, H = canvas.height;
        ctx2.clearRect(0, 0, W, H);
        const mL = 34, mR = 8, mT = 10, mB = 20;
        const pw = W - mL - mR, ph = H - mT - mB;
        let fMax = 0;
        for (const b of res.bands) for (const w of b) fMax = Math.max(fMax, w);
        fMax = fMax || 1;
        const yOf = (w: number) => mT + ph * (1 - w / fMax);
        // 禁带底纹
        for (const g of res.bandgaps) {
          ctx2.fillStyle = 'rgba(250,204,21,0.25)';
          ctx2.fillRect(mL, yOf(g.upper), pw, yOf(g.lower) - yOf(g.upper));
        }
        // 网格与高对称点
        ctx2.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx2.beginPath();
        for (let i = 0; i < pathTicks(res).length; i++) {
          const x = mL + pathTicks(res)[i].x * pw;
          ctx2.moveTo(x, mT); ctx2.lineTo(x, mT + ph);
        }
        ctx2.stroke();
        // 能带线
        const colors = ['#38bdf8', '#38bdf8', '#f59e0b', '#a78bfa', '#a78bfa', '#a78bfa', '#34d399', '#34d399', '#f87171', '#f87171'];
        for (let b = 0; b < res.bands.length; b++) {
          ctx2.strokeStyle = colors[b % colors.length];
          ctx2.lineWidth = b < 3 ? 1.6 : 1;
          ctx2.beginPath();
          for (let kk = 0; kk < res.bands[b].length; kk++) {
            const x = mL + (res.pathX[kk] / (res.pathX[res.pathX.length - 1] || 1)) * pw;
            const y = yOf(res.bands[b][kk]);
            if (kk === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
          }
          ctx2.stroke();
        }
        // 轴标签
        ctx2.fillStyle = 'rgba(148,163,184,0.9)';
        ctx2.font = '10px sans-serif';
        for (const t of pathTicks(res)) ctx2.fillText(t.label, mL + t.x * pw - 4, H - 6);
        ctx2.fillText(`${(fMax / 2 / Math.PI / 1e6).toFixed(1)} MHz`, 2, mT + 8);
      }
    }
    if (out) {
      out.style.display = 'block';
      const bg = res.bandgaps.length
        ? `禁带 ${res.bandgaps.map((g) => `${(g.lower / 2 / Math.PI / 1e3).toFixed(0)}~${(g.upper / 2 / Math.PI / 1e3).toFixed(0)}kHz(BG ${g.bgPct.toFixed(1)}%)`).join(' · ')}`
        : '路径禁带：无';
      out.textContent = `零模态 ${res.zeroModesAtGamma}（平动声学）· 声速比 ${(res.cMeasuredMs / res.cTargetMs).toFixed(3)} · ρ̄=${res.relativeDensity.toFixed(2)} · ${bg} · ${res.elapsedMs}ms`;
    }
  } catch (err) {
    if (out) { out.style.display = 'block'; out.textContent = `能带计算失败：${err instanceof Error ? err.message : String(err)}`; }
  }
});

// ── 【v7.0 Stage IV】组织长入 0~28 天：模拟 + 时序云图播放 ──
let tissueResult: TissueResult | null = null;
let tissueDayIdx = 0;

function tissueApplyFrame(): void {
  if (!tissueResult || !baseGeo) return;
  const fr = Math.min(tissueDayIdx, tissueResult.o2Frames.length - 1);
  const field = tissueResult.o2Frames[fr];
  const pos = baseGeo.attributes.position.array as Float32Array;
  const colored = mapElementFieldToVertexColors(pos, tissueResult.R, field, 0, 1, sampleCoolWarmInto);
  baseGeo.setAttribute('color', new THREE.BufferAttribute(colored, 3));
  const mat = getMaterial(getState().material, getState().model);
  mat.vertexColors = true;
  mat.needsUpdate = true;
  requestRender();
}

function tissueShowStat(): void {
  if (!tissueResult) return;
  const dayOf = tissueResult.frameDays[Math.min(tissueDayIdx, tissueResult.frameDays.length - 1)];
  const st = tissueResult.stats[Math.min(dayOf, tissueResult.stats.length - 1)];
  const out = document.getElementById('tissue-result');
  if (out) {
    out.style.display = 'block';
    out.textContent = `第 ${st.day} 天：平均氧 ${st.meanO2.toFixed(3)} · 存活率 ${(st.viability * 100).toFixed(1)}% · 低氧区 ${st.necrosisPct.toFixed(1)}% · 矿化 ${st.mineralPct.toFixed(1)}%`;
  }
}

document.getElementById('btn-tissue')?.addEventListener('click', () => {
  const out = document.getElementById('tissue-result');
  const s = getState();
  const unsupported = s.type === 'custom' || s.type === 'lidinoid' || s.type === 'splitp' || s.hybrid.enabled;
  if (unsupported) {
    if (out) { out.style.display = 'block'; out.textContent = '组织长入暂不支持 custom/lidinoid/splitp/混合场（固相判定语义源限制）'; }
    return;
  }
  try {
    const R = 24;
    const params: SectionAnalysisParams = {
      type: s.type, customFormula: s.customFormula, weights: s.weights,
      periods: s.cellSize, mode: s.structureMode, gradientDir: s.gradientDir,
      container: 'cube', isoUsed: lastIsoUsed, endplateMm: 0,
    };
    const solid = new Uint8Array(R * R * R);
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      const x = ((ix + 0.5) / R) * 2 - 1, y = ((iy + 0.5) / R) * 2 - 1, z = ((iz + 0.5) / R) * 2 - 1;
      solid[ix + iy * R + iz * R * R] = isSolidAt(params, x, y, z) ? 1 : 0;
    }
    const res = simulateTissueGrowth({ R, solid, days: 28 });
    tissueResult = res;
    tissueDayIdx = res.o2Frames.length - 1;
    // 时间轴
    const slider = document.getElementById('tissue-day') as HTMLInputElement | null;
    const row = document.getElementById('tissue-day-row');
    if (slider) {
      slider.max = String(res.o2Frames.length - 1);
      slider.value = String(tissueDayIdx);
      slider.style.display = 'block';
    }
    if (row) row.style.display = 'flex';
    tissueApplyFrame();
    // 统计曲线（平均氧 + 存活率 vs 天）
    const canvas = document.getElementById('tissue-canvas') as HTMLCanvasElement | null;
    if (canvas) {
      canvas.style.display = 'block';
      const g = canvas.getContext('2d');
      if (g) {
        const W = canvas.width, H = canvas.height;
        g.clearRect(0, 0, W, H);
        g.strokeStyle = '#38bdf8';
        g.beginPath();
        res.stats.forEach((st, i) => {
          const x = 8 + (i / (res.stats.length - 1)) * (W - 16);
          const y = H - 8 - st.meanO2 * (H - 16);
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        });
        g.stroke();
        g.strokeStyle = '#f59e0b';
        g.beginPath();
        res.stats.forEach((st, i) => {
          const x = 8 + (i / (res.stats.length - 1)) * (W - 16);
          const y = H - 8 - st.viability * (H - 16);
          i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        });
        g.stroke();
        g.fillStyle = 'rgba(148,163,184,0.9)';
        g.font = '9px sans-serif';
        g.fillText('蓝=平均氧 · 橙=存活率', 8, 10);
      }
    }
    const last = res.stats[res.stats.length - 1];
    if (out) {
      out.style.display = 'block';
      out.textContent = `28 天终态：平均氧 ${last.meanO2.toFixed(3)} · 存活率 ${(last.viability * 100).toFixed(1)}% · 低氧区 ${last.necrosisPct.toFixed(1)}% · 矿化 ${last.mineralPct.toFixed(1)}% · 质量守恒残差 ${(res.massBalance * 100).toFixed(2)}% · 核心/表层氧比 ${(res.meanO2Core / Math.max(res.meanO2Shell, 1e-9)).toFixed(2)} · ${res.elapsedMs}ms`;
    }
    tissueShowStat();
  } catch (err) {
    if (out) { out.style.display = 'block'; out.textContent = `组织长入模拟失败：${err instanceof Error ? err.message : String(err)}`; }
  }
});

document.getElementById('tissue-day')?.addEventListener('input', (e) => {
  tissueDayIdx = Number((e.target as HTMLInputElement).value);
  const v = document.getElementById('tissue-day-value');
  if (v && tissueResult) {
    const day = tissueResult.frameDays[Math.min(tissueDayIdx, tissueResult.frameDays.length - 1)];
    v.textContent = `${day} 天`;
  }
  tissueApplyFrame();
  tissueShowStat();
});

/** 能带图高对称点刻度（Γ-X-M-R-Γ，坐标 = 实际累计路径比） */
function pathTicks(res: PhononicResult): { label: string; x: number }[] {
  const xMax = res.pathX[res.pathX.length - 1] || 1;
  return res.ticks.map((t) => ({ label: t.label, x: t.x / xMax }));
}

// ── 重建调度 ─────────────────────────────────────────────
/** 返回 true = LRU 命中并已同步应用（不发 worker 请求）；false = 已派发 worker 重建 */
function rebuild(preview: boolean): boolean {
  const s = getState();
  // 三级 LOD：preview 低分辨率 → 中等过渡 → 全高清
  let R: number;
  if (preview) {
    R = 28;  // Level 1: 极低分辨率，拖动时丝滑跟手
  } else if (isFirstBuild) {
    R = hdResolution(s.type, s.structureMode, s.gradientDir, s.cellSize);  // Level 3: 首屏直接高清
  } else {
    R = l2Resolution(s.type, s.structureMode, s.gradientDir, s.cellSize);  // Level 2: 中等分辨率
  }
  const iso = baseIso(s);

  // 缓存检查
  const key = cacheKey(s, R);
  const cached = geoCache.get(key);
  if (cached) {
    // 缓存命中：瞬间恢复（注意：此路径不派发 worker 结果——调用方若在等待结果需以此返回值区分）
    // 颜色不入缓存：由 applyGeometry 内部按当前着色状态现场补算
    applyGeometry(cached.positions, cached.normals, cached.indices, cached.vertCount, cached.faceCount);
    runPendingNLExport();
    return true;
  }

  const params: BuildParams = {
    type: s.type,
    iso,
    periods: s.cellSize,
    resolution: R,
    targetPorosity: s.porosity / 100,
    weights: s.weights,
    structureMode: s.structureMode,
    containerShape: s.containerShape,
    thickness: s.thickness,
    gradientDir: s.gradientDir,
    hybrid: s.hybrid,
    customFormula: s.customFormula,
    preview,
    coloring: effectiveColoring(s),
    endplateMm: s.endplateMm,
    stress: s.stress,
    hierarchical: s.hierarchical,
    neural: s.neural,
  };

  dispatchFullBuild(params, key);
  if (s.hierarchical.enabled) scheduleHierarchicalStats();
  return false;
}

function scheduleRebuild(preview: boolean, skipHistory = false): void {
  // 仅完整重建时记录历史；undo/redo 恢复后的重建跳过（否则会把恢复态压栈、丢弃 redo 分支）
  if (!preview && !skipHistory) pushHistory();
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(preview), preview ? 16 : 150);
}

/** 松手后先渲染中等分辨率，再自动升级到全高清 */
function scheduleHdUpgrade(): void {
  setTimeout(() => {
    const s = getState();
    const fullR = hdResolution(s.type, s.structureMode, s.gradientDir, s.cellSize);
    const params: BuildParams = {
      type: s.type,
      iso: baseIso(s),
      periods: s.cellSize,
      resolution: fullR,
      targetPorosity: s.porosity / 100,
      weights: s.weights,
      structureMode: s.structureMode,
      containerShape: s.containerShape,
      thickness: s.thickness,
      gradientDir: s.gradientDir,
      hybrid: s.hybrid,
      customFormula: s.customFormula,
      preview: false,
      coloring: effectiveColoring(s),
      endplateMm: s.endplateMm,
      stress: s.stress,
      hierarchical: s.hierarchical,
      neural: s.neural,
    };
    dispatchFullBuild(params, cacheKey(s, fullR));
    if (s.hierarchical.enabled) scheduleHierarchicalStats();
  }, 350);
}

// ── 着色模式 ─────────────────────────────────────────────
/** field 口径的可用性：需异构混合开启或梯度双壳在场 */
function fieldAvailable(s: AppState): boolean {
  return s.hybrid.enabled || s.structureMode === 'gradient_shell';
}

/** UI 选择到 Worker 参数的有效着色模式（非法选择优雅回退，不静默丢色彩语义） */
function effectiveColoring(s: AppState): ColoringMode {
  if (s.coloring === 'field' && !fieldAvailable(s)) return 'elevation';
  if (s.coloring === 'stress_vm' && s.stress.preset === 'none') return 'elevation';
  return s.coloring;
}

// ── 几何应用 ─────────────────────────────────────────────
function applyGeometry(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  vertCount: number,
  _faceCount: number,
  colors?: Float32Array | null,
): void {
  disposeGeometry();

  if (vertCount === 0) {
    showEmpty(true);
    updateStats();
    return;
  }
  showEmpty(false);

  // 缓存命中路径不带颜色（颜色不入缓存）：按当前状态现场补算。
  // S(x) 只是位置的纯函数（几十万顶点 ≪10ms），远比一次 worker 往返便宜
  const s0 = getState();
  const cols = colors ?? (() => {
    const eff = effectiveColoring(s0);
    return eff !== 'none'
      ? computeVertexColors(positions, vertCount, {
          mode: eff,
          // 混合对所有标量口径生效（field 权重 / 曲率的 f_A·w+f_B 混合场均依赖它）
          hybrid: s0.hybrid.enabled ? s0.hybrid : undefined,
          gradientDir: s0.gradientDir,
          field: {
            type: s0.type,
            customFormula: s0.customFormula,
            weights: s0.weights,
            periods: s0.cellSize,
            thickness: s0.thickness,
            iso: baseIso(s0),
          },
        })
      : null;
  })();

  // 【阶段 IV】非欧度规空间映射：顶点级连续 warp（水密/流形性质由构造继承）。
  // 映射改变几何 ⇒ 法线重算（THREE 路径）；恒等映射零开销跳过。
  const manifold = s0.manifold ?? { kind: 'identity', radius: 15, scale: 1.4, axis: 'z' };
  if (manifold.kind !== 'identity' && manifold.kind !== undefined) {
    mapGeometry(manifold.kind, manifold, { half: Math.PI * s0.cellSize }, positions);
    const tmpGeo = new THREE.BufferGeometry();
    tmpGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tmpGeo.setIndex(new THREE.BufferAttribute(indices.slice(), 1));
    tmpGeo.computeVertexNormals();
    const nn = tmpGeo.getAttribute('normal').array as Float32Array;
    normals.set(nn.subarray(0, Math.min(normals.length, nn.length)));
    tmpGeo.dispose();
  }

  baseGeo = new THREE.BufferGeometry();
  baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  baseGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (cols) {
    baseGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));
  baseGeo.computeBoundingSphere();

  const mat = getMaterial(s0.material, s0.model);
  // 顶点色开关打在共享材质上：color attribute 缺失时必须关掉，
  // 否则 Three.js 以未定义 attribute 参与 shader 输出（渲染黑面）
  const wantVertexColors = !!cols && s0.model !== 'strut'; // LineBasicMaterial 无顶点色通道，线框保持纯色
  mat.vertexColors = wantVertexColors;
  mat.needsUpdate = true;

  const s = s0;

  if (s.model === 'strut') {
    // 线框模式
    const edges = new THREE.EdgesGeometry(baseGeo, 15);
    meshStrut = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      clippingPlanes: [ctx.clipPlane],
    }));
    meshStrut.scale.set(DISPLAY_SCALE, DISPLAY_SCALE, DISPLAY_SCALE);
    ctx.scene.add(meshStrut);
    if (meshFill) { ctx.scene.remove(meshFill); meshFill = null; }
  } else {
    // surface / solid 模式
    meshFill = new THREE.Mesh(baseGeo, mat);
    meshFill.scale.set(DISPLAY_SCALE, DISPLAY_SCALE, DISPLAY_SCALE);
    meshFill.castShadow = true;
    meshFill.receiveShadow = true;
    ctx.scene.add(meshFill);
    if (meshStrut) { ctx.scene.remove(meshStrut); meshStrut = null; }
  }

  // 截面裁剪 + stencil 封边 overlay（依赖新 baseGeo，必须在裁切后同步重建）
  updateClipPlane();
  syncCapOverlay();

  // 测量工具同步
  if (bboxAnnotation && baseGeo) {
    bboxAnnotation.update(baseGeo, getState().cellSize);
  }
  if (caliperTool) {
    caliperTool.dispose();
    caliperTool = meshFill ? new CaliperTool(ctx.renderer, ctx.camera, ctx.scene, meshFill, getState().cellSize) : null;
    if (caliperTool) {
      const btn = document.getElementById('btn-caliper');
      if (btn) btn.classList.add('on');
      caliperTool.enable();
    }
  }

  // 首屏渐入
  if (isFirstBuild) {
    isFirstBuild = false;
    const target = meshFill || meshStrut;
    if (target) {
      target.scale.set(0.01, 0.01, 0.01);
      let progress = 0;
      const duration = 800;
      const startTime = performance.now();
      const tick = () => {
        progress = Math.min(1, (performance.now() - startTime) / duration);
        const ease = 1 - Math.pow(1 - progress, 3);
        target.scale.set(DISPLAY_SCALE * ease, DISPLAY_SCALE * ease, DISPLAY_SCALE * ease);
        requestRender(); // 按需渲染：渐入动画每帧重绘
        if (progress < 1) requestAnimationFrame(tick);
      };
      tick();
    }
  }

  updateStats();
  requestRender(); // 按需渲染：几何更新后重绘
}

// ── Worker 回调 ─────────────────────────────────────────────
function onWorkerResult(res: WorkerResponse): void {
  if (res.type !== 'result') return;
  if (import.meta.env?.DEV) {
    console.debug('[Main] Worker result:', {
      vertCount: res.vertCount,
      triCount: res.triCount,
      porosityEstimate: res.porosityEstimate,
      isoUsed: res.isoUsed,
      buildTimeMs: res.buildTimeMs,
    });
  }

  lastPorosityEstimate = res.porosityEstimate;
  lastMeshSolidFraction = res.meshSolidFraction ?? null;
  // 红队 V-3a：混叠公式（如 sin(x*40)…）的非流形边占比可达 7%——采样定理警示
  {
    const nmRatio = res.nmEdgeCount != null && res.triCount > 0 ? res.nmEdgeCount / (res.triCount * 3) : 0;
    if (nmRatio > 0.02 && !nmWarned) {
      nmWarned = true;
      flashToast('提示：公式变化太快，超出网格采样能力，导出质量会下降。建议降低公式里的频率（如 x*40 改成 x*20），或提高分辨率');
    } else if (nmRatio <= 0.02) {
      nmWarned = false;
    }
  }
  if (res.isoUsed != null) lastIsoUsed = res.isoUsed;
  lastBuildResolution = res.resolution;
  if (getState().slice < 100) schedulePercolation(80);   // 重建完成后刷新连通性预检
  scheduleMicroPhysics(250);                              // 三向迂曲度 + 各向异性刚度（重建后自动刷新）

  // 物理指标
  if (res.surfaceArea != null && res.envelopeVolume != null) {
    lastPhysicsMetrics = computePhysicsMetrics(
      getState().type,
      res.porosityEstimate,
      res.surfaceArea,
      res.envelopeVolume,
      getState().material,
      getState().structureMode
    );
  }

  // 应用几何
  applyGeometry(res.positions!, res.normals!, res.indices!, res.vertCount, res.triCount, res.colors ?? null);
  runPendingNLExport();

  // 缓存结果
  const cKey = cacheKey(getState(), res.resolution);
  geoCache.set(cKey, {
    positions: new Float32Array(res.positions!),
    normals: new Float32Array(res.normals!),
    indices: new Uint32Array(res.indices!),
    vertCount: res.vertCount,
    faceCount: res.triCount,
  });
  // LRU 淘汰
  if (geoCache.size > MAX_GEO_CACHE) {
    const oldest = geoCache.keys().next().value;
    if (oldest) geoCache.delete(oldest);
  }

  // 同步公式、提示栏
  const st = getState();
  updateFormulaDisplay(st.type, st.weights, res.isoUsed ?? 0);
  updateTips(st.type, st.porosity, st.thickness, res.porosityEstimate ?? null);
}

function onWorkerError(err: string): void {
  console.error('[Main] Worker error:', err);
  // 红队 V-2：静默失败通道——公式 NaN/退化权重/超容量等构建错误必须让用户看见
  flashToast(`构建失败：${err}`);
}

// ── 材质管理 ─────────────────────────────────────────────
function getMaterial(preset: MaterialPreset, model: string): MeshPhysicalMaterial {
  const key = `${preset}-${model}`;
  if (materialCache.has(key)) return materialCache.get(key)!;

  const configs: Record<string, Partial<THREE.MeshPhysicalMaterialParameters>> = {
    // 通用：淡蓝灰，类似钛金属但更哑光
    auto: {
      color: 0x9dafc0,
      metalness: 0.15,
      roughness: 0.52,
      clearcoat: 0.12,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.55,
      emissive: 0x1c232d,
      emissiveIntensity: 0.06,
      sheen: 0.1,
      sheenColor: 0x6a8aa8,
      sheenRoughness: 0.5,
    },
    // TC4 钛合金：冷调金属光泽
    tc4: {
      color: 0xa0aebc,
      metalness: 0.75,
      roughness: 0.32,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.7,
      emissive: 0x141a20,
      emissiveIntensity: 0.04,
      iridescence: 0.15,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [200, 600],
    },
    // PLLA 高分子：奶白哑光
    polymer: {
      color: 0xc8b8a4,
      metalness: 0.0,
      roughness: 0.72,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.3,
      emissive: 0x231a13,
      emissiveIntensity: 0.05,
      sheen: 0.2,
      sheenColor: 0xd8c0a0,
      sheenRoughness: 0.7,
    },
    // 导热材：深蓝灰亚光金属
    thermal: {
      color: 0x455a72,
      metalness: 0.45,
      roughness: 0.38,
      clearcoat: 0.4,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.55,
      emissive: 0x0e1420,
      emissiveIntensity: 0.03,
      sheen: 0.05,
      sheenColor: 0x6080a0,
    },
  };

  const mat = new MeshPhysicalMaterial({
    side: THREE.DoubleSide,
    clippingPlanes: [ctx.clipPlane],
    clipShadows: true,
    ...configs[preset],
  });
  materialCache.set(key, mat);
  return mat;
}

// ── 截面裁剪 ─────────────────────────────────────────────
// ── 动态剖切（三轴 + 反向 + stencil 封边）─────────────────
// 显示空间：mesh 缩放 DISPLAY_SCALE=0.33，wc ±π → 视口 ±1.036；滑杆 100=完整。
let capStencilGroup: THREE.Group | null = null;
let capPlaneMesh: THREE.Mesh | null = null;
const CAP_COLOR = 0x0ea5a3;   // 剖面着色（纯色 cap，主题青）

function disposeCapOverlay(): void {
  if (capStencilGroup) {
    ctx.scene.remove(capStencilGroup);
    capStencilGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
    capStencilGroup = null;
  }
  if (capPlaneMesh) {
    ctx.scene.remove(capPlaneMesh);
    (capPlaneMesh.material as THREE.Material).dispose();
    capPlaneMesh.geometry.dispose();
    capPlaneMesh = null;
  }
}

/** 按 baseGeo + 当前剖切平面重建 stencil 封边 overlay（three.js webgl_clipping_stencil 模式） */
function syncCapOverlay(): void {
  const s = getState();
  const active = s.slice < 100 && s.model !== 'strut' && !!baseGeo;
  disposeCapOverlay();
  if (!active || !baseGeo) { requestRender(); return; }

  // ① stencil 组：对同一 geometry 以 Back/Front 双 pass 写入模板缓冲
  const group = new THREE.Group();
  const baseMat = new THREE.MeshBasicMaterial();
  baseMat.depthWrite = false; baseMat.depthTest = false; baseMat.colorWrite = false;
  baseMat.stencilWrite = true; baseMat.stencilFunc = THREE.AlwaysStencilFunc;
  const back = baseMat.clone();
  back.side = THREE.BackSide;
  back.clippingPlanes = [ctx.clipPlane];
  back.stencilFail = THREE.IncrementWrapStencilOp;
  back.stencilZFail = THREE.IncrementWrapStencilOp;
  back.stencilZPass = THREE.IncrementWrapStencilOp;
  const backMesh = new THREE.Mesh(baseGeo, back);
  backMesh.renderOrder = 6;
  backMesh.scale.setScalar(DISPLAY_SCALE);
  group.add(backMesh);
  const front = baseMat.clone();
  front.side = THREE.FrontSide;
  front.clippingPlanes = [ctx.clipPlane];
  front.stencilFail = THREE.DecrementWrapStencilOp;
  front.stencilZFail = THREE.DecrementWrapStencilOp;
  front.stencilZPass = THREE.DecrementWrapStencilOp;
  const frontMesh = new THREE.Mesh(baseGeo, front);
  frontMesh.renderOrder = 6;
  frontMesh.scale.setScalar(DISPLAY_SCALE);
  group.add(frontMesh);
  ctx.scene.add(group);
  capStencilGroup = group;

  // ② 剖面着色平面：stencilRef≠0 处着色（即被裁掉的开口截面）
  const capMat = new THREE.MeshBasicMaterial({
    color: CAP_COLOR,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
    clippingPlanes: [],
  });
  const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), capMat);
  planeMesh.renderOrder = 6.1;
  ctx.scene.add(planeMesh);
  capPlaneMesh = planeMesh;

  placeCapPlaneMesh();
  requestRender();
}

/** 把剖面 mesh 贴到当前 clipPlane 上（每帧裁切变化时同步姿态） */
function placeCapPlaneMesh(): void {
  if (!capPlaneMesh) return;
  ctx.clipPlane.coplanarPoint(capPlaneMesh.position);
  capPlaneMesh.lookAt(
    capPlaneMesh.position.x - ctx.clipPlane.normal.x,
    capPlaneMesh.position.y - ctx.clipPlane.normal.y,
    capPlaneMesh.position.z - ctx.clipPlane.normal.z,
  );
}

function updateClipPlane(): void {
  const s = getState();
  const showClip = s.slice < 100;
  const c = (s.slice / 100) * 1.6;
  const normal = s.sliceAxis === 'x' ? new THREE.Vector3(1, 0, 0)
    : s.sliceAxis === 'y' ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
  if (s.sliceInvert) normal.negate();
  ctx.clipPlane.normal.copy(normal);
  ctx.clipPlane.constant = showClip ? c : 100;

  // shadow 盘仅对 z 轴语义成立；x/y 轴剖切时隐藏以保持视觉一致
  const zAxis = s.sliceAxis === 'z';
  ctx.shadowPlane.position.y = showClip && zAxis ? c - 0.02 : -2.04;
  ctx.gridHelper.visible = !(showClip && zAxis);

  placeCapPlaneMesh();
  requestRender(); // 按需渲染：裁剪面变化需重绘
}

// ── 截面连通性预检（Percolation Preflight）───────────────
let percolTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePercolation(delayMs: number): void {
  if (percolTimer) clearTimeout(percolTimer);
  percolTimer = setTimeout(() => runPercolation(), delayMs);
}

function runPercolation(): void {
  const s = getState();
  const card = document.getElementById('percolation-card');
  if (!card) return;
  if (s.slice >= 100) { card.style.display = 'none'; return; }
  card.style.display = '';

  const note = document.getElementById('pc-note');
  const setVals = (a: string, b: string, c2: string, d: string) => {
    document.getElementById('pc-through')!.textContent = a;
    document.getElementById('pc-cavity')!.textContent = b;
    document.getElementById('pc-island')!.textContent = c2;
    document.getElementById('pc-porosity')!.textContent = d;
  };

  if (s.hybrid.enabled) {
    setVals('—', '—', '—', '—');
    if (note) note.textContent = '混合（Hybrid）场暂不支持连通性预检。';
    return;
  }
  if (lastIsoUsed === 0) {
    setVals('—', '—', '—', '—');
    if (note) note.textContent = '等待网格重建完成…';
    return;
  }

  const result = analyzeSection(
    {
      type: s.type, customFormula: s.customFormula, weights: s.weights,
      periods: s.cellSize, mode: s.structureMode, gradientDir: s.gradientDir,
      container: s.containerShape, isoUsed: lastIsoUsed, endplateMm: s.endplateMm,
    },
    { axis: s.sliceAxis, posNorm: (s.slice / 100) * (1 - 0.02), sampleN: 96 },
  );

  if (!result) {
    setVals('—', '—', '—', '—');
    if (note) note.textContent = '该曲面类型（Lidinoid / Split-P / 自定义公式）暂不支持预检。';
    return;
  }

  setVals(
    String(result.throughChannels),
    String(result.closedCavities),
    '…',
    `${(result.sectionPorosity * 100).toFixed(1)}%`,
  );
  // 孤岛用 3D 固相连通判定：2D 截面孤立斑是蜂窝切片的必然表象，非打印风险；
  // 真正的悬空结构=3D 上既不触边界也不触剖切面的固相连通片（无支撑锚）
  const islands3D = analyzeIslands3D(
    {
      type: s.type, customFormula: s.customFormula, weights: s.weights,
      periods: s.cellSize, mode: s.structureMode, gradientDir: s.gradientDir,
      container: s.containerShape, isoUsed: lastIsoUsed, endplateMm: s.endplateMm,
    },
    s.sliceAxis, (s.slice / 100) * (1 - 0.02),
  );
  const islandEl = document.getElementById('pc-island');
  if (islandEl) {
    islandEl.textContent = String(islands3D.isolatedIslands3D);
    islandEl.style.color = islands3D.isolatedIslands3D > 0 ? '#ef4444' : '';
  }

  const warn: string[] = [];
  if (islands3D.isolatedIslands3D > 0) warn.push(`检测到 ${islands3D.isolatedIslands3D} 处 3D 悬空孤岛（无锚定固相块）：打印时缺支撑，建议提高孔隙率或更换剖切轴向`);
  if (result.closedCavities > 0) warn.push(`截面 ${result.closedCavities} 处封闭死腔（2D 视角）：残留粉末/树脂可能无法排出`);
  if (note) note.textContent = warn.length ? '⚠ ' + warn.join('；') : '截面拓扑健康：贯通通道连续，无 3D 悬空孤岛。';
}

// ── 基础等值 ─────────────────────────────────────────────
function baseIso(s: AppState): number {
  // 简化版：直接返回 0，让二分搜索在 Worker 中精确计算
  let iso = 0;
  if (s.model === 'solid') {
    iso -= (s.thickness - 1) * 0.12;
  }
  return iso;
}

// ── 清理几何 ─────────────────────────────────────────────
function disposeGeometry(): void {
  disposeCapOverlay();   // stencil overlay 共享 baseGeo 引用，必须先于 baseGeo 释放移除
  if (meshFill) {
    ctx.scene.remove(meshFill);
    meshFill.geometry.dispose();
    meshFill = null;
  }
  if (meshStrut) {
    ctx.scene.remove(meshStrut);
    meshStrut.geometry.dispose();
    meshStrut = null;
  }
  if (baseGeo) {
    // 显式摘除 color attribute：顶点色开启/关闭循环时确保无陈旧引用残留
    // （geometry.dispose() 本身会释放全部 GPU 缓冲，这里是防御性清理）
    baseGeo.deleteAttribute('color');
    baseGeo.deleteAttribute('position');
    baseGeo.deleteAttribute('normal');
    baseGeo.dispose();
    baseGeo = null;
  }
  if (bboxAnnotation) {
    bboxAnnotation.clear();
  }
  if (caliperTool) {
    caliperTool.clearPoints();
  }
}

// ── 空态显示 ─────────────────────────────────────────────
function showEmpty(show: boolean): void {
  const el = document.getElementById('empty');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// ── 统计更新 ─────────────────────────────────────────────
function updateStats(): void {
  try { updateImpactStats(); } catch { /* 统计失败不阻塞 */ }
  const porosityEl = document.getElementById('stat-porosity');
  const materialEl = document.getElementById('stat-material');
  const vertEl = document.getElementById('stat-verts');
  const triEl = document.getElementById('stat-tris');
  const svEl = document.getElementById('stat-sv');
  const youngEl = document.getElementById('stat-young');
  const sigmaEl = document.getElementById('stat-sigma');
  const c1El = document.getElementById('stat-c1');
  const permEl = document.getElementById('stat-perm');
  const poreEl = document.getElementById('stat-pore');
  const tortEl = document.getElementById('stat-tort');

  if (porosityEl) porosityEl.textContent = (lastPorosityEstimate * 100).toFixed(1) + '%';
  // 显示材料名（非体积占比——占比语义放 title，避免"材料 24.5%"的误导）
  if (materialEl) {
    const mat = getState().material;
    materialEl.textContent = MATERIAL_LABEL[mat] || mat;
    const meshPct = lastMeshSolidFraction != null ? (lastMeshSolidFraction * 100).toFixed(1) : null;
    materialEl.title = meshPct != null
      ? `材料体积占比（网格实测）≈ ${meshPct}%`
      : `材料体积占比 ≈ ${((1 - lastPorosityEstimate) * 100).toFixed(1)}%`;
  }
  if (vertEl && baseGeo) vertEl.textContent = (baseGeo.attributes.position.count / 1000).toFixed(1) + 'k';
  if (triEl && baseGeo) triEl.textContent = (baseGeo.index!.count / 3000).toFixed(1) + 'k';

  if (svEl && lastPhysicsMetrics) {
    svEl.textContent = lastPhysicsMetrics.svRatio.toFixed(3) + ' mm⁻¹';
  }
  if (youngEl && lastPhysicsMetrics) {
    youngEl.textContent = lastPhysicsMetrics.youngsModulusGPa.toFixed(2) + ' GPa';
  }
  if (sigmaEl && lastPhysicsMetrics) {
    sigmaEl.textContent = lastPhysicsMetrics.yieldStrengthMPa.toFixed(1) + ' MPa';
  }
  if (c1El && lastPhysicsMetrics) {
    if (lastPhysicsMetrics.gradientRange) {
      c1El.textContent = `${lastPhysicsMetrics.gradientRange.minE.toFixed(4)}–${lastPhysicsMetrics.gradientRange.maxE.toFixed(4)}`;
      c1El.title = `梯度结构弹性模量范围。平均值: ${lastPhysicsMetrics.gradientRange.avgE.toFixed(4)}`;
    } else {
      c1El.textContent = lastPhysicsMetrics.C1.toFixed(2);
      c1El.title = '';
    }
  }
  if (permEl && lastPhysicsMetrics) {
    permEl.textContent = (lastPhysicsMetrics.permeability * 1e6).toFixed(2) + ' μm²';
  }
  if (poreEl && lastPhysicsMetrics) {
    poreEl.textContent = lastPhysicsMetrics.poreStats.meanDiameter.toFixed(3) + ' mm';
  }
  if (tortEl && lastPhysicsMetrics) {
    tortEl.textContent = lastPhysicsMetrics.poreStats.tortuosity.toFixed(3);
    tortEl.title = '经验式估算（Mackie-Meares）。三向几何迂曲度见下方 τ(x/y/z) 与 Zener 行。';
  }
  // 三向几何迂曲度 + 各向异性刚度（异步微物理分析结果，见 scheduleMicroPhysics）
  const tortXYZ = document.getElementById('stat-tort-xyz');
  if (tortXYZ) tortXYZ.textContent = lastMicroTort ?? '分析中…';
  const zenerEl = document.getElementById('stat-zener');
  if (zenerEl) zenerEl.textContent = lastMicroStiff ?? '分析中…';
  const anisoEl = document.getElementById('stat-aniso');
  if (anisoEl && lastPhysicsMetrics) {
    anisoEl.textContent = lastPhysicsMetrics.anisotropy.toFixed(2);
    anisoEl.title = '各向异性系数 (E_max/E_min)。Gibson-Ashby 模型为各向同性近似，实际值可能因方向而异。';
  }
}

// ── 微物理分析（三向几何迂曲度 + 各向异性刚度）──────────────
// 数据源：lastIsoUsed（worker 精确等值）+ 网格实测相对密度（与导出 STL 同口径）
let lastMicroTort: string | null = null;
let lastMicroStiff: string | null = null;
let microTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMicroPhysics(delayMs: number): void {
  if (microTimer) clearTimeout(microTimer);
  microTimer = setTimeout(runMicroPhysics, delayMs);
}

function runMicroPhysics(): void {
  const s = getState();
  if (s.hybrid.enabled) {
    lastMicroTort = '混合模式暂不支持';
    lastMicroStiff = '—';
    return;
  }
  if (lastIsoUsed === 0) { lastMicroTort = null; lastMicroStiff = null; return; }
  const relDensity = lastMeshSolidFraction ?? (1 - s.porosity / 100);
  // UI 展示用 48³（~0.3s）；审计精度场景请用 sampleN=64（micro_physics_audit 口径）
  const tort = analyzeTortuosity3D(
    {
      type: s.type, customFormula: s.customFormula, weights: s.weights,
      periods: s.cellSize, mode: s.structureMode, gradientDir: s.gradientDir,
      container: s.containerShape, isoUsed: lastIsoUsed, endplateMm: s.endplateMm,
    },
    48,
  );
  const fmtTau = (t: number) => (Number.isFinite(t) ? t.toFixed(2) : '∞(未贯通)');
  lastMicroTort = `${fmtTau(tort.tau[0])} / ${fmtTau(tort.tau[1])} / ${fmtTau(tort.tau[2])}`;

  const st = estimateAnisotropicStiffness(
    relDensity, s.type, { x: tort.tau[0], y: tort.tau[1], z: tort.tau[2] },
  );
  const baseE = BASE_MODULUS[s.material === 'auto' ? 'tc4' : s.material] || BASE_MODULUS.tc4;
  lastMicroStiff = `Zener A=${st.zener.toFixed(2)} · E=${st.E.map((e) => (e * baseE).toFixed(2)).join('/')}`;
  updateStats();   // 微物理变量就绪后刷新面板 DOM（updateStats 读取 lastMicro* 填充）
}

// ── UI 事件绑定 ─────────────────────────────────────────────
function bindUIEvents(): void {
  // 滑块：孔隙率
  const porEl = document.getElementById('porosity') as HTMLInputElement;
  if (porEl) {
    porEl.addEventListener('input', () => {
      setState({ porosity: +porEl.value });
      const v = document.getElementById('porosity-value');
      if (v) v.textContent = `${porEl.value}%`;
      scheduleRebuild(true);
    });
    porEl.addEventListener('change', () => { checkPorosityWarning(+porEl.value); scheduleRebuild(false); scheduleHdUpgrade(); });
  }

  // 滑块：单元密度
  const cellEl = document.getElementById('cell-size') as HTMLInputElement;
  if (cellEl) {
    cellEl.addEventListener('input', () => {
      setState({ cellSize: +cellEl.value });
      const v = document.getElementById('cell-size-value');
      if (v) v.textContent = ['极低', '低', '中等', '高', '极高'][+cellEl.value - 1];
      scheduleRebuild(true);
    });
    cellEl.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
  }

  // 滑块：厚度
  const thickEl = document.getElementById('thickness') as HTMLInputElement;
  if (thickEl) {
    thickEl.addEventListener('input', () => {
      setState({ thickness: +thickEl.value });
      const v = document.getElementById('thickness-value');
      if (v) v.textContent = (+thickEl.value).toFixed(1);
      scheduleRebuild(true);
    });
    thickEl.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
  }

  // 滑块：加载端板厚度（mm；0=关。体素场覆写实现，preview/HD 同管线）
  const epEl = document.getElementById('endplate') as HTMLInputElement;
  if (epEl) {
    const showVal = (val: number) => {
      const v = document.getElementById('endplate-value');
      if (v) v.textContent = val <= 0 ? '关' : `${val.toFixed(1)} mm`;
    };
    epEl.addEventListener('input', () => {
      setState({ endplateMm: +epEl.value });
      showVal(+epEl.value);
      scheduleRebuild(true);
    });
    epEl.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
  }

  // 滑块：截面
  const sliceEl = document.getElementById('slice') as HTMLInputElement;
  if (sliceEl) {
    sliceEl.addEventListener('input', () => {
      setState({ slice: +sliceEl.value });
      const sv = document.getElementById('slice-value');
      if (sv) sv.textContent = +sliceEl.value >= 99 ? '完整' : `${Math.round((+sliceEl.value + 100) / 2)}%`;
      updateClipPlane();
      schedulePercolation(300);   // 拖动中 300ms 防抖：3D 剖切即时，连通性分析滞后
    });
    sliceEl.addEventListener('change', () => runPercolation());
  }

  // 剖切轴向 / 反向按钮
  document.querySelectorAll('[data-slice-axis]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ax = btn.getAttribute('data-slice-axis');
      if (ax === 'invert') {
        setState({ sliceInvert: !getState().sliceInvert });
        syncUI(getState());
      } else {
        setState({ sliceAxis: ax as SliceAxis });
        syncUI(getState());
      }
      updateClipPlane();
      runPercolation();
    });
  });

  // 权重滑块：由 refreshWeightsUI() 在每次重建权重行时绑定（见 syncUI），
  // 静态绑定会在滑块 DOM 重建后失效，故不在此处绑定。

  // 曲面类型按钮
  document.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ type: btn.getAttribute('data-type') as AppState['type'] });
      const s = getState();
      syncUI(s);
      updateBadges(s.type, s.model, s.material, s.structureMode);
      scheduleRebuild(false);
    });
  });

  // 渲染模式按钮
  document.querySelectorAll('[data-model]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ model: btn.getAttribute('data-model') as AppState['model'] });
      const s = getState();
      syncUI(s);
      updateBadges(s.type, s.model, s.material, s.structureMode);
      scheduleRebuild(false);
    });
  });

  // 结构拓扑按钮
  document.querySelectorAll('[data-structure]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-structure') as AppState['structureMode'];
      setState({ structureMode: mode });
      updateStructureDesc(mode);
      const s = getState();
      syncUI(s);
      updateBadges(s.type, s.model, s.material, s.structureMode);
      scheduleRebuild(false);
    });
  });

  // 容器按钮
  document.querySelectorAll('[data-container]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ containerShape: btn.getAttribute('data-container') as AppState['containerShape'] });
      syncUI(getState());
      scheduleRebuild(false);
    });
  });

  // 材质按钮
  document.querySelectorAll('[data-material]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ material: btn.getAttribute('data-material') as AppState['material'] });
      const s = getState();
      syncUI(s);
      updateBadges(s.type, s.model, s.material, s.structureMode);
      rebuild(false);
    });
  });

  // 预设场景
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset')!;
      applyPreset(preset);
      const s = getState();
      syncUI(s);
      updateBadges(s.type, s.model, s.material, s.structureMode);
      updateStructureDesc(s.structureMode);
      updateFormulaDisplay(s.type, s.weights, 0);
      updateTips(s.type, s.porosity, s.thickness, null);
      showPresetCard(preset);
      scheduleRebuild(false);
    });
  });

  // 工具栏按钮
  document.getElementById('btn-rotate')?.addEventListener('click', () => {
    const s = getState();
    setState({ autoRotate: !s.autoRotate });
    ctx.controls.autoRotate = !s.autoRotate;
    document.getElementById('btn-rotate')?.classList.toggle('on', !s.autoRotate);
  });

  document.getElementById('btn-reset')?.addEventListener('click', () => {
    ctx.camera.position.set(2.4, 1.5, 4.6);
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.update();
  });

  // WebGPU 场计算加速开关（v3.0 阶段 I）：切换后重走完整重建以立即生效；
  // 重新开启时复位可用性探测（设备热插拔/驱动恢复场景）
  document.getElementById('btn-gpu')?.addEventListener('click', () => {
    const s = getState();
    const turningOn = !s.gpuAccelerate;
    setState({ gpuAccelerate: turningOn });
    if (turningOn) {
      gpuUsable = null;
      setGpuStatusText('探测中…');
      void probeGpuAvailability().then((ok) => {
        gpuUsable = ok;
        setGpuStatusText(ok ? 'WebGPU 可用 · 完整重建自动启用' : 'WebGPU 不可用 · CPU 管线');
      });
    }
    syncUI(getState());
    scheduleRebuild(false, true);
  });

  document.getElementById('btn-share')?.addEventListener('click', () => {
    const url = buildShareURL();
    // 无 clipboard-write 权限的环境（Firefox/失焦标签/沙箱 iframe）会 reject，回退到手动复制
    navigator.clipboard.writeText(url).then(() => {
      flashToast('分享链接已复制到剪贴板');
    }).catch(() => {
      window.prompt('复制失败，请手动复制分享链接：', url);
    });
  });

  document.getElementById('btn-snap')?.addEventListener('click', () => {
    ctx.composer.render();
    const a = document.createElement('a');
    a.href = ctx.renderer.domElement.toDataURL('image/png');
    a.download = `tpms-${getState().type}-p${getState().porosity}-${Date.now()}.png`;
    a.click();
  });

  document.getElementById('btn-stl')?.addEventListener('click', () => {
    // 统一走导出中心路径：共享 HD 锁（此前该入口无锁，拖动后 350ms 内导出 preview 网格，两入口产物不一致）
    handleExport('stl');
  });

  // 导出中心：VTK / VTI / Python / MATLAB / BibTeX / JSON 统一入口
  const exportMenu = document.getElementById('export-menu');
  document.getElementById('btn-export')?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu?.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (
      exportMenu?.classList.contains('show') &&
      !(e.target as HTMLElement).closest('#export-menu, #btn-export')
    ) {
      exportMenu.classList.remove('show');
    }
  });
  document.querySelectorAll('.xm-item').forEach((item) => {
    item.addEventListener('click', () => {
      handleExport(item.getAttribute('data-export'));
      exportMenu?.classList.remove('show');
    });
  });

  document.getElementById('btn-figure')?.addEventListener('click', enterFigureMode);

  document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  document.getElementById('btn-sweep')?.addEventListener('click', runSweep);
  document.getElementById('sweep-cancel')?.addEventListener('click', () => { sweepAbort = true; });

  // 对比视图
  document.getElementById('btn-compare')?.addEventListener('click', toggleCompare);
  document.getElementById('compare-close')?.addEventListener('click', () => {
    compareVisible = false;
    document.getElementById('compare-panel')!.style.display = 'none';
  });
  document.getElementById('compare-snap-a')?.addEventListener('click', () => captureSnapshot('A'));
  document.getElementById('compare-snap-b')?.addEventListener('click', () => captureSnapshot('B'));

  // 尺寸标注开关
  document.getElementById('btn-bbox')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-bbox');
    if (!bboxAnnotation) {
      bboxAnnotation = new BoundingBoxAnnotation(ctx.scene);
      if (baseGeo) bboxAnnotation.update(baseGeo, getState().cellSize);
      btn?.classList.add('on');
    } else {
      bboxAnnotation.dispose();
      bboxAnnotation = null;
      btn?.classList.remove('on');
    }
  });

  // 游标卡尺开关
  document.getElementById('btn-caliper')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-caliper');
    if (!caliperTool) {
      if (meshFill) {
        caliperTool = new CaliperTool(ctx.renderer, ctx.camera, ctx.scene, meshFill, getState().cellSize);
        caliperTool.enable();
        btn?.classList.add('on');
      }
    } else {
      caliperTool.dispose();
      caliperTool = null;
      btn?.classList.remove('on');
    }
  });

  // SVG 截面导出
  document.getElementById('btn-slice-svg')?.addEventListener('click', () => {
    if (!baseGeo) return;
    const s = getState();
    // 几何顶点存于 wc 空间（经 0.33 缩放后显示），clipPlane 为世界坐标，
    // 需将其换算到几何空间再求交，否则截面位置/方向与屏幕显示不符。
    const localPlane = ctx.clipPlane.clone();
    localPlane.constant /= DISPLAY_SCALE;
    const svg = exportSliceSVG(baseGeo, localPlane, {
      type: s.type,
      slice: s.slice,
      iso: lastIsoUsed,
    });
    if (!svg) {
      alert('当前截面无可视交线，请调整 Slice 滑块后再试。');
      return;
    }
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TPMS_${s.type}_slice_${s.slice}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 统计面板切换（CSS 依据 .stat-overlay.open 显示 .stat-full）
  document.getElementById('stat-toggle')?.addEventListener('click', () => {
    document.getElementById('statbox')?.classList.toggle('open');
  });

  // 窗口大小变化
  window.addEventListener('resize', () => {
    const container = document.getElementById('canvas-container')!;
    ctx.resize(container.clientWidth, container.clientHeight);
    requestRender(); // 按需渲染：视口变化重绘
  });

  // 空间梯度按钮
  // 【v4.0 阶段 I】逆向性能求解器
  let inverseReport: InverseReport | null = null;
  const invTargets = (): DesignTargets => {
    const eV = Number((document.getElementById('inv-e') as HTMLInputElement)?.value ?? 0);
    const kV = Number((document.getElementById('inv-k') as HTMLInputElement)?.value ?? 0);
    const pV = Number((document.getElementById('inv-p') as HTMLInputElement)?.value ?? 0);
    const t: DesignTargets = {};
    if (eV > 0) t.ETarget = eV / 10;
    if (kV > 0) t.kappaTarget = kV * 1e-8;
    if (pV > 0) t.porosityTarget = pV / 100;
    return t;
  };
  document.getElementById('inv-preset')?.addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value;
    const preset = INVERSE_PRESETS.find((ps) => ps.key === key);
    if (!preset) return;
    const set = (id: string, v: number) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = String(v);
      const val = document.getElementById(id + '-value');
      if (val) val.textContent = (id === 'inv-e' ? (v / 10).toFixed(1) : id === 'inv-p' ? String(Math.round(v)) : String(Math.round(v)));
    };
    set('inv-e', Math.round((preset.targets.ETarget ?? 0) * 10));
    set('inv-k', Math.round((preset.targets.kappaTarget ?? 0) * 1e8));
    set('inv-p', Math.round((preset.targets.porosityTarget ?? 0) * 100));
    flashToast(preset.description);
  });
  for (const [id, fmt, scale] of [['inv-e', (v: number) => (v / 10).toFixed(1), 0.1], ['inv-k', (v: number) => String(v), 1], ['inv-p', (v: number) => String(v), 1]] as const) {
    document.getElementById(id)?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      const val = document.getElementById(id + '-value');
      if (val) val.textContent = fmt(v);
      void scale;
      const sel = document.getElementById('inv-preset') as HTMLSelectElement | null;
      if (sel) sel.value = 'custom';
    });
  }
  document.getElementById('btn-inv-solve')?.addEventListener('click', () => {
    const targets = invTargets();
    if (!targets.ETarget && !targets.kappaTarget && !targets.porosityTarget) {
      flashToast('请至少设置一个目标指标（E*/κ/P）');
      return;
    }
    inverseReport = solveInverse(targets);
    const top = inverseReport.solutions.slice(0, 3);
    const el = document.getElementById('inverse-result');
    if (el) {
      el.textContent = top.map((so, i) =>
        `${i + 1}. ${so.type} P=${(so.params.porosity * 100).toFixed(0)}% 单元 ${so.params.cellSize.toFixed(1)}mm α=${so.params.anisotropy.toFixed(2)} → E*=${so.prediction.EGPa.toFixed(2)}GPa κ=${(so.prediction.kappaM2 * 1e8).toFixed(2)}e-8 m²（J=${so.objective.toExponential(1)}，${inverseReport!.elapsedMs.toFixed(1)}ms）`,
      ).join(' ｜ ');
    }
    flashToast(inverseReport.converged ? '反演收敛：目标指标全部命中（≤1e-3 相对残差）' : '反演完成：目标组合超出可行包络，已给出最优折中');
  });
  document.getElementById('btn-inv-apply')?.addEventListener('click', () => {
    if (!inverseReport) { flashToast('请先执行反演寻优'); return; }
    const best = inverseReport.solutions[0];
    pushHistory();
    setState({
      type: best.type,
      porosity: Math.round(best.params.porosity * 100),
      cellSize: Math.max(1, Math.min(5, Math.round(best.params.cellSize))),
    });
    syncUI(getState());
    scheduleRebuild(false);
    flashToast(`已应用最优解：${best.type}（P=${(best.params.porosity * 100).toFixed(0)}%）`);
  });

  // 【v4.0 阶段 V】CT 重构与制造偏差
  document.getElementById('btn-ct-demo')?.addEventListener('click', () => {
    const s = getState();
    if (!baseGeo || s.model === 'strut') { flashToast('请先生成有效曲面（线框模式无偏差语义）'); return; }
    try {
      const recon = generateDemoCT({ type: s.type, periods: s.cellSize, structureMode: s.structureMode === 'gradient_shell' ? 'shell' : s.structureMode, iso: lastIsoUsed, R: 64, widthMm: 10, biasMm: 0.25, roughness: 0.15 });
      const pos = baseGeo.attributes.position.array as Float32Array;
      const vc = baseGeo.attributes.position.count;
      const { deviations, stats } = sampleDeviation(recon, pos, vc);
      const colors = deviationColors(deviations, Math.max(0.05, Math.max(Math.abs(stats.maxPositive), Math.abs(stats.maxNegative), 0.05)));
      baseGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = getMaterial(s.material, s.model);
      mat.vertexColors = true;
      mat.needsUpdate = true;
      requestRender();
      const el = document.getElementById('ct-result');
      if (el) el.textContent = `偏差统计（vs 名义 ${s.type}）：过充 +${stats.maxPositive.toFixed(3)} mm ｜ 欠肉 ${stats.maxNegative.toFixed(3)} mm ｜ RMS ${stats.rms.toFixed(3)} mm ｜ 均值 ${stats.mean.toFixed(3)} mm（CT 64³，体素 ${(10 / 64).toFixed(2)} mm）`;
      flashToast('CT 偏差分析完成：过充红 / 欠肉蓝 / 贴合白');
    } catch (err) {
      flashToast('CT 分析失败：' + (err instanceof Error ? err.message : String(err)));
    }
  });
  document.getElementById('btn-ct-clear')?.addEventListener('click', () => {
    baseGeo?.deleteAttribute('color');
    const mat = getMaterial(getState().material, getState().model);
    mat.vertexColors = false;
    mat.needsUpdate = true;
    requestRender();
    flashToast('已清除偏差着色');
  });

  // 【v3.0 阶段 V】多级分形 TPMS：启用 + 微曲面 + 频率/幅值
  document.getElementById('hier-enabled')?.addEventListener('click', () => {
    const s = getState();
    setState({ hierarchical: { ...s.hierarchical, enabled: !s.hierarchical.enabled } });
    syncUI(getState());
    scheduleRebuild(false);
  });
  document.querySelectorAll('[data-hier-micro]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ hierarchical: { ...getState().hierarchical, microType: btn.getAttribute('data-hier-micro') as AppState['type'] } });
      syncUI(getState());
      scheduleRebuild(false);
    });
  });
  document.getElementById('hier-frequency')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    setState({ hierarchical: { ...getState().hierarchical, frequency: v } });
    const el = document.getElementById('hier-frequency-value');
    if (el) el.textContent = String(v);
    scheduleRebuild(true);
  });
  document.getElementById('hier-frequency')?.addEventListener('change', () => scheduleRebuild(false));
  document.getElementById('hier-amplitude')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    setState({ hierarchical: { ...getState().hierarchical, amplitude: v } });
    const el = document.getElementById('hier-amplitude-value');
    if (el) el.textContent = v.toFixed(2);
    scheduleRebuild(true);
  });
  document.getElementById('hier-amplitude')?.addEventListener('change', () => scheduleRebuild(false));

  // 【v3.0 阶段 IV】应力场引导：工况预设 + 壁厚耦合 + 各向异性
  document.querySelectorAll('[data-stress]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ stress: { ...getState().stress, preset: btn.getAttribute('data-stress') as AppState['stress']['preset'] } });
      syncUI(getState());
      scheduleRebuild(false);
    });
  });
  document.getElementById('stress-strength')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    setState({ stress: { ...getState().stress, strength: v } });
    const el = document.getElementById('stress-strength-value');
    if (el) el.textContent = v.toFixed(2);
    scheduleRebuild(true);
  });
  document.getElementById('stress-strength')?.addEventListener('change', () => scheduleRebuild(false));
  document.getElementById('stress-anisotropy')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    setState({ stress: { ...getState().stress, anisotropy: v } });
    const el = document.getElementById('stress-anisotropy-value');
    if (el) el.textContent = v.toFixed(2);
    scheduleRebuild(true);
  });
  document.getElementById('stress-anisotropy')?.addEventListener('change', () => scheduleRebuild(false));

  // 【v7.0 Stage I】隐式神经拓扑（SIREN）：启用 + 专家锚点 + 8 维潜在滑块
  document.getElementById('neural-enabled')?.addEventListener('click', () => {
    const s = getState();
    setState({ neural: { ...s.neural, enabled: !s.neural.enabled } });
    syncUI(getState());
    scheduleRebuild(false);
  });
  document.querySelectorAll('[data-neural-anchor]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-neural-anchor'));
      try {
        setState({ neural: { enabled: true, z: neuralAnchor(idx) } });
        flashToast(`神经拓扑锚点：${expertName(idx)}（潜在空间 ${expertCount()} 专家流形）`);
      } catch { /* 锚点越界不可能触达 */ }
      syncUI(getState());
      scheduleRebuild(false);
    });
  });
  for (let zi = 0; zi < 8; zi++) {
    const el = document.getElementById(`neural-z-${zi}`) as HTMLInputElement | null;
    if (!el) continue;
    el.addEventListener('input', () => {
      const s = getState();
      const z = [...s.neural.z];
      z[zi] = Number(el.value);
      setState({ neural: { ...s.neural, z } });
      const vEl = document.getElementById(`neural-z-${zi}-value`);
      if (vEl) vEl.textContent = Number(el.value).toFixed(1);
      updateNeuralStatus();
      scheduleRebuild(true);
    });
    el.addEventListener('change', () => scheduleRebuild(false));
  }

  document.querySelectorAll('[data-gradient]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ gradientDir: btn.getAttribute('data-gradient') as AppState['gradientDir'] });
      syncUI(getState()); // 存量缺陷修复：本仓库 setState 不刷 UI，处理器负责同步高亮
      scheduleRebuild(false);
    });
  });

  // 着色模式按钮（智能禁用：场口径需混合或梯度双壳在场，非法点击 toast 引导）
  document.querySelectorAll('[data-coloring]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-coloring') as AppState['coloring'];
      if (mode === 'field' && !fieldAvailable(getState())) {
        flashToast('场权重着色需先开启「异构混合」或切换到「梯度双壳」');
        return;
      }
      setState({ coloring: mode });
      syncUI(getState()); // 本仓库惯例：setState 不自动刷 UI，处理器负责同步高亮
      scheduleRebuild(false);
    });
  });

  // 异构混合启用（智能着色联动：开启推荐 Field Map，关闭时若因混合而开的 Field Map 回退单色）
  // 【阶段 IV】非欧度规空间映射接线
  const MANIFOLD_LABEL: Record<string, string> = {
    identity: '无（平面周期）', cylinder: '圆柱弯曲', torus: '环面闭合', hyperbolic: '双曲径向', metric: '应力线各向异性', poincare: '庞加莱双曲度规',
  };
  const manifoldSel = document.getElementById('manifold-kind') as HTMLSelectElement | null;
  if (manifoldSel) {
    for (const [k, v] of Object.entries(MANIFOLD_LABEL)) {
      const o = document.createElement('option');
      o.value = k; o.textContent = v;
      manifoldSel.appendChild(o);
    }
    manifoldSel.addEventListener('change', () => {
      const st = getState();
      setState({ manifold: { ...st.manifold, kind: manifoldSel.value as AppState['manifold']['kind'] } });
      syncUI(getState());
      scheduleRebuild(false);
    });
  }
  const manifoldRadius = document.getElementById('manifold-radius') as HTMLInputElement | null;
  if (manifoldRadius) {
    manifoldRadius.addEventListener('input', () => {
      const st = getState();
      setState({ manifold: { ...st.manifold, radius: +manifoldRadius.value } });
      const mv = document.getElementById('manifold-radius-value');
      if (mv) mv.textContent = (+manifoldRadius.value).toFixed(1);
      scheduleRebuild(true);
    });
    manifoldRadius.addEventListener('change', () => scheduleRebuild(false));
  }

  const hybridEnabled = document.getElementById('hybrid-enabled') as HTMLInputElement;
  if (hybridEnabled) {
    hybridEnabled.addEventListener('change', () => {
      const turningOn = hybridEnabled.checked;
      setState({ hybrid: { ...getState().hybrid, enabled: turningOn } });
      document.getElementById('hybrid-options')!.style.display = turningOn ? 'block' : 'none';
      document.getElementById('hybrid-blend')!.style.display = turningOn ? 'block' : 'none';
      // 着色联动：开→若纯色则推荐场权重；关→若场权重则回单色（显式 setState + syncUI，非静默）
      const s0 = getState();
      if (turningOn && s0.coloring === 'none') {
        setState({ coloring: 'field' });
        flashToast('已切换为「场权重」着色，直观呈现空间过渡带');
      } else if (!turningOn && s0.coloring === 'field') {
        setState({ coloring: 'none' });
      }
      syncUI(getState());
      scheduleRebuild(false);
    });
  }

  // 混合轴向按钮（x/y/z/radial）
  document.querySelectorAll('[data-hybrid-axis]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ hybrid: { ...getState().hybrid, axis: btn.getAttribute('data-hybrid-axis') as AppState['hybrid']['axis'] } });
      syncUI(getState());
      scheduleRebuild(false);
    });
  });

  // 过渡中心 / 宽度滑块（拖动 preview，松手 HD）
  const centerEl = document.getElementById('hybrid-center') as HTMLInputElement;
  if (centerEl) {
    centerEl.addEventListener('input', () => {
      setState({ hybrid: { ...getState().hybrid, blendCenter: +centerEl.value } });
      const v = document.getElementById('hybrid-center-value');
      if (v) v.textContent = (+centerEl.value).toFixed(2);
      scheduleRebuild(true);
    });
    centerEl.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
  }
  const widthEl = document.getElementById('hybrid-width') as HTMLInputElement;
  if (widthEl) {
    widthEl.addEventListener('input', () => {
      setState({ hybrid: { ...getState().hybrid, blendWidth: +widthEl.value } });
      const v = document.getElementById('hybrid-width-value');
      if (v) v.textContent = (+widthEl.value).toFixed(2);
      scheduleRebuild(true);
    });
    widthEl.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
  }

  // 异构混合类型 B
  document.querySelectorAll('[data-hybrid-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ hybrid: { ...getState().hybrid, typeB: btn.getAttribute('data-hybrid-type') as AppState['hybrid']['typeB'] } });
      scheduleRebuild(false);
    });
  });

  // 混合函数
  document.querySelectorAll('[data-blend]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ hybrid: { ...getState().hybrid, blendFunction: btn.getAttribute('data-blend') as AppState['hybrid']['blendFunction'] } });
      scheduleRebuild(false);
    });
  });

  // 自定义隐函数启用
  const customEnabled = document.getElementById('custom-enabled') as HTMLInputElement;
  if (customEnabled) {
    customEnabled.addEventListener('change', () => {
      const field = document.getElementById('custom-formula-field')!;
      field.style.display = customEnabled.checked ? 'block' : 'none';
      let hasFormula = false;
      if (customEnabled.checked) {
        setState({ type: 'custom' });
        // 公式为空时不立即重建（worker 会因缺公式报错），等公式输入事件触发
        const cf = document.getElementById('custom-formula') as HTMLTextAreaElement | null;
        hasFormula = !!cf && cf.value.trim().length > 0;
      } else {
        setState({ type: 'gyroid', customFormula: '' });
      }
      // custom 无权重项（隐藏权重面板），恢复时切回 gyroid 重建权重行；同步类型按钮 active
      syncUI(getState());
      updateBadges(getState().type, getState().model, getState().material, getState().structureMode);
      if (!customEnabled.checked || hasFormula) scheduleRebuild(false);
    });
  }

  // ── 各向异性模量曲面（RVE 均质化，τ-调制方向张量 → E(n) 球面热力图）──
  const rveBtn = document.getElementById('btn-rve');
  if (rveBtn) {
    rveBtn.addEventListener('click', () => {
      const st = getState();
      const canvas = document.getElementById('rve-canvas') as HTMLCanvasElement | null;
      const readout = document.getElementById('rve-readout');
      if (!canvas || !readout) return;
      try {
        const st2 = estimateAnisotropicStiffness(1 - st.porosity / 100, st.type);
        const E = st2.E;
        const nu = 0.3;
        // 6×6 S：正交各向异性 E_i + 统一 ν（近似耦合；S_ij = −ν_ij/E_j 形式的对角缩放）
        const S = orthotropicCompliance(E[0], E[1], E[2], nu);
        const grid = sampleDirectionalGrid(S, 36, 72);
        // Cool-Warm 热力图
        const ctx = canvas.getContext('2d')!;
        const W = canvas.width, H = canvas.height;
        const img = ctx.createImageData(W, H);
        for (let py = 0; py < H; py++) {
          const ir = Math.min(grid.rows, Math.floor((py / H) * (grid.rows + 1)));
          for (let px2 = 0; px2 < W; px2++) {
            const ic = Math.min(grid.cols - 1, Math.floor((px2 / W) * grid.cols));
            const v = grid.E[ir * grid.cols + ic];
            const t = grid.emax > grid.emin ? (v - grid.emin) / (grid.emax - grid.emin) : 0.5;
            // 蓝→白→红
            const r8 = t < 0.5 ? 60 + 195 * (t * 2) : 255;
            const g8 = t < 0.5 ? 80 + 155 * (t * 2) : 250 - 155 * (t - 0.5) * 2;
            const b8 = t < 0.5 ? 220 : 250 - 220 * (t - 0.5) * 2;
            const o = (py * W + px2) * 4;
            img.data[o] = r8; img.data[o + 1] = g8; img.data[o + 2] = b8; img.data[o + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        canvas.style.display = 'block';
        const baseE = BASE_MODULUS[st.material === 'auto' ? 'tc4' : st.material] || BASE_MODULUS.tc4;
        readout.textContent = `E(x/y/z) = ${E.map((e) => (e * baseE).toFixed(2)).join(' / ')} GPa · E(n)∈[${(grid.emin * baseE).toFixed(2)}, ${(grid.emax * baseE).toFixed(2)}] GPa · E(100)=${(directionalModulus(S, 1, 0, 0) * baseE).toFixed(2)} GPa`;
      } catch (err) {
        readout.textContent = '计算失败：' + (err instanceof Error ? err.message : String(err));
      }
    });
  }

  // 自定义公式输入 + 沙箱实时校验（阶段 I：错误定位高亮 + 预设样例库）
  const customFormula = document.getElementById('custom-formula') as HTMLTextAreaElement;
  const customStatus = document.getElementById('custom-formula-status');
  if (customFormula) {
    /** 校验当前输入并刷新状态条；返回是否可重建（空/非法 → false） */
    const updateCustomStatus = (): boolean => {
      if (!customStatus) return true;
      const raw = customFormula.value.trim();
      if (!raw) { customStatus.hidden = true; customStatus.className = 'custom-status'; return false; }
      const res = validateEquation(raw);
      customStatus.hidden = false;
      if (res.ok) {
        const used: string[] = [];
        if (res.usage.coord) used.push('r/theta/phi');
        if (res.usage.k) used.push('k');
        if (res.usage.t) used.push('t');
        if (res.usage.iso) used.push('iso');
        customStatus.className = 'custom-status ok';
        customStatus.textContent = `✓ 语法有效${used.length ? ` · 引用参数：${used.join(' / ')}` : ''}`;
        return true;
      }
      customStatus.className = 'custom-status err';
      customStatus.textContent = `✗ 位置 ${res.pos}：${res.message}`;
      return false;
    };
    customFormula.addEventListener('input', () => {
      const valid = updateCustomStatus();
      setState({ customFormula: customFormula.value.trim() });
      // 非法/空公式不触发重建（保留旧模型 + 错误提示），与启用开关的 hasFormula 守卫一致
      if (valid) scheduleRebuild(true);
      document.querySelectorAll('#custom-presets .chip').forEach((c) => c.classList.toggle('active', (c as HTMLElement).dataset.expr === customFormula.value.trim()));
    });
    customFormula.addEventListener('change', () => { if (updateCustomStatus()) scheduleRebuild(false); });

    // 预设样例芯片（点击回填 → 校验 → 重建）
    const presetRow = document.getElementById('custom-presets');
    if (presetRow) {
      for (const p of EQUATION_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = p.name;
        b.title = `${p.desc}\n${p.expr}`;
        b.dataset.expr = p.expr;
        b.addEventListener('click', () => {
          customFormula.value = p.expr;
          setState({ customFormula: p.expr });
          if (updateCustomStatus()) scheduleRebuild(false);
          presetRow.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
        });
        presetRow.appendChild(b);
      }
    }
  }

  // ── 键盘快捷键 ─────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // 忽略输入框内的按键
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // 新手引导打开时不响应快捷键（Esc/方向键由引导自身处理）
    if (document.getElementById('ob-card')?.classList.contains('show')) return;

    // Ctrl+Z 撤销（重建跳过 pushHistory，保住 redo 分支）
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const prev = undo();
      if (prev) { syncUI(prev); updateBadges(prev.type, prev.model, prev.material, prev.structureMode); updateStructureDesc(prev.structureMode); scheduleRebuild(false, true); flashToast('已撤销'); }
      return;
    }
    // Ctrl+Shift+Z / Ctrl+Y 重做
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      const next = redo();
      if (next) { syncUI(next); updateBadges(next.type, next.model, next.material, next.structureMode); updateStructureDesc(next.structureMode); scheduleRebuild(false, true); flashToast('已重做'); }
      return;
    }

    // 1-8 切换曲面类型
    const types: AppState['type'][] = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
    if (e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key) - 1;
      if (types[idx]) {
        setState({ type: types[idx] });
        const s = getState();
        syncUI(s);
        updateBadges(s.type, s.model, s.material, s.structureMode);
        scheduleRebuild(false);
        flashToast(`已切换至 ${types[idx].toUpperCase()}`);
      }
      return;
    }

    // R 切换自动旋转
    if (e.key.toLowerCase() === 'r') {
      const s = getState();
      setState({ autoRotate: !s.autoRotate });
      ctx.controls.autoRotate = !s.autoRotate;
      document.getElementById('btn-rotate')?.classList.toggle('on', !s.autoRotate);
      flashToast(s.autoRotate ? '已停止旋转' : '已开启旋转');
      return;
    }

    // V 复位视角
    if (e.key.toLowerCase() === 'v') {
      ctx.camera.position.set(2.6, 1.4, 4.2);
      ctx.controls.target.set(0, 0, 0);
      ctx.controls.update();
      flashToast('视角已复位');
      return;
    }

    // S 保存截图
    if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('btn-snap')?.click();
      flashToast('已保存截图');
      return;
    }

    // E 导出 STL
    if (e.key.toLowerCase() === 'e') {
      document.getElementById('btn-stl')?.click();
      return;
    }

    // C 切换卡尺工具
    if (e.key.toLowerCase() === 'c') {
      document.getElementById('btn-caliper')?.click();
      return;
    }

    // 数字 9：循环切换材料（1-8 已被 8 类曲面切换占用）
    if (e.key === '9') {
      const mats: AppState['material'][] = ['auto', 'tc4', 'polymer', 'thermal'];
      const next = mats[(mats.indexOf(getState().material) + 1) % mats.length];
      setState({ material: next });
      syncUI(getState());
      scheduleRebuild(false);
      flashToast(MATERIAL_LABEL[next]);
      return;
    }

    // Shift+1/2：快速切换容器形状
    if (e.key === '!') { setState({ containerShape: 'cube' }); syncUI(getState()); scheduleRebuild(false); flashToast('立方体容器'); return; }
    if (e.key === '@') { setState({ containerShape: 'cylinder' }); syncUI(getState()); scheduleRebuild(false); flashToast('圆柱体容器'); return; }

    // F 键：全屏切换
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      return;
    }

    // P 键：快速截图
    if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      takeScreenshot();
      flashToast('已截图');
      return;
    }

    // ? 键：快捷键帮助
    if (e.key === '?') {
      flashToast('1-8 曲面 | 9 材料 | Shift+1/2 容器 | F 全屏 | P 截图 | Ctrl+Z 撤销 | R 旋转 | V 复位视角 | E 导出 STL');
      return;
    }

    // 空格 自动旋转
    if (e.code === 'Space') {
      e.preventDefault();
      const s = getState();
      setState({ autoRotate: !s.autoRotate });
      ctx.controls.autoRotate = !s.autoRotate;
      document.getElementById('btn-rotate')?.classList.toggle('on', !s.autoRotate);
      return;
    }
  });
}

/** 检查孔隙率极值并弹出警告 */
function checkPorosityWarning(porosity: number): void {
  if (porosity < 30) {
    flashToast('警告：孔隙率 <30% 可能导致营养传输受限，不利于骨组织长入');
  } else if (porosity > 95) {
    flashToast('警告：孔隙率 >95% 结构极脆弱，机械强度可能不足');
  }
}

/** 简洁的浮动提示 */
let toastTimer: number | undefined;
function flashToast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1500);
}

/** 对比视图：捕获当前 3D 场景快照 */
let compareVisible = false;

function toggleCompare(): void {
  const panel = document.getElementById('compare-panel')!;
  compareVisible = !compareVisible;
  panel.style.display = compareVisible ? 'block' : 'none';
}

function captureSnapshot(side: 'A' | 'B'): void {
  // 显式定位渲染 canvas（依赖文档序的第一个 canvas 会因 loader/对比面板的 DOM 变化而脆弱）
  const canvas = document.querySelector('#canvas-container canvas') as HTMLCanvasElement;
  const dataUrl = canvas.toDataURL('image/png');
  const targetCanvas = document.getElementById(side === 'A' ? 'compare-canvas-a' : 'compare-canvas-b') as HTMLCanvasElement;
  const ctx2d = targetCanvas.getContext('2d')!;
  const img = new Image();
  img.onload = () => {
    targetCanvas.width = img.width;
    targetCanvas.height = img.height;
    ctx2d.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
  flashToast(`已捕获 ${side} 侧快照`);
}

/** 快速截图函数 */
function takeScreenshot(): void {
  ctx.composer.render();
  const a = document.createElement('a');
  a.href = ctx.renderer.domElement.toDataURL('image/png');
  a.download = `tpms-${getState().type}-p${getState().porosity}-${Date.now()}.png`;
  a.click();
}

// ── UI 同步 ─────────────────────────────────────────────
function syncUI(s: AppState): void {
  const setVal = (id: string, val: number) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) el.value = String(val);
  };
  setVal('porosity', s.porosity);
  setVal('cell-size', s.cellSize);
  setVal('thickness', s.thickness);
  setVal('slice', s.slice);

  // 同步标签文本
  const pv = document.getElementById('porosity-value');
  if (pv) pv.textContent = `${s.porosity}%`;
  const cv = document.getElementById('cell-size-value');
  if (cv) cv.textContent = ['极低', '低', '中等', '高', '极高'][s.cellSize - 1];
  const tv = document.getElementById('thickness-value');
  if (tv) tv.textContent = s.thickness.toFixed(1);
  const sv = document.getElementById('slice-value');
  if (sv) sv.textContent = s.slice >= 99 ? '完整' : `${Math.round((s.slice + 100) / 2)}%`;
  // 加载端板滑块（URL 恢复/undo/预设后必然经过 syncUI）
  const epElSync = document.getElementById('endplate') as HTMLInputElement | null;
  if (epElSync) {
    epElSync.value = String(s.endplateMm);
    const ev2 = document.getElementById('endplate-value');
    if (ev2) ev2.textContent = s.endplateMm <= 0 ? '关' : `${s.endplateMm.toFixed(1)} mm`;
  }
  // 剖切轴向/反向按钮态
  document.querySelectorAll('[data-slice-axis]').forEach(el => {
    const ax = el.getAttribute('data-slice-axis');
    el.classList.toggle('active', ax === 'invert' ? !!s.sliceInvert : s.sliceAxis === ax);
  });

  // 自动旋转按钮
  document.getElementById('btn-rotate')?.classList.toggle('on', s.autoRotate);

  // 混合启用复选框
  const he = document.getElementById('hybrid-enabled') as HTMLInputElement | null;
  if (he) he.checked = s.hybrid.enabled;

  // WebGPU 加速开关态（v3.0 阶段 I）
  document.getElementById('btn-gpu')?.classList.toggle('on', s.gpuAccelerate);

  // 自定义公式文本框（仅 custom 模式回填，避免覆盖用户正在输入）
  const cf = document.getElementById('custom-formula') as HTMLTextAreaElement | null;
  if (cf && s.type === 'custom') cf.value = s.customFormula;

  // Active 状态（基础分组）
  document.querySelectorAll('[data-type], [data-model], [data-structure], [data-container], [data-material]').forEach(el => {
    const key = el.getAttribute('data-type') || el.getAttribute('data-model') || el.getAttribute('data-structure') || el.getAttribute('data-container') || el.getAttribute('data-material');
    const prop = el.hasAttribute('data-type') ? 'type' : el.hasAttribute('data-model') ? 'model' : el.hasAttribute('data-structure') ? 'structureMode' : el.hasAttribute('data-container') ? 'containerShape' : 'material';
    el.classList.toggle('active', (s as any)[prop] === key);
  });

  // Active 状态（梯度 / 混合类型 / 混合函数）
  document.querySelectorAll('[data-gradient]').forEach(el => {
    el.classList.toggle('active', (s as any).gradientDir === el.getAttribute('data-gradient'));
  });
  // 【v3.0 阶段 V】多级分形 UI 同步
  {
    const he = document.getElementById('hier-enabled');
    if (he) he.classList.toggle('on', s.hierarchical.enabled);
    document.querySelectorAll('[data-hier-micro]').forEach(el => {
      el.classList.toggle('active', (s as any).hierarchical.microType === el.getAttribute('data-hier-micro'));
    });
    const hf = document.getElementById('hier-frequency') as HTMLInputElement | null;
    if (hf) hf.value = String((s as any).hierarchical.frequency);
    const hfv = document.getElementById('hier-frequency-value');
    if (hfv) hfv.textContent = String((s as any).hierarchical.frequency);
    const ha = document.getElementById('hier-amplitude') as HTMLInputElement | null;
    if (ha) ha.value = String((s as any).hierarchical.amplitude);
    const hav = document.getElementById('hier-amplitude-value');
    if (hav) hav.textContent = (s as any).hierarchical.amplitude.toFixed(2);
    const hs = document.getElementById('hier-stats');
    if (hs && !s.hierarchical.enabled) hs.textContent = '';
    if (s.hierarchical.enabled) scheduleHierarchicalStats();
  }
  // 【v3.0 阶段 IV】应力引导 UI 同步
  document.querySelectorAll('[data-stress]').forEach(el => {
    el.classList.toggle('active', (s as any).stress.preset === el.getAttribute('data-stress'));
  });
  // 【v7.0 Stage I】神经拓扑 UI 同步
  {
    const ne = document.getElementById('neural-enabled');
    if (ne) ne.classList.toggle('on', s.neural.enabled);
    const no = document.getElementById('neural-options');
    if (no) no.style.display = s.neural.enabled ? 'block' : 'none';
    for (let zi = 0; zi < 8; zi++) {
      const el = document.getElementById(`neural-z-${zi}`) as HTMLInputElement | null;
      if (el) el.value = String(s.neural.z[zi] ?? 3);
      const vEl = document.getElementById(`neural-z-${zi}-value`);
      if (vEl) vEl.textContent = (s.neural.z[zi] ?? 3).toFixed(1);
    }
    updateNeuralStatus();
  }
  {
    const ss = document.getElementById('stress-strength') as HTMLInputElement | null;
    if (ss) ss.value = String((s as any).stress.strength);
    const ssv = document.getElementById('stress-strength-value');
    if (ssv) ssv.textContent = (s as any).stress.strength.toFixed(2);
    const sa = document.getElementById('stress-anisotropy') as HTMLInputElement | null;
    if (sa) sa.value = String((s as any).stress.anisotropy);
    const sav = document.getElementById('stress-anisotropy-value');
    if (sav) sav.textContent = (s as any).stress.anisotropy.toFixed(2);
  }
  document.querySelectorAll('[data-hybrid-type]').forEach(el => {
    el.classList.toggle('active', (s as any).hybrid.typeB === el.getAttribute('data-hybrid-type'));
  });
  document.querySelectorAll('[data-blend]').forEach(el => {
    el.classList.toggle('active', (s as any).hybrid.blendFunction === el.getAttribute('data-blend'));
  });

  // 混合轴向按钮态 + 中心/宽度滑块值同步（URL 恢复/undo 后经 syncUI）
  document.querySelectorAll('[data-hybrid-axis]').forEach(el => {
    el.classList.toggle('active', (s as any).hybrid.axis === el.getAttribute('data-hybrid-axis'));
  });
  const hybridSubOn = (s as any).hybrid.enabled;
  document.getElementById('hybrid-options')!.style.display = hybridSubOn ? 'block' : 'none';
  document.getElementById('hybrid-blend')!.style.display = hybridSubOn ? 'block' : 'none';
  const hc = document.getElementById('hybrid-center') as HTMLInputElement | null;
  if (hc) {
    hc.value = String((s as any).hybrid.blendCenter);
    const hv = document.getElementById('hybrid-center-value');
    if (hv) hv.textContent = (s as any).hybrid.blendCenter.toFixed(2);
  }
  const hw = document.getElementById('hybrid-width') as HTMLInputElement | null;
  if (hw) {
    hw.value = String((s as any).hybrid.blendWidth);
    const hv = document.getElementById('hybrid-width-value');
    if (hv) hv.textContent = (s as any).hybrid.blendWidth.toFixed(2);
  }

  // 【阶段 IV】空间映射同步
  const msel = document.getElementById('manifold-kind') as HTMLSelectElement | null;
  if (msel) msel.value = s.manifold.kind;
  const mr = document.getElementById('manifold-radius') as HTMLInputElement | null;
  if (mr) { mr.value = String(s.manifold.radius); const mv = document.getElementById('manifold-radius-value'); if (mv) mv.textContent = s.manifold.radius.toFixed(1); }

  // 着色模式：高亮 + 场口径非法时置灰禁用（状态里残留的非法 'field' 由
  // effectiveColoring 在重建参数处优雅回退，这里只负责视觉一致）
  document.querySelectorAll('[data-coloring]').forEach(el => {
    const mode = el.getAttribute('data-coloring');
    el.classList.toggle('active', (s as any).coloring === mode);
    if (mode === 'field') (el as HTMLButtonElement).disabled = !fieldAvailable(s);
  });

  // 权重滑块行按当前曲面类型整体重建（类型/预设/undo/URL 恢复后必然经过 syncUI）
  refreshWeightsUI();
}

/** 重建公式权重滑块并接线（拖动预览 / 松手正式重建） */
function refreshWeightsUI(): void {
  const s = getState();
  refreshWeightUI(
    s.type,
    [...s.weights],
    (idx, val) => {
      const w = [...getState().weights] as [number, number, number, number];
      w[idx] = val;
      setState({ weights: w });
      scheduleRebuild(true);
    },
    () => {
      scheduleRebuild(false);
      scheduleHdUpgrade();
    },
  );
}

// ── 参数扫描 ─────────────────────────────────────────────
/** 参数扫描：自动生成一系列孔隙率的截图 */
let sweepAbort = false;

async function runSweep(): Promise<void> {
  const s = getState();
  const overlay = document.getElementById('sweep-overlay')!;
  const bar = document.getElementById('sweep-bar')!;
  const status = document.getElementById('sweep-status')!;
  const preview = document.getElementById('sweep-preview')!;

  overlay.style.display = 'flex';
  preview.innerHTML = '';
  bar.style.width = '0%';
  sweepAbort = false;

  const startPorosity = 50;
  const endPorosity = 90;
  const step = 5;
  const frames: string[] = [];
  const configs: unknown[] = [];

  for (let p = startPorosity; p <= endPorosity && !sweepAbort; p += step) {
    const progress = ((p - startPorosity) / (endPorosity - startPorosity)) * 100;
    bar.style.width = `${progress}%`;
    status.textContent = `孔隙率 ${p}% (${Math.round(progress)}%)`;

    // 更新状态并重建（直接调 rebuild 绕过 150ms 防抖；LRU 命中时无 worker 结果，不可等待）
    setState({ porosity: p });
    syncUI(getState());
    if (rebuildTimer) clearTimeout(rebuildTimer);
    const fromCache = rebuild(false);
    if (!fromCache) {
      await new Promise<void>(resolve => {
        const handler = () => { resolve(); bridge.removeResultListener(handler); };
        bridge.addResultListener(handler);
      });
    }

    // 延迟一帧确保渲染完成
    await new Promise(r => setTimeout(r, 200));

    // 截取 canvas
    ctx.composer.render();
    const canvas = ctx.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');
    frames.push(dataUrl);

    // 生成参数配置（收集到数组，循环结束后合并为单个 JSON 下载，
    // 避免逐帧连发自动下载触发浏览器多文件下载拦截）
    const config = {
      frame: (p - startPorosity) / step,
      porosity: p,
      totalFrames: Math.floor((endPorosity - startPorosity) / step) + 1,
      parameters: {
        type: s.type,
        cellSize: s.cellSize,
        thickness: s.thickness,
        weights: s.weights,
        structureMode: s.structureMode,
        containerShape: s.containerShape,
        material: s.material,
        gradientDir: s.gradientDir,
      },
      generatedAt: new Date().toISOString(),
      platform: 'TPMS Explorer v2.0',
    };
    configs.push(config);

    // 添加缩略图
    const img = document.createElement('img');
    img.src = dataUrl;
    preview.appendChild(img);
  }

  if (!sweepAbort) {
    status.textContent = '扫描完成，正在下载...';
    bar.style.width = '100%';

    // 逐帧下载 PNG（250ms 间隔，降低浏览器连发下载拦截概率）
    for (let i = 0; i < frames.length; i++) {
      const a = document.createElement('a');
      a.href = frames[i];
      a.download = `tpms_sweep_p${startPorosity + i * step}%.png`;
      a.click();
      await new Promise(r => setTimeout(r, 250));
    }

    // 全部帧参数合并为单个 JSON
    const configBlob = new Blob([JSON.stringify(configs, null, 2)], { type: 'application/json' });
    const configA = document.createElement('a');
    configA.href = URL.createObjectURL(configBlob);
    configA.download = 'tpms_sweep_configs.json';
    configA.click();

    // 导出汇总 CSV
    let csv = 'frame,porosity,type,cellSize,thickness,structureMode,container,material\n';
    for (let i = 0; i < frames.length; i++) {
      const p = startPorosity + i * step;
      csv += `${i},${p},${s.type},${s.cellSize},${s.thickness},${s.structureMode},${s.containerShape},${s.material}\n`;
    }
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    const csvA = document.createElement('a');
    csvA.href = URL.createObjectURL(csvBlob);
    csvA.download = 'tpms_sweep_summary.csv';
    csvA.click();

    status.textContent = `已完成！共 ${frames.length} 帧`;
    setTimeout(() => { overlay.style.display = 'none'; }, 2000);
  } else {
    status.textContent = '已取消';
    setTimeout(() => { overlay.style.display = 'none'; }, 1000);
  }

  // 恢复原始孔隙率（程序行为，不进 undo 历史）
  setState({ porosity: s.porosity });
  syncUI(getState());
  scheduleRebuild(false, true);
}

// ── 论文配图模式 ─────────────────────────────────────────────
function enterFigureMode(): void {
  const s = getState();
  const saved = {
    autoRotate: ctx.controls.autoRotate,
    camPos: ctx.camera.position.clone(),
    target: ctx.controls.target.clone(),
    fov: ctx.camera.fov,
    pixelRatio: ctx.renderer.getPixelRatio(),
    cssW: ctx.renderer.domElement.clientWidth,
    cssH: ctx.renderer.domElement.clientHeight,
  };
  // 论文配图 2x 提分（对齐单文件版）：半屏窗口下普通 DPR 导出的 PNG 达不到期刊 300dpi 要求
  ctx.renderer.setPixelRatio(Math.min(saved.pixelRatio * 2, 3));
  ctx.renderer.setSize(saved.cssW, saved.cssH, false);
  ctx.composer.setSize(saved.cssW, saved.cssH);

  // 隐藏 UI
  document.body.classList.add('figure-mode');
  ctx.controls.autoRotate = false;
  ctx.camera.position.set(0.3, 4.5, 0.3);
  ctx.controls.target.set(0, 0, 0);
  ctx.camera.fov = 32;
  ctx.camera.updateProjectionMatrix();
  ctx.controls.update();

  // 显示水印
  const wm = document.getElementById('figure-watermark');
  if (wm) {
    wm.innerHTML = `TPMS Explorer · <b>${s.type}</b> · target ${s.porosity}% · ${s.structureMode}`;
    wm.classList.add('show');
  }

  setTimeout(() => {
    ctx.composer.render();
    // 导出 PNG
    const a = document.createElement('a');
    a.href = ctx.renderer.domElement.toDataURL('image/png');
    a.download = `tpms-figure-${s.type}-p${s.porosity}-c${s.cellSize}-${Date.now()}.png`;
    a.click();

    // 导出 JSON sidecar
    const pos = baseGeo?.attributes.position?.array as Float32Array | undefined;
    const meshHash = pos ? hashArray(pos) : 'nogeo';
    const json = generateJSONSidecar(s, lastPhysicsMetrics, meshHash, { resolution: lastBuildResolution, isoUsed: lastIsoUsed });
    const ja = document.createElement('a');
    ja.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    ja.download = `tpms-figure-${s.type}-p${s.porosity}-${Date.now()}.json`;
    ja.click();

    // 恢复
    setTimeout(() => {
      document.body.classList.remove('figure-mode');
      wm?.classList.remove('show');
      ctx.controls.autoRotate = saved.autoRotate;
      ctx.camera.position.copy(saved.camPos);
      ctx.controls.target.copy(saved.target);
      ctx.camera.fov = saved.fov;
      ctx.camera.updateProjectionMatrix();
      ctx.controls.update();
      ctx.renderer.setPixelRatio(saved.pixelRatio);
      ctx.renderer.setSize(saved.cssW, saved.cssH, false);
      ctx.composer.setSize(saved.cssW, saved.cssH);
    }, 300);
  }, 400);
}

// ── 导出中心 ─────────────────────────────────────────────
/** 统一导出分发：根据格式调用对应导出器 */
function handleExport(fmt: string | null): void {
  if (!fmt) return;
  const s = getState();
  const base = `tpms-${s.type}-p${s.porosity}-${s.structureMode}`;
  const needGeo = fmt === 'stl' || fmt === 'vtk' || fmt === 'cfdstl' || fmt === 'glb' || fmt === '3mf';
  if (needGeo && (!baseGeo || !baseGeo.index)) {
    flashToast('请先生成有效曲面再导出');
    return;
  }
  if (needGeo) {
    // 拖动滑块后 0~350ms 内 HD 升级尚未完成，此时导出会拿到 preview(R=28) 网格——
    // 同步在主线程重建高清（一次性几百 ms），保证导出物与屏幕最终形态一致
    const hdR = hdResolution(s.type, s.structureMode, s.gradientDir, s.cellSize);
    if (lastBuildResolution < hdR) {
      const res = buildSurface({
        type: s.type, iso: baseIso(s), periods: s.cellSize, resolution: hdR,
        targetPorosity: s.porosity / 100, weights: s.weights, structureMode: s.structureMode,
        containerShape: s.containerShape, thickness: s.thickness, gradientDir: s.gradientDir,
        hybrid: s.hybrid, customFormula: s.customFormula, preview: false,
        endplateMm: s.endplateMm,
      });
      if (res.type === 'result' && res.vertCount > 0) {
        applyGeometry(res.positions!, res.normals!, res.indices!, res.vertCount, res.triCount, res.colors ?? null);
        lastBuildResolution = hdR;
        if (res.isoUsed != null) lastIsoUsed = res.isoUsed;
        // 与 onWorkerResult 对齐：指标/缓存也同步更新，否则紧随的 JSON/bib 导出拿到
        // R=28 陈旧 metrics（svRatio 偏差实测 +15%），sidecar 自相矛盾
        lastPorosityEstimate = res.porosityEstimate;
  lastMeshSolidFraction = res.meshSolidFraction ?? null;
  // 红队 V-3a：混叠公式（如 sin(x*40)…）的非流形边占比可达 7%——采样定理警示
  {
    const nmRatio = res.nmEdgeCount != null && res.triCount > 0 ? res.nmEdgeCount / (res.triCount * 3) : 0;
    if (nmRatio > 0.02 && !nmWarned) {
      nmWarned = true;
      flashToast('提示：公式变化太快，超出网格采样能力，导出质量会下降。建议降低公式里的频率（如 x*40 改成 x*20），或提高分辨率');
    } else if (nmRatio <= 0.02) {
      nmWarned = false;
    }
  }
        if (res.surfaceArea != null && res.envelopeVolume != null) {
          lastPhysicsMetrics = computePhysicsMetrics(
            getState().type, res.porosityEstimate, res.surfaceArea, res.envelopeVolume,
            getState().material, getState().structureMode
          );
        }
        geoCache.set(cacheKey(getState(), hdR), {
          positions: new Float32Array(res.positions!),
          normals: new Float32Array(res.normals!),
          indices: new Uint32Array(res.indices!),
          vertCount: res.vertCount,
          faceCount: res.triCount,
        });
        requestRender();
      }
    }
  }
  try {
    switch (fmt) {
      case 'stl': {
        // 与 btn-stl 工具栏入口共用同一 mm 缩放（wc 域 ±π → cellSize mm），两入口产物必须一致
        const stlNormals = baseGeo!.attributes.normal?.array as Float32Array | undefined;
        exportBinarySTL(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}.stl`, wcToMmFactor(getState().cellSize), stlNormals);
        break;
      }
      case 'vtk': {
        const vtkNormals = baseGeo!.attributes.normal?.array as Float32Array | undefined;
        exportVTK(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}.vtk`, wcToMmFactor(getState().cellSize), vtkNormals);
        break;
      }
      case 'glb': {
        // 彩色 GLB：携带当前顶点色（着色模式开启时）+ mm 缩放，COLOR_0 Float32
        const glbColors = (baseGeo!.getAttribute('color')?.array as Float32Array | undefined) ?? null;
        exportGLB(baseGeo!.attributes.position.array as Float32Array, baseGeo!.attributes.normal?.array as Float32Array | undefined, baseGeo!.index!.array as Uint32Array, glbColors, `${base}.glb`, wcToMmFactor(getState().cellSize), { type: s.type, mode: s.structureMode, porosityPct: s.porosity });
        break;
      }
      case '3mf': {
        // 工业格式：mm 尺度 + 端板/构型元数据（切片机可读自定义 metadata）
        export3MF(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}.3mf`, wcToMmFactor(getState().cellSize), {
          configName: base, porosity: s.porosity, endplateMm: s.endplateMm, structureMode: s.structureMode,
        });
        break;
      }
      case 'cfdstl': {
        // CFD Multi-Patch：与 binary 同一缠绕定向约定 + mm 缩放，OpenFOAM 分块边界
        // （成功提示由函数末尾的通用 toast 统一给出，此处不再叠加）
        const cfdNormals = baseGeo!.attributes.normal?.array as Float32Array | undefined;
        exportMultiSolidSTL(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}-cfd.stl`, wcToMmFactor(getState().cellSize), cfdNormals);
        break;
      }
      case 'rvestl': {
        // 【v3.0 阶段 II】周期性 RVE 网格 + PBC 节点配对表：主线程独立构建
        // （wrapped 提取管线，与屏幕几何无关），STL 为开放缝合网格 + JSON 配对表
        if (s.containerShape !== 'cube' || s.structureMode === 'gradient_shell' || s.hybrid.enabled || s.endplateMm > 0) {
          flashToast('周期性 RVE 需：立方体容器 + solid/shell 模式 + 关闭混合与端板');
          return;
        }
        const rveR = 48;
        const rveRes = buildSurface({
          type: s.type, iso: baseIso(s), periods: s.cellSize, resolution: rveR,
          targetPorosity: s.porosity / 100, weights: s.weights, structureMode: s.structureMode,
          containerShape: 'cube', thickness: s.thickness, gradientDir: s.gradientDir,
          hybrid: { ...s.hybrid, enabled: false }, customFormula: s.customFormula,
          preview: false, periodicRve: true,
        });
        if (rveRes.type !== 'result' || rveRes.vertCount === 0 || !rveRes.pbcPairs) {
          flashToast('周期性 RVE 构建失败：当前参数无有效周期曲面');
          return;
        }
        const scaleRve = wcToMmFactor(s.cellSize);
        exportBinarySTL(rveRes.positions!, rveRes.indices!, `${base}-pbc-rve.stl`, scaleRve, rveRes.normals);
        const sidecar = {
          format: 'tpms-pbc-rve/1.0',
          unit: 'millimeter',
          note: 'STL 为开放缝合网格：全部开放边躺在单胞六面 (±L/2) 上，±L 配对面由 PBC 方程缝合；3×3×3 平铺内部 100% 水密',
          params: { type: s.type, structureMode: s.structureMode, periods: s.cellSize, resolution: rveR, targetPorosity: s.porosity / 100 },
          counts: { vertices: rveRes.vertCount, triangles: rveRes.triCount, solidFraction: rveRes.meshSolidFraction },
          pbc: {
            pairsX: rveRes.pbcPairs.pairsX,
            pairsY: rveRes.pbcPairs.pairsY,
            pairsZ: rveRes.pbcPairs.pairsZ,
            edgeClasses: rveRes.pbcPairs.edgeClasses,
            cornerClasses: rveRes.pbcPairs.cornerClasses,
          },
        };
        downloadText(JSON.stringify(sidecar, null, 2), `${base}-pbc-rve.json`, 'application/json');
        break;
      }
      case 'inp':
      case 'ofmesh': {
        // 【v3.0 阶段 III】CAE 体网格：Abaqus C3D8 INP / OpenFOAM polyMesh（体素级）
        if (s.type === 'custom' && !s.customFormula.trim()) {
          flashToast('自定义公式为空，无法导出体网格');
          return;
        }
        const caeR = 40;   // 体素分辨率/轴（INP/polyMesh 共用；均衡文件体积与工程精度）
        const vox = buildVoxelModel({
          type: s.type, periods: s.cellSize, weights: s.weights,
          structureMode: s.structureMode, containerShape: s.containerShape,
          thickness: s.thickness, targetPorosity: s.porosity / 100,
          iso: baseIso(s), customFormula: s.customFormula,
          stress: s.stress,
        }, caeR);
        const specimen = s.cellSize;   // 总宽 = cellSize mm（1 period = 1 mm 约定）
        if (fmt === 'inp') {
          const eGPa = BASE_MODULUS[s.material] ?? BASE_MODULUS.tc4;
          const nu = s.material === 'polymer' ? 0.35 : s.material === 'thermal' ? 0.22 : 0.34;
          exportAbaqusInp(vox, {
            youngModulusMPa: eGPa * 1000, poisson: nu,
            nominalStrain: 0.05, specimenSizeMm: specimen,
          }, `${base}-voxel.inp`);
          flashToast(`Abaqus INP 导出：${vox.solidCount} 个 C3D8 单元（体素 h≈${(specimen / caeR).toFixed(3)} mm）`);
        } else {
          exportOpenfoamPolyMesh(vox, specimen, `${base}-polymesh.zip`, downloadBlob);
          flashToast('OpenFOAM polyMesh 导出：解压到 case 的 constant/polyMesh/ 即可求解');
        }
        break;
      }
      case 'caesuite': {
        // 【v4.0 阶段 III】CAE 验证脚本包：Abaqus/OpenFOAM 自动化求解脚本 + 壳 + 对比模板
        const voxV = buildVoxelModel({
          type: s.type, periods: s.cellSize, weights: s.weights,
          structureMode: s.structureMode, containerShape: s.containerShape,
          thickness: s.thickness, targetPorosity: s.porosity / 100,
          iso: baseIso(s), customFormula: s.customFormula, stress: s.stress,
        }, 40);
        exportVerificationSuite(
          { type: s.type, solidCount: voxV.solidCount, voidCount: 40 ** 3 - voxV.solidCount },
          `${base}-cae-verification.zip`,
          downloadBlob,
        );
        break;
      }
      case 'vti': {
        if (s.type === 'custom' && !s.customFormula.trim()) {
          flashToast('自定义公式为空，无法导出体素场');
          return;
        }
        const { field, dims } = buildVtiField(s);
        // FieldData 携带 re-contour 所需 iso 与 mm 单位（solid 用 isoUsed，shell 类用 0）
        exportVTI(field, dims, `${base}.vti`, {
          cellSizeMm: s.cellSize,
          isoUsed: lastIsoUsed,
          type: s.type,
          structureMode: s.structureMode,
        });
        break;
      }
      case 'py':
      case 'm':
        // 【阶段 I】自定义公式经 AST→NumPy/MATLAB 翻译后可导出；编译失败（含 hybrid B 侧）才拦截
        if (s.type === 'custom' || (s.hybrid.enabled && s.hybrid.typeB === 'custom')) {
          try {
            getCompiledCustomFormula(s.customFormula);
          } catch (err) {
            flashToast('自定义公式无法翻译为脚本：' + (err instanceof Error ? err.message : String(err)));
            return;
          }
        }
        if (fmt === 'py') exportPythonScript(s, `${base}.py`);
        else exportMatlabScript(s, `${base}.m`);
        break;
      case 'bibtex': {
        const pos = baseGeo?.attributes.position?.array as Float32Array | undefined;
        const meshHash = pos ? hashArray(pos) : 'nogeo';
        downloadText(generateBibTeX(s, lastPhysicsMetrics, meshHash), `${base}.bib`, 'text/plain');
        break;
      }
      case 'json': {
        const pos = baseGeo?.attributes.position?.array as Float32Array | undefined;
        const meshHash = pos ? hashArray(pos) : 'nogeo';
        downloadText(generateJSONSidecar(s, lastPhysicsMetrics, meshHash, { resolution: lastBuildResolution, isoUsed: lastIsoUsed }), `${base}.json`, 'application/json');
        break;
      }
      default:
        return;
    }
    flashToast(`已导出 ${fmt.toUpperCase()}`);
  } catch (err) {
    flashToast('导出失败：' + (err instanceof Error ? err.message : String(err)));
  }
}

/** 通用文本文件下载 */
function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * 在主线程重采样 TPMS 隐函数标量场，供 VTI 体素导出使用。
 * 物理域 [-1,1]³ 映射到弧度域：m = π · cellSize · p（与 surface-nets 一致）。
 * 注：导出基础场（type A），异构混合/壳变换不写入，供 ParaView 自由 re-contour。
 */
function buildVtiField(s: AppState): { field: Float32Array; dims: [number, number, number] } {
  const R = l2Resolution(s.type, s.structureMode, s.gradientDir, s.cellSize);   // 倍频曲面密度同步加倍
  const N = R + 1;
  const field = new Float32Array(N * N * N);
  const k = s.cellSize;
  const w = s.weights;
  let idx = 0;
  for (let iz = 0; iz < N; iz++) {
    const mz = ((iz / R) * 2 - 1) * Math.PI * k;
    for (let iy = 0; iy < N; iy++) {
      const my = ((iy / R) * 2 - 1) * Math.PI * k;
      for (let ix = 0; ix < N; ix++) {
        const mx = ((ix / R) * 2 - 1) * Math.PI * k;
        field[idx++] = evaluateField(s.type, mx, my, mz, w, s.customFormula, { k: s.cellSize, t: s.thickness, iso: baseIso(s) });
      }
    }
  }
  return { field, dims: [N, N, N] };
}

function hashArray(arr: Float32Array): string {
  let h = 0;
  // 全量 hash：此前只取前 3000 分量（约前 1000 顶点），不同网格可能碰撞出相同 cite key
  for (let i = 0; i < arr.length; i++) {
    h = ((h * 31) ^ Math.floor(arr[i] * 1000)) >>> 0;
  }
  return h.toString(36) + '-' + (arr.length / 3 | 0);
}
