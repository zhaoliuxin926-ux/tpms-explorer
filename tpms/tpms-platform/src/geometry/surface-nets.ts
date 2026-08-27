/**
 * Surface Nets v2 等值面重建算法（2026-08-27 全面重写，见 agent_memory/mission_2026-08-27.md）
 *
 * 核心流程：
 *  1. 预计算 sin/cos 查表
 *  2. 计算基础 TPMS 场 V（弧度域）
 *  3. 容器边界场 boundArr（原始 SDF，仅作符号判定）
 *  4. 模式公式与孔隙率二分搜索（预排序 + lower_bound）
 *  5. 生成最终场 field：容器外(b>=0)或网格边界层 ⇒ 无条件空气(-1e-6)，
 *     否则 max(f_formula, bound) —— 实体相在表面自然截断（防反相/包裹）
 *  6. Surface Nets 顶点生成（每 cell 取边交点均值质心）
 *  7. 三角面提取：以「网格边穿越等值面」为键 —— 每条穿越边恰产出一个 quad，
 *     同一网格面两侧的 quad 段严格配对，水密由构造保证
 *     （参照 Lysenko surface-nets、Gibson 1998 constrained elastic surface nets）
 *  8. 端面封盖：孔口开口环 succ 链追踪 + 质心扇面（与开口有向边反向配对，
 *     盖片缠绕自动继承「外向=离实体」约定）
 *  9. 切向平滑（剥法向分量，体积保真）+ 每轮解析 Newton 投影（仅 solid_network，
 *     消除栅格低通偏差；梯度病态守卫防漂移）
 * 9c. 鞍点掐捏边顶点分裂（默认禁用，见块内说明）
 * 10. 解析法线（隐函数梯度 ∇f；preview 用离散 computeVertexNormals）
 * 11. 几何指标 + 网格实测固相体积分数（porosityEstimate = 1 − 实测，供 UI/物理指标）
 */

