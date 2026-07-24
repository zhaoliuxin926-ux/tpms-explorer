/**
 * Kozeny-Carman 渗透率估算
 *
 * K = (ε³ · d²) / (C · (1-ε)² · S²)
 *
 * 其中：
 * - ε: 孔隙率 (porosity)
 * - d: 特征孔径 (mm) — 可近似为 0.5 × cellSize / periods
 * - C: Kozeny 常数 (~5 for TPMS)
 * - S: 比表面积 (mm²/mm³ = mm⁻¹)
 *
 * 简化形式（使用比表面积 Sv = S/V）：
 * K = ε³ / (C · Sv² · (1-ε)²)
 *
 * 单位：mm²
 *
 * 参考文献：
 * - Bhatt & Habros (2017), DOI:10.1016/j.jmbbm.2017.05.007
 */
export function estimatePermeability(porosity: number, svRatio: number, C = 5): number {
  const eps = Math.max(0.01, Math.min(0.99, porosity / 100));
  const k = Math.pow(eps, 3) / (C * svRatio * svRatio * Math.pow(1 - eps, 2));
  return k;  // mm²
}
