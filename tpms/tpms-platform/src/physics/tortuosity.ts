/**
 * 三向几何迂曲度（Geometric Tortuosity τx/τy/τz）
 *
 * 定义：τ_i = L_path,i / L0,i。在体素化流体空间（F<0 / 非固相，判据与平台
 * 最终场同语义，见 percolation-analysis.isSolidAt）上，沿主轴 i 以 26 连通
 * Dijkstra（欧氏边长）求入流截面到出流截面的最短流体路径长度 L_path；
 * L0 = 沿轴直线距离。τ ≥ 1；某方向无贯通流道 ⇒ τ = Infinity（未贯通）。
 *
 * 工程意义：τ 越大传质/渗透阻力越高；τ 的三向差异是多孔支架各向异性传质的
 * 一阶指标。26 连通（而非 6 连通）使路径长度近似连续，把栅格量子化误差压到
 * 对称曲面三向一致性断言（≤1%）可承受的水平。
 *
 * 成本：64³ 网格 × 3 轴 Dijkstra（lazy-deletion 二叉堆，26 邻域）
 * ≈ 0.6~0.9 s（单线程）。调用方应 debounce / idle 调度。
 */

import type { SectionAnalysisParams } from './percolation-analysis';
import { isSolidAt } from './percolation-analysis';

export interface TortuosityResult {
  /** 三向迂曲度；未贯通方向为 Infinity */
  tau: [number, number, number];
  /** 三向是否贯通 */
  percolating: [boolean, boolean, boolean];
  /** 体素栅格边长（采样点数） */
  gridN: number;
  /** 流体体素占比 */
  fluidFraction: number;
}

// 26 邻域偏移（含 6 面 + 12 棱 + 8 角）
const NEIGH: [number, number, number][] = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (dx !== 0 || dy !== 0 || dz !== 0) NEIGH.push([dx, dy, dz]);
const NEIGH_LEN = NEIGH.map(([dx, dy, dz]) => Math.sqrt(dx * dx + dy * dy + dz * dz));

/** 二叉最小堆（lazy deletion：比较 dist 快照） */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    this.keys.push(key); this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): [number, number] | null {
    if (this.keys.length === 0) return null;
    const topKey = this.keys[0], topVal = this.vals[0];
    const lk = this.keys.pop()!, lv = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk; this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        [this.vals[m], this.vals[i]] = [this.vals[i], this.vals[m]];
        i = m;
      }
    }
    return [topKey, topVal];
  }
}

/**
 * 单轴 Dijkstra：从 axis 负面全部流体格出发（初始距离 0），到 axis 正面任一
 * 流体格的最短欧氏路径长（体素单位）。不可达返回 Infinity。
 */
function shortestPathAlongAxis(
  fluid: Uint8Array, n: number, axis: 0 | 1 | 2,
): number {
  const dist = new Float64Array(n ** 3).fill(Infinity);
  const heap = new MinHeap();
  const coords = [0, 0, 0];
  // 负面源：壳排除后的负面内邻层（iz/ix/iy = 1），初始距离 1（距边界层一格）
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      coords[axis] = 1; coords[(axis + 1) % 3] = a; coords[(axis + 2) % 3] = b;
      const idx = coords[0] + coords[1] * n + coords[2] * n * n;
      if (fluid[idx]) { dist[idx] = 0; heap.push(0, idx); }
    }
  }
  const lastPlane = n - 2;      // 壳排除后：正面内邻层
  while (heap.size) {
    const top = heap.pop()!;
    const d = top[0], idx = top[1];
    if (d > dist[idx]) continue;   // lazy deletion
    coords[0] = idx % n;
    coords[1] = ((idx / n) | 0) % n;
    coords[2] = (idx / (n * n)) | 0;
    if (coords[axis] === lastPlane) return d;   // 首次到达正面即最短
    for (let k = 0; k < 26; k++) {
      const [dx, dy, dz] = NEIGH[k];
      const nx = coords[0] + dx, ny = coords[1] + dy, nz = coords[2] + dz;
      if (nx < 0 || nx >= n || ny < 0 || ny >= n || nz < 0 || nz >= n) continue;
      const nIdx = nx + ny * n + nz * n * n;
      if (!fluid[nIdx]) continue;
      const nd = d + NEIGH_LEN[k];
      if (nd < dist[nIdx]) { dist[nIdx] = nd; heap.push(nd, nIdx); }
    }
  }
  return Infinity;
}

/**
 * 三向迂曲度主入口。
 * @param sampleN 体素栅格边长（默认 64，任务域 64~80）
 */
export function analyzeTortuosity3D(
  params: SectionAnalysisParams,
  sampleN = 64,
  debug = false,
): TortuosityResult {
  const coordOf = (i: number) => -1 + (2 * i) / (sampleN - 1);
  const fluid = new Uint8Array(sampleN ** 3);
  let fluidCount = 0;
  let idx = 0;
  for (let iz = 0; iz < sampleN; iz++) {
    const z = coordOf(iz);
    for (let iy = 0; iy < sampleN; iy++) {
      const y = coordOf(iy);
      for (let ix = 0; ix < sampleN; ix++) {
        // 容器外表面壳层（任一坐标触界）排除出流体空间——
        // 否则边界棱/面的空气格构成贯穿六面的"壳层直通道"，
        // 任何结构的几何 τ 都会被污染为 1.000（首轮实测根因）
        const onShell = ix === 0 || ix === sampleN - 1 || iy === 0 || iy === sampleN - 1 || iz === 0 || iz === sampleN - 1;
        const isFluid = !onShell && !isSolidAt(params, coordOf(ix), y, z);
        fluid[idx++] = isFluid ? 1 : 0;
        if (isFluid) fluidCount++;
      }
    }
  }
  if (debug) {
    let z0 = 0, zLast = 0;
    for (let a = 0; a < sampleN; a++) for (let b = 0; b < sampleN; b++) {
      z0 += fluid[a + b * sampleN];
      zLast += fluid[a + b * sampleN + sampleN * sampleN * (sampleN - 1)];
    }
    console.log(`[tortuosity debug] iz=0 fluid=${z0}/${sampleN * sampleN} | iz=${sampleN - 1} fluid=${zLast}/${sampleN * sampleN}`);
  }
  const fluidFraction = fluidCount / fluid.length;

  const tau: [number, number, number] = [Infinity, Infinity, Infinity];
  const percolating: [boolean, boolean, boolean] = [false, false, false];
  // L0：源内邻层（iz=1）到对面内邻层（iz=n−2）的轴向直线步数；
  // 路径段数与 L0 同口径 ⇒ 纯直线路径 τ 精确 = 1.0
  const L0 = sampleN - 3;
  for (let axis = 0 as 0 | 1 | 2; axis < 3; axis++) {
    const Lpath = shortestPathAlongAxis(fluid, sampleN, axis as 0 | 1 | 2);
    if (Number.isFinite(Lpath)) {
      percolating[axis] = true;
      tau[axis] = Lpath / L0;
    }
  }
  return { tau, percolating, gridN: sampleN, fluidFraction };
}
