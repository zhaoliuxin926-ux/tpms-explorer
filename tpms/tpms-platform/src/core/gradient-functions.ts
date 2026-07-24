/**
 * 多维空间梯度函数
 * 在现有 Z 轴渐变基础上，新增径向梯度与球形梯度。
 */

import type { GradientDirection } from '../types';

/** 梯度评估器：给定物理坐标 [-1,1]³，返回厚度缩放系数 tScale ∈ [0.5, 1.5] */
export type GradientEvaluator = (px: number, py: number, pz: number) => number;

/** Z 轴线性梯度：底部厚(致密承重) → 顶部薄(疏松促长入) */
function zGradient(_px: number, _py: number, pz: number): number {
  // pz ∈ [-1, 1] → 映射到 [1.5, 0.5]：pz=-1(底) 得 1.5(厚)，pz=+1(顶) 得 0.5(薄)
  return 1.5 - (pz + 1) * 0.5;
}

/** 径向梯度：中心 → 边缘（sqrt 消除：使用平方距离与阈值平方比较） */
function radialGradient(px: number, py: number, _pz: number): number {
  const r2 = px * px + py * py;
  // r² / 2 等价于 (r / √2)²，映射到 [0, ~1]
  const t = Math.min(r2 / 2, 1.4);
  return 1.5 - t;
}

/** 球形梯度：中心 → 表面（sqrt 消除） */
function sphericalGradient(px: number, py: number, pz: number): number {
  const r2 = px * px + py * py + pz * pz;
  // r² / 3 等价于 (r / √3)²
  const t = Math.min(r2 / 3, 1.4);
  return 1.5 - t;
}

/** 方向 → 评估器映射 */
export const GRADIENT_EVALUATORS: Record<GradientDirection, GradientEvaluator> = {
  z: zGradient,
  radial: radialGradient,
  spherical: sphericalGradient,
};

/** 获取评估器 */
export function getGradientEvaluator(dir: GradientDirection): GradientEvaluator {
  return GRADIENT_EVALUATORS[dir];
}
