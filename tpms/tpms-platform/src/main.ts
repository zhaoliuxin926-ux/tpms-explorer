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
import type { ColoringMode } from './types';
import { computePhysicsMetrics } from './physics/gibson-ashby';
import { buildSurface } from './geometry/surface-nets';
import { computeVertexColors } from './geometry/vertex-coloring';
import type { PhysicsMetrics } from './types';
import {
  exportBinarySTL,
  exportVTK,
  exportVTI,
  exportPythonScript,
  exportMatlabScript,
  generateBibTeX,
  generateJSONSidecar,
} from './export';
import { evaluateField } from './core/tpms-functions';
import { DISPLAY_SCALE, wcToMmFactor, resolutionPerPeriod } from './core/units';
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
  return `${s.type}|${s.model}|${s.cellSize}|${R}|${s.porosity}|${s.structureMode}|${s.containerShape}|${s.thickness}|${s.gradientDir}|${s.hybrid.enabled ? 'H' + s.hybrid.typeB : ''}|${s.customFormula}|${s.weights.join(',')}`;
}

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

// ── 重建调度 ─────────────────────────────────────────────
/** 返回 true = LRU 命中并已同步应用（不发 worker 请求）；false = 已派发 worker 重建 */
function rebuild(preview: boolean): boolean {
  const s = getState();
  // 三级 LOD：preview 低分辨率 → 中等过渡 → 全高清
  let R: number;
  if (preview) {
    R = 28;  // Level 1: 极低分辨率，拖动时丝滑跟手
  } else if (isFirstBuild) {
    R = Math.min(96, 19 + s.cellSize * resolutionPerPeriod(s.type, s.structureMode, s.gradientDir));  // Level 3: 首屏直接高清（倍频曲面密度加倍）
  } else {
    R = Math.min(72, 19 + s.cellSize * resolutionPerPeriod(s.type, s.structureMode, s.gradientDir) * 10 / 14);  // Level 2: 中等分辨率（倍频同步加倍）
  }
  const iso = baseIso(s);

  // 缓存检查
  const key = cacheKey(s, R);
  const cached = geoCache.get(key);
  if (cached) {
    // 缓存命中：瞬间恢复（注意：此路径不派发 worker 结果——调用方若在等待结果需以此返回值区分）
    // 颜色不入缓存：由 applyGeometry 内部按当前着色状态现场补算
    applyGeometry(cached.positions, cached.normals, cached.indices, cached.vertCount, cached.faceCount);
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
  };

  bridge.build(params);
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
    const fullR = Math.min(96, 19 + s.cellSize * resolutionPerPeriod(s.type, s.structureMode, s.gradientDir));
    bridge.build({
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
    });
  }, 350);
}

// ── 着色模式 ─────────────────────────────────────────────
/** field 口径的可用性：需异构混合开启或梯度双壳在场 */
function fieldAvailable(s: AppState): boolean {
  return s.hybrid.enabled || s.structureMode === 'gradient_shell';
}

