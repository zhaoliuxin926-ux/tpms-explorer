/**
 * CAE 体素模型（v3.0 阶段 III · Abaqus/OpenFOAM 体网格共用分类语义源）
 *
 * 把 TPMS 场离散为 R³ 体素（中心采样），提供与屏幕几何同语义的固相判定：
 *   solid_network: bias − V > 0（二分求 bias）
 *   shell:         dv² − (tEff/2)² > 0（二分求 tEff）
 *   容器外（cube: |p|>1 任一轴；cylinder: r>1 或 |z|>1）无条件为空。
 * 与 surface-nets 的差异：体素中心采样（非节点采样）、不含端板覆写
 * （CAE 体网格导出为均匀多孔段语义，端板属增材工艺层，文档化声明）。
 */

import type { TpmType, StructureMode, ContainerShape } from '../types';
import { getTpmsFunction } from '../core/tpms-functions';

export interface VoxelModelParams {
  type: TpmType;
  periods: number;
  weights: [number, number, number, number];
  structureMode: StructureMode;
  containerShape: ContainerShape;
  thickness: number;
  targetPorosity: number;
  iso: number;
  customFormula: string;
}

export interface VoxelModel {
  R: number;
  hWc: number;               // 体素边长（wc 域）
  solid: Uint8Array;         // R³，1 = 固相体素
  solidCount: number;
  /** 载入的等值参数（INP 头部元数据） */
  isoUsed: number;
}

export function buildVoxelModel(params: VoxelModelParams, R: number): VoxelModel {
  const N = R;
  const k = params.periods;
  const span = 2 * Math.PI;
  const hWc = span / R;
  const w = params.weights;

  const tpmFn = getTpmsFunction(params.type, params.customFormula, {
    k, t: params.thickness, iso: params.iso,
  });

  const center = (i: number) => -Math.PI + ((i + 0.5) / R) * span;

  // 容器判定（与 surface-nets boundAt 同语义）
  const boundAt = (px: number, py: number, pz: number): number => {
    if (params.containerShape === 'cylinder') {
      return Math.max(px * px + py * py - 1, Math.abs(pz) - 1);
    }
    return Math.max(Math.abs(px) - 1, Math.max(Math.abs(py) - 1, Math.abs(pz) - 1));
  };

  // 1. V 场（体素中心；容器外不参与二分）
  const V = new Float64Array(N * N * N);
  const inside = new Uint8Array(N * N * N);
  let minV = Infinity, maxV = -Infinity;
  for (let iz = 0; iz < N; iz++) {
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const px = center(ix), py = center(iy), pz = center(iz);
        const i = ix + iy * N + iz * N * N;
        // boundAt 语义为归一化坐标（±1），与 surface-nets 的 phys 口径一致
        if (boundAt(px / Math.PI, py / Math.PI, pz / Math.PI) < 0) inside[i] = 1;
        const v = tpmFn(px * k, py * k, pz * k, w);
        V[i] = v;
        if (inside[i]) { if (v < minV) minV = v; if (v > maxV) maxV = v; }
      }
    }
  }
  if (!Number.isFinite(minV) || maxV - minV < 1e-9) {
    throw new Error('曲面场退化为常数，无法构建体素模型');
  }

  // 2. 二分（容器内样本；solid: bias；shell: tEff）
  let bias = params.iso;
  let tEff = Math.max(0.05, params.thickness * 1.5);
  {
    const samples: number[] = [];
    for (let i = 0; i < N * N * N; i++) if (inside[i]) samples.push(V[i]);
    samples.sort((a, b) => a - b);
    const n = samples.length;
    const lb = (val: number) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid] < val) lo = mid + 1; else hi = mid; } return lo; };
    const targetSolid = Math.max(0.02, Math.min(0.98, 1 - params.targetPorosity));
    if (params.structureMode === 'solid_network') {
      let lo = minV - 0.5, hi = maxV + 0.5;
      for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (lb(mid) / n > targetSolid) hi = mid; else lo = mid; }
      bias = (lo + hi) / 2;
    } else {
      const count = (t: number) => lb(-t / 2) + (n - lb(t / 2));
      let lo = 0.02, hi = (maxV - minV) * 4;
      for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (count(mid) / n > targetSolid) lo = mid; else hi = mid; }
      tEff = (lo + hi) / 2;
    }
  }

  // 3. 最终固相判定（容器外强制空）
  const solid = new Uint8Array(N * N * N);
  let solidCount = 0;
  for (let iz = 0; iz < N; iz++) {
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const i = ix + iy * N + iz * N * N;
        if (!inside[i]) continue;
        const dv = V[i] - bias;
        const f = params.structureMode === 'solid_network' ? bias - V[i] : dv * dv - (tEff / 2) * (tEff / 2);
        if (f > 0) { solid[i] = 1; solidCount++; }
      }
    }
  }

  return {
    R,
    hWc,
    solid,
    solidCount,
    isoUsed: params.structureMode === 'solid_network' ? bias : tEff / 2,
  };
}
