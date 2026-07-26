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
import { computePhysicsMetrics } from './physics/gibson-ashby';
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
} from './ui-helpers';

// ── 全局变量 ─────────────────────────────────────────────
let ctx: ThreeContext;
let bridge: WorkerBridge;
let baseGeo: THREE.BufferGeometry | null = null;
let meshFill: THREE.Mesh | null = null;
let meshStrut: THREE.LineSegments | null = null;
let lastPorosityEstimate = 0;
let lastPhysicsMetrics: PhysicsMetrics | null = null;
let lastIsoUsed = 0;
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
  initTheme();

  // 6) 同步 UI 状态与文本
  const s = getState();
  syncUI(s);
  updateBadges(s.type, s.model, s.material, s.structureMode);
  updateStructureDesc(s.structureMode);
  updateFormulaDisplay(s.type, s.weights, 0);
  updateTips(s.type, s.porosity, s.thickness, null);

  // 7) 初始重建
  rebuild(false);

  // 8) 动画循环
  animate();
});

// ── 动画循环 ─────────────────────────────────────────────
function animate(): void {
  animId = requestAnimationFrame(animate);
  ctx.controls.update();
  ctx.composer.render();
}

// 页面卸载时取消动画帧，避免内存泄漏
window.addEventListener('beforeunload', () => cancelAnimationFrame(animId));

// ── 重建调度 ─────────────────────────────────────────────
function rebuild(preview: boolean): void {
  const s = getState();
  // 三级 LOD：preview 低分辨率 → 中等过渡 → 全高清
  let R: number;
  if (preview) {
    R = 28;  // Level 1: 极低分辨率，拖动时丝滑跟手
  } else if (isFirstBuild) {
    R = Math.min(88, 19 + s.cellSize * 14);  // Level 3: 首屏直接高清
  } else {
    R = Math.min(64, 19 + s.cellSize * 10);  // Level 2: 中等分辨率，松手后快速过渡
  }
  const iso = baseIso(s);

  // 缓存检查
  const key = cacheKey(s, R);
  const cached = geoCache.get(key);
  if (cached) {
    // 缓存命中：瞬间恢复
    applyGeometry(cached.positions, cached.normals, cached.indices, cached.vertCount, cached.faceCount);
    return;
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
  };

  bridge.build(params);
}

function scheduleRebuild(preview: boolean): void {
  if (!preview) pushHistory();  // 仅完整重建时记录历史
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(preview), preview ? 16 : 150);
}

/** 松手后先渲染中等分辨率，再自动升级到全高清 */
function scheduleHdUpgrade(): void {
  setTimeout(() => {
    const s = getState();
    const fullR = Math.min(88, 19 + s.cellSize * 14);
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
    });
  }, 350);
}

