/**
 * 全局状态管理
 * 完全兼容原系统的 URL 参数恢复与分享机制。
 */

import { DEFAULT_STATE, type AppState, PRESET_SCENES } from './types';
import { getDefaultWeights } from './core/tpms-functions';

/** 当前应用状态 */
let _state: AppState = { ...DEFAULT_STATE };

/** 获取状态快照（只读） */
export function getState(): Readonly<AppState> {
  return _state;
}

/** 更新状态（支持部分更新） */
export function setState(partial: Partial<AppState>): void {
  const prev = _state;
  _state = { ...prev, ...partial };

  // 类型变更时自动重置权重；URL 恢复等显式携带 weights 的调用以传入值为准
  if (partial.type && partial.type !== prev.type && partial.weights === undefined) {
    _state.weights = getDefaultWeights(partial.type);
  }
}

/** 应用预设场景 */
export function applyPreset(key: string): void {
  const preset = PRESET_SCENES.find(p => p.key === key);
  if (!preset) return;
  setState({ ...preset.state } as Partial<AppState>);
}

/** 状态历史栈（用于 Undo/Redo） */
const history: AppState[] = [{ ...DEFAULT_STATE }];
let historyIndex = 0;
const MAX_HISTORY = 50;

/** 记录当前状态到历史（在用户操作前调用） */
export function pushHistory(): void {
  // 丢弃当前位置之后的历史（新操作覆盖 redo 分支）
  history.splice(historyIndex + 1);
  history.push({ ..._state });
  if (history.length > MAX_HISTORY) history.shift();
  historyIndex = history.length - 1;
}

/** 撤销到上一个状态 */
export function undo(): Readonly<AppState> | null {
  if (historyIndex <= 0) return null;
  historyIndex--;
  _state = { ...history[historyIndex] };
  return _state;
}

/** 重做到下一个状态 */
export function redo(): Readonly<AppState> | null {
  if (historyIndex >= history.length - 1) return null;
  historyIndex++;
  _state = { ...history[historyIndex] };
  return _state;
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
  if (s.hybrid.enabled) {
    params.set('hybrid', '1');
    params.set('hybridType', s.hybrid.typeB);
    params.set('hybridBlend', s.hybrid.blendFunction);
    params.set('hybridCenter', String(s.hybrid.blendCenter));
    params.set('hybridWidth', String(s.hybrid.blendWidth));
    params.set('hybridAxis', s.hybrid.axis);
  }
  if (s.customFormula) params.set('formula', s.customFormula);
  const url = new URL(location.href);
  url.search = params.toString();
  return url.toString();
}
