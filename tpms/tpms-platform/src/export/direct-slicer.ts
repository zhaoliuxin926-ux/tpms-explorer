/**
 * 直接隐式层切 v1（战役三 2026-09-14）——扫描线区间法
 *
 * 数学源：VoxelModel 的 V 场（体素中心采样，wc 域）+ isoUsed 等值面（与体素/网格同 iso）。
 * 每层 z_k、每行 y_j：沿 x 对 V−iso 线性插值求根 → 固相区间（V<iso）列表（x 周期 mod 处理）。
 *   层净面积 = Σ 区间长 × 行距；体积 = Σ 层面积 × 层高——一维求根无 16-case/无环链接/
 *   无 unwrap，数学严谨性与等值线法同阶（线性插值精度）。
 * SVG 交付：逐行矢量填充带 + 扫描路径线（M x1 y H x2）——即增材扫描填充路径本身。
 *
 * 弃用路线登记：Marching Squares 环面环链接（gyroid 截面固相为绕环面条带，波浪线绕环闭合
 * 的 shoelace 基准语义 + 周期 unwrap 深水区，三轮实测未收敛）——扫描线法绕开全部拓扑难题。
 *
 * 验收口径：层切体积 vs 同模型体素体积（solidCount×h³）两独立积分对拍（门禁断言）。
 * 范围：solid_network + cube 容器（域边界即容器；shell/cylinder 另属）。
 */
import type { VoxelModel } from './voxel-model';

export interface SliceLayer {
  z: number;            // mm（层中心，相对试样中面）
  nRows: number;        // 层内行数（= 体素分辨率）
  /** 有固相区间的行（行号 y + 区间列表，格坐标 x ∈ [0, nRows)） */
  rows: { y: number; iv: [number, number][] }[];
  netArea: number;      // mm²（Σ 区间长 × 行距）
}

export interface DirectSliceResult {
  layers: SliceLayer[];
  layerHeightMm: number;
  volumeMm3: number;    // Σ 净面积 × 层高
  totalIntervals: number;
}

/** 三线性采样体素中心 V 场（wc 域 → 任意 wc 点）——与 voxel-model sdfAt 同型 */
function sampler(model: VoxelModel): (x: number, y: number, z: number) => number {
  const { R, V } = model;
  const span = 2 * Math.PI;
  const toG = (wc: number) => ((wc + Math.PI) / span) * R - 0.5; // 体素中心 i ↔ wc = -π+(i+0.5)h
  return (x: number, y: number, z: number) => {
    const gx = toG(x), gy = toG(y), gz = toG(z);
    const i0 = Math.min(R - 1, Math.max(0, Math.floor(gx))), j0 = Math.min(R - 1, Math.max(0, Math.floor(gy))), k0 = Math.min(R - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i0)), fy = Math.min(1, Math.max(0, gy - j0)), fz = Math.min(1, Math.max(0, gz - k0));
    const i1 = Math.min(R - 1, i0 + 1), j1 = Math.min(R - 1, j0 + 1), k1 = Math.min(R - 1, k0 + 1);
    const at = (a: number, b: number, c: number) => V[(c * R + b) * R + a];
    const c00 = at(i0, j0, k0) * (1 - fx) + at(i1, j0, k0) * fx;
    const c01 = at(i0, j1, k0) * (1 - fx) + at(i1, j1, k0) * fx;
    const c10 = at(i0, j0, k1) * (1 - fx) + at(i1, j0, k1) * fx;
    const c11 = at(i0, j1, k1) * (1 - fx) + at(i1, j1, k1) * fx;
    return (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
  };
}

export interface DirectSliceOptions {
  /** 容器裁剪（v2 容器裁剪轮）：cylinder 走解析求根（精确一阶）；mesh 走 sdf 三线性采样线性求根 */
  containerShape?: 'cube' | 'cylinder' | 'mesh';
  /** C5 mesh 容器 SDF（(R+1)³ 节点，phys 域 [-1,1]，外正内负）——containerShape='mesh' 时必填 */
  containerSdf?: Float32Array;
}

