/**
 * printability-audit.ts —— 增材制造可打印性审计（悬垂角 + 最优摆盘寻优）
 *
 * 口径（方向语义防歧义钉死）：
 *   - 面外向单位法向 N（发散定理定向：vol6<0 整体翻转，与 mesh-container 同款）；
 *   - 构建方向 b（打印堆积方向，默认 [0,0,1]）；
 *   - 朝下面 ⟺ N·b < 0；
 *   - 悬垂角 α = arccos(−N·b)（仅朝下面）：α=0° 完全水平朝下（最危险），
 *     α=90° 竖直墙（自支撑安全）——α 即「表面与水平面的夹角」工业口径；
 *   - critical ⟺ α < criticalDeg（默认 45°，无支撑 FDM/SLM 常用工程阈值），
 *     等价判定 N·b < −cos(criticalDeg)。
 *
 * 面积加权统计口径：criticalArea / totalArea（全表面面积比）。
 * 摆盘寻优：Fibonacci 螺旋确定性球面采样（无 RNG），最小化 critical 面积比。
 *
 * 诚实边界：
 *   - 45° 临界角为常用无支撑工程阈值，实际因材料/工艺/路径策略而异（30°~60° 均有报道），
 *     --critical 可调；
 *   - 面积比≠支撑材料体积（后者需切片器级支撑生成模拟）；
 *   - 寻优仅最小化临界面积比（表面质量/支撑痕位置/构建时间等多目标未纳入）；
 *     上机前建议与切片器（如 Bambu Studio）支撑预览交叉复核。
 */

export interface OverhangReport {
  tris: number;
  skippedDegenerate: number;
  totalArea: number;
  downFacingArea: number;
  criticalArea: number;
  /** criticalArea / totalArea（面积加权，全表面口径） */
  criticalAreaRatio: number;
  /** 朝下面 α 直方图：9 桶 × 10°（[0,10)…[80,90]），面积加权 */
  alphaHistogram: number[];
  buildDir: [number, number, number];
  criticalDeg: number;
}

export interface OrientationSearchResult {
  bestDir: [number, number, number];
  bestCriticalRatio: number;
  samples: number;
}

interface FaceAcc {
  /** 每面 4 元组：外向单位法向 nx,ny,nz + 面积（退化面不入表） */
  fn: Float64Array;
  count: number;
  skipped: number;
  totalArea: number;
}

function accumulateFaces(positions: Float32Array, indices: Uint32Array): FaceAcc {
  const nTri = indices.length / 3;
  // 第一遍：全量发散体积定符号（凹区域逐面贡献可负，累积中途过零——
  // 逐面读累积值会让个别面定向符号错，必须先收敛终值再逐面定向）
  let vol6 = 0;
  for (let t = 0; t < nTri; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  if (vol6 === 0) {
    throw new Error('网格发散体积为零——开放/退化网格无法定向（悬垂审计要求封闭流形外向法向，fail-closed 拒绝）');
  }
  const s = vol6 < 0 ? -1 : 1; // 定向自愈：整体翻转语义（与 mesh-container 同款，不改输入）
  const fn = new Float64Array(Math.floor(nTri) * 4);
  let w = 0, skipped = 0, totalArea = 0;
  for (let t = 0; t < nTri; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const ux = positions[i1] - ax, uy = positions[i1 + 1] - ay, uz = positions[i1 + 2] - az;
    const vx = positions[i2] - ax, vy = positions[i2 + 1] - ay, vz = positions[i2 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-14) { skipped++; continue; } // 退化三角（零面积）不入统计
    const area = cl / 2;
    fn[w * 4] = (s * cx) / cl; fn[w * 4 + 1] = (s * cy) / cl; fn[w * 4 + 2] = (s * cz) / cl;
    fn[w * 4 + 3] = area;
    totalArea += area;
    w++;
  }
  return { fn, count: w, skipped, totalArea };
}

function criticalRatioOf(acc: FaceAcc, b: readonly number[], cosCrit: number): { ratio: number; criticalArea: number; downArea: number } {
  let crit = 0, down = 0;
  for (let i = 0; i < acc.count; i++) {
    const dot = acc.fn[i * 4] * b[0] + acc.fn[i * 4 + 1] * b[1] + acc.fn[i * 4 + 2] * b[2];
    const area = acc.fn[i * 4 + 3];
    if (dot < 0) down += area;
    if (dot < -cosCrit) crit += area; // α=arccos(−N·b) < criticalDeg ⟺ N·b < −cos(criticalDeg)
  }
  return { ratio: acc.totalArea > 0 ? crit / acc.totalArea : NaN, criticalArea: crit, downArea: down };
}

function normalizeDir(b: readonly number[]): [number, number, number] {
  const l = Math.hypot(b[0], b[1], b[2]);
  if (!Number.isFinite(l) || l < 1e-12) throw new Error('构建方向为零向量或非有限值');
  return [b[0] / l, b[1] / l, b[2] / l];
}

/** 悬垂审计：已定向（或可定向）封闭网格 + 构建方向 → 面积加权悬垂报告 */
export function auditOverhang(
  positions: Float32Array, indices: Uint32Array,
  buildDir: readonly number[], criticalDeg = 45,
): OverhangReport {
  if (!(criticalDeg > 0 && criticalDeg < 90)) throw new Error(`criticalDeg 须 0° < θ < 90°（收到 ${criticalDeg}）`);
  const bd = normalizeDir(buildDir);
  const cosCrit = Math.cos((criticalDeg * Math.PI) / 180);
  const acc = accumulateFaces(positions, indices);
  const hist = new Array(9).fill(0);
  for (let i = 0; i < acc.count; i++) {
    const dot = acc.fn[i * 4] * bd[0] + acc.fn[i * 4 + 1] * bd[1] + acc.fn[i * 4 + 2] * bd[2];
    if (dot >= 0) continue; // 直方图仅统计朝下面
    const alpha = (Math.acos(Math.min(1, Math.max(0, -dot))) * 180) / Math.PI; // [0°,90°]
    hist[Math.min(8, Math.floor(alpha / 10))] += acc.fn[i * 4 + 3];
  }
  const { ratio, criticalArea, downArea } = criticalRatioOf(acc, bd, cosCrit);
  return {
    tris: acc.count, skippedDegenerate: acc.skipped, totalArea: acc.totalArea,
    downFacingArea: downArea, criticalArea, criticalAreaRatio: ratio,
    alphaHistogram: hist, buildDir: bd, criticalDeg,
  };
}

/** 最优摆盘寻优：Fibonacci 螺旋确定性球面采样（无 RNG，同输入逐位一致） */
export function searchBuildOrientation(
  positions: Float32Array, indices: Uint32Array, criticalDeg = 45, samples = 512,
): OrientationSearchResult {
  if (!Number.isInteger(samples) || samples < 32 || samples > 8192) {
    throw new Error(`samples 须 32~8192 整数（收到 ${samples}）`);
  }
  const cosCrit = Math.cos((criticalDeg * Math.PI) / 180);
  const acc = accumulateFaces(positions, indices);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let best: [number, number, number] = [0, 0, 1];
  let bestRatio = Infinity;
  for (let k = 0; k < samples; k++) {
    const z = 1 - (2 * (k + 0.5)) / samples;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = k * golden;
    const b: [number, number, number] = [r * Math.cos(phi), r * Math.sin(phi), z];
    const { ratio } = criticalRatioOf(acc, b, cosCrit);
    if (ratio < bestRatio) { bestRatio = ratio; best = b; } // 严格 <：并列取先到者，确定性
  }
  return { bestDir: best, bestCriticalRatio: bestRatio, samples };
}