/** UI 选择到 Worker 参数的有效着色模式（非法选择优雅回退，不静默丢色彩语义） */
function effectiveColoring(s: AppState): ColoringMode {
  return s.coloring === 'field' && !fieldAvailable(s) ? 'elevation' : s.coloring;
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
          hybrid: eff === 'field' && s0.hybrid.enabled ? s0.hybrid : undefined,
          gradientDir: s0.gradientDir,
        })
      : null;
  })();

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

  // 截面裁剪
  updateClipPlane();

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
function updateClipPlane(): void {
  const s = getState();
  const showClip = s.slice < 100;
  const yClip = showClip ? (s.slice / 100) * 1.6 : 100;
  ctx.clipPlane.constant = yClip;

  // 移动 shadow plane 到截面处增强 3D 感知（clipPlane 为世界坐标，阴影盘同处世界空间）
  ctx.shadowPlane.position.y = showClip ? yClip - 0.02 : -2.04;
  ctx.gridHelper.visible = !showClip;

  requestRender(); // 按需渲染：裁剪面变化需重绘
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
  }
  const anisoEl = document.getElementById('stat-aniso');
  if (anisoEl && lastPhysicsMetrics) {
    anisoEl.textContent = lastPhysicsMetrics.anisotropy.toFixed(2);
    anisoEl.title = '各向异性系数 (E_max/E_min)。Gibson-Ashby 模型为各向同性近似，实际值可能因方向而异。';
  }
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

  // 滑块：截面
  const sliceEl = document.getElementById('slice') as HTMLInputElement;
  if (sliceEl) {
    sliceEl.addEventListener('input', () => {
      setState({ slice: +sliceEl.value });
      const sv = document.getElementById('slice-value');
      if (sv) sv.textContent = +sliceEl.value >= 99 ? '完整' : `${Math.round((+sliceEl.value + 100) / 2)}%`;
      updateClipPlane();
    });
  }

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
  document.querySelectorAll('[data-gradient]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ gradientDir: btn.getAttribute('data-gradient') as AppState['gradientDir'] });
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

  // 异构混合启用
  const hybridEnabled = document.getElementById('hybrid-enabled') as HTMLInputElement;
  if (hybridEnabled) {
    hybridEnabled.addEventListener('change', () => {
      setState({ hybrid: { ...getState().hybrid, enabled: hybridEnabled.checked } });
      document.getElementById('hybrid-options')!.style.display = hybridEnabled.checked ? 'block' : 'none';
      document.getElementById('hybrid-blend')!.style.display = hybridEnabled.checked ? 'block' : 'none';
      scheduleRebuild(false);
    });
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

  // 自定义公式输入
  const customFormula = document.getElementById('custom-formula') as HTMLTextAreaElement;
  if (customFormula) {
    customFormula.addEventListener('input', () => {
      setState({ customFormula: customFormula.value.trim() });
      scheduleRebuild(true);
    });
    customFormula.addEventListener('change', () => scheduleRebuild(false));
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

  // 自动旋转按钮
  document.getElementById('btn-rotate')?.classList.toggle('on', s.autoRotate);

  // 混合启用复选框
  const he = document.getElementById('hybrid-enabled') as HTMLInputElement | null;
  if (he) he.checked = s.hybrid.enabled;

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
  document.querySelectorAll('[data-hybrid-type]').forEach(el => {
    el.classList.toggle('active', (s as any).hybrid.typeB === el.getAttribute('data-hybrid-type'));
  });
  document.querySelectorAll('[data-blend]').forEach(el => {
    el.classList.toggle('active', (s as any).hybrid.blendFunction === el.getAttribute('data-blend'));
  });

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
  const needGeo = fmt === 'stl' || fmt === 'vtk';
  if (needGeo && (!baseGeo || !baseGeo.index)) {
    flashToast('请先生成有效曲面再导出');
    return;
  }
  if (needGeo) {
    // 拖动滑块后 0~350ms 内 HD 升级尚未完成，此时导出会拿到 preview(R=28) 网格——
    // 同步在主线程重建高清（一次性几百 ms），保证导出物与屏幕最终形态一致
    const hdR = Math.min(96, 19 + s.cellSize * resolutionPerPeriod(s.type, s.structureMode, s.gradientDir));
    if (lastBuildResolution < hdR) {
      const res = buildSurface({
        type: s.type, iso: baseIso(s), periods: s.cellSize, resolution: hdR,
        targetPorosity: s.porosity / 100, weights: s.weights, structureMode: s.structureMode,
        containerShape: s.containerShape, thickness: s.thickness, gradientDir: s.gradientDir,
        hybrid: s.hybrid, customFormula: s.customFormula, preview: false,
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
        // custom 公式无法翻译成 numpy/MATLAB 表达式，脚本只会必然报错——直接拦截
        if (s.type === 'custom') {
          flashToast('自定义公式暂不支持脚本导出，请改用 STL/VTK 网格导出');
          return;
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
  const R = Math.min(72, 19 + s.cellSize * resolutionPerPeriod(s.type, s.structureMode, s.gradientDir) * 10 / 14);   // 倍频曲面密度同步加倍
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
        field[idx++] = evaluateField(s.type, mx, my, mz, w, s.customFormula);
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
