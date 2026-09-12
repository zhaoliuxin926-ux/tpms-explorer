/**
 * experimental-fit.ts —— v9.0 方向三：万能试验机压缩曲线 ISO 13314:2011 标定与参数反演
 *
 * 定位：纯数学模块（无 DOM/无 IO 依赖）。输入万能试验机导出的 CSV/TSV 文本
 * （位移-载荷 或 应变-应力），输出 ISO 13314 特征量（准弹性模量 / Rp0.2 / 平台应力 /
 * 密实化应变 / 比吸能）与数字孪生 / Gibson-Ashby 预测的双向标定比。
 *
 * 算法（v9.0 立项规格）：
 *   1. 健壮解析：注释行/空行跳过、分隔符频次自适应（, \t ;）、表头识别、非有限值过滤、
 *      乱序排序、重复横坐标均值折叠；
 *   2. Toe Region 虚拟原点补偿：首峰前窗口线性回归取最大斜率段为准弹性切线，
 *      截距回推虚拟原点，舍弃预载非线性段并在 (0,0) 锚定；
 *   3. ISO 13314 特征：准弹性梯度 E*、Rp0.2 平行线交点、第一峰值、平台应力
 *      （[0.20,0.40] 梯形均值）、吸能效率 η=W/σ 极值点定密实化应变 εd、Wv=∫₀^εd σ dε。
 */

export interface RawCurveInput {
  text: string;
  columnX?: string | number;
  columnY?: string | number;
  inputType?: 'strain-stress' | 'displacement-force';
  specimenDimensions?: {
    lengthMm: number;
    widthMm: number;
    thicknessMm: number;
  };
}

export interface Iso13314Metrics {
  elasticModulusE: number;
  proofStressRp02: number;
  firstPeakStress: number;
  firstPeakStrain: number;
  plateauStress: number;
  densificationStrain: number;
  energyAbsorptionW: number;
  maxEfficiencyEta: number;
  virtualOriginStrain: number;
}

export interface CalibrationResult {
  metrics: Iso13314Metrics;
  cleanedCurve: { strain: Float64Array; stress: Float64Array };
  scaling: {
    dtVsExpRatio?: number;
    gaVsExpRatio?: number;
  };
}

const SEP_CANDIDATES = [',', '\t', ';'];

/** 频次法检测分隔符（注释行与空行不计） */
export function detectSeparator(text: string): string {
  let best = ',', bestN = -1;
  for (const sep of SEP_CANDIDATES) {
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || s.startsWith('//')) continue;
      let c = 0;
      for (const ch of s) if (ch === sep) c++;
      n += c;
    }
    if (n > bestN) { best = sep; bestN = n; }
  }
  return best;
}

