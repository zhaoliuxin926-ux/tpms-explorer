/**
 * 异构/混合 TPMS 函数
 * 支持两种 TPMS 曲面的空间平滑过渡。
 */

import type { TpmType } from '../types';
import { getTpmsFunction, type Weights } from './tpms-functions';

/** 混合模式 */
export type BlendFunction = 'sigmoid' | 'linear';

/** 混合配置 */
export interface HybridConfig {
  enabled: boolean;
  typeB: TpmType;
  blendFunction: BlendFunction;
  blendCenter: number;  // 混合中心位置（物理坐标）
  blendWidth: number;   // 混合过渡宽度
}

/** Sigmoid 混合权重: w(x) = 1 / (1 + exp(-k·(x - c))) */
function sigmoidWeight(x: number, center: number, width: number): number {
  const k = 6 / Math.max(width, 0.01);  // 宽度控制陡峭度
  return 1 / (1 + Math.exp(-k * (x - center)));
}

/** 线性混合权重 */
function linearWeight(x: number, center: number, width: number): number {
  const half = width / 2;
  const lo = center - half;
  const hi = center + half;
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  return (x - lo) / (hi - lo);
}

/** 获取混合权重函数 */
function getBlendWeightFn(func: BlendFunction) {
  return func === 'sigmoid' ? sigmoidWeight : linearWeight;
}

/**
 * 导出混合权重求值器（几何模块顶点着色用）。
 * 与 createHybridField 内部严格同源——着色显示的权重就是参与混合的权重，
 * 混合语义变更只动一处，屏幕所见与公式行为不会漂移。
 */
export function getHybridWeightFn(config: HybridConfig): (px: number) => number {
  const weightFn = getBlendWeightFn(config.blendFunction);
  return (px: number) => weightFn(px, config.blendCenter, config.blendWidth);
}

/**
 * 创建混合 TPMS 场函数
 * f_hybrid = w·f_A + (1-w)·f_B
 * 混合轴默认沿 X 轴（物理坐标 px），可通过扩展支持任意轴
 */
export function createHybridField(
  typeA: TpmType,
  typeB: TpmType,
  config: HybridConfig,
  customA: string = '',
  customB: string = ''
): (mx: number, my: number, mz: number, px: number, w: Weights) => number {
  const fA = getTpmsFunction(typeA, customA);
  const fB = getTpmsFunction(typeB, customB);
  const weightFn = getHybridWeightFn(config);

  return (mx: number, my: number, mz: number, px: number, w: Weights) => {
    const vA = fA(mx, my, mz, w);
    const vB = fB(mx, my, mz, w);
    const weight = weightFn(px);
    return weight * vA + (1 - weight) * vB;
  };
}
