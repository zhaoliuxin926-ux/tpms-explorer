/**
 * Surface Nets 等值面重建算法
 * 从 app.html 完整迁移到 TypeScript 模块，使用 BufferPool 消除频繁 new TypedArray 的 GC 开销。
 *
 * 核心流程：
 *  1. 预计算 TPMS 标量场 V（弧度域）
 *  2. 预计算容器边界场 boundArr（立方体 / 圆柱体，圆柱用平方比较省 sqrt）
 *  3. 孔隙率驱动的二分搜索（预排序 + lower_bound）
 *  4. Monte Carlo 体积分数估算（cell 中心采样，8 角平均）
 *  5. 生成最终场 field = max(F_tpms, F_bound)
 *  6. Surface Nets 顶点生成（12 条边零 crossing 插值）
 *  7. 三角面提取（四角退化时自动补三角）
 *  8. Laplacian 平滑（6 邻域均值，preview 1 轮 / full 2 轮）
 *  9. 解析法线（隐函数梯度 ∇f；preview 跳过，改用离散 computeVertexNormals）
 * 10. 几何指标（表面积、包围体积、比表面积 Sv）
 */

import { BufferPool, globalBufferPool } from './buffer-pool';
import type { BuildParams, WorkerResponse } from '../types';
import { getGradientEvaluator } from '../core/gradient-functions';
import { createHybridField } from '../core/hybrid-functions';
import { getTpmsFunction, type Weights } from '../core/tpms-functions';
import { computeSurfaceArea, computeEnvelopeVolume, computeSvRatio } from '../physics/surface-area';

/** 线性索引辅助函数：将三维网格坐标 (ix, iy, iz) 展平为一维 */
const idxF = (N: number) => (ix: number, iy: number, iz: number) => ix + iy * N + iz * N * N;

/**
 * 离散顶点法线计算（逐面法线加权平均）
 * 供 preview 模式替代耗时的解析法线，节省约 30% 重建时间。
 */
function computeVertexNormals(positions: Float32Array, indices: Uint32Array, normals: Float32Array): void {
  const vertCount = positions.length / 3;
  normals.fill(0);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];

    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];

    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }

  for (let i = 0; i < vertCount; i++) {
    const i3 = i * 3;
    let nx = normals[i3], ny = normals[i3 + 1], nz = normals[i3 + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[i3] = nx / len;
    normals[i3 + 1] = ny / len;
    normals[i3 + 2] = nz / len;
  }
}

/**
 * 主重建函数
 * @param params  构建参数（类型、分辨率、孔隙率、结构模式等）
 * @param pool    BufferPool 实例（默认使用全局单例）
 * @returns       WorkerResponse 兼容的结果对象
 */
