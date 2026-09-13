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

import type { TpmType, StructureMode, ContainerShape, StressConfig } from '../types';
import { getTpmsFunction } from '../core/tpms-functions';
import { transformByStress, stressThicknessScale } from '../core/stress-driven-field';

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
  /** 【v3.0 阶段 IV】应力场引导（与屏幕几何同语义，preset none 忽略） */
  stress?: StressConfig;
  /**
   * 【方向 C 2026-09-13】C5 mesh 容器 SDF（(R+1)³ 节点，phys 域 [-1,1]，外正内负）。
   * 提供时容器判定 = 体素中心三线性采样 sdf < 0（替代 boundAt 解析式）；
   * 容器外体素既非固相也非流体（polyMesh 四 patch 口径的正确域划分）。
   */
  containerSdf?: Float32Array;
}

export interface VoxelModel {
  R: number;
  hWc: number;               // 体素边长（wc 域）
  solid: Uint8Array;         // R³，1 = 固相体素
  solidCount: number;
  /** 容器内体素数（cube = R³；cylinder = 柱内格点数；mesh = sdf<0 格点数）——体素孔隙率的正确分母（口径专项 2026-09-13） */
  insideCount: number;
  /** 容器内掩码（方向 C：polyMesh 流体域 = inside && !solid；容器外既非固相也非流体） */
  inside: Uint8Array;
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

  // 容器判定（与 surface-nets boundAt 同语义）；mesh 容器 = 体素中心三线性采样 SDF
  // （SDF 网格 n=R+1 与体素域同跨 [-1,1]，体素中心 i 恰落格坐标 i+0.5——采样即 8 邻均值）
  const cSdf = params.containerSdf;
  const sdfAt = (px: number, py: number, pz: number): number => {
    const gx = ((px / Math.PI) + 1) / 2 * R, gy = ((py / Math.PI) + 1) / 2 * R, gz = ((pz / Math.PI) + 1) / 2 * R;
    const i0 = Math.min(R - 1, Math.max(0, Math.floor(gx))), j0 = Math.min(R - 1, Math.max(0, Math.floor(gy))), k0 = Math.min(R - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i0)), fy = Math.min(1, Math.max(0, gy - j0)), fz = Math.min(1, Math.max(0, gz - k0));
    const i1 = Math.min(R, i0 + 1), j1 = Math.min(R, j0 + 1), k1 = Math.min(R, k0 + 1);
    const at = (a: number, b: number, c: number) => cSdf![(c * (R + 1) + b) * (R + 1) + a];
    const c00 = at(i0, j0, k0) * (1 - fx) + at(i1, j0, k0) * fx;
    const c01 = at(i0, j1, k0) * (1 - fx) + at(i1, j1, k0) * fx;
    const c10 = at(i0, j0, k1) * (1 - fx) + at(i1, j0, k1) * fx;
    const c11 = at(i0, j1, k1) * (1 - fx) + at(i1, j1, k1) * fx;
    return (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
  };
  const boundAt = (px: number, py: number, pz: number): number => {
    if (params.containerShape === 'cylinder') {
      return Math.max(px * px + py * py - 1, Math.abs(pz) - 1);
    }
    return Math.max(Math.abs(px) - 1, Math.max(Math.abs(py) - 1, Math.abs(pz) - 1));
  };

  // 1. V 场（体素中心；容器外不参与二分）
  const V = new Float64Array(N * N * N);
  const inside = new Uint8Array(N * N * N);
  let insideCount = 0;
  let minV = Infinity, maxV = -Infinity;
  for (let iz = 0; iz < N; iz++) {
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        const px = center(ix), py = center(iy), pz = center(iz);
        const i = ix + iy * N + iz * N * N;
        // boundAt 语义为归一化坐标（±1），与 surface-nets 的 phys 口径一致
        if ((cSdf ? sdfAt(px, py, pz) : boundAt(px / Math.PI, py / Math.PI, pz / Math.PI)) < 0) { inside[i] = 1; insideCount++; }
        // 【阶段 IV】主轴各向异性坐标变换（与 surface-nets 的包装同语义）
        const v = params.stress && params.stress.preset !== 'none'
          ? tpmFn(...transformByStress(params.stress, px * k, py * k, pz * k), w)
          : tpmFn(px * k, py * k, pz * k, w);
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
        const tS = params.stress && params.stress.preset !== 'none' && params.structureMode !== 'solid_network'
          ? stressThicknessScale(params.stress, center(ix), center(iy), center(iz)) : 1;
        const tLoc = tEff * tS;
        const f = params.structureMode === 'solid_network' ? bias - V[i] : dv * dv - (tLoc / 2) * (tLoc / 2);
        if (f > 0) { solid[i] = 1; solidCount++; }
      }
    }
  }

  return {
    R,
    hWc,
    solid,
    solidCount,
    insideCount,
    inside,
    isoUsed: params.structureMode === 'solid_network' ? bias : tEff / 2,
  };
}
