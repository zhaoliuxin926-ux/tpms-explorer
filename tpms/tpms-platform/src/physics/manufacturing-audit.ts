/**
 * manufacturing-audit.ts —— 增材制造几何检查（体素级：最小壁厚 / 孔喉 / 封闭孔腔 / 连通性）
 *
 * 2026-10-24 实用性审查「补齐制造检查」首档：在既有悬垂分析（printability-audit，网格级）
 * 之外补几何级制造性指标。工艺阈值（最小壁厚等）因设备/材料而异——本模块只给几何量与
 * 可配置阈值比较，阈值默认值标注出处，不冒充工艺结论。
 *
 * 口径（防歧义钉死）：
 *   - 输入为体素模型 {R, solid, inside}（与 buildVoxelModel 同语义：solid=1 固相，
 *     孔隙 = inside && !solid；cube 容器 inside 全 1）；
 *   - 壁厚双口径：
 *     · medial（旋转不变）：固相内到孔隙的欧氏距离变换（EDT，chamfer 3-4-5 近似，
 *       误差 ≤~4% 内）取 26 邻域局部极大点（离散中面采样，D≥2h 去表面单层噪声），
 *       壁厚 = 2×min(局部极大 D)——「最薄壁的最大内切球直径」；
 *     · axial（轴向扫描线）：x/y/z 三向固相连续段长度×h 的最小值——斜壁偏厚
 *       （上界语义，作交叉参考；斜壁的真实厚度以 medial 口径为准）；
 *   - 孔喉：同双口径但作用于**主连通孔隙域**（接触体素域边界的最大孔隙连通域，
 *     6 连通 BFS）——封闭腔不参与（无喉语义）；
 *   - 封闭孔腔：非主域且不触边界的孔隙域体积占比（6 连通）；触边界的小域
 *     （如表面凹陷）计入开放域分母口径见 mainPoreFraction；
 *   - 连通性：mainPoreFraction = 主域体素 / 孔隙总体素（<1 即存在未连通孔隙）。
 *
 * 诚实边界：体素分辨率 R 决定精度——壁厚/孔喉的量化误差量级为 h（体素尺寸）；
 * medial 口径另含 chamfer EDT 的度规误差（3-4-5 权重对真实欧氏距离 ≤~4% 高估）。
 * 封闭腔检测受限于体素连通性语义（6 连通比 26 连通更保守，细缝连通可能被判封闭）。
 */

export interface VoxelLike {
  R: number;
  solid: Uint8Array;
  inside: Uint8Array;
}

export interface ManufacturingReport {
  R: number;
  voxelSizeMm: number;
  /** 最小壁厚（mm）：medial=旋转不变中面口径；axial=[x,y,z] 扫描线口径（上界语义）+最小值 */
  minWallMm: { medial: number; axial: [number, number, number]; axialMin: number };
  /** 主域最小孔喉（mm）：medial 与轴向口径 */
  minThroatMm: { medial: number; axialMin: number };
  /** 封闭孔腔（不触域边界的孔隙连通域） */
  closedDomains: number;
  closedPoreVoxels: number;
  /** 封闭孔腔体积 / 孔隙总体积 */
  closedPoreFraction: number;
  /** 主连通域体积 / 孔隙总体积（<1 存在未连通/封闭孔隙） */
  mainPoreFraction: number;
  /** 阈值比较（工艺阈值由调用方给；缺省不比对） */
  warnings: string[];
  note: string;
}

export interface ManufacturingOptions {
  /** 工艺最小壁厚阈值（mm），如 FDM 0.4 喷嘴常见工程下限 0.4；给出即比对 */
  minWallMm?: number;
}

const INF = 0x3fffffff;

/** chamfer 3-4-5 距离变换（两遍扫描；权重 ÷3 归一后 d1=1,d2=√2,d3=√3 近似）。
 *  target=1 的相内距离为 0，其余点到最近 target 体素的距离（单位=体素边长×(1/3)）。 */
