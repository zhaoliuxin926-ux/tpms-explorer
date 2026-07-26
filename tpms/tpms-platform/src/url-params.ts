/**
 * URL 参数解析与序列化
 * 完全兼容原系统的 URL 参数恢复机制，确保旧版链接可正常解析加载。
 */

import type { AppState, TpmType, RenderModel, StructureMode, ContainerShape, MaterialPreset, GradientDirection } from './types';
// import { getDefaultWeights } from './core/tpms-functions'; // TODO: restore when used

const VALID = {
  type: ['gyroid','diamond','schwarz','neovius','iwp','frd','lidinoid','splitp','custom'] as TpmType[],
  model: ['surface','strut','solid'] as RenderModel[],
  structure: ['solid_network','shell','gradient_shell'] as StructureMode[],
  container: ['cube','cylinder'] as ContainerShape[],
  material: ['auto','tc4','polymer','thermal'] as MaterialPreset[],
  gradient: ['z','radial','spherical'] as GradientDirection[],
};

function clamp(v: string | null, min: number, max: number, def: number): number {
  if (v == null || isNaN(+v)) return def;
  return Math.min(max, Math.max(min, +v));
}

/** 从 URL SearchParams 解析为状态 */
export function parseURLParams(search: string): Partial<AppState> {
  const q = new URLSearchParams(search);
  const state: Partial<AppState> = {};

  if (q.has('type') && VALID.type.includes(q.get('type') as TpmType)) {
    state.type = q.get('type') as TpmType;
  }
  if (q.has('model') && VALID.model.includes(q.get('model') as RenderModel)) {
    state.model = q.get('model') as RenderModel;
  }
  if (q.has('structure') && VALID.structure.includes(q.get('structure') as StructureMode)) {
    state.structureMode = q.get('structure') as StructureMode;
  }
  if (q.has('container') && VALID.container.includes(q.get('container') as ContainerShape)) {
    state.containerShape = q.get('container') as ContainerShape;
  }
  if (q.has('porosity')) {
    state.porosity = clamp(q.get('porosity'), 60, 90, 75);
  }
  if (q.has('cellSize')) {
    state.cellSize = clamp(q.get('cellSize'), 1, 5, 3);
  }
  if (q.has('thickness')) {
    state.thickness = clamp(q.get('thickness'), 0.5, 2.0, 1.0);
  }
  if (q.has('slice')) {
    state.slice = clamp(q.get('slice'), -100, 100, 100);
  }
  if (q.has('material') && VALID.material.includes(q.get('material') as MaterialPreset)) {
    state.material = q.get('material') as MaterialPreset;
  }

  // 权重
  const w: [number, number, number, number] = [
    clamp(q.get('wa'), 0, 2, 1),
    clamp(q.get('wb'), 0, 2, 1),
    clamp(q.get('wc'), 0, 2, 1),
    clamp(q.get('wd'), 0, 2, 1),
  ];
  state.weights = w;

  // 自动旋转
  if (q.has('autoRotate')) {
    state.autoRotate = q.get('autoRotate') !== '0';
  }

  // 梯度方向
  state.gradientDir = 'z';  // default
  if (q.has('grad') && VALID.gradient.includes(q.get('grad') as GradientDirection)) {
    state.gradientDir = q.get('grad') as GradientDirection;
  }

  // 混合模式
  if (q.get('hybrid') === '1') {
    state.hybrid = {
      enabled: true,
      typeB: (q.get('hybridType') as TpmType) || 'diamond',
      blendFunction: (q.get('hybridBlend') as 'sigmoid' | 'linear') || 'sigmoid',
      blendCenter: clamp(q.get('hybridCenter'), -2, 2, 0),
      blendWidth: clamp(q.get('hybridWidth'), 0.1, 5, 1.0),
    };
  }

  // 自定义公式（URLSearchParams 已自动编解码，无需再包一层）
  if (q.has('formula')) {
    state.customFormula = q.get('formula') ?? '';
  }

  return state;
}

/** 在 init 之前解析 URL 参数到全局状态 */
export function initStateFromURL(): Partial<AppState> {
  if (!location.search || location.search.length <= 1) return {};
  return parseURLParams(location.search);
}
