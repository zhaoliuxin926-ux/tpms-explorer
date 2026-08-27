import type { TpmType, PhysicsMetrics } from '../types';
import { estimatePermeability } from './permeability';
import { estimatePoreStats } from './pore-analysis';

const C1_MAP: Record<string, number> = {
  gyroid: 0.38,
  diamond: 0.42,
  schwarz: 0.35,
  iwp: 0.44,
  frd: 0.40,
  neovius: 0.36,
  lidinoid: 0.37,
  splitp: 0.39,
  custom: 0.38,  // default to gyroid value
};

// Gibson & Ashby (1997) 开孔泡沫塑性坍塌：σ*/σs ≈ 0.23·ρ^1.5（弯曲主导）。
// TPMS 网格略强于随机开孔泡沫，取 0.3 作为折中上界；原值 1.5 高估 ~6.5×，无文献出处。
const C2 = 0.3;

/**
 * 各向异性系数估算
 * TPMS 结构在[100]、[110]、[111]方向的弹性模量不同。
 * 此系数表示最大方向差异与平均值的比例。
 *
 * 参考文献：
 * - Abueidda et al. (2017) 报道 Gyroid 的 E_max/E_min ≈ 1.3
 */
const ANISOTROPY_MAP: Record<string, number> = {
  gyroid: 1.30,
  diamond: 1.45,
  schwarz: 1.25,
  iwp: 1.35,
  frd: 1.40,
  neovius: 1.28,
  lidinoid: 1.32,
  splitp: 1.33,
  custom: 1.30,
};

export function getAnisotropy(type: string): number {
  return ANISOTROPY_MAP[type] ?? ANISOTROPY_MAP['gyroid'];
}

/** 基体材料杨氏模量 (GPa) */
export const BASE_MODULUS: Record<string, number> = {
  tc4: 110,      // Ti-6Al-4V
  polymer: 3.5,  // PLLA/PLA
  thermal: 70,   // 高导热复合材料（近似 Al-SiC）
};

/** 基体材料屈服强度 (MPa) —— 近似文献值 */
export const BASE_YIELD_STRENGTH: Record<string, number> = {
  tc4: 880,
  polymer: 50,
  thermal: 300,
};

/**
 * Gibson-Ashby 力学模型（开孔泡沫近似）
 *
 * E* / Es ≈ C1·(ρ* / ρs)²
 * σ* / σs ≈ C2·(ρ* / ρs)^(3/2)
 *
 * C1 取值参考文献：
 * - Gyroid: Abueidda et al. (2017), doi:10.1016/j.ijsolstr.2017.02.015
 * - Diamond: Maskery et al. (2018), doi:10.1016/j.actbio.2018.04.011
 * - Schwarz P: Berger et al. (2017)
 *
 * 注意：此模型为各向同性近似，实际 TPMS 结构存在各向异性。
 */
export function gibsonAshby(relativeDensity: number, type: string = 'gyroid'): { E_Es: number; sigma_Es: number; C1: number } {
  const C1 = C1_MAP[type] ?? C1_MAP['gyroid'];
  const E_Es = C1 * Math.pow(relativeDensity, 2);
  const sigma_Es = C2 * Math.pow(relativeDensity, 1.5);
  return { E_Es, sigma_Es, C1 };
}

/**
 * 计算 Gibson-Ashby 相对刚度 E* / Es（兼容旧接口）
 * @param type 曲面类型
 * @param porosity 孔隙率 (0-1)
 * @returns 相对刚度比值
 */
export function computeGibsonAshby(type: TpmType, porosity: number): number {
  const relativeDensity = 1 - porosity;
  return gibsonAshby(relativeDensity, type).E_Es;
}

/**
 * 计算梯度结构的弹性模量范围
 * 梯度结构的孔隙率从一端到另一端变化
 * 近似：Z轴梯度时，底部孔隙率高，顶部孔隙率低
 * 底部孔隙率 ≈ porosity + 15%，顶部 ≈ porosity - 15%
 */