export function buildSurface(params: BuildParams, pool: BufferPool = globalBufferPool): WorkerResponse {
  const t0 = performance.now();

  const {
    type, iso, periods, resolution: R, targetPorosity,
    weights, structureMode: mode, containerShape: container,
    thickness, gradientDir, hybrid, customFormula, preview: isPreview,
  } = params;

  const N = R + 1;
  const half = Math.PI;
  const span = 2 * half;
  const k = periods;
  const w = weights as Weights;

  const index = idxF(N);

  // ──────────────────────────────────────────────────────────────
  // 梯度评估器（仅在 gradient_shell 模式下生效）
  // ──────────────────────────────────────────────────────────────
  const gradientEvaluator = mode === 'gradient_shell' ? getGradientEvaluator(gradientDir) : null;

  // hybrid / custom / lidinoid / splitp 无法使用 sin/cos 查表，需实时求值
  const hybridEnabled = hybrid.enabled;
  const useLookup = !hybridEnabled && type !== 'custom' && type !== 'lidinoid' && type !== 'splitp';

  let tpmFn: ((mx: number, my: number, mz: number, w: Weights) => number) | null = null;
  let hybridFn: ((mx: number, my: number, mz: number, px: number, w: Weights) => number) | null = null;

  if (hybridEnabled) {
    hybridFn = createHybridField(type, hybrid.typeB, hybrid, customFormula, customFormula);
  } else if (!useLookup) {
    tpmFn = getTpmsFunction(type, customFormula);
  }

  // ──────────────────────────────────────────────────────────────
  // 1. 预计算 sin/cos 查表（非 hybrid / custom 时大幅加速内层循环）
  // ──────────────────────────────────────────────────────────────
  const sn = new Float32Array(N);
  const cs = new Float32Array(N);
  const cs2 = new Float32Array(N);

  if (useLookup) {
    for (let i = 0; i < N; i++) {
      const a = (-half + (i / R) * span) * k;
      sn[i] = Math.sin(a);
      cs[i] = Math.cos(a);
      cs2[i] = Math.cos(2 * a);
    }
  }

  // 物理坐标映射：ix/R ∈ [0,1] → [-1,1]
  const phys = (i: number) => (i / R) * 2 - 1;

  // ──────────────────────────────────────────────────────────────
  // 2. 计算基础 TPMS 场 V（存入 pool.field；后续会被最终场覆盖）
  // ──────────────────────────────────────────────────────────────
  const V = pool.field.subarray(0, N * N * N);
  let minV = Infinity;
  let maxV = -Infinity;

  if (useLookup) {
    for (let iz = 0; iz < N; iz++) {
      const Sz = sn[iz], Cz = cs[iz], C2z = cs2[iz];
      const zB = iz * N * N;
      for (let iy = 0; iy < N; iy++) {
        const Sy = sn[iy], Cy = cs[iy], C2y = cs2[iy];
        const yB = zB + iy * N;
        for (let ix = 0; ix < N; ix++) {
          const Sx = sn[ix], Cx = cs[ix], C2x = cs2[ix];
          let v: number;
          if (type === 'gyroid') {
            v = w[0] * Sx * Cy + w[1] * Sy * Cz + w[2] * Sz * Cx;
          } else if (type === 'neovius') {
            v = w[0] * 3 * (Cx + Cy + Cz) + w[1] * 4 * Cx * Cy * Cz;
          } else if (type === 'iwp') {
            v = w[0] * 2 * (Cx * Cy + Cy * Cz + Cz * Cx) - w[1] * (C2x + C2y + C2z);
          } else if (type === 'frd') {
            v = w[0] * 4 * Cx * Cy * Cz - w[1] * (C2x * C2y + C2y * C2z + C2z * C2x);
          } else if (type === 'diamond') {
            v = w[0] * Sx * Sy * Sz + w[1] * Sx * Cy * Cz + w[2] * Cx * Sy * Cz + w[3] * Cx * Cy * Sz;
          } else {
            v = w[0] * Cx + w[1] * Cy + w[2] * Cz;
          }
          const idx = yB + ix;
          V[idx] = v;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
    }
  } else {
    for (let iz = 0; iz < N; iz++) {
      const zB = iz * N * N;
      for (let iy = 0; iy < N; iy++) {
        const yB = zB + iy * N;
        for (let ix = 0; ix < N; ix++) {
          const mx = (-half + (ix / R) * span) * k;
          const my = (-half + (iy / R) * span) * k;
          const mz = (-half + (iz / R) * span) * k;
          const px = phys(ix);
          let v: number;
          if (hybridFn) {
            v = hybridFn(mx, my, mz, px, w);
          } else {
            v = tpmFn!(mx, my, mz, w);
          }
          const idx = yB + ix;
          V[idx] = v;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 3. 容器边界函数与预计算 boundArr
  // ──────────────────────────────────────────────────────────────
  const boundAt = (px: number, py: number, pz: number): number => {
    if (container === 'cylinder') {
      // 平方比较，省去 N³ 次 sqrt
      return Math.max(px * px + py * py - 1, Math.abs(pz) - 1);
    }
    return Math.max(Math.abs(px) - 1, Math.max(Math.abs(py) - 1, Math.abs(pz) - 1));
  };

  const boundArr = pool.boundArr.subarray(0, N * N * N);
  let containerInside = 0;

  for (let iz = 0; iz < N; iz++) {
    const pz = phys(iz);
    const zB = iz * N * N;
    for (let iy = 0; iy < N; iy++) {
      const py = phys(iy);
      const yB = zB + iy * N;
      for (let ix = 0; ix < N; ix++) {
        const b = boundAt(phys(ix), py, pz);
        boundArr[yB + ix] = b;
        if (b < 0) containerInside++;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 4. 模式公式与孔隙率二分搜索
  // ──────────────────────────────────────────────────────────────
  const biasForShell = 0;
  let tEffBase = Math.max(0.05, thickness * 1.5);
  let biasBase = iso;

  const tpmsAt = (v: number, bias: number, tEff: number, px?: number, py?: number, pz?: number): number => {
    if (mode === 'solid_network') return bias - v;
    const dv = v - bias;
    if (mode === 'gradient_shell') {
      // gradientDir 驱动厚度缩放：tGrad = tEff * gradientEvaluator(px, py, pz)
      const tScale = gradientEvaluator!(px!, py!, pz!);
      const tGrad = tEff * tScale;
      return dv * dv - (tGrad / 2) * (tGrad / 2);
    }
    return dv * dv - (tEff / 2) * (tEff / 2);
  };

  if (typeof targetPorosity === 'number') {
    // targetPorosity 已由主线程转换为 0~1 小数（main.ts 中 s.porosity / 100）
    const targetSolid = Math.max(0.02, Math.min(0.98, 1 - targetPorosity));

    // 提取容器内 V 值并排序，供 lower_bound 使用
    // 先复制到临时数组再排序，避免污染 pool.insideV 的后续使用
    const insideV = pool.insideV.subarray(0, containerInside);
    let insideIdx = 0;
    for (let i = 0; i < N * N * N; i++) {
      if (boundArr[i] < 0) {
        insideV[insideIdx++] = V[i];
      }
    }
    const insideArr = insideV.slice(0, insideIdx);
    insideArr.sort((a, b) => a - b);
    const insideN = insideArr.length;

    /** lower_bound：返回第一个 >= value 的索引；[0, idx) 均 < value */
    const lb = (value: number): number => {
      let lo = 0, hi = insideN;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (insideArr[mid] < value) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    if (mode === 'solid_network') {
      const countSolid = (bias: number) => lb(bias);
      let lo = minV - 0.5, hi = maxV + 0.5;

      // 单调性预检：非对称权重下 countSolid 可能非单调
      const samples = 5;
      let monotone = true, prev = -1;
      for (let s = 0; s <= samples; s++) {
        const v = lo + (hi - lo) * s / samples;
        const c = countSolid(v);
        if (prev >= 0 && c < prev) { monotone = false; break; }
        prev = c;
      }
      if (!monotone) {
        lo = minV - 1.0; hi = maxV + 1.0;
      }

      for (let iter = 0; iter < 16; iter++) {
        const mid = (lo + hi) / 2;
        if (countSolid(mid) / insideN > targetSolid) hi = mid;
        else lo = mid;
      }
      biasBase = (lo + hi) / 2;
    } else {
      // shell / gradient_shell：统一用 lower_bound 近似（与原代码行为一致）
      const countSolidShell = (tEff: number) => lb(-tEff / 2) + (insideN - lb(tEff / 2));
      let lo = 0.02, hi = (maxV - minV) * 4;

      for (let iter = 0; iter < 18; iter++) {
        const mid = (lo + hi) / 2;
        if (countSolidShell(mid) / insideN > targetSolid) lo = mid;
        else hi = mid;
      }
      tEffBase = (lo + hi) / 2;
      biasBase = biasForShell;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Monte Carlo 孔隙率估算（必须在覆盖 V 之前执行）
  //    cell 中心采样 + 8 角 V 平均，与 μCT 体积扫描对齐
  // ──────────────────────────────────────────────────────────────
  let monteCarloInside = 0, monteCarloSolid = 0;

  for (let cz = 0; cz < R; cz++) {
    for (let cy = 0; cy < R; cy++) {
      for (let cx = 0; cx < R; cx++) {
        const px = (cx + 0.5) / R * 2 - 1;
        const py = (cy + 0.5) / R * 2 - 1;
        const pz = (cz + 0.5) / R * 2 - 1;

        if (boundAt(px, py, pz) >= 0) continue;
        monteCarloInside++;

        const idx00 = index(cx, cy, cz);
        const v = (V[idx00] + V[idx00 + 1] + V[idx00 + N] + V[idx00 + N + 1]
          + V[idx00 + N * N] + V[idx00 + N * N + 1] + V[idx00 + N * N + N] + V[idx00 + N * N + N + 1]) * 0.125;

        const f = tpmsAt(v, biasBase, tEffBase, px, py, pz);
        if (f > 0) monteCarloSolid++;
      }
    }
  }

  const porosityEstimate = monteCarloInside > 0 ? 1 - monteCarloSolid / monteCarloInside : 0;
  const isoUsedReport = mode === 'solid_network' ? biasBase : tEffBase / 2;

  // ──────────────────────────────────────────────────────────────
  // 6. 生成最终场 field（覆盖 pool.field，V 不再被需要）
  //    F_final = max(F_tpms, F_bound)，等值面取 0
  // ──────────────────────────────────────────────────────────────
  const field = pool.field.subarray(0, N * N * N);

  for (let iz = 0; iz < N; iz++) {
    const pz = phys(iz);
    const zB = iz * N * N;
    for (let iy = 0; iy < N; iy++) {
      const py = phys(iy);
      const yB = zB + iy * N;
      for (let ix = 0; ix < N; ix++) {
        const px = phys(ix);
        const f = tpmsAt(V[yB + ix], biasBase, tEffBase, px, py, pz);
        field[yB + ix] = Math.max(f, boundArr[yB + ix]);
      }
    }
  }

  // 诊断日志（仅开发模式启用，Vite 生产构建会 tree-shake 掉）
  if (import.meta.env?.DEV) {
    let posCount = 0, negCount = 0, zeroCount = 0;
    for (let i = 0; i < N * N * N; i++) {
      const f = field[i];
      if (f > 0) posCount++;
      else if (f < 0) negCount++;
      else zeroCount++;
    }
    console.log('[buildSurface diag]', {
      type, mode, R, biasBase, tEffBase,
      containerInside,
      minV, maxV,
      fieldPos: posCount, fieldNeg: negCount, fieldZero: zeroCount,
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Surface Nets 顶点生成
  // ──────────────────────────────────────────────────────────────
  const wcTable = new Float32Array(N);
  for (let i = 0; i < N; i++) wcTable[i] = -half + (i / R) * span;
  const cellVert = pool.cellVert.subarray(0, R * R * R);
  cellVert.fill(-1);

  let vertCount = 0;
  const positions = pool.positions;
  const activeCells: number[] = [];  // 存储有顶点的 cell 编码索引（cx + cy*R + cz*R*R）

  // 12 条边的端点定义
  const ED = [
    [[0, 0, 0], [1, 0, 0]], [[0, 1, 0], [1, 1, 0]],
    [[0, 0, 1], [1, 0, 1]], [[0, 1, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0]],
    [[0, 0, 1], [0, 1, 1]], [[1, 0, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]],
    [[0, 1, 0], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]],
  ];

  for (let cz = 0; cz < R; cz++) {
    for (let cy = 0; cy < R; cy++) {
      for (let cx = 0; cx < R; cx++) {
        const corners = [
          field[index(cx, cy, cz)],
          field[index(cx + 1, cy, cz)],
          field[index(cx, cy + 1, cz)],
          field[index(cx + 1, cy + 1, cz)],
          field[index(cx, cy, cz + 1)],
          field[index(cx + 1, cy, cz + 1)],
          field[index(cx, cy + 1, cz + 1)],
          field[index(cx + 1, cy + 1, cz + 1)],
        ];

        let solid = 0;
        for (let i = 0; i < 8; i++) if (corners[i] > 0) solid++;
        if (solid === 0 || solid === 8) continue;

        let sx = 0, sy = 0, sz = 0, sc = 0;
        for (const [a, b] of ED) {
          const va = field[index(cx + a[0], cy + a[1], cz + a[2])];
          const vb = field[index(cx + b[0], cy + b[1], cz + b[2])];
          if ((va > 0) !== (vb > 0)) {
            let t = (0 - va) / (vb - va);
            if (!isFinite(t)) t = 0.5;
            t = t < 0 ? 0 : t > 1 ? 1 : t;

            const ax = wcTable[cx + a[0]], ay = wcTable[cy + a[1]], az = wcTable[cz + a[2]];
            const bx = wcTable[cx + b[0]], by = wcTable[cy + b[1]], bz = wcTable[cz + b[2]];

            sx += ax + (bx - ax) * t;
            sy += ay + (by - ay) * t;
            sz += az + (bz - az) * t;
            sc++;
          }
        }

        let vx: number, vy: number, vz: number;
        if (sc > 0) {
          vx = sx / sc; vy = sy / sc; vz = sz / sc;
        } else {
          vx = wcTable[cx] + (wcTable[cx + 1] - wcTable[cx]) * 0.5; vy = wcTable[cy] + (wcTable[cy + 1] - wcTable[cy]) * 0.5; vz = wcTable[cz] + (wcTable[cz + 1] - wcTable[cz]) * 0.5;
        }

        const i3 = vertCount * 3;
        positions[i3] = vx;
        positions[i3 + 1] = vy;
        positions[i3 + 2] = vz;
        cellVert[cx + cy * R + cz * R * R] = vertCount;
        activeCells.push(cx + cy * R + cz * R * R);
        vertCount++;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 8. 三角面提取
  //    tryFaceDirect：四角不全时降级补三角，封住边界菱形裂缝
  // ──────────────────────────────────────────────────────────────
  let indexCount = 0;
  const indices = pool.indices;

  const pushTri = (a: number, b: number, c: number) => {
    indices[indexCount++] = a;
    indices[indexCount++] = b;
    indices[indexCount++] = c;
  };
  const pushQuad = (a: number, b: number, c: number, d: number) => {
    pushTri(a, b, c);
    pushTri(a, c, d);
  };
  // 直接接收顶点索引的 tryFace 变体，避免 vAt 函数调用开销
  const tryFaceDirect = (A: number, B: number, C: number, D: number) => {
    if (A >= 0 && B >= 0 && C >= 0 && D >= 0) {
      pushQuad(A, B, C, D);
      return;
    }
    const verts = [];
    if (A >= 0) verts.push(A);
    if (B >= 0) verts.push(B);
    if (C >= 0) verts.push(C);
    if (D >= 0) verts.push(D);
    if (verts.length === 3) pushTri(verts[0], verts[1], verts[2]);
  };

  const R2 = R * R;
  for (let cz = 0; cz < R; cz++) {
    for (let cy = 0; cy < R; cy++) {
      for (let cx = 0; cx < R; cx++) {
        const vi2 = cx + cy * R + cz * R2;
        if (cellVert[vi2] < 0) continue;
        // 内联 vAt：直接通过 cellVert 查找邻接 cell 的顶点索引
        // 面 1：z = cz 平面（cz 不变，检查 cy 方向的四个 cell）
        { const A = cellVert[vi2];
          const B = cx + 1 < R ? cellVert[vi2 + 1] : -1;
          const C = cx + 1 < R && cy + 1 < R ? cellVert[vi2 + 1 + R] : -1;
          const D = cy + 1 < R ? cellVert[vi2 + R] : -1;
          tryFaceDirect(A, B, C, D); }
        // 面 2：y = cy 平面（cy 不变，检查 cz 方向）
        { const A = cellVert[vi2];
          const B = cx + 1 < R ? cellVert[vi2 + 1] : -1;
          const C = cx + 1 < R && cz + 1 < R ? cellVert[vi2 + 1 + R2] : -1;
          const D = cz + 1 < R ? cellVert[vi2 + R2] : -1;
          tryFaceDirect(A, B, C, D); }
        // 面 3：x = cx 平面（cx 不变，检查 cz 方向）
        { const A = cellVert[vi2];
          const B = cy + 1 < R ? cellVert[vi2 + R] : -1;
          const C = cy + 1 < R && cz + 1 < R ? cellVert[vi2 + R + R2] : -1;
          const D = cz + 1 < R ? cellVert[vi2 + R2] : -1;
          tryFaceDirect(A, B, C, D); }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 9. Laplacian 平滑（双重缓冲）
  //    preview 模式只跑 1 轮，full 模式 2 轮
  // ──────────────────────────────────────────────────────────────
  const cur = vertCount > 0 ? pool.smoothA.subarray(0, vertCount * 3) : null;

  if (cur) {
    for (let i = 0; i < vertCount * 3; i++) cur[i] = positions[i];

    const lambda = 0.5;
    const iters = isPreview ? 1 : 2;
    const next = pool.smoothB.subarray(0, vertCount * 3);

    for (let it = 0; it < iters; it++) {
      next.set(cur);
      for (const encoded of activeCells) {
        const self = cellVert[encoded];
        const cx2 = encoded % R;
        const cy2 = (encoded / R | 0) % R;
        const cz2 = encoded / (R * R) | 0;
        let nx = 0, ny = 0, nz = 0, nc = 0;
        // 6 邻域：直接通过 cellVert 查找，内联边界检查避免 vAt 调用
        if (cx2 > 0) { const nb = cellVert[encoded - 1]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (cx2 < R - 1) { const nb = cellVert[encoded + 1]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (cy2 > 0) { const nb = cellVert[encoded - R]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (cy2 < R - 1) { const nb = cellVert[encoded + R]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (cz2 > 0) { const nb = cellVert[encoded - R * R]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (cz2 < R - 1) { const nb = cellVert[encoded + R * R]; if (nb >= 0) { nx += cur[nb * 3]; ny += cur[nb * 3 + 1]; nz += cur[nb * 3 + 2]; nc++; } }
        if (nc > 0) {
          const i3 = self * 3;
          next[i3]     = cur[i3]     + lambda * (nx / nc - cur[i3]);
          next[i3 + 1] = cur[i3 + 1] + lambda * (ny / nc - cur[i3 + 1]);
          next[i3 + 2] = cur[i3 + 2] + lambda * (nz / nc - cur[i3 + 2]);
        }
      }
      cur.set(next);
    }

    // 将平滑结果写回 positions，供后续法线与指标计算使用
    for (let i = 0; i < vertCount * 3; i++) positions[i] = cur[i];
  }

  // ──────────────────────────────────────────────────────────────
  // 10. 法线计算
  //     full 模式：解析梯度（边界顶点用几何法线，内部用 ∇f）
  //     preview 模式：跳过解析法线，用离散 computeVertexNormals
  // ──────────────────────────────────────────────────────────────
  const normals = pool.normals.subarray(0, vertCount * 3);

  if (vertCount > 0 && !isPreview) {
    const BTOL = 0.04;

    for (const encoded of activeCells) {
      const self = cellVert[encoded];

      const i3 = self * 3;
      const vx = positions[i3], vy = positions[i3 + 1], vz = positions[i3 + 2];
      const px = vx / Math.PI, py = vy / Math.PI, pz = vz / Math.PI;
      let gx: number, gy: number, gz: number;

      // Z 轴上下底面（两种容器通用）
      if (pz > 1 - BTOL) { gx = 0; gy = 0; gz = 1; }
      else if (pz < -1 + BTOL) { gx = 0; gy = 0; gz = -1; }
      // 立方体侧面
      else if (container === 'cube' && px > 1 - BTOL) { gx = 1; gy = 0; gz = 0; }
      else if (container === 'cube' && px < -1 + BTOL) { gx = -1; gy = 0; gz = 0; }
      else if (container === 'cube' && py > 1 - BTOL) { gx = 0; gy = 1; gz = 0; }
      else if (container === 'cube' && py < -1 + BTOL) { gx = 0; gy = -1; gz = 0; }
      // 圆柱侧面：径向外侧法线（平方比较）
      else if (container === 'cylinder') {
        const r2 = px * px + py * py;
        if (r2 > (1 - BTOL) * (1 - BTOL)) {
          const r = Math.sqrt(r2) || 1;
          gx = px / r; gy = py / r; gz = 0;
        } else {
          gx = NaN; gy = NaN; gz = NaN;
        }
      } else {
        gx = NaN; gy = NaN; gz = NaN;
      }

      // 内部顶点：实时三角函数求解析梯度
      if (isNaN(gx)) {
        const mx = vx * k, my = vy * k, mz = vz * k;
        const Sx = Math.sin(mx), Cx = Math.cos(mx);
        const Sy = Math.sin(my), Cy = Math.cos(my);
        const Sz = Math.sin(mz), Cz = Math.cos(mz);

        if (type === 'gyroid') {
          gx = w[0] * Cx * Cy - w[2] * Sz * Sx;
          gy = w[1] * Cy * Cz - w[0] * Sx * Sy;
          gz = w[2] * Cz * Cx - w[1] * Sy * Sz;
        } else if (type === 'schwarz') {
          gx = -w[0] * Sx; gy = -w[1] * Sy; gz = -w[2] * Sz;
        } else if (type === 'neovius') {
          gx = -3 * w[0] * Sx - 4 * w[1] * Sx * Cy * Cz;
          gy = -3 * w[0] * Sy - 4 * w[1] * Cx * Sy * Cz;
          gz = -3 * w[0] * Sz - 4 * w[1] * Cx * Cy * Sz;
        } else if (type === 'iwp') {
          const S2x = Math.sin(2 * mx), S2y = Math.sin(2 * my), S2z = Math.sin(2 * mz);
          gx = -2 * w[0] * Sx * (Cy + Cz) + 2 * w[1] * S2x;
          gy = -2 * w[0] * Sy * (Cz + Cx) + 2 * w[1] * S2y;
          gz = -2 * w[0] * Sz * (Cx + Cy) + 2 * w[1] * S2z;
        } else if (type === 'frd') {
          const S2x = Math.sin(2 * mx), S2y = Math.sin(2 * my), S2z = Math.sin(2 * mz);
          const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
          gx = -4 * w[0] * Sx * Cy * Cz + 2 * w[1] * S2x * (C2y + C2z);
          gy = -4 * w[0] * Cx * Sy * Cz + 2 * w[1] * S2y * (C2z + C2x);
          gz = -4 * w[0] * Cx * Cy * Sz + 2 * w[1] * S2z * (C2x + C2y);
        } else if (type === 'lidinoid') {
          const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
          const S2x = Math.sin(2 * mx), S2y = Math.sin(2 * my), S2z = Math.sin(2 * mz);
          const dAx = 2 * C2x * Cy * Sz + 2 * Sy * Cy * Cz * Cx - 2 * Sz * Cz * Sx * Sy;
          const dAy = -2 * Sx * Cx * Sy * Sz + 2 * C2y * Cz * Sx + 2 * Sz * Cz * Cx * Cy;
          const dAz = 2 * Sx * Cx * Cy * Cz - 2 * Sy * Cy * Sz * Sx + 2 * C2z * Cx * Sy;
          const dBx = -2 * (S2x * C2y + S2z * C2x);
          const dBy = -2 * (S2y * C2z + S2x * C2y);
          const dBz = -2 * (S2z * C2x + S2y * C2z);
          gx = 0.5 * w[0] * dAx - 0.5 * w[1] * dBx;
          gy = 0.5 * w[0] * dAy - 0.5 * w[1] * dBy;
          gz = 0.5 * w[0] * dAz - 0.5 * w[1] * dBz;
        } else if (type === 'splitp') {
          const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
          const S2x = Math.sin(2 * mx), S2y = Math.sin(2 * my), S2z = Math.sin(2 * mz);
          const dAx = 2 * C2x * Cy * Sz + 2 * Cx * Sy * Cy * Cz - 2 * Sx * Sy * Sz * Cz;
          const dAy = -2 * Sx * Cx * Sy * Sz + 2 * Sx * Cz * C2y + 2 * Cx * Cy * Sz * Cz;
          const dAz = 2 * Sx * Cx * Cy * Cz - 2 * Sx * Sy * Cy * Sz + 2 * Cx * Sy * C2z;
          const dBx = -2 * (S2x * C2y + S2z * C2x);
          const dBy = -2 * (S2y * C2z + S2x * C2y);
          const dBz = -2 * (S2z * C2x + S2y * C2z);
          const dCx = -2 * S2x, dCy = -2 * S2y, dCz = -2 * S2z;
          gx = 1.1 * w[0] * dAx - 0.2 * w[1] * dBx - 0.4 * w[2] * dCx;
          gy = 1.1 * w[0] * dAy - 0.2 * w[1] * dBy - 0.4 * w[2] * dCy;
          gz = 1.1 * w[0] * dAz - 0.2 * w[1] * dBz - 0.4 * w[2] * dCz;
        } else { // diamond (custom 等未显式列出类型回退)
          gx = w[0] * Cx * Sy * Sz + w[1] * Cx * Cy * Cz - w[2] * Sx * Sy * Cz - w[3] * Sx * Cy * Sz;
          gy = w[0] * Sx * Cy * Sz - w[1] * Sx * Sy * Cz + w[2] * Cx * Cy * Cz - w[3] * Cx * Sy * Sz;
          gz = w[0] * Sx * Sy * Cz - w[1] * Sx * Cy * Sz - w[2] * Cx * Sy * Cz + w[3] * Cx * Cy * Cz;
        }

        const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
        gx /= len; gy /= len; gz /= len;
      }

      normals[i3] = gx;
      normals[i3 + 1] = gy;
      normals[i3 + 2] = gz;
    }
  } else if (vertCount > 0) {
    computeVertexNormals(
      positions.subarray(0, vertCount * 3),
      indices.subarray(0, indexCount),
      normals,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // 11. 几何指标：表面积、包围体积、比表面积 Sv
  // ──────────────────────────────────────────────────────────────
  let surfaceArea = 0;
  let envelopeVolume = 0;
  let svRatio = 0;

  if (vertCount > 0 && indexCount > 0) {
    surfaceArea = computeSurfaceArea(
      positions.subarray(0, vertCount * 3),
      indices.subarray(0, indexCount),
      params.periods,
    );
    envelopeVolume = computeEnvelopeVolume(params.periods, params.containerShape);
    svRatio = computeSvRatio(surfaceArea, envelopeVolume);
  }

  const buildTimeMs = performance.now() - t0;

  return {
    id: 0,
    type: 'result',
    positions: positions.slice(0, vertCount * 3),
    normals: normals.slice(0, vertCount * 3),
    indices: indices.slice(0, indexCount),
    vertCount,
    triCount: Math.floor(indexCount / 3),
    porosityEstimate,
    isoUsed: isoUsedReport,
    resolution: params.resolution,
    surfaceArea,
    envelopeVolume,
    svRatio,
    buildTimeMs,
  };
}
