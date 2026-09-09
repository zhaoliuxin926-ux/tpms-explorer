/**
 * 全局状态管理
 * 完全兼容原系统的 URL 参数恢复与分享机制。
 */

import { DEFAULT_STATE, type AppState, PRESET_SCENES } from './types';
import { getDefaultWeights } from './core/tpms-functions';

/**
 * 创建一个真正独立的状态快照。
 *
 * AppState 含有多层可变对象。单纯的对象展开只复制第一层，导致
 * UI 事件修改 hybrid/stress 等嵌套字段时会同时改写历史栈里的对象。
 * structuredClone 在现代浏览器和 Node 中可用，显式回退则保证旧运行时
 * 仍能工作（状态只包含普通数据，不含函数/类实例）。
 */
function cloneState(state: AppState): AppState {
  if (typeof structuredClone === 'function') return structuredClone(state);
  return {
    ...state,
    weights: [...state.weights] as AppState['weights'],
    hybrid: { ...state.hybrid },
    isoGrad: { ...state.isoGrad },
    manifold: { ...state.manifold },
    stress: { ...state.stress },
    hierarchical: { ...state.hierarchical },
    neural: { ...state.neural, z: [...state.neural.z] },
  };
}

/** 当前应用状态（模块内部唯一可变实例） */
let _state: AppState = cloneState(DEFAULT_STATE);

/**
 * Partial state update accepted by setState. Nested configuration objects are
 * merged field-by-field, while tuple/primitive fields retain AppState's exact
 * types. Keeping this explicit avoids DeepPartial turning neural.z/weights
 * into array-like object maps.
 */
export type AppStatePatch = Omit<Partial<AppState>,
  'hybrid' | 'manifold' | 'stress' | 'hierarchical' | 'neural'
> & {
  hybrid?: Partial<AppState['hybrid']>;
  isoGrad?: Partial<AppState['isoGrad']>;
  manifold?: Partial<AppState['manifold']>;
  stress?: Partial<AppState['stress']>;
  hierarchical?: Partial<AppState['hierarchical']>;
  neural?: Partial<AppState['neural']>;
};

/** 获取状态快照（调用方不能通过返回值污染内部状态或历史栈） */
export function getState(): Readonly<AppState> {
  return cloneState(_state);
}

/** 更新状态（支持部分更新，并对嵌套配置做合并） */
export function setState(partial: AppStatePatch): void {
  const prev = _state;
  const next: AppState = {
    ...prev,
    ...partial,
    weights: partial.weights
      ? [...partial.weights] as AppState['weights']
      : [...prev.weights] as AppState['weights'],
    hybrid: { ...prev.hybrid, ...(partial.hybrid ?? {}) },
    manifold: { ...prev.manifold, ...(partial.manifold ?? {}) },
    stress: { ...prev.stress, ...(partial.stress ?? {}) },
    hierarchical: { ...prev.hierarchical, ...(partial.hierarchical ?? {}) },
    neural: {
      ...prev.neural,
      ...(partial.neural ?? {}),
      z: partial.neural?.z ? [...partial.neural.z] : [...prev.neural.z],
    },
  };

  // 类型变更时自动重置权重；URL 恢复等显式携带 weights 的调用以传入值为准
  if (partial.type && partial.type !== prev.type && partial.weights === undefined) {
    next.weights = getDefaultWeights(partial.type);
  }
  _state = cloneState(next);
}

/** 应用预设场景 */
export function applyPreset(key: string): void {
  const preset = PRESET_SCENES.find(p => p.key === key);
  if (!preset) return;
  setState({ ...preset.state });
}

/** 状态历史栈（用于 Undo/Redo） */
const history: AppState[] = [cloneState(DEFAULT_STATE)];
let historyIndex = 0;
const MAX_HISTORY = 50;

/**
 * 将当前状态设为新的 Undo/Redo 基线。
 *
 * 分享链接会在页面启动时覆盖默认状态；若历史仍从 DEFAULT_STATE 开始，
 * 用户首次改动后撤销会错误跳回默认配置，而不是链接恢复出的配置。
 */
export function resetHistory(): void {
  history.splice(0, history.length, cloneState(_state));
  historyIndex = 0;
}

