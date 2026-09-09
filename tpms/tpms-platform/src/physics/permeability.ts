/**
 * Kozeny-Carman 渗透率估算（bulk 比表面积口径）
 *
 * K = ε³ / (C · Sv²)
 *
 * 其中：
 * - ε: 孔隙率（0-100 百分数入参，内部归一）
 * - Sv: 比表面积，每 Bulk 体积的界面面积（mm²/mm³ = mm⁻¹）
 * - C: Kozeny 常数 (~5 for TPMS)
 * 单位：mm²
 *
 * 【2026-09-10 量纲修正】旧实现 K = ε³/(C·Sv²·(1−ε)²) 把「每固相体积 S_s」约定下的
 * (1−ε)² 因子，误用于「每 Bulk 体积 Sv」入参（svRatio = surfaceArea/envelopeVolume
 * 恒为 bulk 口径）→ 渗透率被系统性低估 (1−ε)² 倍（φ=0.7 时 11×）。
 * 两约定换算：Sv = S_s·(1−ε)；粒子直径形式 K = ε³d²/(180(1−ε)²) 的 (1−ε)² 即来源于此。
 * 门禁 22 F 节已实现 FD-Darcy vs 本函数区间对拍（实测比 1.22~1.39@φ0.44-0.54，钉入 [0.3,3]）。
 *
 * 参考文献：
 * - Bhatt & Habros (2017), DOI:10.1016/j.jmbbm.2017.05.007
 * - Carman (1937)经典形式 k = ε³/(c·S_v²)，S_v 为 bulk 比表面积
 */
export function estimatePermeability(porosity: number, svRatio: number, C = 5): number {
  const eps = Math.max(0.01, Math.min(0.99, porosity / 100));
  const k = Math.pow(eps, 3) / (C * svRatio * svRatio);
  return k;  // mm²
}