/** CSV/TSV → 单调递增应变序列（含单位换算、清洗、排序、重复折叠） */
export function parseCurve(input: RawCurveInput): { strain: Float64Array; stress: Float64Array } {
  const sep = detectSeparator(input.text);
  const type = input.inputType ?? 'strain-stress';
  const lines = input.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  // 表头识别：首个含非数值 token 的行视为表头，建立列名→索引映射
  let header: string[] | null = null;
  let start = 0;
  const firstCells = lines[0].split(sep).map((c) => c.trim());
  if (firstCells.some((c) => c === '' || !Number.isFinite(Number(c)))) {
    header = firstCells;
    start = 1;
  }
  const colIndex = (spec: string | number | undefined, fallback: number): number => {
    if (spec === undefined) return fallback;
    if (typeof spec === 'number') return spec;
    if (!header) throw new Error(`列名 "${spec}" 指定了但输入无表头行`);
    const i = header.indexOf(spec);
    if (i < 0) throw new Error(`表头中不存在列 "${spec}"（表头: ${header.join(',')}）`);
    return i;
  };
  const ix = colIndex(input.columnX, 0);
  const iy = colIndex(input.columnY, 1);

  // 数值行收集（空 cell / 非有限值丢弃——防 `,,` 尾随逗号被 Number('')=0 误收为数据点）
  const raw: Array<[number, number]> = [];
  for (let i = start; i < lines.length; i++) {
    const cells = lines[i].split(sep).map((c) => c.trim());
    if (cells.length <= Math.max(ix, iy)) continue;
    if (cells[ix] === '' || cells[iy] === '') continue;
    const x = Number(cells[ix]);
    const y = Number(cells[iy]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    raw.push([x, y]);
  }
  if (raw.length < 10) throw new Error(`有效数据点不足（${raw.length} < 10）`);

  // 位移-载荷 → 应变-应力（工程口径）
  let pts = raw;
  if (type === 'displacement-force') {
    const d = input.specimenDimensions;
    if (!d || !(d.lengthMm > 0) || !(d.widthMm > 0) || !(d.thicknessMm > 0)) {
      throw new Error('displacement-force 输入须提供 specimenDimensions（lengthMm/widthMm/thicknessMm）');
    }
    const a0 = d.widthMm * d.thicknessMm;
    pts = raw.map(([dl, f]) => [dl / d.lengthMm, f / a0]);
  }

  // 排序 + 重复横坐标均值折叠
  pts = pts.slice().sort((p, q) => p[0] - q[0]);
  const xs: number[] = [];
  const ys: number[] = [];
  let runStart = 0;
  while (runStart < pts.length) {
    let runEnd = runStart + 1;
    let sum = pts[runStart][1];
    while (runEnd < pts.length && pts[runEnd][0] === pts[runStart][0]) { sum += pts[runEnd][1]; runEnd++; }
    xs.push(pts[runStart][0]);
    ys.push(sum / (runEnd - runStart));
    runStart = runEnd;
  }
  const toF64 = (a: number[]) => Float64Array.from(a);
  return { strain: toF64(xs), stress: toF64(ys) };
}

export interface ToeCompensation {
  strain: Float64Array;
  stress: Float64Array;
  originStrain: number;
  elasticModulus: number;
}

/**
 * Toe Region 虚拟原点补偿：在首峰之前以窗口 Δε 做线性回归，取最大斜率窗口为弹性切线；
 * 虚拟原点 ε0 = ε_mid − σ_mid/E；平移后舍弃 ε'<0 并在 (0,0) 锚定。
 */
export function compensateToe(strain: Float64Array, stress: Float64Array, windowStrain = 0.015): ToeCompensation {
  if (strain.length < 8) throw new Error('补偿要求 ≥8 个数据点');
  // 首峰（平滑 5 点滑动均值上的首个局部极大）——限制弹性切线搜索域在其之前
  const sm = new Float64Array(strain.length);
  for (let i = 0; i < strain.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(strain.length - 1, i + 2); j++) { s += stress[j]; n++; }
    sm[i] = s / n;
  }
  let peakIdx = strain.length - 1;
  for (let i = 2; i < strain.length - 2; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] > sm[0]) { peakIdx = i; break; }
  }

  // 全窗口斜率预算 + 高斜率带并集回代（消 max-slope 搜索的噪声正偏/winner's curse）：
  // 与最优窗口斜率差 ≤5% 的连续窗口族 ≈ 弹性段核心（低斜率的 toe 过渡/屈服段窗口被带外
  // 排除），对并集全域回归——统计量用满弹性区，偏差趋零。
  const wPts = Math.max(5, Math.round(windowStrain / Math.max(1e-12, strain[1] - strain[0])));
  const nWin = Math.max(0, peakIdx + 1 - wPts);
  const slopes = new Float64Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let sx = 0, sy = 0;
    for (let k = i; k < i + wPts; k++) { sx += strain[k]; sy += stress[k]; }
    const mx = sx / wPts, my = sy / wPts;
    let num = 0, den = 0;
    for (let k = i; k < i + wPts; k++) { const dx = strain[k] - mx; num += dx * (stress[k] - my); den += dx * dx; }
    slopes[i] = den > 0 ? num / den : 0;
  }
  let bestSlope = -Infinity, bestI = -1;
  for (let i = 0; i < nWin; i++) if (slopes[i] > bestSlope) { bestSlope = slopes[i]; bestI = i; }
  if (bestI < 0 || !(bestSlope > 0)) throw new Error('Toe 补偿失败：未找到正斜率弹性段');
  let lo = bestI, hiI = bestI;
  while (lo > 0 && slopes[lo - 1] >= bestSlope * 0.95) lo--;
  while (hiI + 1 < nWin && slopes[hiI + 1] >= bestSlope * 0.95) hiI++;
  const rStart = lo, rEnd = hiI + wPts - 1;
  let rs = 0, sys = 0, rn = 0;
  for (let k = rStart; k <= rEnd; k++) { rs += strain[k]; sys += stress[k]; rn++; }
  let eFit = bestSlope;
  if (rn >= 5) {
    const mx = rs / rn, my = sys / rn;
    let num = 0, den = 0;
    for (let k = rStart; k <= rEnd; k++) { const dx = strain[k] - mx; num += dx * (stress[k] - my); den += dx * dx; }
    if (den > 0 && num / den > 0) eFit = num / den;
  }
  const e = eFit;
  // 虚拟原点 = 带内回归直线的零应力截距（全带统计；单点 σ_mid/E 会把 0.5 MPa 噪声全传给原点）
  const origin = rs / rn - sys / rn / e;

  const xs: number[] = [0];
  const ys: number[] = [0];
  for (let i = 0; i < strain.length; i++) {
    const e2 = strain[i] - origin;
    if (e2 > 0) { xs.push(e2); ys.push(stress[i]); }
  }
  return { strain: Float64Array.from(xs), stress: Float64Array.from(ys), originStrain: origin, elasticModulus: e };
}

/** Rp0.2：平行偏移线 σ=E·(ε−0.002) 与曲线的第一个交点（弹性段曲线在偏移线上方，屈服后穿到下方：+→−）。
 *  输入用平滑应力（噪声毛刺不产生伪交点）。 */
