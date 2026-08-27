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