import { BufferPool, globalBufferPool } from './buffer-pool';
import type { BuildParams, WorkerResponse } from '../types';
import { getGradientEvaluator } from '../core/gradient-functions';
import { createHybridField } from '../core/hybrid-functions';
import { getTpmsFunction, type Weights } from '../core/tpms-functions';
import { computeSurfaceArea, computeEnvelopeVolume, computeSvRatio } from '../physics/surface-area';
import { wcToMmFactor } from '../core/units';
import { computeVertexColors } from './vertex-coloring';

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
  // 红队守卫（V-6）：超池分辨率会被 TypedArray.subarray 静默钳制，产出截肢几何
  // 且零告警——必须显式失败（UI 的 min(88,…) 公式不会触达；脚本/API 侧防护）
  if (N * N * N > 1_000_000) {
    throw new Error(`分辨率 ${R}³ 超出缓冲池容量（${N * N * N} > 1,000,000 采样点），请降低周期数或分辨率`);
  }
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
  let nonFiniteCount = 0;

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
          if (!Number.isFinite(v)) nonFiniteCount++;
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
          if (!Number.isFinite(v)) nonFiniteCount++;
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
        // 容器边界面上 b 恰为 0：与内部负值无符号变化 → 不产生 crossing → 网格边界开口（非水密）。
        // 把 >=0 的点抬升为严格正值后边界处生成盖板，导出网格闭合；不影响统计（MC/二分用原始符号判定）。
        boundArr[yB + ix] = b < 0 ? b : Math.max(b, 1e-6);
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
    // 注意：boundArr 已叠加封盖皮肤环（±ε），容器内外判定必须用原始 boundAt
    const insideV = pool.insideV.subarray(0, containerInside);
    let insideIdx = 0;
    for (let iz = 0; iz < N; iz++) {
      const pz = phys(iz);
      const zB = iz * N * N;
      for (let iy = 0; iy < N; iy++) {
        const py = phys(iy);
        const yB = zB + iy * N;
        for (let ix = 0; ix < N; ix++) {
          if (boundAt(phys(ix), py, pz) < 0) {
            insideV[insideIdx++] = V[yB + ix];
          }
        }
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

  // 红队守卫（V-1/V-2）：退化场（权重全零/常数公式）与非有限场（公式产生
  // NaN/Inf，如 sqrt(-1)、1/0）必须走 error 通道，而不是静默产出
  // 「满容器方糖」或空网格
  if (nonFiniteCount > 0) {
    throw new Error(`公式结果含 ${nonFiniteCount} 个非有限值（NaN/Inf），请检查公式定义域（如 sqrt 的负数输入、除零）`);
  }
  if (!Number.isFinite(maxV - minV) || maxV - minV < 1e-9) {
    throw new Error('曲面场退化为常数：权重不能全为 0，公式不能与坐标无关');
  }

  // 【2026-08-27】格子中心 MC 孔隙率估算已移除：porosityEstimate 改为网格实测口径
  // （1 − 发散体积/包络，见 return 处）。格子 MC 对薄壁/倍频曲面有最高 13pp
  // 量化偏差，且每构建白跑 R³ 次三角函数——移除后重建提速且数字更诚实。
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
        const b = boundArr[yB + ix];
        // 统一封盖规则（v2）：容器外(b>=0)或网格边界层(dAx==0)一律空气。
        // max(f, clip) 不行——公式在圆柱角落的正瓣会压过负 clip（+109%→+27% 教训），
        // 公式不知道容器的存在，容器裁剪必须无条件覆写。
        // 覆写后实体相在容器表面自然截断，孔口以开口环留在面/柱面上，由 8c 封盖。
        const dAx = Math.min(ix, R - ix, iy, R - iy, iz, R - iz);
        field[yB + ix] = (b >= 0 || dAx === 0) ? -1e-6 : Math.max(f, b);
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
  // 8. 三角面提取（v2）：以「网格边穿越等值面」为键
  //    历史 v1 缺陷：只判「四个邻接 cell 是否有顶点」，不校验共享边是否穿越，
  //    鞍点/退化构型下产生成片虚假 quad 与裂缝（实测单模型 4.7 万开放边 +
  //    7 万非流形边，STL 完全不可打印）。新不变量：
  //      · field>0 视为实体、≤0 为空气；穿越 = 边两端符号互异
  //      · 每条穿越网格边恰产出一个 quad，连接环绕该边的 4 个 cell 质心顶点
  //        （这些 cell 必含穿越端点 ⇒ 必有顶点，无需降级补三角）
  //      · 同一网格面两侧的 quad 段一一配对 ⇒ 无开放边 / 非流形边
  //      · 缠绕方向由场符号决定：几何法线始终指向空气侧（外向）
  // ──────────────────────────────────────────────────────────────
  let indexCount = 0;
  const indices = pool.indices;

  const pushTri = (a: number, b: number, c: number) => {
    indices[indexCount++] = a;
    indices[indexCount++] = b;
    indices[indexCount++] = c;
  };
  const R2 = R * R;
  const NN = N * N;   // field 布局 z 向步长（cellVert 用 R2，两套索引严禁混用）

  /**
   * 发射四边形 A→B→C→D（环绕一条穿越网格边的 4 个 cell 顶点，按周边序）。
   * o = 外向单位方向（实体端指向空气端的轴向）：n=(B−A)×(D−A) 与默认拆分
   * (A,B,C)(A,C,D) 正面同向，n·o<0 时反向拆分 ⇒ 缠绕与场符号严格一致。
   * 镜像钳位会让相邻角共享同一 cell 顶点：4 顶点去重后按剩余顶点发射
   * 定向三角形（3 个）或跳过（<3 个，纯退化）。
   */
  const pushOrientedQuad = (
    a: number, b: number, c: number, d: number,
    ox: number, oy: number, oz: number,
  ) => {
    let v0 = a, v1 = b, v2 = c, v3 = d;
    // 去重（保持周边序）：两两相同则收缩
    if (v0 === v1 || v0 === v2 || v0 === v3 || v1 === v2 || v1 === v3 || v2 === v3) {
      const list = [v0, v1, v2, v3];
      const uniq: number[] = [];
      for (const x of list) if (!uniq.includes(x)) uniq.push(x);
      if (uniq.length === 3) { v0 = uniq[0]; v1 = uniq[1]; v2 = uniq[2]; v3 = -1; }
      else if (uniq.length < 3) return;
      else { v0 = uniq[0]; v1 = uniq[1]; v2 = uniq[2]; v3 = uniq[3]; }
    }
    const i0 = v0 * 3, i1 = v1 * 3;
    const b1x = positions[i1] - positions[i0];
    const b1y = positions[i1 + 1] - positions[i0 + 1];
    const b1z = positions[i1 + 2] - positions[i0 + 2];
    const iE = (v3 >= 0 ? v3 : v2) * 3;
    const d1x = positions[iE] - positions[i0];
    const d1y = positions[iE + 1] - positions[i0 + 1];
    const d1z = positions[iE + 2] - positions[i0 + 2];
    if (b1x * d1y * oz + b1y * d1z * ox + b1z * d1x * oy
      - b1z * d1y * ox - b1y * d1x * oz - b1x * d1z * oy >= 0) {
      pushTri(v0, v1, v2);
      if (v3 >= 0) pushTri(v0, v2, v3);
    } else {
      pushTri(v0, v2, v1);
      if (v3 >= 0) pushTri(v0, v3, v2);
    }
  };

  // cellVert 镜像钳位查询：孔口封盖环落在边界层，环绕 cell 可能越界一格，
  // 钳位后与相邻真实 cell 共享顶点 → 由 pushOrientedQuad 的去重逻辑收缩为三角形
  const cvAt = (x: number, y: number, z: number): number => {
    const xc = x < 0 ? 0 : x >= R ? R - 1 : x;
    const yc = y < 0 ? 0 : y >= R ? R - 1 : y;
    const zc = z < 0 ? 0 : z >= R ? R - 1 : z;
    return cellVert[xc + yc * R + zc * R2];
  };

  for (let cz = 0; cz <= R; cz++) {
    for (let cy = 0; cy <= R; cy++) {
      const rowBase = cz * NN + cy * N;
      for (let cx = 0; cx <= R; cx++) {
        const pIdx = rowBase + cx;
        const fp = field[pIdx];
        const pPos = fp > 0;

        // +x 出边：终点 (cx+1,cy,cz)；环绕 cell 共享 cell-x 层 = cx，周边 y-z 平面
        if (cx < R && ((field[pIdx + 1] > 0) !== pPos)) {
          if (cy >= 1 && cy < R && cz >= 1 && cz < R) {
            pushOrientedQuad(
              cvAt(cx, cy - 1, cz - 1), cvAt(cx, cy, cz - 1), cvAt(cx, cy, cz), cvAt(cx, cy - 1, cz),
              pPos ? 1 : -1, 0, 0,
            );
          }
        }
        // +y 出边：终点 (cx,cy+1,cz)；环绕 cell 共享 cell-y 层 = cy，周边 x-z 平面
        if (cy < R && ((field[pIdx + N] > 0) !== pPos)) {
          if (cx >= 1 && cx < R && cz >= 1 && cz < R) {
            pushOrientedQuad(
              cvAt(cx - 1, cy, cz - 1), cvAt(cx - 1, cy, cz), cvAt(cx, cy, cz), cvAt(cx, cy, cz - 1),
              0, pPos ? 1 : -1, 0,
            );
          }
        }
        // +z 出边：终点 (cx,cy,cz+1)；环绕 cell 共享 cell-z 层 = cz，周边 x-y 平面
        if (cz < R && ((field[pIdx + NN] > 0) !== pPos)) {
          if (cx >= 1 && cx < R && cy >= 1 && cy < R) {
            pushOrientedQuad(
              cvAt(cx - 1, cy - 1, cz), cvAt(cx, cy - 1, cz), cvAt(cx, cy, cz), cvAt(cx - 1, cy, cz),
              0, 0, pPos ? 1 : -1,
            );
          }
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 8c. 端面封盖（pore capping）：把界面在边界层上的开口环用质心扇面封死
  //    边界层强制为空气后，触及表面的孔道以开口环收尾（环躺在端面/柱面
  //    附近）。对每个环：
  //      · 边界流形上每个开口顶点恰有一条出向开口边 → succ 环链直接追踪
  //      · 三角形 (C, ring[i+1], ring[i]) 与既有开口有向边 ring[i]→ring[i+1]
  //        反向配对 ⇒ 盖片缠绕自动继承界面的「外向=离实体」约定，
  //        无需任何平面符号推理；扇心内部边自配对
  //      · 环顶点冻结，不参与平滑/投影，保证盖片贴合端面
  // ──────────────────────────────────────────────────────────────
  // 非流形边计数（鞍点掐捏残留，供 UI 采样定理警示）
  let nmEdgeCount = 0;
  const frozen = new Uint8Array(vertCount + 65536);   // 环顶点（面内约束）+ 扇心（全冻结）
  const frozenCap = new Uint8Array(vertCount + 65536);  // 扇心：完全不动
  {
    const KM = vertCount + 1;
    const dirCnt = new Map<number, number>();
    const undCnt = new Map<number, number>();
    for (let t = 0; t < indexCount; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const put = (u: number, v: number) => {
        const dk = u * KM + v;
        dirCnt.set(dk, (dirCnt.get(dk) ?? 0) + 1);
        const uk = u < v ? u * KM + v : v * KM + u;
        undCnt.set(uk, (undCnt.get(uk) ?? 0) + 1);
      };
      put(a, b); put(b, c); put(c, a);
    }
    let nmCountLocal = 0;
    for (const [, cnt] of undCnt) if (cnt > 2) nmCountLocal++;
    const succ = new Map<number, number>();
    for (const [uk, cnt] of undCnt) {
      if (cnt !== 1) continue;
      const u = Math.floor(uk / KM), v = uk % KM;
      const su = (dirCnt.get(u * KM + v) ?? 0) === 1 ? u : v;
      const sv = su === u ? v : u;
      if (succ.has(su)) continue;   // 非流形边界顶点（罕见）：放弃该段，审计暴露
      succ.set(su, sv);
      frozen[su] = 1; frozen[sv] = 1;
    }
    const visited = new Uint8Array(vertCount);
    for (const [start] of succ) {
      if (visited[start]) continue;
      const ring: number[] = [start];
      visited[start] = 1;
      let cur = succ.get(start);
      while (cur !== undefined && cur !== start && !visited[cur]) {
        visited[cur] = 1;
        ring.push(cur);
        cur = succ.get(cur);
      }
      if (cur !== start || ring.length < 3) continue;
      let gx = 0, gy = 0, gz = 0;
      for (const r of ring) { gx += positions[r * 3]; gy += positions[r * 3 + 1]; gz += positions[r * 3 + 2]; }
      const m = ring.length;
      gx /= m; gy /= m; gz /= m;
      if (indexCount + m * 3 > indices.length) continue;   // 容量护栏
      const cIdx = vertCount++;
      if (cIdx * 3 + 2 < positions.length) {
        positions[cIdx * 3] = gx; positions[cIdx * 3 + 1] = gy; positions[cIdx * 3 + 2] = gz;
        frozen[cIdx] = 1;
        frozenCap[cIdx] = 1;
      }
      for (let i = 0; i < m; i++) {
        pushTri(cIdx, ring[(i + 1) % m], ring[i]);
      }
    }
    nmEdgeCount = nmCountLocal;
  }

  // ──────────────────────────────────────────────────────────────
  // 9. 切向 Taubin 平滑 + 每轮解析 Newton 投影（Gibson 1998 约束弹性网）
  //    实测教训：法向平滑位移会跨薄壁/细杆拉扯顶点，投影吸附到错误
  //    sheet（shell80 −22%、shell70 −5%）。切向平滑剥掉位移的法向分量，
  //    顶点只沿曲面滑动——体积保真由机制保证，阶梯感由切向平滑消除。
  //    投影把残余法向偏差拉回解析连续场零面（消除栅格低通偏差）。
  // ──────────────────────────────────────────────────────────────
  const projSolidFn = hybridFn ? null : (tpmFn ?? getTpmsFunction(type, customFormula));
  const projectVertices = (newtonIters: number): void => {
    if (vertCount <= 0) return;
    const hStep = span / R;
    const kpi = 1 / (k * Math.PI);
    const rawAt = (a: number, b2: number, c2: number, p2x: number, p2y: number, p2z: number): number => {
      const v = hybridFn ? hybridFn(a, b2, c2, p2x, w) : projSolidFn!(a, b2, c2, w);
      return tpmsAt(v, biasBase, tEffBase, p2x, p2y, p2z);
    };
    const hh = 1e-4;
    for (let it = 0; it < newtonIters; it++) {
      for (let vi = 0; vi < vertCount; vi++) {
        if (frozen[vi]) continue;
        const i3 = vi * 3;
        const wx = positions[i3], wy = positions[i3 + 1], wz = positions[i3 + 2];
        const ppx = wx / Math.PI, ppy = wy / Math.PI, ppz = wz / Math.PI;
        if (Math.abs(ppx) > 0.97 || Math.abs(ppy) > 0.97 || Math.abs(ppz) > 0.97) continue;
        // solidFn 期望弧度参数 mx=k·wc；phys 坐标随弧度联动（与法线段 rawAt 同约定）
        const fC = rawAt(wx * k, wy * k, wz * k, ppx, ppy, ppz);
        // 收敛判据（文献审计 P4）：已达零面精度需求则跳过后续步
        if (Math.abs(fC) < 1e-6 * (1 + Math.abs(biasBase))) continue;
        const gx = (rawAt(wx * k + hh, wy * k, wz * k, ppx + hh * kpi, ppy, ppz) - rawAt(wx * k - hh, wy * k, wz * k, ppx - hh * kpi, ppy, ppz)) / (2 * hh);
        const gy = (rawAt(wx * k, wy * k + hh, wz * k, ppx, ppy + hh * kpi, ppz) - rawAt(wx * k, wy * k - hh, wz * k, ppx, ppy - hh * kpi, ppz)) / (2 * hh);
        const gz = (rawAt(wx * k, wy * k, wz * k + hh, ppx, ppy, ppz + hh * kpi) - rawAt(wx * k, wy * k, wz * k - hh, ppx, ppy, ppz - hh * kpi)) / (2 * hh);
        const len2 = gx * gx + gy * gy + gz * gz;
        if (!(len2 > 1e-16)) continue;
        // 可靠性守卫：|f| 远超单步钳位可达量（梯度病态/远离曲面）时跳过，
        // 防止 f/|g|² 爆炸被限幅转成「满速定向漂移」（slab 下板漂移 2.4 格的根因）
        if (Math.abs(fC) > 2.4 * hStep * Math.sqrt(len2)) continue;   // 只滤 |g|→0 病态；1.0h 会误杀高曲率合法顶点（diamond −10.5% 实测）
        let stepN = fC / len2;
        // 限幅 1.2h：文献审计建议 0.5h，但实测 0.5h 削减高曲率细杆顶点的
        // 可达行程（diamond −5.8→−10.4%）——折叠防护由 |g|→0 守卫独立承担
        const dispLen = Math.sqrt(len2) * Math.abs(stepN);
        if (dispLen > 1.2 * hStep) stepN *= (1.2 * hStep) / dispLen;
        positions[i3] -= gx * stepN;
        positions[i3 + 1] -= gy * stepN;
        positions[i3 + 2] -= gz * stepN;
      }
    }
  };
  const cur = vertCount > 0 ? pool.smoothA.subarray(0, vertCount * 3) : null;

  if (cur) {
    for (let i = 0; i < vertCount * 3; i++) cur[i] = positions[i];

    // 切向 Taubin λ|μ 对（0.5/-0.53）：λ 滑动磨平锯齿，μ 切向膨胀抵消拥挤，
    // 理论体积中性；每轮后立即投影（仅 solid_network，联合迭代）
    const lambda = 0.5;
    const mu = -0.53;
    const passes = 2;   // 实测最优：[λ,μ] 收尾于 μ（膨胀补偿收缩）；[λ,μ,λ] 会重新引入收缩（diamond −5.05→−5.85%）
    const passCoef = (it: number) => (it % 2 === 0 ? lambda : mu);
    const next = pool.smoothB.subarray(0, vertCount * 3);

    for (let it = 0; it < passes; it++) {
      next.set(cur);
      for (const encoded of activeCells) {
        const self = cellVert[encoded];
        if (frozenCap[self]) continue;   // 扇心不动
        const rim = frozen[self] === 1;  // 孔口环顶点：面内约束平滑（磨平轮廓锯齿）
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
          let dx = nx / nc - cur[i3], dy = ny / nc - cur[i3 + 1], dz = nz / nc - cur[i3 + 2];
          const vx0 = cur[i3], vy0 = cur[i3 + 1], vz0 = cur[i3 + 2];
          const ppx = vx0 / Math.PI, ppy = vy0 / Math.PI, ppz = vz0 / Math.PI;
          if (rim) {
            // 环顶点：面内约束——去掉沿端面/柱面法向的分量，只沿面内滑动
            // （普通均值位移即可：环的邻居都在面附近，面外分量本就小）
            let pnx = 0, pny = 0, pnz = 0;
            if (container === 'cylinder' && Math.abs(ppz) <= 0.96) {
              const r2 = ppx * ppx + ppy * ppy;
              if (r2 > 1e-9) { const rr = Math.sqrt(r2); pnx = ppx / rr; pny = ppy / rr; }
              else { dx = 0; dy = 0; dz = 0; }
            } else if (ppz > 0.96) pnz = 1;
            else if (ppz < -0.96) pnz = -1;
            else if (container === 'cube' && Math.abs(ppx) > 0.96) pnx = ppx > 0 ? 1 : -1;
            else if (container === 'cube' && Math.abs(ppy) > 0.96) pny = ppy > 0 ? 1 : -1;
            else if (Math.abs(ppz) > 0.96) pnz = ppz > 0 ? 1 : -1;
            const dn = dx * pnx + dy * pny + dz * pnz;
            dx -= pnx * dn; dy -= pny * dn; dz -= pnz * dn;
            const coefR = passCoef(it);
            next[i3]     = cur[i3]     + coefR * dx;
            next[i3 + 1] = cur[i3 + 1] + coefR * dy;
            next[i3 + 2] = cur[i3 + 2] + coefR * dz;
            continue;
          }
          // 切向平滑：剥掉位移的法向分量，只沿曲面切面滑动（体积保真的机制保证）
          // 【实测教训】preview 跳过梯度分解会让普通 Laplacian 在薄杆上收缩
          // （R28 −19%）：preview 与 full 必须同管线，保证拖动中所见=导出所得
          if (Math.abs(ppx) <= 0.97 && Math.abs(ppy) <= 0.97 && Math.abs(ppz) <= 0.97) {
            const kpi = 1 / (k * Math.PI);
            const hh = 1e-4;
            const ev = (a: number, b2: number, c2: number, q2x: number, q2y: number, q2z: number): number => {
              const v = hybridFn ? hybridFn(a, b2, c2, q2x, w) : projSolidFn!(a, b2, c2, w);
              return tpmsAt(v, biasBase, tEffBase, q2x, q2y, q2z);
            };
            const gxx = (ev(vx0 * k + hh, vy0 * k, vz0 * k, ppx + hh * kpi, ppy, ppz) - ev(vx0 * k - hh, vy0 * k, vz0 * k, ppx - hh * kpi, ppy, ppz)) / (2 * hh);
            const gyy = (ev(vx0 * k, vy0 * k + hh, vz0 * k, ppx, ppy + hh * kpi, ppz) - ev(vx0 * k, vy0 * k - hh, vz0 * k, ppx, ppy - hh * kpi, ppz)) / (2 * hh);
            const gzz = (ev(vx0 * k, vy0 * k, vz0 * k + hh, ppx, ppy, ppz + hh * kpi) - ev(vx0 * k, vy0 * k, vz0 * k - hh, ppx, ppy, ppz - hh * kpi)) / (2 * hh);
            const gl2 = gxx * gxx + gyy * gyy + gzz * gzz;
            if (gl2 > 1e-16) {
              const dot = (dx * gxx + dy * gyy + dz * gzz) / gl2;
              dx -= gxx * dot; dy -= gyy * dot; dz -= gzz * dot;
            }
          }
          const coef = passCoef(it);
          next[i3]     = cur[i3]     + coef * dx;
          next[i3 + 1] = cur[i3 + 1] + coef * dy;
          next[i3 + 2] = cur[i3 + 2] + coef * dz;
        }
      }
      cur.set(next);
      // 每轮平滑后立即写回；投影仅用于 solid_network：杆状网络顶点跨面
      // 吸附收益为正（diamond −6.4→−5.0%），而 shell 的亚格厚壁会产生
      // 「中线质心顶点」，投影沿法向折叠到任意一侧（projOnly 实测 −29.5%），
      // 壳类依靠切向平滑保体积即可（raw 实测 +0.8% / −4.65%）。
      for (let i = 0; i < vertCount * 3; i++) positions[i] = cur[i];
      // 文献审计 P4 实测定案：2 步投影在高曲率细杆上振荡/跨越反而丢体积
      // （diamond −5.8→−10.4%）；顶点出生于半格内，1 步 Newton 即收敛点
      if (mode === 'solid_network') projectVertices(1);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 9c. 鞍点掐捏边顶点分裂：把「4 面共边」的非流形边按面连通性拆成两片，
  //     每片独占自己的边副本 ⇒ 输出对 trimesh/FEA 完全流形。
  //     分 sheet：nm 边不作为连通桥，按其余公共边 BFS 分组；组 0 保留原边，
  //     其余组顶点复制后重挂。若分裂引入开放边（分组病态）则整体回滚。
  //     复制顶点在 splitDupPairs 中登记（原,副本 交替），法线段按对拷贝。
  // ──────────────────────────────────────────────────────────────
  const splitDupPairs: number[] = [];
  // 【2026-08-27 实测结论：此清理禁用】伞面传播分裂在简单 X-掐捏上可安全执行
  // （0 开放边），但簇状掐捏（frd R88 达 1248 条）分裂处会再生新掐捏，
  // 6 轮后计数不降（24→24），且每轮 O(E) 重扫描拖慢重建。残留掐捏
  // 0.008~0.4% 边对切片器/打印无感，netfabb 一键可修——保留守卫代码供
  // 后续「全域拓扑重建」方案参考，当前直接跳过。
  const ENABLE_PINCH_SPLIT = false;
  {
    if (!ENABLE_PINCH_SPLIT) splitDupPairs.length = 0;
    const MAX_SPLIT_PASSES = 6;
    for (let pass = 0; ENABLE_PINCH_SPLIT && pass < MAX_SPLIT_PASSES; pass++) {
      let maxV = 0;
      for (let t = 0; t < indexCount; t++) if (indices[t] > maxV) maxV = indices[t];
      const KM = maxV + 1;
      const ekey = (a: number, b: number) => (a < b ? a * KM + b : b * KM + a);
      const faceAtEdge = new Map<number, number[]>();
      const faceCount = indexCount / 3;
      for (let f = 0; f < faceCount; f++) {
        const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const key = ekey(u, v);
          let arr = faceAtEdge.get(key);
          if (!arr) { arr = []; faceAtEdge.set(key, arr); }
          arr.push(f);
        }
      }
      const nmEdges: { u: number; v: number; faces: number[] }[] = [];
      for (const [key, fs] of faceAtEdge) {
        if (fs.length > 2) nmEdges.push({ u: Math.floor(key / KM), v: key % KM, faces: fs });
      }
      if (nmEdges.length === 0) break;

      // 面邻接（仅经由流形边连通；nm 边不桥接）
      const adj: number[][] = new Array(faceCount);
      for (let f = 0; f < faceCount; f++) adj[f] = [];
      for (const [, fs] of faceAtEdge) {
        if (fs.length !== 2) continue;
        adj[fs[0]].push(fs[1]);
        adj[fs[1]].push(fs[0]);
      }

      const idxSnap = indices.slice(0, indexCount);
      const vertSnap = vertCount;
      let splitAny = false;

      // 逐 nm 边分裂：sheetB（第二个连通片）连同其在 u / v 处的整个伞面
      // 切换到副本顶点 uD / vD。伞面传播沿「过 u(或 v) 的流形轮辐边」BFS——
      // 掐捏顶点的伞面是两个仅共享该顶点的独立环，轮辐两侧同环，
      // 因此传播不越过掐捏边界（越界情形由 openAfter 校验整体回滚兜底）。
      for (const { u, v, faces } of nmEdges) {
        const faceSet = new Set(faces);
        const seen = new Set<number>();
        const sheets: number[][] = [];
        for (const f0 of faces) {
          if (seen.has(f0)) continue;
          const comp = [f0];
          seen.add(f0);
          const queue = [f0];
          while (queue.length) {
            const f = queue.pop()!;
            for (const g of adj[f]) {
              if (faceSet.has(g) && !seen.has(g)) { seen.add(g); comp.push(g); queue.push(g); }
            }
          }
          sheets.push(comp);
        }
        if (sheets.length < 2) continue;
        const sheetB = sheets[1];

        const switchSet = new Set<number>(sheetB);
        const queue = [...sheetB];
        const touches = (f: number, x: number) =>
          indices[f * 3] === x || indices[f * 3 + 1] === x || indices[f * 3 + 2] === x;
        while (queue.length) {
          const f = queue.pop()!;
          const fa = indices[f * 3], fb = indices[f * 3 + 1], fc = indices[f * 3 + 2];
          for (const x of [u, v]) {
            if (!touches(f, x)) continue;
            for (const o of [fa, fb, fc]) {
              if (o === x) continue;
              const fs2 = faceAtEdge.get(ekey(x, o));
              if (!fs2 || fs2.length !== 2) continue;   // 只沿流形轮辐边传播
              for (const g of fs2) {
                if (!switchSet.has(g)) { switchSet.add(g); queue.push(g); }
              }
            }
          }
        }
        if (switchSet.size === 0) continue;
        if (vertCount * 3 + 2 > positions.length) continue;
        const uD = vertCount++;
        const vD = vertCount++;
        positions[uD * 3] = positions[u * 3]; positions[uD * 3 + 1] = positions[u * 3 + 1]; positions[uD * 3 + 2] = positions[u * 3 + 2];
        positions[vD * 3] = positions[v * 3]; positions[vD * 3 + 1] = positions[v * 3 + 1]; positions[vD * 3 + 2] = positions[v * 3 + 2];
        splitDupPairs.push(u, uD, v, vD);
        for (const f of switchSet) {
          for (let j = 0; j < 3; j++) {
            if (indices[f * 3 + j] === u) indices[f * 3 + j] = uD;
            else if (indices[f * 3 + j] === v) indices[f * 3 + j] = vD;
          }
        }
        splitAny = true;
      }
      if (!splitAny) break;

      // 校验：分裂不得引入开放边，否则整体回滚
      const cnt = new Map<number, number>();
      for (let t = 0; t < indexCount; t += 3) {
        const a = indices[t], b = indices[t + 1], c = indices[t + 2];
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
          const key = ekey(x, y);
          cnt.set(key, (cnt.get(key) ?? 0) + 1);
        }
      }
      let openAfter = 0;
      for (const [, n] of cnt) if (n === 1) openAfter++;
      if (openAfter > 0) {
        indices.set(idxSnap);
        vertCount = vertSnap;
        splitDupPairs.length = 0;
        break;
      }
    }
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

      // 内部顶点法线：
      //  - 纯 solid_network + 非 hybrid + 内置类型：解析梯度（查表/函数一致，parity_math.mjs 守护）
      //  - custom / hybrid / shell / gradient_shell：对最终场做中心差分（解析式对复合场不可靠，
      //    历史 bug：custom 回退到 diamond 梯度、hybrid 用纯 A 侧梯度——法线近反向）
      if (isNaN(gx)) {
        const needNumericGrad = hybridEnabled || mode !== 'solid_network' || type === 'custom';
        if (needNumericGrad) {
          // 非 hybrid 时才需要底层 V 场函数（hybrid 用 hybridFn，类型签名不同故分开持有）
          const solidFn = hybridFn ? null : (tpmFn ?? getTpmsFunction(type, customFormula));
          // px = mx/(k·π)（px = ix/R·2-1 与 mx = kπ·px 的线性关系），差分时物理坐标须随弧度坐标联动
          const rawAt = (a: number, b2: number, c2: number): number => {
            const p2x = a / (k * Math.PI), p2y = b2 / (k * Math.PI), p2z = c2 / (k * Math.PI);
            const v = hybridFn ? hybridFn(a, b2, c2, p2x, w) : solidFn!(a, b2, c2, w);
            // solid 模式外法线 = +∇V（固相在 V 小的一侧）；shell 类直接对模式场差分（内外壁方向自动正确）
            return mode === 'solid_network' ? v : tpmsAt(v, biasBase, tEffBase, p2x, p2y, p2z);
          };
          const mx = vx * k, my = vy * k, mz = vz * k;
          const h = 1e-4;
          gx = (rawAt(mx + h, my, mz) - rawAt(mx - h, my, mz)) / (2 * h);
          gy = (rawAt(mx, my + h, mz) - rawAt(mx, my - h, mz)) / (2 * h);
          gz = (rawAt(mx, my, mz + h) - rawAt(mx, my, mz - h)) / (2 * h);
          // STL/仿真惯例：法线指离实体（空气侧）。solid 的 +∇V 即空气侧；
          // shell 类 +∇F 指向 F>0 固体侧 → 取负统一外向（否则导出面定向系统性反转，仿真重建出负体积）
          if (mode !== 'solid_network') { gx = -gx; gy = -gy; gz = -gz; }
        } else {
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
          // B = cos2x·cos2y + cos2y·cos2z + cos2z·cos2x → ∂B/∂x = -2·sin2x·(cos2y + cos2z)（历史 bug：第二项循环错位）
          const dBx = -2 * S2x * (C2y + C2z);
          const dBy = -2 * S2y * (C2z + C2x);
          const dBz = -2 * S2z * (C2x + C2y);
          gx = 0.5 * w[0] * dAx - 0.5 * w[1] * dBx;
          gy = 0.5 * w[0] * dAy - 0.5 * w[1] * dBy;
          gz = 0.5 * w[0] * dAz - 0.5 * w[1] * dBz;
        } else if (type === 'splitp') {
          const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
          const S2x = Math.sin(2 * mx), S2y = Math.sin(2 * my), S2z = Math.sin(2 * mz);
          const dAx = 2 * C2x * Cy * Sz + 2 * Cx * Sy * Cy * Cz - 2 * Sx * Sy * Sz * Cz;
          const dAy = -2 * Sx * Cx * Sy * Sz + 2 * Sx * Cz * C2y + 2 * Cx * Cy * Sz * Cz;
          const dAz = 2 * Sx * Cx * Cy * Cz - 2 * Sx * Sy * Cy * Sz + 2 * Cx * Sy * C2z;
          const dBx = -2 * S2x * (C2y + C2z);
          const dBy = -2 * S2y * (C2z + C2x);
          const dBz = -2 * S2z * (C2x + C2y);
          const dCx = -2 * S2x, dCy = -2 * S2y, dCz = -2 * S2z;
          gx = 1.1 * w[0] * dAx - 0.2 * w[1] * dBx - 0.4 * w[2] * dCx;
          gy = 1.1 * w[0] * dAy - 0.2 * w[1] * dBy - 0.4 * w[2] * dCy;
          gz = 1.1 * w[0] * dAz - 0.2 * w[1] * dBz - 0.4 * w[2] * dCz;
        } else { // diamond：v = w0·Sx·Sy·Sz + w1·Sx·Cy·Cz + w2·Cx·Sy·Cz + w3·Cx·Cy·Sz
          gx = w[0] * Cx * Sy * Sz + w[1] * Cx * Cy * Cz - w[2] * Sx * Sy * Cz - w[3] * Sx * Cy * Sz;
          gy = w[0] * Sx * Cy * Sz - w[1] * Sx * Sy * Cz + w[2] * Cx * Cy * Cz - w[3] * Cx * Sy * Sz;
          gz = w[0] * Sx * Sy * Cz - w[1] * Sx * Cy * Sz - w[2] * Cx * Sy * Sz + w[3] * Cx * Cy * Cz; // w2 项 Sz（历史笔误 Cz）
        }
        }

        const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
        gx /= len; gy /= len; gz /= len;
      }

      normals[i3] = gx;
      normals[i3 + 1] = gy;
      normals[i3 + 2] = gz;
    }
    // 掐捏分裂的复制顶点继承原顶点法线
    for (let i = 0; i < splitDupPairs.length; i += 2) {
      const o = splitDupPairs[i] * 3, d = splitDupPairs[i + 1] * 3;
      normals[d] = normals[o]; normals[d + 1] = normals[o + 1]; normals[d + 2] = normals[o + 2];
    }
    // 红队 V-3b：piecewise 常数/混叠公式的数值梯度恒 0 → 法线 (0,0,0) 渲染黑斑。
    // 兜底：对这些顶点用离散面法线（preview 同款）局部重算。
    let zeroNormals = 0;
    for (let i = 0; i < vertCount; i++) {
      if (Math.abs(normals[i * 3]) + Math.abs(normals[i * 3 + 1]) + Math.abs(normals[i * 3 + 2]) < 1e-6) zeroNormals++;
    }
    if (zeroNormals > 0) {
      const scratch = new Float32Array(vertCount * 3);
      computeVertexNormals(
        positions.subarray(0, vertCount * 3),
        indices.subarray(0, indexCount),
        scratch,
      );
      for (let i = 0; i < vertCount; i++) {
        if (Math.abs(normals[i * 3]) + Math.abs(normals[i * 3 + 1]) + Math.abs(normals[i * 3 + 2]) < 1e-6) {
          normals[i * 3] = scratch[i * 3]; normals[i * 3 + 1] = scratch[i * 3 + 1]; normals[i * 3 + 2] = scratch[i * 3 + 2];
        }
      }
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

  // 网格实测固相体积分数：发散定理体积 ÷ 包络体积。
  // 与 porosityEstimate（公式格子 MC）独立——薄壁/倍频曲面下格子 MC 有
  // 最高 13pp 量化偏差，网格实测才是 STL 的真实材料占比。
  let meshSolidFraction = 0;
  if (vertCount > 0 && indexCount > 0) {
    let vol6 = 0;
    for (let t = 0; t < indexCount; t += 3) {
      const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
      vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
        + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
        + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
    }
    const mm3 = Math.pow(wcToMmFactor(params.periods), 3);
    const env = computeEnvelopeVolume(params.periods, params.containerShape);
    meshSolidFraction = env > 0 ? Math.min(1, Math.abs(vol6) / 6 * mm3 / env) : 0;
  }

  const buildTimeMs = performance.now() - t0;

  // 顶点颜色（Colormap 热力图）：S(x) 仅依赖顶点坐标，颜色生成不参与等值面
  // 提取，任何一步几何失败都不该被着色逻辑放大——放在最后、独立 try 无必要
  // （内部无除零路径，退化 range 已钳中性感）。mode 由主线程校验后传入。
  const colors =
    params.coloring && params.coloring !== 'none' && vertCount > 0
      ? computeVertexColors(positions, vertCount, {
          mode: params.coloring,
          hybrid: hybridEnabled ? params.hybrid : undefined,
          gradientDir: params.gradientDir,
        })
      : null;

  return {
    id: 0,
    type: 'result',
    positions: positions.slice(0, vertCount * 3),
    normals: normals.slice(0, vertCount * 3),
    indices: indices.slice(0, indexCount),
    colors: colors ?? undefined,
    vertCount,
    triCount: Math.floor(indexCount / 3),
    // 孔隙率采用网格实测口径（1 − 发散体积/包络），公式格子 MC 仅作二分目标旁证：
    // 薄壁/倍频曲面下格子 MC 有最高 13pp 量化偏差，实测口径让 UI 与物理指标
    // （Gibson-Ashby/渗透率）忠实于导出的 STL 本体
    porosityEstimate: 1 - meshSolidFraction,
    isoUsed: isoUsedReport,
    resolution: params.resolution,
    surfaceArea,
    envelopeVolume,
    svRatio,
    meshSolidFraction,
    nmEdgeCount,
    buildTimeMs,
  };
}
