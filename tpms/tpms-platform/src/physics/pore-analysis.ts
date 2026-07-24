/**
 * 孔径分布估算（基于 TPMS 场特征尺度）
 *
 * 对于各向同性 TPMS，特征孔径近似为：
 * d_pore ≈ cellSize / n_periods × (porosity)^(1/3) × f(type)
 *
 * 其中 f(type) 为拓扑修正因子：
 * - Gyroid: 0.58
 * - Diamond: 0.52
 * - Schwarz P: 0.63
 * - I-WP: 0.55
 * - F-RD: 0.48
 * - Neovius: 0.60
 */

const PORE_FACTOR: Record<string, number> = {
  gyroid: 0.58,
  diamond: 0.52,
  'schwarz': 0.63,
  'i-wp': 0.55,
  'f-rd': 0.48,
  neovius: 0.60,
  lidinoid: 0.57,
  splitp: 0.54,
  custom: 0.58,
};

export interface PoreStats {
  meanDiameter: number;       // 平均孔径 (mm)
  minDiameter: number;        // 最小孔径 (mm)
  maxDiameter: number;        // 最大孔径 (mm)
  stdDiameter: number;        // 标准差 (mm)
  surfaceToVolume: number;    // 比表面积 (mm²/mm³)
  tortuosity: number;         // 迂曲度
}

function mapType(type: string): string {
  if (type === 'iwp') return 'i-wp';
  if (type === 'frd') return 'f-rd';
  return type;
}

export function estimatePoreStats(
  porosity: number,
  cellSize: number,
  type: string,
  svRatio: number
): PoreStats {
  const eps = porosity / 100;
  const factor = PORE_FACTOR[mapType(type)] ?? PORE_FACTOR['gyroid'];

  // 平均孔径：基于单元尺寸和孔隙率的标度律
  const meanDiameter = cellSize * factor * Math.pow(eps, 1/3);

  // 孔径分布近似为正态，σ ≈ 0.15 × mean
  const stdDiameter = meanDiameter * 0.15;
  const minDiameter = Math.max(0.01, meanDiameter - 2 * stdDiameter);
  const maxDiameter = meanDiameter + 2 * stdDiameter;

  // 迂曲度估算：τ ≈ 1 + 0.5·(1-ε) (Mackie-Meares 近似)
  const tortuosity = 1 + 0.5 * (1 - eps);

  return {
    meanDiameter,
    minDiameter,
    maxDiameter,
    stdDiameter,
    surfaceToVolume: svRatio,
    tortuosity,
  };
}
