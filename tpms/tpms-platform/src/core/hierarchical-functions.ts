/**
 * 多级分形分级 TPMS（v3.0 阶段 V · Hierarchical / Multi-Scale）
 *
 * 隐函数：F_hier(x) = F_macro(x) + λ·F_micro(N·x)
 *   · F_macro：主曲面（当前 TPMS 类型），维持宏观力学支撑与骨长入通道
 *   · F_micro：微曲面（N ≥ 3 倍频），在宏观壁面诱发微尺度织构/微孔，
 *     提供超高比表面积与毛细传质通道（骨支架：大孔 300~600 µm 供骨细胞长入，
 *     微孔 20~50 µm 供营养输运；换热器：微肋强化对流）
 *   · λ ∈ [0.1, 0.5] 微观调制幅值；λ=0 退化为宏观单一尺度
 *
 * 双重比表面积分离估算（coarea 公式 MC 积分）：
 *   S_total ≈ (1/V)·E[|∇F_hier|]，S_macro ≈ (1/V)·E[|∇F_macro|]，
 *   S_micro_added = S_total − S_macro（微织构带来的附加比表面积）。
 * 诚实边界：等值面位置受二分 iso 影响，coarea 估算是面积密度量级口径，
 * 供相对比较与教学演示，不作精密计量。
 *
 * 微孔连通率：微场 F_micro(N·x) 在自身等值下的空隙 6 连通 BFS，
 * 最大贯通簇占微空隙比例 ≥95% 视为微通道贯通（TPMS 微曲面天然贯通）。
 */

import type { TpmType, HierarchicalConfig } from '../types';
import { getTpmsFunction, type Weights } from './tpms-functions';

export type { HierarchicalConfig };

export const HIERARCHICAL_DEFAULTS: HierarchicalConfig = {
  enabled: false,
  microType: 'diamond',
  frequency: 4,
  amplitude: 0.25,
};

/** 构建 F_hier 场函数（弧度域坐标；macro/micro 共用同一权重与 dyn 句柄） */
export function createHierarchicalField(
  macroType: TpmType,
  cfg: HierarchicalConfig,
  customFormula: string,
  dyn: { k: number; t: number; iso: number } | undefined,
): ((mx: number, my: number, mz: number, w: Weights) => number) | null {
  if (!cfg.enabled) return null;
  const N = Math.max(1, cfg.frequency);
  const lambda = cfg.amplitude;
  const fMacro = getTpmsFunction(macroType, customFormula, dyn);
  const fMicro = cfg.microType === 'custom'
    ? getTpmsFunction('custom', customFormula, dyn)
    : getTpmsFunction(cfg.microType, '', dyn);
  return (mx, my, mz, w) => fMacro(mx, my, mz, w) + lambda * fMicro(N * mx, N * my, N * mz, w);
}

/**
 * 双重比表面积分离估算 + 微孔连通率。
 * @param params 场配置（type/microType/weights/N/λ）
 * @param R 采样分辨率（每轴；建议 48~64）
 */