export function computeGradientRange(
  porosity: number,
  type: string
): { minE: number; maxE: number; avgE: number } {
  const bottomPorosity = Math.min(95, porosity + 15);
  const topPorosity = Math.max(5, porosity - 15);

  const bottomRelDensity = 1 - bottomPorosity / 100;
  const topRelDensity = 1 - topPorosity / 100;

  const C1 = C1_MAP[type] ?? C1_MAP['gyroid'];
  const minE = C1 * Math.pow(bottomRelDensity, 2);   // 底部（多孔）弹性模量最低
  const maxE = C1 * Math.pow(topRelDensity, 2);      // 顶部（致密）弹性模量最高
  const avgE = (minE + maxE) / 2;

  return { minE, maxE, avgE };
}

/**
 * 计算完整物理力学指标
 */
export function computePhysicsMetrics(
  type: TpmType,
  porosity: number,
  surfaceArea: number,
  envelopeVolume: number,
  material: string,
  structureMode: string = 'solid_network'
): PhysicsMetrics {
  // 统一孔隙率单位：Worker 返回的是 0-100 百分比，内部计算需要 0-1 分数
  const porosityPercent = porosity > 1 ? porosity : porosity * 100;
  const porosityFraction = porosityPercent / 100;
  const relativeDensity = 1 - porosityFraction;

  const { E_Es, sigma_Es, C1 } = gibsonAshby(relativeDensity, type);
  // 'auto' 不在材质表内：解析为默认基体（tc4），避免静默回退导致展示材质名与实际不一致
  const resolvedMaterial = material === 'auto' ? 'tc4' : material;
  const baseE = BASE_MODULUS[resolvedMaterial] || BASE_MODULUS.tc4;
  const baseSigma = BASE_YIELD_STRENGTH[resolvedMaterial] || BASE_YIELD_STRENGTH.tc4;
  const svRatio = envelopeVolume > 0 ? surfaceArea / envelopeVolume : 0;
  const permeability = estimatePermeability(porosityPercent, svRatio);
  const poreStats = estimatePoreStats(porosityPercent, type, svRatio);
  const anisotropy = getAnisotropy(type);

  const result: PhysicsMetrics = {
    surfaceArea,
    envelopeVolume,
    svRatio,
    relativeDensity,
    youngsModulusGPa: E_Es * baseE,
    yieldStrengthMPa: sigma_Es * baseSigma,
    gibsonAshbyE: E_Es,
    gibsonAshbySigma: sigma_Es,
    C1,
    anisotropy,
    permeability,
    poreStats,
  };

  if (structureMode === 'gradient_shell') {
    result.gradientRange = computeGradientRange(porosityPercent, type);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────
// 正交各向异性等效刚度张量预估（Asymptotic Homogenization 近似）
//
// 模型定位（诚实边界）：真正的渐近均质化需对单胞做数值求解（FEA/FFT），
// 本函数提供的是【一阶几何调制近似】——
//   1. 各向同性基：Gibson-Ashby E_iso = C1·ρ̄²（弯曲主导，文献参数见上）
//   2. 三向调制：E_ii = E_iso · (τ̄/τ_i)²，τ̄ = (τx·τy·τz)^(1/3)
//      （几何迂曲度越大的方向，载荷路径越长、有效刚度越低；指数 2 与
//        弯曲主导标度一致）
//   3. 泊松比取开孔 TPMS 文献典型值 ν* = 0.30（各方向同值）
//   4. G_ij = √(E_i·E_j) / (2(1+ν))
//   5. 组装正交各向异性柔度矩阵 S → C = S⁻¹（3×3 法向/剪切块）
//   6. Zener 各向异性比 A = 2·C44 / (C11 − C12)：立方对称 + 迂曲各向同性
//      时 A = 1（数值上因离散栅格有 ~1% 级偏差，由 micro_physics_audit 守门）
//
// 立方对称曲面集合：Gyroid / Diamond / Schwarz P / Neovius / I-WP。
// ──────────────────────────────────────────────────────────────

/** 立方对称曲面集合（Zener 比预期 ≈ 1） */
const CUBIC_SYMMETRY: ReadonlySet<string> = new Set(['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp']);

export interface TortuosityTriple {
  x: number;
  y: number;
  z: number;
}

export interface AnisotropicStiffness {
  /** 主轴向归一化模量 E11/E22/E33（相对基体，×Es 得 GPa） */
  E: [number, number, number];
  /** 主轴向剪切模量 G12/G23/G13（相对基体） */
  G: [number, number, number];
  /** 泊松比 ν12/ν23/ν13 */
  nu: [number, number, number];
  /** 刚度矩阵常数：C11、C12、C44（相对基体） */
  C11: number;
  C12: number;
  C44: number;
  /** Zener 各向异性比 A = 2C44/(C11−C12) */
  zener: number;
  /** 是否立方对称曲面（预期各向同性） */
  cubicSymmetry: boolean;
  /** 模型口径说明 */
  note: string;
}

const POISSON_TPMS = 0.30;

/** 3×3 矩阵求逆（伴随/行列式，解析 3×3） */
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];   // 退化兜底：单位阵（调用方视为无效）
  }
  const invDet = 1 / det;
  return [
    A * invDet, -(b * i - c * h) * invDet, (b * f - c * e) * invDet,
    B * invDet, (a * i - c * g) * invDet, -(a * f - c * d) * invDet,
    C * invDet, -(a * h - b * g) * invDet, (a * e - b * d) * invDet,
  ];
}