function proofStress(strain: Float64Array, sm: Float64Array, e: number): number {
  for (let i = 1; i < strain.length; i++) {
    const f0 = sm[i - 1] - e * (strain[i - 1] - 0.002);
    const f1 = sm[i] - e * (strain[i] - 0.002);
    if (f0 >= 0 && f1 < 0) {
      const t = f0 / (f0 - f1);
      return sm[i - 1] + t * (sm[i] - sm[i - 1]);
    }
  }
  return NaN;
}

/** 梯形积分 ∫[a,b] σ dε（越界线性插值） */
function trapz(strain: Float64Array, stress: Float64Array, a: number, b: number): number {
  const interp = (x: number): number => {
    if (x <= strain[0]) return stress[0];
    if (x >= strain[strain.length - 1]) return stress[strain.length - 1];
    let lo = 0, hi = strain.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (strain[m] <= x) lo = m; else hi = m; }
    const t = (x - strain[lo]) / (strain[hi] - strain[lo]);
    return stress[lo] + t * (stress[hi] - stress[lo]);
  };
  let sum = 0;
  const n = 400;
  const h = (b - a) / n;
  for (let i = 0; i < n; i++) sum += (interp(a + i * h) + interp(a + (i + 1) * h)) / 2 * h;
  return sum;
}

/** ISO 13314:2011 特征抽取（输入须已经 Toe 补偿） */
export function extractIso13314(strain: Float64Array, stress: Float64Array, elasticModulus: number): Iso13314Metrics {
  const e = elasticModulus;
  // 5 点滑动均值（Rp0.2 与峰值检测在平滑曲线上进行——噪声鲁棒；平台/积分用原值保面积）
  const sm = new Float64Array(stress.length);
  for (let i = 0; i < stress.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(stress.length - 1, i + 2); j++) { s += stress[j]; n++; }
    sm[i] = s / n;
  }
  const rp = proofStress(strain, sm, e);
  if (!Number.isFinite(rp)) throw new Error('Rp0.2 未找到交点（曲线未过 0.2% 偏移线）');

  // 第一峰值：Rp0.2 交点之后、平台区（ε<0.2）内的平滑曲线 argmax
  let rpIdx = 0;
  for (let i = 0; i < strain.length; i++) { if (strain[i] > 0.002) { rpIdx = i; break; } }
  let peakIdx = -1, peakSm = -Infinity;
  for (let i = rpIdx; i < strain.length; i++) {
    if (strain[i] >= 0.2) break;
    if (sm[i] > peakSm) { peakSm = sm[i]; peakIdx = i; }
  }
  if (peakIdx < 0 || peakSm <= rp) throw new Error('未找到第一屈服峰值');
  const peakStress = stress[peakIdx];
  const peakStrain = strain[peakIdx];

  const eMax = strain[strain.length - 1];
  if (eMax < 0.4) throw new Error(`应变范围不足（max ε=${eMax.toFixed(3)} < 0.40，无法取平台应力）`);
  const plateau = trapz(strain, stress, 0.2, 0.4) / 0.2;

  // 吸能效率 η(ε)=W(ε)/σ(ε)，εd=argmax η（σ>0 且 ε>0.02 域内全局搜索）
  let w = 0, bestEta = -Infinity, ed = NaN;
  for (let i = 1; i < strain.length; i++) {
    w += (stress[i - 1] + stress[i]) / 2 * (strain[i] - strain[i - 1]);
    if (strain[i] > 0.02 && stress[i] > 0) {
      const eta = w / stress[i];
      if (eta > bestEta) { bestEta = eta; ed = strain[i]; }
    }
  }
  if (!Number.isFinite(ed)) throw new Error('密实化应变未找到（η 无有效极值）');
  const wv = trapz(strain, stress, 0, ed);

  return {
    elasticModulusE: e,
    proofStressRp02: rp,
    firstPeakStress: peakStress,
    firstPeakStrain: peakStrain,
    plateauStress: plateau,
    densificationStrain: ed,
    energyAbsorptionW: wv,
    maxEfficiencyEta: bestEta,
    virtualOriginStrain: 0, // 补偿后口径为 0；原始补偿量见 compensateToe().originStrain
  };
}

/** 全管线：解析 → Toe 补偿 → ISO 特征 → 双向标定比 */
export function fitExperimentalCurve(input: RawCurveInput, predictions?: { dtPlateau?: number; gaPlateau?: number }): CalibrationResult {
  const { strain, stress } = parseCurve(input);
  const comp = compensateToe(strain, stress);
  const metrics = extractIso13314(comp.strain, comp.stress, comp.elasticModulus);
  const withOrigin: Iso13314Metrics = { ...metrics, virtualOriginStrain: comp.originStrain };
  const scaling: CalibrationResult['scaling'] = {};
  if (predictions?.dtPlateau !== undefined && predictions.dtPlateau > 0) {
    scaling.dtVsExpRatio = predictions.dtPlateau / metrics.plateauStress;
  }
  if (predictions?.gaPlateau !== undefined && predictions.gaPlateau > 0) {
    scaling.gaVsExpRatio = predictions.gaPlateau / metrics.plateauStress;
  }
  return { metrics: withOrigin, cleanedCurve: { strain: comp.strain, stress: comp.stress }, scaling };
}
