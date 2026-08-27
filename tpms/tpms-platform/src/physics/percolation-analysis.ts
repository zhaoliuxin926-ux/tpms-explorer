/**
 * 截面连通性分析（2D Percolation & Island Preflight）
 *
 * 用途：剖切平面处的打印前预检——
 *   · through-channels    贯通主通道：空域连通片横跨剖切面两侧边界（可灌注/可渗流）
 *   · closed cavities     封闭死腔：不贯通的空域连通片（残留粉末/树脂捕集风险）
 *   · isolated islands    悬空孤岛：不接触任何容器边界的固相连通片
 *                          （打印时无锚定的漂浮微结构，工艺风险最高）
 *   · sectionPorosity     截面孔隙率（空域占比，MC 口径）
 *
 * 实现：在剖切面内均匀采样 sampleN² 点，逐点按平台最终场同语义判固/空
 * （solid: iso−v>0；shell 族: dv²−(t/2·scale)²>0；端板带强制实体；容器外空气），
 * 再做 4-连通 BFS 标记。O(N²) 纯整数/浮点运算，N=96 时 <2ms，可安全在主线程
 * 以 debounce 方式执行，无需 Worker。
 *
 * 已知边界：hybrid 混合场无法用单一隐函数复刻（alpha 权重场），不支持——
 * 调用方应在 hybrid.enabled 时置灰该功能。
 */

import type { TpmType, StructureMode, ContainerShape, GradientDirection, SliceAxis } from '../types';

export type { SliceAxis };

export interface SectionAnalysisParams {
  type: TpmType;
  customFormula: string;
  weights: [number, number, number, number];
  /** 周期数 k（1 period = 1 mm） */
  periods: number;
  mode: StructureMode;
  gradientDir: GradientDirection;
  container: ContainerShape;
  /** 精确等值参数：solid = biasBase；shell 族 = tEffBase/2（均来自 Worker isoUsed） */
  isoUsed: number;
  /** 实心端板厚度 mm（0 关闭） */
  endplateMm: number;
}

export interface SectionQuery {
  axis: SliceAxis;
  /** 剖切面在轴向的归一化位置 ∈ [−1, 1]（±1 = 域边界） */
  posNorm: number;
  /** 采样密度（每维格数），默认 96 */
  sampleN?: number;
}

export interface PercolationResult {
  throughChannels: number;
  closedCavities: number;
  isolatedIslands: number;
  /** 截面孔隙率 ∈ [0,1]（空域占比） */
  sectionPorosity: number;
  sampleN: number;
}

/**
 * 与 surface-nets 最终场同语义的固相判定（最终场 > 0 = 实体）。
 * phys 坐标 ∈ [−1,1]³；返回 true = 固体。
 */
function isSolidAt(params: SectionAnalysisParams, x: number, y: number, z: number): boolean {
  const k = params.periods;
  const PI = Math.PI;
  // 容器外一律空气（与 boundAt 同式）
  let bound: number;
  if (params.container === 'cylinder') bound = Math.max(x * x + y * y - 1, Math.abs(z) - 1);
  else bound = Math.max(Math.abs(x) - 1, Math.abs(y) - 1, Math.abs(z) - 1);
  if (bound >= 0) return false;

  // 端板带（与 surface-nets 实现同判据：|z_mm| ≥ L/2 − t_eff；此处直接 phys 比对）
  if (params.endplateMm > 0) {
    const tEff = Math.min(params.endplateMm, 0.4 * k);
    if (Math.abs(z) >= 1 - (2 * tEff) / k - 2 / (k * PI) * 0) {
      // 与平台一致：带内且侧向界内即实体（z 向收口层的半格差对 2D 判定无感）
      let sideB: number;
      if (params.container === 'cylinder') sideB = x * x + y * y - 1;
      else sideB = Math.max(Math.abs(x) - 1, Math.abs(y) - 1);
      return sideB < 0;
    }
  }

  const mx = x * PI * k, my = y * PI * k, mz = z * PI * k;
  const w = params.weights;
  let v: number;
  switch (params.type) {
    case 'gyroid': v = w[0] * Math.sin(mx) * Math.cos(my) + w[1] * Math.sin(my) * Math.cos(mz) + w[2] * Math.sin(mz) * Math.cos(mx); break;
    case 'diamond': v = w[0] * Math.sin(mx) * Math.sin(my) * Math.sin(mz) + w[1] * Math.sin(mx) * Math.cos(my) * Math.cos(mz) + w[2] * Math.cos(mx) * Math.sin(my) * Math.cos(mz) + w[3] * Math.cos(mx) * Math.cos(my) * Math.sin(mz); break;
    case 'schwarz': v = w[0] * Math.cos(mx) + w[1] * Math.cos(my) + w[2] * Math.cos(mz); break;
    case 'neovius': v = w[0] * 3 * (Math.cos(mx) + Math.cos(my) + Math.cos(mz)) + w[1] * 4 * Math.cos(mx) * Math.cos(my) * Math.cos(mz); break;
    case 'iwp': {
      const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
      v = w[0] * 2 * (Math.cos(mx) * Math.cos(my) + Math.cos(my) * Math.cos(mz) + Math.cos(mz) * Math.cos(mx)) - w[1] * (C2x + C2y + C2z);
      break;
    }
    case 'frd': {
      const C2x = Math.cos(2 * mx), C2y = Math.cos(2 * my), C2z = Math.cos(2 * mz);
      v = w[0] * 4 * Math.cos(mx) * Math.cos(my) * Math.cos(mz) - w[1] * (C2x * C2y + C2y * C2z + C2z * C2x);
      break;
    }
    case 'lidinoid':
    case 'splitp':
    case 'custom':
      // 非查表类型：与平台一致走实时求值由调用方注入的公式不可行（模块零依赖），
      // 因此这三种类型由调用方通过 customSampler 注入；缺省按空气处理并由 UI 提示。
      return false;
    default:
      return false;
  }

  if (params.mode === 'solid_network') {
    return params.isoUsed - v > 0;                       // bias − v > 0
  }
  const dv = v - 0;                                      // shell 族 biasForShell = 0
  let tHalf = params.isoUsed;                            // isoUsed = tEffBase / 2
  if (params.mode === 'gradient_shell') {
    let scale = 1.0;
    if (params.gradientDir === 'radial') scale = Math.max(1.5 - Math.min((x * x + y * y) / 2, 1.4), 0.1);
    else if (params.gradientDir === 'spherical') scale = Math.max(1.5 - Math.min((x * x + y * y + z * z) / 3, 1.4), 0.1);
    else scale = 1.5 - (z + 1) * 0.5;
    tHalf = params.isoUsed * scale;
  }
  return dv * dv - tHalf * tHalf > 0;
}