/**
 * 正交各向异性等效刚度预估。
 * @param relativeDensity 相对密度 ρ̄ = 1 − P（网格实测口径）
 * @param type 曲面类型（决定 Gibson-Ashby C1）
 * @param tort 三向几何迂曲度（未贯通 Infinity 时取 t̄ 回退——该方向模量按各向同性基处理，
 *             因为载荷路径不存在时迂曲调制失去意义）
 */
export function estimateAnisotropicStiffness(
  relativeDensity: number,
  type: string,
  tort?: TortuosityTriple,
): AnisotropicStiffness {
  const C1 = C1_MAP[type] ?? C1_MAP['gyroid'];
  const E_iso = C1 * relativeDensity * relativeDensity;
  const nu = POISSON_TPMS;

  // 迂曲调制（τ 未提供/未贯通方向 → 以 τ̄ 替代 = 调制因子 1）
  let tx = 1, ty = 1, tz = 1;
  if (tort) {
    const finite = (v: number) => (Number.isFinite(v) && v >= 1 ? v : NaN);
    const fx = finite(tort.x), fy = finite(tort.y), fz = finite(tort.z);
    const anyFinite = [fx, fy, fz].filter(Number.isFinite);
    const tBar = anyFinite.length
      ? Math.pow(anyFinite.reduce((a, b) => a * b, 1), 1 / anyFinite.length)
      : 1;
    tx = Number.isFinite(fx) ? fx : tBar;
    ty = Number.isFinite(fy) ? fy : tBar;
    tz = Number.isFinite(fz) ? fz : tBar;
  }
  const tBarGeo = Math.cbrt(tx * ty * tz) || 1;
  const modulate = (t: number) => Math.pow(tBarGeo / (t || tBarGeo), 2);
  const E1 = E_iso * modulate(tx);
  const E2 = E_iso * modulate(ty);
  const E3 = E_iso * modulate(tz);

  // 剪切：方向对角模量的几何平均 + 各向同性泊松关系（一阶近似）
  const G12 = Math.sqrt(E1 * E2) / (2 * (1 + nu));
  const G23 = Math.sqrt(E2 * E3) / (2 * (1 + nu));
  const G13 = Math.sqrt(E1 * E3) / (2 * (1 + nu));

  // 正交各向异性柔度（3×3 法向块；ν_ij 定义在 i 方向加载、j 方向应变约定）
  const S = [
    1 / E1, -nu / E1, -nu / E1,
    -nu / E2, 1 / E2, -nu / E2,
    -nu / E3, -nu / E3, 1 / E3,
  ];
  const C = invert3(S);
  const C11 = C[0], C12 = C[1], C44 = G23;   // 立方约定 C44 ↔ 23 面（近似口径）

  // 工程剪切直接取 G（与 C44 在立方对称下等价；正交情形以 G 面板展示为准）
  const zener = C11 - C12 !== 0 ? (2 * C44) / (C11 - C12) : 1;
  const cubicSymmetry = CUBIC_SYMMETRY.has(type);

  const note = cubicSymmetry
    ? `立方对称曲面：预期 Zener A ≈ 1（实测 ${zener.toFixed(3)}）`
    : '正交各向异性近似（迂曲度几何调制，非渐近均质化数值解）';

  return {
    E: [E1, E2, E3],
    G: [G12, G23, G13],
    nu: [nu, nu, nu],
    C11, C12, C44,
    zener,
    cubicSymmetry,
    note,
  };
}