function chamferEDT(R: number, mask: Uint8Array, target: 0 | 1): Int32Array {
  const N = R * R * R;
  const d = new Int32Array(N);
  for (let i = 0; i < N; i++) d[i] = mask[i] === target ? 0 : INF;
  const at = (x: number, y: number, z: number) => x + y * R + z * R * R;
  // 前向（x,y,z 递增）+ 后向（递减）两遍；邻域半盒（3×3×3 的因果半部）保证两遍覆盖 26 邻域
  const relax = (x: number, y: number, z: number, forward: boolean) => {
    const i = at(x, y, z);
    if (d[i] === 0) return;
    let best = d[i];
    for (let dz = -1; dz <= 1; dz++) {
      const zz = forward ? z + dz : z - dz;
      if (zz < 0 || zz >= R) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = forward ? y + dy : y - dy;
        if (yy < 0 || yy >= R) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const xx = forward ? x + dx : x - dx;
          if (xx < 0 || xx >= R) continue;
          // chamfer 3-4-5：面邻（1 轴）=3、棱邻（2 轴）=4、角邻（3 轴）=5（÷3 归一为 1/√2/√3）
          const axes = (dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) + (dz !== 0 ? 1 : 0);
          const w = axes === 1 ? 3 : axes === 2 ? 4 : 5;
          const v = d[at(xx, yy, zz)] + w;
          if (v < best) best = v;
        }
      }
    }
    d[i] = best;
  };
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) relax(x, y, z, true);
  for (let z = R - 1; z >= 0; z--) for (let y = R - 1; y >= 0; y--) for (let x = R - 1; x >= 0; x--) relax(x, y, z, false);
  return d;
}

/** 离散中面采样：26 邻域局部极大（并列取一）且 D ≥ 2h 的点 → 半厚度集合（mm） */
function medialMinThickness(d: Int32Array, R: number, hMm: number, phaseMask: Uint8Array, phase: 0 | 1): number {
  const at = (x: number, y: number, z: number) => x + y * R + z * R * R;
  let minT = Infinity;
  for (let z = 0; z < R; z++) {
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        const i = at(x, y, z);
        if (phaseMask[i] !== phase) continue;
        const di = d[i];
        // 2×(1/3) 体素 = 2h 的整数栅格（chamfer 权重 3 = 1 体素）——距表面至少 2 体素才算中面采样点
        if (di * hMm / 3 < 2 * hMm) continue;
        let isMax = true;
        for (let dz = -1; dz <= 1 && isMax; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= R) continue;
          for (let dy = -1; dy <= 1 && isMax; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= R) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= R) continue;
              const j = at(xx, yy, zz);
              if (phaseMask[j] === phase && d[j] > di) { isMax = false; break; }
            }
          }
        }
        if (isMax) {
          const t = 2 * (di * hMm / 3);
          if (t < minT) minT = t;
        }
      }
    }
  }
  return minT === Infinity ? NaN : minT;
}

/** 轴向扫描线：三向最小连续段（mm），限定 phase 体素 */
function axialMinRuns(R: number, mask: Uint8Array, phase: 0 | 1, hMm: number): [number, number, number] {
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const at = (x: number, y: number, z: number) => x + y * R + z * R * R;
  // x 向
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) {
    let run = 0;
    for (let x = 0; x < R; x++) {
      if (mask[at(x, y, z)] === phase) run++;
      else { if (run > 0 && run < mins[0]) mins[0] = run; run = 0; }
    }
    if (run > 0 && run < mins[0]) mins[0] = run;
  }
  // y 向
  for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) {
    let run = 0;
    for (let y = 0; y < R; y++) {
      if (mask[at(x, y, z)] === phase) run++;
      else { if (run > 0 && run < mins[1]) mins[1] = run; run = 0; }
    }
    if (run > 0 && run < mins[1]) mins[1] = run;
  }
  // z 向
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    let run = 0;
    for (let z = 0; z < R; z++) {
      if (mask[at(x, y, z)] === phase) run++;
      else { if (run > 0 && run < mins[2]) mins[2] = run; run = 0; }
    }
    if (run > 0 && run < mins[2]) mins[2] = run;
  }
  return mins.map((v) => (v === Infinity ? NaN : v * hMm)) as [number, number, number];
}

/** 孔隙连通域标记（6 连通 BFS）+ 域触界/大小分类。返回 {labels, domains: [{voxels, open, id}]} */
function poreDomains(R: number, pore: Uint8Array): { labels: Int32Array; domains: Array<{ id: number; voxels: number; open: boolean }> } {
  const N = R * R * R;
  const labels = new Int32Array(N); // 0=非孔隙，1..=域 id
  const domains: Array<{ id: number; voxels: number; open: boolean }> = [];
  const stack = new Int32Array(N);
  const at = (x: number, y: number, z: number) => x + y * R + z * R * R;
  for (let seed = 0; seed < N; seed++) {
    if (!pore[seed] || labels[seed]) continue;
    const id = domains.length + 1;
    let voxels = 0;
    let open = false;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = id;
    while (sp > 0) {
      const i = stack[--sp];
      voxels++;
      const z = Math.floor(i / (R * R));
      const y = Math.floor((i % (R * R)) / R);
      const x = i % R;
      if (x === 0 || x === R - 1 || y === 0 || y === R - 1 || z === 0 || z === R - 1) open = true;
      if (x > 0 && pore[i - 1] && !labels[i - 1]) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x < R - 1 && pore[i + 1] && !labels[i + 1]) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && pore[i - R] && !labels[i - R]) { labels[i - R] = id; stack[sp++] = i - R; }
      if (y < R - 1 && pore[i + R] && !labels[i + R]) { labels[i + R] = id; stack[sp++] = i + R; }
      if (z > 0 && pore[i - R * R] && !labels[i - R * R]) { labels[i - R * R] = id; stack[sp++] = i - R * R; }
      if (z < R - 1 && pore[i + R * R] && !labels[i + R * R]) { labels[i + R * R] = id; stack[sp++] = i + R * R; }
    }
    void at;
    domains.push({ id, voxels, open });
  }
  return { labels, domains };
}

