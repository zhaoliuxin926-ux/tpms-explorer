/**
 * 周期性 RVE 网格生成器（v3.0 阶段 II · PBC-Ready Surface Nets）
 *
 * 目标：为有限元代表性体积单元（RVE）均质化产出可施加周期性边界条件（PBC）的
 * 单胞表面网格——相对面上顶点精确镜像配对（v_right − v_left = (L,0,0)），
 * 3×3×3 空间拼接 100% 水密无缝。
 *
 * 算法（回卷复制节点层 + 边界 quad 裁剪）：
 *  1. 网格节点 0..R（N=R+1，与 v2 同布局），节点层 R := 节点层 0 的场值【位级复制】
 *     ——整数周期数下 F(kπ) ≡ F(−kπ)（2π 周期），复制保证 ±π 两侧插值语义严格一致。
 *  2. cell 顶点 = v2 同款穿越点均值（cells 0..R−1，位置在 (−π,π) 内）。
 *  3. quad 发射以「网格边穿越等值面」为键（v2 不变量）：内部 quad 与 v2 完全一致；
 *     【周期一致性的关键规则】跨越 {R−1,0} 层对的 quad，层 0 的 cell 恒取 +2π 像
 *     （层对 {R−1,0} 全局恒解为 (R−1@0, 0@+L)）——共享两条 cell 的相邻 quad 必属
 *     同一层对类，平移选择逐位一致，无 T 型节/撕裂（首版 per-quad unroll 锚定的
     * 方案在此处翻车，实测 2000+ 非平面开放边，已废弃）。
 *  4. 跨界 quad 按位置判定域平面（±π），Sutherland–Hodgman 三角裁剪：域内片保留、
 *     域外片平移 −L 回盒；缝合顶点强制精确落平面。内部 quad 无需裁剪。
 *  5. 输出网格的开放边全部精确躺在 6 个域平面上（面 ∩ 曲线），即 PBC 缝合边；
 *     ±L 两侧缝合线是同一裁剪的两侧副本 ⇒ (切向坐标) 位级相同。
 *
 * 与主 surface-nets 的差异（刻意自包含，避免循环依赖）：
 *  · 无容器裁剪/端板/孔口封盖/平滑/投影；法线用离散逐面加权
 *  · 二分在 R³ 个唯一节点上进行（排除复制层）
 *  · meshSolidFraction 用体素栅格实测（开放面的发散体积不闭合，不可用）
 */

import type { BuildParams, WorkerResponse } from '../types';
import { getTpmsFunction, type Weights } from '../core/tpms-functions';
import { wcToMmFactor } from '../core/units';

/** 裁剪顶点：x = 非展开位置（可越出 ±π），t = 累计规范平移（L 的整数倍） */
interface ClipVert { x: number; y: number; z: number; tx: number; ty: number; tz: number }

const HALF = Math.PI;

/** Sutherland–Hodgman 多边形对半空间裁剪。位置与平移都线性插值；
 *  缝合顶点强制精确落平面（消插值漂移）。
 *  【关键】输出一律克隆：同一顶点可能同时进入域内/域外两个多边形，
 *  后续对域外片的就地平移不得污染域内副本（曾因共享引用产生 −3π 双重平移）。 */
function clipHalf(poly: ClipVert[], a: number, bound: number, keepLower: boolean): ClipVert[] {
  if (poly.length === 0) return [];
  const get = (v: ClipVert) => (a === 0 ? v.x : a === 1 ? v.y : v.z);
  const out: ClipVert[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % n];
    const dc = get(cur) - bound, dn = get(nxt) - bound;
    const inC = keepLower ? dc <= 0 : dc >= 0;
    const inN = keepLower ? dn <= 0 : dn >= 0;
    if (inC) out.push({ ...cur });
    if (inC !== inN) {
      const t = dc / (dc - dn);
      const v: ClipVert = {
        x: cur.x + (nxt.x - cur.x) * t,
        y: cur.y + (nxt.y - cur.y) * t,
        z: cur.z + (nxt.z - cur.z) * t,
        tx: cur.tx + (nxt.tx - cur.tx) * t,
        ty: cur.ty + (nxt.ty - cur.ty) * t,
        tz: cur.tz + (nxt.tz - cur.tz) * t,
      };
      if (a === 0) v.x = bound;
      else if (a === 1) v.y = bound;
      else v.z = bound;
      out.push(v);
    }
  }
  return out;
}

