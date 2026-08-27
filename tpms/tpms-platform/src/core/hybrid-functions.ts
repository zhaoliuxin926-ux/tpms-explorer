/**
 * 异构/混合 TPMS 函数
 * 支持两种 TPMS 曲面的空间平滑过渡。
 */

import type { TpmType, BlendAxis } from '../types';
import { getTpmsFunction, type Weights } from './tpms-functions';

/** 混合模式 */
export type BlendFunction = 'sigmoid' | 'linear';

export type { BlendAxis };

/** 混合配置 */
export interface HybridConfig {
  enabled: boolean;
  typeB: TpmType;
  blendFunction: BlendFunction;
  blendCenter: number;  // 混合中心位置（物理坐标）
  blendWidth: number;   // 混合过渡宽度
  axis?: BlendAxis;     // 缺省 'x'（兼容既有状态/URL）
}

/** Sigmoid 混合权重: w(t) = 1 / (1 + exp(-k·(t - c))) */
function sigmoidWeight(t: number, center: number, width: number): number {
  const k = 6 / Math.max(width, 0.01);  // 宽度控制陡峭度
  return 1 / (1 + Math.exp(-k * (t - center)));
}

/** 线性混合权重 */
function linearWeight(t: number, center: number, width: number): number {
  const half = width / 2;
  const lo = center - half;
  const hi = center + half;
  if (t <= lo) return 0;
  if (t >= hi) return 1;
  return (t - lo) / (hi - lo);
}

/** 获取混合权重函数 */
function getBlendWeightFn(func: BlendFunction) {
  return func === 'sigmoid' ? sigmoidWeight : linearWeight;
}

/**
 * 波前坐标：把物理坐标投影到所选混合轴的一维波前参数 t。
 * radial 取球面半径 √(x²+y²+z²)（中心在原点，与 blendCenter/radial 配对）。
 */
function wavefrontCoord(axis: BlendAxis | undefined, x: number, y: number, z: number): number {
  switch (axis) {
    case 'y': return y;
    case 'z': return z;
    case 'radial': return Math.sqrt(x * x + y * y + z * z);
    default: return x;
  }
}

/**
 * 导出混合权重求值器（几何模块顶点着色/曲率用）。
 * 与 createHybridField 内部严格同源——着色显示的权重就是参与混合的权重，
 * 混合语义变更只动一处，屏幕所见与公式行为不会漂移。
 */
export function getHybridWeightFn(config: HybridConfig): (x: number, y: number, z: number) => number {
  const weightFn = getBlendWeightFn(config.blendFunction);
  return (x: number, y: number, z: number) => weightFn(wavefrontCoord(config.axis, x, y, z), config.blendCenter, config.blendWidth);
}

/**
 * 创建混合 TPMS 场函数
 * F_hybrid = w·F_A + (1−w)·F_B，w 由混合轴向投影坐标决定
 */
export function createHybridField(
  typeA: TpmType,
  typeB: TpmType,
  config: HybridConfig,
  customA: string = '',
  customB: string = ''
): (mx: number, my: number, mz: number, px: number, py: number, pz: number, w: Weights) => number {
  const fA = getTpmsFunction(typeA, customA);
  const fB = getTpmsFunction(typeB, customB);
  const weightFn = getHybridWeightFn(config);

  return (mx: number, my: number, mz: number, px: number, py: number, pz: number, w: Weights) => {
    const vA = fA(mx, my, mz, w);
    const vB = fB(mx, my, mz, w);
    const weight = weightFn(px, py, pz);
    return weight * vA + (1 - weight) * vB;
  };
}