// ── 几何应用 ─────────────────────────────────────────────
function applyGeometry(positions: Float32Array, normals: Float32Array, indices: Uint32Array, vertCount: number, _faceCount: number): void {
  disposeGeometry();

  if (vertCount === 0) {
    showEmpty(true);
    updateStats();
    return;
  }
  showEmpty(false);

  baseGeo = new THREE.BufferGeometry();
  baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  baseGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  baseGeo.setIndex(new THREE.BufferAttribute(indices, 1));
  baseGeo.computeBoundingSphere();

  const s = getState();
  const mat = getMaterial(s.material, s.model);

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
    meshStrut.scale.set(0.33, 0.33, 0.33);
    ctx.scene.add(meshStrut);
    if (meshFill) { ctx.scene.remove(meshFill); meshFill = null; }
  } else {
    // surface / solid 模式
    meshFill = new THREE.Mesh(baseGeo, mat);
    meshFill.scale.set(0.33, 0.33, 0.33);
    meshFill.castShadow = true;
    meshFill.receiveShadow = true;
    ctx.scene.add(meshFill);
    if (meshStrut) { ctx.scene.remove(meshStrut); meshStrut = null; }
  }

  // 截面裁剪
  updateClipPlane();

  // 测量工具同步
  if (bboxAnnotation && baseGeo) {
    bboxAnnotation.update(baseGeo);
  }
  if (caliperTool) {
    caliperTool.dispose();
    caliperTool = meshFill ? new CaliperTool(ctx.renderer, ctx.camera, ctx.scene, meshFill) : null;
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
        target.scale.set(0.33 * ease, 0.33 * ease, 0.33 * ease);
        if (progress < 1) requestAnimationFrame(tick);
      };
      tick();
    }
  }

  updateStats();
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
  if (res.isoUsed != null) lastIsoUsed = res.isoUsed;

  // 物理指标
  if (res.surfaceArea != null && res.envelopeVolume != null) {
    lastPhysicsMetrics = computePhysicsMetrics(
      getState().type,
      res.porosityEstimate,
      res.surfaceArea,
      res.envelopeVolume,
      getState().material,
      getState().cellSize,
      getState().structureMode
    );
  }

  // 应用几何
  applyGeometry(res.positions!, res.normals!, res.indices!, res.vertCount, res.triCount);

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
  if (materialEl) materialEl.textContent = ((1 - lastPorosityEstimate) * 100).toFixed(1) + '%';
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

  // 权重滑块
  const weightIds = ['fw-a', 'fw-b', 'fw-c', 'fw-d'];
  weightIds.forEach((id, idx) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (el) {
      el.addEventListener('input', () => {
        const w = [...getState().weights] as [number, number, number, number];
        w[idx] = +el.value;
        setState({ weights: w });
        scheduleRebuild(true);
      });
      el.addEventListener('change', () => { scheduleRebuild(false); scheduleHdUpgrade(); });
    }
  });

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
    navigator.clipboard.writeText(url).then(() => {
      alert('分享链接已复制到剪贴板！');
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
    if (!baseGeo || !baseGeo.index) return;
    const positions = baseGeo.attributes.position.array as Float32Array;
    const indices = baseGeo.index.array as Uint32Array;
    exportBinarySTL(positions, indices, `tpms-${getState().type}-p${getState().porosity}-${getState().structureMode}.stl`);
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
      if (baseGeo) bboxAnnotation.update(baseGeo);
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
        caliperTool = new CaliperTool(ctx.renderer, ctx.camera, ctx.scene, meshFill);
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
    localPlane.constant /= 0.33;
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

  // 统计面板切换
  document.getElementById('stat-toggle')?.addEventListener('click', () => {
    document.getElementById('stat-details')?.classList.toggle('show');
  });

  // 窗口大小变化
  window.addEventListener('resize', () => {
    const container = document.getElementById('canvas-container')!;
    ctx.resize(container.clientWidth, container.clientHeight);
  });

  // 空间梯度按钮
  document.querySelectorAll('[data-gradient]').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ gradientDir: btn.getAttribute('data-gradient') as AppState['gradientDir'] });
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
      if (customEnabled.checked) {
        setState({ type: 'custom' });
      } else {
        setState({ type: 'gyroid', customFormula: '' });
      }
      scheduleRebuild(false);
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

    // Ctrl+Z 撤销
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const prev = undo();
      if (prev) { syncUI(prev); updateBadges(prev.type, prev.model, prev.material, prev.structureMode); updateStructureDesc(prev.structureMode); scheduleRebuild(false); flashToast('已撤销'); }
      return;
    }
    // Ctrl+Shift+Z / Ctrl+Y 重做
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      const next = redo();
      if (next) { syncUI(next); updateBadges(next.type, next.model, next.material, next.structureMode); updateStructureDesc(next.structureMode); scheduleRebuild(false); flashToast('已重做'); }
      return;
    }

    // 1-8 切换曲面类型
    const types: AppState['type'][] = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
    if (e.key >= '1' && e.key <= '8') {
      const idx = parseInt(e.key) - 1;
      if (types[idx]) {
        setState({ type: types[idx] });
        const s = getState();
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

    // 数字 7-9：快速切换材料
    if (e.key === '7') { setState({ material: 'tc4' }); syncUI(getState()); scheduleRebuild(false); flashToast('TC4 钛合金'); return; }
    if (e.key === '8') { setState({ material: 'polymer' }); syncUI(getState()); scheduleRebuild(false); flashToast('PLLA 高分子'); return; }
    if (e.key === '9') { setState({ material: 'thermal' }); syncUI(getState()); scheduleRebuild(false); flashToast('导热材料'); return; }

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
      flashToast('1-6 曲面 | 7-9 材料 | Shift+1/2 容器 | F 全屏 | P 截图 | Ctrl+Z 撤销 | R 重置 | V 截面 | E 导出');
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
  const canvas = document.querySelector('canvas')!;
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

  const weightIds = ['fw-a', 'fw-b', 'fw-c', 'fw-d'];
  weightIds.forEach((id, idx) => setVal(id, s.weights[idx]));

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

  for (let p = startPorosity; p <= endPorosity && !sweepAbort; p += step) {
    const progress = ((p - startPorosity) / (endPorosity - startPorosity)) * 100;
    bar.style.width = `${progress}%`;
    status.textContent = `孔隙率 ${p}% (${Math.round(progress)}%)`;

    // 更新状态并触发重建
    setState({ porosity: p });
    syncUI(getState());

    // 等待 Worker 完成
    await new Promise<void>(resolve => {
      const handler = () => { resolve(); bridge.removeResultListener(handler); };
      bridge.addResultListener(handler);
      scheduleRebuild(false);
    });

    // 延迟一帧确保渲染完成
    await new Promise(r => setTimeout(r, 200));

    // 截取 canvas
    ctx.composer.render();
    const canvas = ctx.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');
    frames.push(dataUrl);

    // 生成参数配置文件
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
    
    const configBlob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const configA = document.createElement('a');
    configA.href = URL.createObjectURL(configBlob);
    configA.download = `tpms_sweep_p${p}%.json`;
    configA.click();

    // 添加缩略图
    const img = document.createElement('img');
    img.src = dataUrl;
    preview.appendChild(img);
  }

  if (!sweepAbort) {
    status.textContent = '扫描完成，正在下载...';
    bar.style.width = '100%';

    // 逐帧下载 PNG
    for (let i = 0; i < frames.length; i++) {
      const a = document.createElement('a');
      a.href = frames[i];
      a.download = `tpms_sweep_p${startPorosity + i * step}%.png`;
      a.click();
      await new Promise(r => setTimeout(r, 100));
    }

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

  // 恢复原始孔隙率
  setState({ porosity: s.porosity });
  syncUI(getState());
  scheduleRebuild(false);
}

// ── 论文配图模式 ─────────────────────────────────────────────
function enterFigureMode(): void {
  const s = getState();
  const saved = {
    autoRotate: ctx.controls.autoRotate,
    camPos: ctx.camera.position.clone(),
    target: ctx.controls.target.clone(),
    fov: ctx.camera.fov,
  };

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
    const json = generateJSONSidecar(s, lastPhysicsMetrics, meshHash);
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
  try {
    switch (fmt) {
      case 'stl':
        exportBinarySTL(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}.stl`);
        break;
      case 'vtk':
        exportVTK(baseGeo!.attributes.position.array as Float32Array, baseGeo!.index!.array as Uint32Array, `${base}.vtk`);
        break;
      case 'vti': {
        if (s.type === 'custom' && !s.customFormula.trim()) {
          flashToast('自定义公式为空，无法导出体素场');
          return;
        }
        const { field, dims } = buildVtiField(s);
        exportVTI(field, dims, `${base}.vti`);
        break;
      }
      case 'py':
        exportPythonScript(s, `${base}.py`);
        break;
      case 'm':
        exportMatlabScript(s, `${base}.m`);
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
        downloadText(generateJSONSidecar(s, lastPhysicsMetrics, meshHash), `${base}.json`, 'application/json');
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
  const R = Math.min(64, 19 + s.cellSize * 10);
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
  const n = Math.min(arr.length, 3000);
  for (let i = 0; i < n; i++) {
    h = ((h * 31) ^ Math.floor(arr[i] * 1000)) >>> 0;
  }
  return h.toString(36) + '-' + (arr.length / 3 | 0);
}
