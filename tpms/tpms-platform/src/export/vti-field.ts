import type { AppState } from '../types';
import { evaluateField } from '../core/tpms-functions';
import { l2Resolution } from '../core/units';

/** 基础等值（简化版：0 附近，二分在 Worker 精算） */
export function baseIso(s: AppState): number {
  let iso = 0;
  if (s.model === 'solid') {
    iso -= (s.thickness - 1) * 0.12;
  }
  return iso;
}

/**
 * 在主线程重采样 TPMS 隐函数标量场，供 VTI 体素导出使用。
 * 物理域 [-1,1]³ 映射到弧度域：m = π · cellSize · p（与 surface-nets 一致）。
 * 注：导出基础场（type A），异构混合/壳变换不写入，供 ParaView 自由 re-contour。
 */
export function buildVtiField(s: AppState): { field: Float32Array; dims: [number, number, number] } {
  const R = l2Resolution(s.type, s.structureMode, s.gradientDir, s.cellSize);   // 倍频曲面密度同步加倍
  const N = R + 1;
  const field = new Float32Array(N * N * N);
  const k = s.cellSize;
  const w = s.weights;
  let idx = 0;
  for (let iz = 0; iz < N; iz++) {
    const mz = ((iz / R) * 2 - 1) * Math.PI * k;
    for (let iy = 0; iy < N; iy++) {
      const my = ((iy / R) * 2 - 1) * Math.PI * k;
      for (let ix = 0; ix < N; ix++) {
        const mx = ((ix / R) * 2 - 1) * Math.PI * k;
        field[idx++] = evaluateField(s.type, mx, my, mz, w, s.customFormula, { k: s.cellSize, t: s.thickness, iso: baseIso(s) });
      }
    }
  }
  return { field, dims: [N, N, N] };
}