/** 记录当前状态到历史（在用户操作前调用） */
export function pushHistory(): void {
  // 相同状态不重复入栈（例如重复点击当前材质，或逆向设计“应用”后
  // 又触发一次统一重建）。这也避免无意义的 Undo 步骤消耗历史容量。
  if (JSON.stringify(history[historyIndex]) === JSON.stringify(_state)) return;
  // 丢弃当前位置之后的历史（新操作覆盖 redo 分支）
  history.splice(historyIndex + 1);
  history.push(cloneState(_state));
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
}

/** 撤销到上一个状态 */
export function undo(): Readonly<AppState> | null {
  if (historyIndex <= 0) return null;
  historyIndex--;
  _state = cloneState(history[historyIndex]);
  return cloneState(_state);
}

/** 重做到下一个状态 */
export function redo(): Readonly<AppState> | null {
  if (historyIndex >= history.length - 1) return null;
  historyIndex++;
  _state = cloneState(history[historyIndex]);
  return cloneState(_state);
}

/** 是否可撤销 */
export function canUndo(): boolean { return historyIndex > 0; }

/** 是否可重做 */
export function canRedo(): boolean { return historyIndex < history.length - 1; }

/** 从状态构建分享 URL */
export function buildShareURL(): string {
  const s = _state;
  const params = new URLSearchParams({
    type: s.type,
    model: s.model,
    structure: s.structureMode,
    container: s.containerShape,
    porosity: String(s.porosity),
    cellSize: String(s.cellSize),
    thickness: String(s.thickness),
    slice: String(s.slice),
    material: s.material,
    autoRotate: s.autoRotate ? '1' : '0',
    wa: String(s.weights[0]),
    wb: String(s.weights[1]),
    wc: String(s.weights[2]),
    wd: String(s.weights[3]),
  });
  params.set('grad', s.gradientDir);
  if (s.endplateMm > 0) params.set('ep', String(s.endplateMm));
  // 【阶段 IV】非欧度规空间映射（identity 关闭时不写入，URL 保持简洁）
  if (s.manifold.kind !== 'identity') {
    params.set('mfd', s.manifold.kind);
    params.set('mfr', String(s.manifold.radius));
    // 保留 metric 映射的全部自由度，避免分享链接只恢复 kind/radius 后
    // 在不同轴向或缩放比例下得到另一套几何。
    params.set('mfs', String(s.manifold.scale));
    params.set('mfa', s.manifold.axis);
  }
  if (s.sliceAxis !== 'z') params.set('sa', s.sliceAxis);
  if (s.sliceInvert) params.set('si', '1');
  // 【v3.0 阶段 IV】应力场引导（none 关闭时不写入）
  if (s.stress.preset !== 'none') {
    params.set('sd', s.stress.preset);
    params.set('sds', String(s.stress.strength));
    params.set('sda', String(s.stress.anisotropy));
  }
  // 【v3.0 阶段 V】多级分形（关闭时不写入）
  if (s.hierarchical.enabled) {
    params.set('hd', s.hierarchical.microType);
    params.set('hn', String(s.hierarchical.frequency));
    params.set('hl', String(s.hierarchical.amplitude));
  }
  // 【v7.0 Stage I】隐式神经拓扑（关闭时不写入；z 打包 CSV）
  if (s.neural.enabled) {
    params.set('ne', '1');
    params.set('nz', s.neural.z.map((v) => v.toFixed(2)).join(','));
  }
  if (s.hybrid.enabled) {
    params.set('hybrid', '1');
    params.set('hybridType', s.hybrid.typeB);
    params.set('hybridBlend', s.hybrid.blendFunction);
    params.set('hybridCenter', String(s.hybrid.blendCenter));
    params.set('hybridWidth', String(s.hybrid.blendWidth));
    params.set('hybridAxis', s.hybrid.axis);
  }
  if (s.isoGrad.enabled) {
    params.set('ig', '1');
    params.set('igH', String(s.isoGrad.hard));
    params.set('igS', String(s.isoGrad.soft));
    params.set('igB', String(s.isoGrad.band));
  }
  if (s.customFormula) params.set('formula', s.customFormula);
  // 颜色与 GPU 只是渲染偏好，但也属于可复现实验配置；仅写非默认值，
  // 让旧链接保持短小并继续按默认行为加载。
  if (s.coloring !== 'none') params.set('color', s.coloring);
  if (!s.gpuAccelerate) params.set('gpu', '0');
  const url = new URL(location.href);
  url.search = params.toString();
  return url.toString();
}
