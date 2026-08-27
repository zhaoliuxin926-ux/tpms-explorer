/**
 * URL 参数解析与序列化
 * 完全兼容原系统的 URL 参数恢复机制，确保旧版链接可正常解析加载。
 */

import type { AppState, TpmType, RenderModel, StructureMode, ContainerShape, MaterialPreset, GradientDirection } from './types';
import { ENDPLATE_MAX_UI_MM } from './types';
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

  // 权重：仅 URL 显式携带 wa/wb/wc/wd 之一时覆盖。
  // 无条件覆盖会让 setState 的"类型变更重置为该类型默认权重"语义在 URL 路径永不生效
  //（当前各类型默认恰为全 1 故无害，未来默认非全 1 时会静默出错）
  if (q.has('wa') || q.has('wb') || q.has('wc') || q.has('wd')) {
    state.weights = [
      clamp(q.get('wa'), 0, 2, 1),
      clamp(q.get('wb'), 0, 2, 1),
      clamp(q.get('wc'), 0, 2, 1),
      clamp(q.get('wd'), 0, 2, 1),
    ];
  }

  // 自动旋转
  if (q.has('autoRotate')) {
    state.autoRotate = q.get('autoRotate') !== '0';
  }

  // 梯度方向
  state.gradientDir = 'z';  // default
  if (q.has('grad') && VALID.gradient.includes(q.get('grad') as GradientDirection)) {
    state.gradientDir = q.get('grad') as GradientDirection;
  }

  // 加载端板厚度（mm）；缺省 = 关闭（数值参数无注入面）
  state.endplateMm = clamp(q.get('ep'), 0, ENDPLATE_MAX_UI_MM, 0);

  // 剖切轴向 / 反向
  const sa = q.get('sa');
  if (sa === 'x' || sa === 'y' || sa === 'z') state.sliceAxis = sa;
  state.sliceInvert = q.get('si') === '1';

  // 混合模式（hybridType/hybridBlend 必须过白名单：否则恶意 URL 可注入任意字符串，
  // 经导出脚本的单引号插值落地为可执行 Python/MATLAB 代码——任意代码执行）
  if (q.get('hybrid') === '1') {
    const rawTypeB = q.get('hybridType');
    const rawBlend = q.get('hybridBlend');
    state.hybrid = {
      enabled: true,
      typeB: rawTypeB && VALID.type.includes(rawTypeB as TpmType) ? (rawTypeB as TpmType) : 'diamond',
      blendFunction: rawBlend === 'linear' || rawBlend === 'sigmoid' ? rawBlend : 'sigmoid',
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