/** 体素制造检查主入口 */
export function auditManufacturing(vox: VoxelLike, voxelSizeMm: number, opts: ManufacturingOptions = {}): ManufacturingReport {
  const { R, solid, inside } = vox;
  const N = R * R * R;
  const h = voxelSizeMm;

  // 固相 EDT → 壁厚（medial + axial 双口径）
  const solidD = chamferEDT(R, solid, 0);   // 到孔隙（solid=0 的相）距离
  const wallMedial = medialMinThickness(solidD, R, h, solid, 1);
  const wallAxial = axialMinRuns(R, solid, 1, h);

  // 孔隙掩码与连通域
  const pore = new Uint8Array(N);
  let poreTotal = 0;
  for (let i = 0; i < N; i++) {
    if (inside[i] && !solid[i]) { pore[i] = 1; poreTotal++; }
  }
  const { labels, domains } = poreDomains(R, pore);
  const openDomains = domains.filter((dm) => dm.open);
  const mainDom = openDomains.length ? openDomains.reduce((a, b) => (b.voxels > a.voxels ? b : a)) : null;
  const closedDomains = domains.filter((dm) => !dm.open);
  const closedVoxels = closedDomains.reduce((a, b) => a + b.voxels, 0);

  // 主域掩码 → 孔喉（medial + axial）
  let throatMedial = NaN;
  let throatAxialMin = NaN;
  if (mainDom) {
    const mainMask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mainMask[i] = labels[i] === mainDom.id ? 1 : 0;
    const poreD = chamferEDT(R, mainMask, 0);  // 到固相+到非主域 的距离——喉径只对主域内部有意义
    throatMedial = medialMinThickness(poreD, R, h, mainMask, 1);
    throatAxialMin = Math.min(...axialMinRuns(R, mainMask, 1, h).filter(Number.isFinite));
  }

  const warnings: string[] = [];
  const closedPoreFrac = poreTotal > 0 ? closedVoxels / poreTotal : 0;
  // 阈值比对：优先 medial（旋转不变）；壁薄于 2h 滤噪线时无 medial 采样点——用 axial 兜底
  //（axial 为上界口径：上界 < 阈值 ⟹ 真实法向厚度 < 阈值，无假阳性；不漏报薄壁）
  const axialMinFinite = wallAxial.filter(Number.isFinite);
  const wallForWarn = Number.isFinite(wallMedial) ? wallMedial : (axialMinFinite.length ? Math.min(...axialMinFinite) : NaN);
  if (opts.minWallMm !== undefined && Number.isFinite(wallForWarn) && wallForWarn < opts.minWallMm) {
    warnings.push(`最小壁厚 ${wallForWarn.toFixed(3)} mm < 工艺阈值 ${opts.minWallMm} mm（${Number.isFinite(wallMedial) ? 'medial 口径，旋转不变' : 'axial 口径兜底——壁薄于 2 体素，medial 无采样点'}）`);
  }
  if (closedPoreFrac > 0.001) {
    warnings.push(`封闭孔腔占比 ${(closedPoreFrac * 100).toFixed(2)}%（${closedDomains.length} 个域）——粉末/树脂无法排出，LPBF/SLM 工艺需注意`);
  }

  return {
    R, voxelSizeMm: h,
    minWallMm: { medial: wallMedial, axial: wallAxial, axialMin: Math.min(...wallAxial.filter(Number.isFinite)) },
    minThroatMm: { medial: throatMedial, axialMin: throatAxialMin },
    closedDomains: closedDomains.length,
    closedPoreVoxels: closedVoxels,
    closedPoreFraction: closedPoreFrac,
    mainPoreFraction: poreTotal > 0 && mainDom ? mainDom.voxels / poreTotal : (poreTotal > 0 ? 0 : 1),
    warnings,
    note: '体素口径（6 连通孔隙域）；壁厚/孔喉量化误差量级=h，medial 含 chamfer EDT ≤~4% 度规高估；axial 口径斜壁偏厚（上界语义）；工艺阈值因设备/材料而异（FDM 0.4 喷嘴常见壁厚工程下限 0.4mm 仅为缺省参考）',
  };
}