/**
 * 主入口：剖切面固/空二值场 → 4-连通标记 → 三类拓扑计数 + 截面孔隙率。
 * 支持的曲面类型受查表公式集合限制（lidinoid/splitp/custom 返回 null，
 * 调用方 UI 置灰提示）。
 */
export function analyzeSection(
  params: SectionAnalysisParams,
  query: SectionQuery,
): PercolationResult | null {
  switch (params.type) {
    case 'gyroid': case 'diamond': case 'schwarz': case 'neovius':
    case 'iwp': case 'frd':
      break;
    default:
      return null;   // lidinoid / splitp / custom：调用方置灰
  }

  const n = query.sampleN ?? 96;
  const { axis, posNorm } = query;
  const axisCoord = Math.max(-1, Math.min(1, posNorm));

  // 固/空二值栅格（按平面内两正交轴展开）
  const [uAxis, vAxis] = axis === 'x' ? [1, 2] : axis === 'y' ? [0, 2] : [0, 1];
  const coord = [0, 0, 0];
  coord[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = axisCoord;

  const solidGrid = new Uint8Array(n * n);
  let voidCount = 0;
  for (let iv = 0; iv < n; iv++) {
    coord[vAxis] = -1 + (2 * iv) / (n - 1);
    for (let iu = 0; iu < n; iu++) {
      coord[uAxis] = -1 + (2 * iu) / (n - 1);
      const solid = isSolidAt(params, coord[0], coord[1], coord[2]);
      solidGrid[iv * n + iu] = solid ? 1 : 0;
      if (!solid) voidCount++;
    }
  }
  const sectionPorosity = voidCount / (n * n);

  // 4-连通 BFS 标记（label > 0 的栅格为已访问）
  const label = new Int32Array(n * n);
  const queue = new Int32Array(n * n);
  const touchU0 = new Uint8Array(n * n + 1), touchU1 = new Uint8Array(n * n + 1);
  const touchV0 = new Uint8Array(n * n + 1), touchV1 = new Uint8Array(n * n + 1);
  const components: { id: number; solid: boolean }[] = [];
  let nextLabel = 1;

  const bfs = (start: number, isSolidComp: boolean) => {
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = nextLabel;
    let tu0 = 0, tu1 = 0, tv0 = 0, tv1 = 0, count = 0;
    while (head < tail) {
      const cur = queue[head++];
      count++;
      const iv = (cur / n) | 0, iu = cur % n;
      if (iu === 0) tu0 = 1;
      if (iu === n - 1) tu1 = 1;
      if (iv === 0) tv0 = 1;
      if (iv === n - 1) tv1 = 1;
      // 4-邻域
      if (iu > 0 && label[cur - 1] === 0 && (!!solidGrid[cur - 1] === isSolidComp)) { label[cur - 1] = nextLabel; queue[tail++] = cur - 1; }
      if (iu < n - 1 && label[cur + 1] === 0 && (!!solidGrid[cur + 1] === isSolidComp)) { label[cur + 1] = nextLabel; queue[tail++] = cur + 1; }
      if (iv > 0 && label[cur - n] === 0 && (!!solidGrid[cur - n] === isSolidComp)) { label[cur - n] = nextLabel; queue[tail++] = cur - n; }
      if (iv < n - 1 && label[cur + n] === 0 && (!!solidGrid[cur + n] === isSolidComp)) { label[cur + n] = nextLabel; queue[tail++] = cur + n; }
    }
    components.push({ id: nextLabel, solid: isSolidComp });
    // 边界触达信息挂到分量（复用数组索引 = label）
    if (tu0) touchU0[nextLabel] = 1;
    if (tu1) touchU1[nextLabel] = 1;
    if (tv0) touchV0[nextLabel] = 1;
    if (tv1) touchV1[nextLabel] = 1;
    nextLabel++;
  };

  // 空域分量
  for (let i = 0; i < n * n; i++) if (label[i] === 0 && !solidGrid[i]) bfs(i, false);
  // 固域分量
  for (let i = 0; i < n * n; i++) if (label[i] === 0 && solidGrid[i]) bfs(i, true);

  let throughChannels = 0, closedCavities = 0, isolatedIslands = 0;
  for (const comp of components) {
    if (comp.solid) {
      // 悬空孤岛：固相且四边皆未触达
      if (!touchU0[comp.id] && !touchU1[comp.id] && !touchV0[comp.id] && !touchV1[comp.id]) isolatedIslands++;
      continue;
    }
    // 空域：触达两对边（u0&u1 或 v0&v1）= 贯通；否则封闭死腔
    const throughU = touchU0[comp.id] && touchU1[comp.id];
    const throughV = touchV0[comp.id] && touchV1[comp.id];
    if (throughU || throughV) throughChannels++;
    else closedCavities++;
  }

  return { throughChannels, closedCavities, isolatedIslands, sectionPorosity, sampleN: n };
}

/**
 * 【3D 悬空孤岛检测】（打印风险的正确语义）
 *
 * 2D 截面上的固相孤立斑≠打印风险：3D 连通的 TPMS 结构在任意截面上必然呈现
 * 大量 2D 孤立斑（蜂窝切片效应）。真正的悬空结构必须以 3D 判定——
 * 在全域降采样栅格（默认 64³）上做固相 6-连通标记：
 *   孤岛 = 既不接触容器六面边界、也不接触当前剖切平面的固相连通片。
 *
 * 复杂度 O(N³)，64³ ≈ 26 万格，JS 单线程 ~40ms（debounce 后可接受）。
 */
export function analyzeIslands3D(
  params: SectionAnalysisParams,
  axis: SliceAxis,
  posNorm: number,
  sampleN = 96,
): { isolatedIslands3D: number } {
  const coordOf = (i: number) => -1 + (2 * i) / (sampleN - 1);
  const grid = new Uint8Array(sampleN ** 3);
  let idx = 0;
  for (let iz = 0; iz < sampleN; iz++) {
    const z = coordOf(iz);
    for (let iy = 0; iy < sampleN; iy++) {
      const y = coordOf(iy);
      for (let ix = 0; ix < sampleN; ix++) {
        grid[idx++] = isSolidAt(params, coordOf(ix), y, z) ? 1 : 0;
      }
    }
  }

  const N3 = sampleN;
  const label = new Int32Array(N3 ** 3);
  const queue = new Int32Array(N3 ** 3);
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const slabTol = 1.5 / (sampleN - 1);        // 剖切面接触容差（约一个半 cell）
  const strides = [1, N3, N3 * N3];
  let islands = 0, nextLabel = 1;

  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || label[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = nextLabel;
    let touchesBoundary = false, touchesPlane = false, count = 0;
    while (head < tail) {
      const cur = queue[head++];
      count++;
      const ix = cur % N3;
      const iy = ((cur / N3) | 0) % N3;
      const iz = (cur / (N3 * N3)) | 0;
      const coords = [ix, iy, iz];
      // 边界接触（六面）——已连接容器壁/端板 ⇒ 有支撑锚
      if (ix === 0 || ix === N3 - 1 || iy === 0 || iy === N3 - 1 || iz === 0 || iz === N3 - 1) touchesBoundary = true;
      // 剖切面接触：面被切开 ⇒ 该块与主结构在剖切面处相连（视觉可见）
      if (Math.abs(coords[axisIdx] / (N3 - 1) * 2 - 1 - posNorm) <= slabTol) touchesPlane = true;
      for (let d = 0; d < 3; d++) {
        const st = strides[d];
        if (coords[d] > 0 && !label[cur - st] && grid[cur - st]) { label[cur - st] = nextLabel; queue[tail++] = cur - st; }
        if (coords[d] < N3 - 1 && !label[cur + st] && grid[cur + st]) { label[cur + st] = nextLabel; queue[tail++] = cur + st; }
      }
    }
    // 最小体素数过滤：降采样会把细连接处打断产生假阳性碎块（<8 体素≈2³），
    // 真实悬空固相块必然大于该尺度
    if (!touchesBoundary && !touchesPlane && count >= 8) islands++;
    nextLabel++;
  }
  return { isolatedIslands3D: islands };
}
