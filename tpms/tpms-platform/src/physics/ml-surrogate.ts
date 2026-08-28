/**
 * 轻量多物理场神经网络代理模型 + 多目标 Pareto 前沿（v5.0 阶段 V）
 *
 * MLP：自研前馈多层感知机（零依赖，Float64 向量矩阵运算）。
 * 教师信号：解析代理模型（inverse-design + impact-energy 同源公式）。
 * 推理：毫秒级输出 E/κ/SEA/Sv/Tb.Th；SGD 在线训练（演示口径，非生产精度）。
 *
 * Pareto：非支配排序（NSGA-II 排序骨架）→ 前沿散点 → 点击即选。
 */

import type { TpmType } from '../types';

// ── 轻量 MLP ──

export interface MLPSpec {
  layers: { w: Float64Array; b: Float64Array; nIn: number; nOut: number }[];
}

export function createMLP(dims: number[], seed = 42): MLPSpec {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const layers: MLPSpec['layers'] = [];
  for (let i = 0; i < dims.length - 1; i++) {
    const nIn = dims[i], nOut = dims[i + 1];
    const w = new Float64Array(nIn * nOut);
    const scale = Math.sqrt(2 / nIn);
    for (let j = 0; j < w.length; j++) w[j] = (rnd() * 2 - 1) * scale;
    layers.push({ w, b: new Float64Array(nOut), nIn, nOut });
  }
  return { layers };
}

export function mlpForward(mlp: MLPSpec, x: Float64Array): Float64Array {
  let act = x;
  for (const layer of mlp.layers) {
    const next = new Float64Array(layer.nOut);
    for (let o = 0; o < layer.nOut; o++) {
      let s = layer.b[o];
      for (let i = 0; i < layer.nIn; i++) s += layer.w[o * layer.nIn + i] * act[i];
      next[o] = o < mlp.layers.length - 1 ? Math.max(0, s) : s;   // ReLU 隐层 / 线性输出
    }
    act = next;
  }
  return act;
}

/** SGD 在线训练（MSE 损失；演示口径） */
export function trainMLP(mlp: MLPSpec, inputs: Float64Array[], targets: Float64Array[], epochs: number, lr: number): void {
  for (let ep = 0; ep < epochs; ep++) {
    for (let si = 0; si < inputs.length; si++) {
      // 前向存储
      const acts: Float64Array[] = [inputs[si]];
      for (const layer of mlp.layers) {
        const prev = acts[acts.length - 1];
        const next = new Float64Array(layer.nOut);
        for (let o = 0; o < layer.nOut; o++) {
          let s = layer.b[o];
          for (let i = 0; i < layer.nIn; i++) s += layer.w[o * layer.nIn + i] * prev[i];
          next[o] = o < mlp.layers.length - 1 ? Math.max(0, s) : s;
        }
        acts.push(next);
      }
      // 反向（MSE + ReLU 链）
      let delta = new Float64Array(acts[acts.length - 1]);
      const lastOut = acts[acts.length - 1];
      for (let o = 0; o < delta.length; o++) delta[o] = 2 * (lastOut[o] - targets[si][o]);
      for (let li = mlp.layers.length - 1; li >= 0; li--) {
        const layer = mlp.layers[li];
        const prevAct = acts[li];
        const newDelta = new Float64Array(prevAct.length);
        for (let o = 0; o < layer.nOut; o++) {
          let d = delta[o];
          if (li < mlp.layers.length - 1 && acts[li + 1][o] <= 0) d = 0;
          for (let i = 0; i < layer.nIn; i++) {
            newDelta[i] += layer.w[o * layer.nIn + i] * d;
            layer.w[o * layer.nIn + i] -= lr * d * prevAct[i];
          }
          layer.b[o] -= lr * d;
        }
        delta = newDelta;
      }
    }
  }
}

// ── 多目标 Pareto ──

export interface ParetoPoint {
  E: number;           // GPa
  kappa: number;       // m²
  sea: number;         // J/g
  type: TpmType;
  porosity: number;
  cellSize: number;
}

/** 非支配排序（最小化 −E 最大化... 简化：E 越大越好，κ 越大越好，SEA 越大越好） */
export function paretoFront(points: ParetoPoint[]): ParetoPoint[] {
  const dominated = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      // j 支配 i ⟺ j ≥ i 全维 且 j > i 至少一维
      const eOk = points[j].E >= points[i].E;
      const kOk = points[j].kappa >= points[i].kappa;
      const sOk = points[j].sea >= points[i].sea;
      const strict = points[j].E > points[i].E || points[j].kappa > points[i].kappa || points[j].sea > points[i].sea;
      if (eOk && kOk && sOk && strict) { dominated.add(i); break; }
    }
  }
  return points.filter((_, i) => !dominated.has(i));
}
