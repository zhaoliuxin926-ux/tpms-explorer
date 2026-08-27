/**
 * 顶点颜色映射（Colormap 热力图）
 *
 * 标量特征 S(x) 的三种口径（均只依赖顶点物理坐标，与等值面提取解耦）：
 *   · field     混合开启 → 混合权重 w(px)（与 hybrid 场内部严格同源，见
 *                 getHybridWeightFn）；否则梯度双壳 → 厚度缩放系数
 *                 tScale(px,py,pz)，两遍扫描做 min/max 归一化到 [0,1]
 *   · elevation Z 高度归一化 S=(pz+1)/2，域恒为 [-1,1]，无需归一化扫描
 *
 * 配色：Cool-Warm（蓝→白→红发散色谱），5 停靠点线性插值 LUT——
 * 选它而非 Turbo/Viridis 的原因：权重/梯度天然以 0.5 为"中性"中心，
 * 发散色谱让过渡带一眼可辨。
 *
 * 入口 computeVertexColors 被 Worker（surface-nets 重建时）与主线程
 * （geoCache 缓存命中补色）两侧共用同一实现，杜绝两条路径语义分叉。
 */

import type { ColoringMode, GradientDirection, TpmType } from '../types';
import type { HybridConfig } from '../core/hybrid-functions';
import { getHybridWeightFn } from '../core/hybrid-functions';
import { getGradientEvaluator } from '../core/gradient-functions';
import { estimateCurvatureScalars } from './curvature';

/** [s, r, g, b] 停靠点；取值参考 Moreland Cool-Warm 采样 */
const COOLWARM_STOPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 0.23, 0.30, 0.75],
  [0.25, 0.47, 0.56, 0.86],
  [0.50, 0.87, 0.87, 0.87],
  [0.75, 0.94, 0.42, 0.34],
  [1.0, 0.71, 0.02, 0.15],
];

/** 把标量 s∈[0,1] 写入 colors[i3..i3+2]（越界钳制） */
export function sampleCoolWarmInto(s: number, colors: Float32Array, i3: number): void {
  const t = s < 0 ? 0 : s > 1 ? 1 : s;
  let lo = 0;
  while (lo < COOLWARM_STOPS.length - 2 && t > COOLWARM_STOPS[lo + 1][0]) lo++;
  const a = COOLWARM_STOPS[lo], b = COOLWARM_STOPS[lo + 1];
  const span = b[0] - a[0];
  const u = span > 0 ? (t - a[0]) / span : 0;
  colors[i3] = a[1] + (b[1] - a[1]) * u;
  colors[i3 + 1] = a[2] + (b[2] - a[2]) * u;
  colors[i3 + 2] = a[3] + (b[3] - a[3]) * u;
}

export interface VertexColorOptions {
  mode: Exclude<ColoringMode, 'none'>;
  /** hybrid.enabled 时传入完整配置；缺省表示混合未启用 → field 落到梯度口径 */
  hybrid?: HybridConfig;
  gradientDir: GradientDirection;
  /**
   * 曲率口径（mean/gauss_curvature）必需：隐函数场配置，须与屏幕几何同源。
   * 缺失时优雅退化为高度着色，不抛错。
   */
  field?: {
    type: TpmType;
    customFormula: string;
    weights: [number, number, number, number];
    periods: number;
  };
}

const INV_PI = 1 / Math.PI;

/**
 * 由顶点坐标计算颜色数组。positions 为 wc 域（[-π,π]·k 周期由频率承载，
 * 单顶点跨度恒 ±π）。返回长度 vertCount*3，vertCount===0 时返回 null。
 */
export function computeVertexColors(
  positions: Float32Array,
  vertCount: number,
  opts: VertexColorOptions,
): Float32Array | null {
  if (vertCount === 0 || positions.length < vertCount * 3) return null;
  const colors = new Float32Array(vertCount * 3);

  // 曲率口径：数值中心差分 ∇F/Hessian → 对称截断分位数归一化标量
  if (opts.mode === 'mean_curvature' || opts.mode === 'gauss_curvature') {
    if (!opts.field) return computeVertexColors(positions, vertCount, { ...opts, mode: 'elevation' });
    const scalars = estimateCurvatureScalars(
      positions, vertCount, { ...opts.field, hybrid: opts.hybrid },
      opts.mode === 'mean_curvature' ? 'mean' : 'gauss',
    );
    for (let i = 0; i < vertCount; i++) sampleCoolWarmInto(scalars[i], colors, i * 3);
    return colors;
  }

  if (opts.mode === 'elevation') {
    for (let i = 0; i < vertCount; i++) {
      const pz = positions[i * 3 + 2] * INV_PI;
      sampleCoolWarmInto((pz + 1) * 0.5, colors, i * 3);
    }
    return colors;
  }

  // ── field 口径 ──
  if (opts.hybrid?.enabled) {
    // 混合权重 w(px)：sigmoid/linear 的值域本身就是 [0,1]，直接上色
    const wf = getHybridWeightFn(opts.hybrid);
    for (let i = 0; i < vertCount; i++) {
      sampleCoolWarmInto(wf(positions[i * 3] * INV_PI, positions[i * 3 + 1] * INV_PI, positions[i * 3 + 2] * INV_PI), colors, i * 3);
    }
    return colors;
  }

  // 梯度厚度缩放系数：值域随方向不同（z:[0.5,1.5]，radial/spherical:[0.1,1.5]，
  // 内部 clamp 1.4→下界 0.1），用两遍扫描按实测 min/max 归一化，避免硬编码域
  const grad = getGradientEvaluator(opts.gradientDir);
  let sMin = Infinity, sMax = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const px = positions[i * 3] * INV_PI;
    const py = positions[i * 3 + 1] * INV_PI;
    const pz = positions[i * 3 + 2] * INV_PI;
    const sv = grad(px, py, pz);
    if (sv < sMin) sMin = sv;
    if (sv > sMax) sMax = sv;
  }
  const range = sMax - sMin;
  if (!(range > 1e-12)) {
    // 退化（如 mesh 只有单层顶点）：统一填中性感，避免除零产生 NaN 颜色
    for (let i = 0; i < vertCount; i++) sampleCoolWarmInto(0.5, colors, i * 3);
    return colors;
  }
  const invRange = 1 / range;
  for (let i = 0; i < vertCount; i++) {
    const px = positions[i * 3] * INV_PI;
    const py = positions[i * 3 + 1] * INV_PI;
    const pz = positions[i * 3 + 2] * INV_PI;
    sampleCoolWarmInto((grad(px, py, pz) - sMin) * invRange, colors, i * 3);
  }
  return colors;
}