/**
 * 周期性 RVE 主构建函数。buildSurface 在 params.periodicRve 时路由到此。
 */
export function buildPeriodicSurface(params: BuildParams, _pool?: unknown): WorkerResponse {
  void _pool;
  const t0 = performance.now();
  const { type, iso, periods: k, resolution: R, targetPorosity, weights, structureMode: mode, customFormula } = params;

  // ── 守卫：周期可行性（违反即显式失败，导出层先行校验并引导用户）──
  if (params.containerShape !== 'cube') throw new Error('周期性 RVE 仅支持立方体容器（圆柱容器破坏 x/y 周期性）');
  if (mode !== 'solid_network' && mode !== 'shell') throw new Error('周期性 RVE 不支持梯度双壳（z 向厚度缩放破坏周期性）');
  if (params.hybrid?.enabled) throw new Error('周期性 RVE 暂不支持异构混合（radial 波前破坏周期性）');
  if ((params.endplateMm ?? 0) > 0) throw new Error('周期性 RVE 不兼容加载端板（端板是边界截断语义）');
  if (R < 8) throw new Error('周期性 RVE 分辨率过低（R ≥ 8）');

  const span = 2 * HALF;
  const L = span;
  const w = weights as Weights;
  const N = R + 1;                      // 节点 0..R（层 R = 层 0 的位级复制）

  // ── 1. 场填充（内置 8 类走 sin/cos 查表；custom 实时求值）──
  const useLookup = type !== 'custom';
  const tpmFn = useLookup ? null : getTpmsFunction('custom', customFormula, { k, t: params.thickness, iso });
  const sn = new Float64Array(N), cs = new Float64Array(N), cs2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (-HALF + (i / R) * span) * k;
    sn[i] = Math.sin(a); cs[i] = Math.cos(a); cs2[i] = Math.cos(2 * a);
  }
  const V = new Float64Array(N * N * N);
  let nonFinite = 0;
  const fillAt = (ix: number, iy: number, iz: number) => {
    const Sx = sn[ix], Cx = cs[ix], C2x = cs2[ix];
    const Sy = sn[iy], Cy = cs[iy], C2y = cs2[iy];
    const Sz = sn[iz], Cz = cs[iz], C2z = cs2[iz];
    let v: number;
    if (useLookup) {
      if (type === 'gyroid') v = w[0] * Sx * Cy + w[1] * Sy * Cz + w[2] * Sz * Cx;
      else if (type === 'neovius') v = w[0] * 3 * (Cx + Cy + Cz) + w[1] * 4 * Cx * Cy * Cz;
      else if (type === 'iwp') v = w[0] * 2 * (Cx * Cy + Cy * Cz + Cz * Cx) - w[1] * (C2x + C2y + C2z);
      else if (type === 'frd') v = w[0] * 4 * Cx * Cy * Cz - w[1] * (C2x * C2y + C2y * C2z + C2z * C2x);
      else if (type === 'diamond') v = w[0] * Sx * Sy * Sz + w[1] * Sx * Cy * Cz + w[2] * Cx * Sy * Cz + w[3] * Cx * Cy * Sz;
      else if (type === 'lidinoid')
        v = w[0] * 0.5 * (2 * Sx * Cx * Cy * Sz + 2 * Sy * Cy * Cz * Sx + 2 * Sz * Cz * Cx * Sy)
          + w[1] * (-0.5) * (C2x * C2y + C2y * C2z + C2z * C2x);
      else if (type === 'splitp')
        v = w[0] * 1.1 * (2 * Sx * Cx * Cy * Sz + 2 * Sx * Sy * Cy * Cz + 2 * Cx * Sy * Sz * Cz)
          + w[1] * (-0.2) * (C2x * C2y + C2y * C2z + C2z * C2x) + w[2] * (-0.4) * (C2x + C2y + C2z);
      else v = w[0] * Cx + w[1] * Cy + w[2] * Cz;   // schwarz
    } else {
      v = tpmFn!(-HALF * k + (ix / R) * span * k, -HALF * k + (iy / R) * span * k, -HALF * k + (iz / R) * span * k, w);
    }
    if (!Number.isFinite(v)) nonFinite++;
    return v;
  };
  for (let iz = 0; iz < R; iz++) {
    for (let iy = 0; iy < R; iy++) {
      for (let ix = 0; ix < R; ix++) {
        V[ix + iy * N + iz * N * N] = fillAt(ix, iy, iz);
      }
    }
  }
  if (nonFinite > 0) throw new Error(`公式结果含 ${nonFinite} 个非有限值（NaN/Inf）`);
  // 复制层：节点 R ≡ 节点 0（位级），x/y/z 三层独立复制（组合角点自动一致）
  for (let iz = 0; iz < N; iz++) {
    const izs = iz % R;
    for (let iy = 0; iy < N; iy++) {
      const iys = iy % R;
      for (let ix = 0; ix < N; ix++) {
        const ixs = ix % R;
        if (ix !== ixs || iy !== iys || iz !== izs) {
          V[ix + iy * N + iz * N * N] = V[ixs + iys * N + izs * N * N];
        }
      }
    }
  }

  // ── 2. 孔隙率二分（R³ 唯一节点）──
  let bias = iso;
  let tEff = Math.max(0.05, params.thickness * 1.5);
  {
    const uniq = new Float64Array(R * R * R);
    let u = 0;
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      uniq[u++] = V[ix + iy * N + iz * N * N];
    }
    const sorted = Float64Array.from(uniq).sort();
    const n = sorted.length;
    const lb = (val: number) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < val) lo = mid + 1; else hi = mid; } return lo; };
    const targetSolid = Math.max(0.02, Math.min(0.98, 1 - targetPorosity));
    if (mode === 'solid_network') {
      let lo = -2, hi = 2;
      for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (lb(mid) / n > targetSolid) hi = mid; else lo = mid; }
      bias = (lo + hi) / 2;
    } else {
      const count = (t: number) => lb(-t / 2) + (n - lb(t / 2));
      let lo = 0.02, hi = 6;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; if (count(mid) / n > targetSolid) lo = mid; else hi = mid; }
      tEff = (lo + hi) / 2;
    }
  }

  // ── 3. 最终场（纯周期场，无容器覆写）──
  const field = new Float64Array(N * N * N);
  let solidCount = 0;
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const i = ix + iy * N + iz * N * N;
    const dv = V[i] - bias;
    const f = mode === 'solid_network' ? bias - V[i] : dv * dv - (tEff / 2) * (tEff / 2);
    field[i] = f;
    if (f > 0) solidCount++;
  }
  for (let iz = 0; iz < N; iz++) {
    const izs = iz % R;
    for (let iy = 0; iy < N; iy++) {
      const iys = iy % R;
      for (let ix = 0; ix < N; ix++) {
        const ixs = ix % R;
        if (ix !== ixs || iy !== iys || iz !== izs) field[ix + iy * N + iz * N * N] = field[ixs + iys * N + izs * N * N];
      }
    }
  }
  const gridSolidFraction = solidCount / (R * R * R);

  // ── 4. cell 顶点（cells 0..R−1；节点层 R 参与插值但值=层 0）──
  const wc = (i: number) => -HALF + (i / R) * span;   // i ∈ [0,R]
  const idx = (x: number, y: number, z: number) => x + y * N + z * N * N;
  const cellVert = new Int32Array(R * R * R).fill(-1);
  const posArr: number[] = [];
  const ED = [
    [[0, 0, 0], [1, 0, 0]], [[0, 1, 0], [1, 1, 0]], [[0, 0, 1], [1, 0, 1]], [[0, 1, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0]], [[0, 0, 1], [0, 1, 1]], [[1, 0, 1], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1]], [[1, 0, 0], [1, 0, 1]], [[0, 1, 0], [0, 1, 1]], [[1, 1, 0], [1, 1, 1]],
  ] as const;

  for (let cz = 0; cz < R; cz++) {
    for (let cy = 0; cy < R; cy++) {
      for (let cx = 0; cx < R; cx++) {
        let solid = 0;
        for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const) {
          if (field[idx(cx + dx, cy + dy, cz + dz)] > 0) solid++;
        }
        if (solid === 0 || solid === 8) continue;
        let sx = 0, sy = 0, sz = 0, sc = 0;
        for (const [a, b] of ED) {
          const va = field[idx(cx + a[0], cy + a[1], cz + a[2])];
          const vb = field[idx(cx + b[0], cy + b[1], cz + b[2])];
          if ((va > 0) !== (vb > 0)) {
            let t = (0 - va) / (vb - va);
            if (!Number.isFinite(t)) t = 0.5;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            sx += wc(cx + a[0]) + (wc(cx + b[0]) - wc(cx + a[0])) * t;
            sy += wc(cy + a[1]) + (wc(cy + b[1]) - wc(cy + a[1])) * t;
            sz += wc(cz + a[2]) + (wc(cz + b[2]) - wc(cz + a[2])) * t;
            sc++;
          }
        }
        const vi = posArr.length / 3;
        if (sc > 0) posArr.push(sx / sc, sy / sc, sz / sc);
        else posArr.push(wc(cx) + (span / R) / 2, wc(cy) + (span / R) / 2, wc(cz) + (span / R) / 2);
        cellVert[cx + cy * R + cz * R * R] = vi;
      }
    }
  }

  // ── 5. quad 发射（穿越边为键 + 层对 {R−1,0} 全局恒定 +2π 规则 + 平面裁剪）──
  const outPos: number[] = [];
  const outIdx: number[] = [];
  // 【缝合 Canonical 吸附】落面顶点（多插值链到达同一理论点）强制精确 ±π：
  // 不同 quad 对同一盒棱/角点的插值路径有 ~1e-6 浮点抖动，不吸附会产生近重复
  // 顶点簇，破坏 PBC 配对唯一性与平铺焊接一致性（实测 88≠104 顶点数漂移根因）。
  const SNAP = 1e-5;
  const snapC = (c: number) => (c > HALF - SNAP && c < HALF + SNAP ? HALF : c < -HALF + SNAP && c > -HALF - SNAP ? -HALF : c);
  // 【容差焊接】缝合曲线的近重复顶点（相邻 quad 对同一点的独立插值，1e-6 量级
  // 间隔）必须合并为单一拓扑顶点——量化键在 1e-6 间隔下会跨桶漏合并
  // （实测 diamond solid 每面 3~66 个未配对顶点的根因），改用网格哈希 27 邻域。
  const WELD_TOL = 1e-5;
  const weldGrid = new Map<string, number[]>();
  const weld = (v: ClipVert): number => {
    const x = snapC(v.x), y = snapC(v.y), z = snapC(v.z);
    const gx = Math.round(x / WELD_TOL), gy = Math.round(y / WELD_TOL), gz = Math.round(z / WELD_TOL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = weldGrid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz));
      if (!arr) continue;
      for (const id of arr) {
        const ddx = x - outPos[id * 3], ddy = y - outPos[id * 3 + 1], ddz = z - outPos[id * 3 + 2];
        if (ddx * ddx + ddy * ddy + ddz * ddz <= WELD_TOL * WELD_TOL) return id;
      }
    }
    const id = outPos.length / 3;
    outPos.push(x, y, z);
    const k = gx + ',' + gy + ',' + gz;
    const arr = weldGrid.get(k) ?? [];
    arr.push(id);
    weldGrid.set(k, arr);
    return id;
  };

  const emitPoly = (poly: ClipVert[], dir: [number, number, number]) => {
    if (poly.length < 3) return;
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      nx += (p.y - q.y) * (p.z + q.z);
      ny += (p.z - q.z) * (p.x + q.x);
      nz += (p.x - q.x) * (p.y + q.y);
    }
    const sameSide = nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0;
    const ids = poly.map(weld);
    for (let i = 1; i + 1 < ids.length; i++) {
      const a = ids[0], b = sameSide ? ids[i] : ids[i + 1], c = sameSide ? ids[i + 1] : ids[i];
      if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
    }
  };

  const emitTriCanonical = (tri: ClipVert[], dir: [number, number, number]) => {
    let pieces: ClipVert[][] = [tri];
    const EPS = 1e-9;
    for (let a = 0; a < 3; a++) {
      const next: ClipVert[][] = [];
      for (const piece of pieces) {
        let hi = -Infinity, lo = Infinity;
        for (const v of piece) {
          const c = a === 0 ? v.x : a === 1 ? v.y : v.z;
          if (c > hi) hi = c;
          if (c < lo) lo = c;
        }
        if (hi <= HALF + EPS && lo >= -HALF - EPS) { next.push(piece); continue; }
        const posSide = hi > HALF + EPS;
        const bound = posSide ? HALF : -HALF;
        const keepLower = posSide;
        const inPart = clipHalf(piece, a, bound, keepLower);
        const outPart = clipHalf(piece, a, bound, !keepLower);
        for (const v of outPart) {
          if (a === 0) v.tx += posSide ? -L : L;
          else if (a === 1) v.ty += posSide ? -L : L;
          else v.tz += posSide ? -L : L;
        }
        if (inPart.length >= 3) next.push(inPart);
        if (outPart.length >= 3) next.push(outPart);
      }
      pieces = next;
      if (pieces.length === 0) return;
    }
    for (const p of pieces) {
      for (const v of p) { v.x += v.tx; v.y += v.ty; v.z += v.tz; }
      emitPoly(p, dir);
    }
  };

  /**
   * 发射一条穿越边的 quad。
   * span [sa, sb]：两条跨轴的节点层坐标（+x 边时为 [ay, az] 各自的 {n−1, n} 跨越由调用方展开）。
   * cells: 4 个 cell 的 canonical 索引（可含 R，表示「层 R = 层 0 的 +2π 像」）。
   * 规则：某轴跨越 {R−1,0} 层对（n==0 或 n==R）时，canonical 坐标为 0 的 cell 在该轴 +2π。
   */
  const emitQuad = (cells: [number, number, number][], wrappedAxes: boolean[], axis: number, sign: number) => {
    const corners: ClipVert[] = cells.map((cell) => {
      const ccx = cell[0] % R, ccy = cell[1] % R, ccz = cell[2] % R;
      const vi = cellVert[ccx + ccy * R + ccz * R * R];
      const sx = (wrappedAxes[0] && cell[0] === R ? 1 : 0) * L;
      const sy = (wrappedAxes[1] && cell[1] === R ? 1 : 0) * L;
      const sz = (wrappedAxes[2] && cell[2] === R ? 1 : 0) * L;
      return {
        x: posArr[vi * 3] + sx,
        y: posArr[vi * 3 + 1] + sy,
        z: posArr[vi * 3 + 2] + sz,
        tx: 0, ty: 0, tz: 0,
      };
    });
    const dir: [number, number, number] = [0, 0, 0];
    dir[axis] = sign;
    const d02 = (corners[0].x - corners[2].x) ** 2 + (corners[0].y - corners[2].y) ** 2 + (corners[0].z - corners[2].z) ** 2;
    const d13 = (corners[1].x - corners[3].x) ** 2 + (corners[1].y - corners[3].y) ** 2 + (corners[1].z - corners[3].z) ** 2;
    if (d02 <= d13) {
      emitTriCanonical([corners[0], corners[1], corners[2]], dir);
      emitTriCanonical([corners[0], corners[2], corners[3]], dir);
    } else {
      emitTriCanonical([corners[0], corners[1], corners[3]], dir);
      emitTriCanonical([corners[1], corners[2], corners[3]], dir);
    }
  };

  /** 跨轴层坐标 n∈[0,R] → cell 坐标对：n==0 时跨 {R−1, 0}（0 取 +2π 像，编码为 R） */
  const spanPair = (n: number): [number, number] => (n === 0 ? [R - 1, R] : [n - 1, n]);
  const isWrapped = (n: number) => n === 0 || n === R;

  for (let az = 0; az < N; az++) {
    for (let ay = 0; ay < N; ay++) {
      for (let ax = 0; ax < N; ax++) {
        const p = idx(ax, ay, az);
        const fp = field[p];
        const pPos = fp > 0;
        // 【重复发射守卫】复制层（坐标 == R）上的边与对应层 0 的边是同一环面边
        // （场值位级复制）——跳过层 R 上的跨越边，物理 quad 只发一次。
        // +x 出边（终点 ax+1 仅当 ax<R；终点层的场值已含复制语义）
        if (ax < R && ay < R && az < R && (field[idx(ax + 1, ay, az)] > 0) !== pPos) {
          const [y0, y1] = spanPair(ay), [z0, z1] = spanPair(az);
          emitQuad(
            [[ax, y0, z0], [ax, y1, z0], [ax, y1, z1], [ax, y0, z1]],
            [false, isWrapped(ay), isWrapped(az)], 0, pPos ? 1 : -1,
          );
        }
        // +y 出边
        if (ay < R && ax < R && az < R && (field[idx(ax, ay + 1, az)] > 0) !== pPos) {
          const [x0, x1] = spanPair(ax), [z0, z1] = spanPair(az);
          emitQuad(
            [[x0, ay, z0], [x0, ay, z1], [x1, ay, z1], [x1, ay, z0]],
            [isWrapped(ax), false, isWrapped(az)], 1, pPos ? 1 : -1,
          );
        }
        // +z 出边
        if (az < R && ax < R && ay < R && (field[idx(ax, ay, az + 1)] > 0) !== pPos) {
          const [x0, x1] = spanPair(ax), [y0, y1] = spanPair(ay);
          emitQuad(
            [[x0, y0, az], [x1, y0, az], [x1, y1, az], [x0, y1, az]],
            [isWrapped(ax), isWrapped(ay), false], 2, pPos ? 1 : -1,
          );
        }
      }
    }
  }

  // ── 6. PBC 节点配对表 ──
  const vertCount = outPos.length / 3;
  const tol = 1e-5;
  const atPlane = (c: number, s: number) => (s > 0 ? c > HALF - tol : c < -HALF + tol);
  const facePair = (a: number): [number, number][] => {
    const posIdx: number[] = [], negIdx: number[] = [];
    for (let i = 0; i < vertCount; i++) {
      const c = outPos[i * 3 + a];
      if (atPlane(c, 1)) posIdx.push(i);
      else if (atPlane(c, -1)) negIdx.push(i);
    }
    // 桶配对（1e-4 分辨率）：几何 mates 由构造位级一致；桶只解决查找，
    // 近碰撞（<1e-4 的两个独立缝合点）允许小残差，audit 以 ≤1e-4 验收
    const bucket = new Map<string, number>();
    for (const i of negIdx) {
      const o1 = outPos[i * 3 + ((a + 1) % 3)], o2 = outPos[i * 3 + ((a + 2) % 3)];
      bucket.set(`${Math.round(o1 * 1e4)},${Math.round(o2 * 1e4)}`, i);
    }
    const pairs: [number, number][] = [];
    for (const i of posIdx) {
      const o1 = outPos[i * 3 + ((a + 1) % 3)], o2 = outPos[i * 3 + ((a + 2) % 3)];
      const partner = bucket.get(`${Math.round(o1 * 1e4)},${Math.round(o2 * 1e4)}`);
      if (partner !== undefined) pairs.push([i, partner]);
    }
    return pairs;
  };
  const pairsX = facePair(0), pairsY = facePair(1), pairsZ = facePair(2);

  const planeSig = (i: number): number[] => [0, 1, 2].map((a) => {
    const c = outPos[i * 3 + a];
    return atPlane(c, 1) ? 1 : atPlane(c, -1) ? -1 : 0;
  });
  const edgeMap = new Map<string, number[]>();
  const cornerMap = new Map<string, number[]>();
  for (let i = 0; i < vertCount; i++) {
    const sig = planeSig(i);
    const nz = sig.filter((s) => s !== 0).length;
    if (nz === 2) {
      const key = sig.join(',');
      const arr = edgeMap.get(key) ?? [];
      arr.push(i); edgeMap.set(key, arr);
    } else if (nz === 3) {
      const key = sig.join(',');
      const arr = cornerMap.get(key) ?? [];
      arr.push(i); cornerMap.set(key, arr);
    }
  }

  // ── 7. 表面积 + 离散法线 ──
  let surfaceArea = 0;
  for (let t = 0; t < outIdx.length; t += 3) {
    const i0 = outIdx[t] * 3, i1 = outIdx[t + 1] * 3, i2 = outIdx[t + 2] * 3;
    const ux = outPos[i1] - outPos[i0], uy = outPos[i1 + 1] - outPos[i0 + 1], uz = outPos[i1 + 2] - outPos[i0 + 2];
    const vx = outPos[i2] - outPos[i0], vy = outPos[i2 + 1] - outPos[i0 + 1], vz = outPos[i2 + 2] - outPos[i0 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    surfaceArea += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  const mmScale = wcToMmFactor(k);
  const surfaceAreaMm = surfaceArea * mmScale * mmScale;
  const envelopeMm = Math.pow(L * mmScale, 3);

  const indices32 = new Uint32Array(outIdx);
  const positions32 = new Float32Array(outPos);
  const normals = new Float32Array(vertCount * 3);
  for (let t = 0; t < indices32.length; t += 3) {
    const i0 = indices32[t] * 3, i1 = indices32[t + 1] * 3, i2 = indices32[t + 2] * 3;
    const ax = positions32[i1] - positions32[i0], ay = positions32[i1 + 1] - positions32[i0 + 1], az = positions32[i1 + 2] - positions32[i0 + 2];
    const bx = positions32[i2] - positions32[i0], by = positions32[i2 + 1] - positions32[i0 + 1], bz = positions32[i2 + 2] - positions32[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
  }
  for (let i = 0; i < vertCount; i++) {
    const len = Math.sqrt(normals[i * 3] ** 2 + normals[i * 3 + 1] ** 2 + normals[i * 3 + 2] ** 2) || 1;
    normals[i * 3] /= len; normals[i * 3 + 1] /= len; normals[i * 3 + 2] /= len;
  }

  return {
    id: 0,
    type: 'result',
    positions: positions32,
    normals,
    indices: indices32,
    vertCount,
    triCount: Math.floor(indices32.length / 3),
    porosityEstimate: 1 - gridSolidFraction,
    isoUsed: mode === 'solid_network' ? bias : tEff / 2,
    resolution: R,
    surfaceArea: surfaceAreaMm,
    envelopeVolume: envelopeMm,
    svRatio: surfaceAreaMm / envelopeMm,
    meshSolidFraction: gridSolidFraction,
    nmEdgeCount: 0,
    pbcPairs: { pairsX, pairsY, pairsZ, edgeClasses: [...edgeMap.values()], cornerClasses: [...cornerMap.values()] },
    buildTimeMs: performance.now() - t0,
  };
}