export function analyzeHierarchical(
  params: {
    type: TpmType;
    microType: TpmType;
    frequency: number;
    amplitude: number;
    weights: [number, number, number, number];
    periods: number;
    iso: number;
    customFormula: string;
  },
  R = 48,
): { ssaTotal: number; ssaMacro: number; ssaMicroAdded: number; microConnectivity: number } {
  const k = params.periods;
  const N = Math.max(1, params.frequency);
  const w = params.weights;
  const dyn = { k, t: 1, iso: params.iso };
  const fMacro = getTpmsFunction(params.type, params.customFormula, dyn);
  const fMicro = params.microType === 'custom'
    ? getTpmsFunction('custom', params.customFormula, dyn)
    : getTpmsFunction(params.microType, '', dyn);
  void R;

  // ── coarea MC：|∇F| 均值 ≈ 单位体积等值面面积（面积密度）──
  const gradAt = (f: (mx: number, my: number, mz: number, w: Weights) => number, x: number, y: number, z: number): number => {
    const hh = 1e-3;
    const gx = f(x + hh, y, z, w) - f(x - hh, y, z, w);
    const gy = f(x, y + hh, z, w) - f(x, y - hh, z, w);
    const gz = f(x, y, z + hh, w) - f(x, y, z - hh, w);
    return Math.hypot(gx, gy, gz) / (2 * hh);
  };
  let gTot = 0, gMac = 0;
  const samples = 40000;
  let seed = 20260828;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < samples; i++) {
    const mx = (rnd() * 2 - 1) * Math.PI * k;
    const my = (rnd() * 2 - 1) * Math.PI * k;
    const mz = (rnd() * 2 - 1) * Math.PI * k;
    gTot += gradAt((x, y, z, ww) => fMacro(x, y, z, ww) + params.amplitude * fMicro(N * x, N * y, N * z, ww), mx, my, mz);
    gMac += gradAt(fMacro, mx, my, mz);
  }
  const ssaTotal = gTot / samples;
  const ssaMacro = gMac / samples;

  // ── 微孔连通率：微场空隙 6 连通 BFS（N·R³ 采样网格太大，用 micro 专属 32³ 网格）──
  const Rm = 32;
  const size = Rm * Rm * Rm;
  const voidAt = new Uint8Array(size);
  let voidCount = 0;
  const microVal = new Float64Array(size);
  let vmin = Infinity, vmax = -Infinity;
  for (let iz = 0; iz < Rm; iz++) {
    for (let iy = 0; iy < Rm; iy++) {
      for (let ix = 0; ix < Rm; ix++) {
        const mx = (-Math.PI + ((ix + 0.5) / Rm) * 2 * Math.PI) * k;
        const my = (-Math.PI + ((iy + 0.5) / Rm) * 2 * Math.PI) * k;
        const mz = (-Math.PI + ((iz + 0.5) / Rm) * 2 * Math.PI) * k;
        const v = fMicro(N * mx, N * my, N * mz, w);
        const i = ix + iy * Rm + iz * Rm * Rm;
        microVal[i] = v;
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  const isoMicro = (vmin + vmax) / 2;   // 微场中位等值：50% 孔隙率的微结构
  for (let i = 0; i < size; i++) {
    if (microVal[i] < isoMicro) { voidAt[i] = 1; voidCount++; }
  }
  // 最大连通簇（6 连通 BFS）
  const label = new Int32Array(size).fill(-1);
  let best = 0;
  const queue = new Int32Array(size);
  let nClusters = 0;
  for (let s = 0; s < size; s++) {
    if (!voidAt[s] || label[s] >= 0) continue;
    let head = 0, tail = 0, count = 0;
    queue[tail++] = s;
    label[s] = nClusters;
    while (head < tail) {
      const c = queue[head++];
      count++;
      const ix = c % Rm, iy = Math.floor((c % (Rm * Rm)) / Rm), iz = Math.floor(c / (Rm * Rm));
      if (ix > 0 && voidAt[c - 1] && label[c - 1] < 0) { label[c - 1] = nClusters; queue[tail++] = c - 1; }
      if (ix < Rm - 1 && voidAt[c + 1] && label[c + 1] < 0) { label[c + 1] = nClusters; queue[tail++] = c + 1; }
      if (iy > 0 && voidAt[c - Rm] && label[c - Rm] < 0) { label[c - Rm] = nClusters; queue[tail++] = c - Rm; }
      if (iy < Rm - 1 && voidAt[c + Rm] && label[c + Rm] < 0) { label[c + Rm] = nClusters; queue[tail++] = c + Rm; }
      if (iz > 0 && voidAt[c - Rm * Rm] && label[c - Rm * Rm] < 0) { label[c - Rm * Rm] = nClusters; queue[tail++] = c - Rm * Rm; }
      if (iz < Rm - 1 && voidAt[c + Rm * Rm] && label[c + Rm * Rm] < 0) { label[c + Rm * Rm] = nClusters; queue[tail++] = c + Rm * Rm; }
    }
    if (count > best) best = count;
    nClusters++;
  }
  const microConnectivity = voidCount > 0 ? best / voidCount : 0;

  return { ssaTotal, ssaMacro, ssaMicroAdded: ssaTotal - ssaMacro, microConnectivity };
}