/** 两个有序区间列表的 1D 布尔交（线性合并） */
function intersectIntervals(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

export function directSlice(model: VoxelModel, layerCount: number, specimenSizeMm: number, opts: DirectSliceOptions = {}): DirectSliceResult {
  const { R } = model;
  const iso = model.isoUsed;
  const scale = specimenSizeMm / (2 * Math.PI); // wc → mm（与 polyMesh 同口径）
  const span = 2 * Math.PI;
  const sample = sampler(model);
  const n = R;          // 每层行数 = 体素分辨率（行距/列距 = wc 域 span/n）
  const dGrid = span / n;
  const layerH = span / layerCount;
  const cShape = opts.containerShape ?? 'cube';
  // mesh 容器 sdf 采样器（phys 域网格 (R+1)³——与 buildVoxelModel 的 sdfAt 同型）
  const sdfSampler = (x: number, y: number, z: number): number => {
    const s = opts.containerSdf!;
    const gx = ((x / Math.PI) + 1) / 2 * R, gy = ((y / Math.PI) + 1) / 2 * R, gz = ((z / Math.PI) + 1) / 2 * R;
    const i0 = Math.min(R - 1, Math.max(0, Math.floor(gx))), j0 = Math.min(R - 1, Math.max(0, Math.floor(gy))), k0 = Math.min(R - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i0)), fy = Math.min(1, Math.max(0, gy - j0)), fz = Math.min(1, Math.max(0, gz - k0));
    const i1 = Math.min(R, i0 + 1), j1 = Math.min(R, j0 + 1), k1 = Math.min(R, k0 + 1);
    const at = (a: number, b: number, c: number) => s[(c * (R + 1) + b) * (R + 1) + a];
    const c00 = at(i0, j0, k0) * (1 - fx) + at(i1, j0, k0) * fx;
    const c01 = at(i0, j1, k0) * (1 - fx) + at(i1, j1, k0) * fx;
    const c10 = at(i0, j0, k1) * (1 - fx) + at(i1, j0, k1) * fx;
    const c11 = at(i0, j1, k1) * (1 - fx) + at(i1, j1, k1) * fx;
    return (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
  };
  if (cShape === 'mesh' && !opts.containerSdf) throw new Error('containerShape=mesh 需要 containerSdf（computeMeshSDF 的 sdf）——fail-closed');

  /** 行级容器内区间（格坐标 [0,n)）：TPMS 固相区间将与之求交 */
  const containerRowIntervals = (yw: number, zw: number): [number, number][] | null => {
    if (cShape === 'cube') return null; // null = 无裁剪（全行）
    const gOf = (wc: number) => ((wc + Math.PI) / span) * n; // wc → 格坐标
    if (cShape === 'cylinder') {
      const yph = yw / Math.PI, zph = zw / Math.PI; // phys 域
      if (Math.abs(zph) >= 1 || Math.abs(yph) >= 1) return []; // 层/行在容器外
      const halfWc = Math.PI * Math.sqrt(1 - yph * yph); // x ∈ ±π·√(1−y_ph²)（解析一阶精确）
      const s = gOf(-halfWc), e = gOf(halfWc);
      const iv: [number, number][] = [];
      if (e > s) iv.push([s, e]);
      return iv;
    }
    // mesh：沿 x 采样 sdf 线性求根（与 TPMS 行区间同型；多区间支持凹容器）
    const vals: number[] = [];
    for (let a = 0; a <= n; a++) vals.push(sdfSampler(-Math.PI + (a / n) * span, yw, zw));
    const iv: [number, number][] = [];
    let start = vals[0] < 0 ? 0 : -1;
    for (let a = 1; a <= n; a++) {
      const pIn = vals[a - 1] < 0, cIn = vals[a] < 0;
      if (cIn && !pIn) start = a - 1 + vals[a - 1] / (vals[a - 1] - vals[a]);
      else if (!cIn && pIn && start >= 0) { iv.push([start, a - 1 + (0 - vals[a - 1]) / (vals[a] - vals[a - 1])]); start = -1; }
    }
    if (start >= 0) iv.push([start, n]);
    return iv;
  };

  const layers: SliceLayer[] = [];
  let totalIntervals = 0;

  for (let k = 0; k < layerCount; k++) {
    const zw = -Math.PI + (k + 0.5) * layerH;
    const rows: { y: number; iv: [number, number][] }[] = [];
    let layerAreaMm2 = 0;

    for (let j = 0; j < n; j++) {
      const yw = -Math.PI + (j + 0.5) * dGrid; // 行中心
      // 沿 x 的周期节点环（n+1 节点；第 n 个是第 0 个的周期副本，场值相同——独立采样等价）
      const vals: number[] = [];
      for (let a = 0; a <= n; a++) vals.push(sample(-Math.PI + (a / n) * span, yw, zw));
      // 符号区间提取（inside = V < iso；周期衔接：行首 inside ⇒ 区间从 0 起步，行尾未闭合则到副本 n）
      let iv: [number, number][] = [];
      let start = vals[0] < iso ? 0 : -1;
      const vA = (a: number) => vals[a]; // a ∈ [0,n]
      for (let a = 1; a <= n; a++) {
        const prevIn = vA(a - 1) < iso;
        const curIn = vA(a) < iso;
        if (curIn && !prevIn) {
          const t = (vA(a - 1) - iso) / (vA(a - 1) - vA(a)); // ∈(0,1)，从 ≥iso 跨入 <iso
          start = a - 1 + t;
        } else if (!curIn && prevIn && start >= 0) {
          const t = (iso - vA(a - 1)) / (vA(a) - vA(a - 1));
          iv.push([start, a - 1 + t]);
          start = -1;
        }
      }
      if (start >= 0) iv.push([start, n]); // 行尾仍 inside（含全行固相/跨周期）
      // 容器裁剪（v2）：TPMS 固相区间 ∩ 容器内区间（1D 布尔交；容器外整行 ⇒ 空）
      const cIv = containerRowIntervals(yw, zw);
      if (cIv !== null) iv = intersectIntervals(iv, cIv);
      let rowLenGrid = 0;
      for (const [s0, e0] of iv) rowLenGrid += e0 - s0;
      layerAreaMm2 += rowLenGrid * dGrid * dGrid * scale * scale;
      totalIntervals += iv.length;
      if (iv.length) rows.push({ y: j, iv });
    }
    layers.push({ z: zw * scale, nRows: n, rows, netArea: layerAreaMm2 });
  }

  const layerHeightMm = layerH * scale;
  return {
    layers,
    layerHeightMm,
    volumeMm3: layers.reduce((s, l) => s + l.netArea, 0) * layerHeightMm,
    totalIntervals,
  };
}

/** 层矢量 SVG：逐行填充带（rect 语义 path）+ 扫描路径线（增材填充语义） */
export function buildSliceSvg(res: DirectSliceResult, specimenSizeMm: number): string {
  const m = 1; // margin mm
  const vb = `${-m} ${-m} ${specimenSizeMm + 2 * m} ${specimenSizeMm + 2 * m}`;
  const half = specimenSizeMm / 2;
  const groups = res.layers.map((l, i) => {
    const rowH = specimenSizeMm / l.nRows;
    const fills: string[] = [];
    const scans: string[] = [];
    for (const { y, iv } of l.rows) {
      const yTop = -half + y * rowH;
      for (const [s0, e0] of iv) {
        const x1 = -half + (s0 / l.nRows) * specimenSizeMm;
        const x2 = -half + (e0 / l.nRows) * specimenSizeMm;
        fills.push(`M ${x1.toFixed(4)} ${yTop.toFixed(4)} H ${x2.toFixed(4)} V ${(yTop + rowH).toFixed(4)} H ${x1.toFixed(4)} Z`);
        scans.push(`M ${x1.toFixed(4)} ${(yTop + rowH / 2).toFixed(4)} H ${x2.toFixed(4)}`);
      }
    }
    return `  <g id="layer-${i}" data-z="${l.z.toFixed(4)}" data-net-area="${l.netArea.toFixed(4)}">\n    <path d="${fills.join(' ')}" fill="#cbd5e1" stroke="none"/>\n    <path d="${scans.join(' ')}" fill="none" stroke="#1e293b" stroke-width="${Math.min(0.06, rowH / 8).toFixed(3)}"/>\n  </g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${specimenSizeMm + 2 * m}mm" height="${specimenSizeMm + 2 * m}mm">\n<metadata>{"layers":${res.layers.length},"layerHeightMm":${res.layerHeightMm.toFixed(6)},"volumeMm3":${res.volumeMm3.toFixed(6)},"totalIntervals":${res.totalIntervals}}</metadata>\n${groups}\n</svg>\n`;
}
