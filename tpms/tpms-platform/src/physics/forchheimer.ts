/**
 * forchheimer.ts —— CFD 压降两流量点 Forchheimer 分离 + 固有渗透率换算
 *
 * 方法论出处（FEA_Bone_Scaffold 论文工程验证口径，2026-09 交接借鉴）：
 *   ΔP = A·Q + B·Q²（Forchheimer 双点拟合）——两个流量点解线性方程分离
 *   黏性项 A（Stokes 阻抗，Pa·s/m³）与惯性项 B（Pa·s²/m⁶）；
 *   固有渗透率取 Stokes 截距：K_int = μ·L / (A_box·A)。
 *   惯性占比 = B·Q²/ΔP 随流量增长（论文实测口径 ~6-12% @ 灌注流量）。
 *
 * 诚实边界：两流量点若落非线性高段，A/B 为该区间等效值（非全域常数）；
 * K_int 绝对值受网格敏感性影响（结构化六面体较 snappy 四面体更良态，
 * 但未做网格收敛研究前绝对值须带区间披露——论文三水平研究先例）。
 */

export interface ForchheimerInputs {
  q1: number; dp1: number; q2: number; dp2: number;
  /** 动力黏度 Pa·s（默认 1.45e-3 = DMEM+10%FBS @37°C，论文 [Chao 2021] 口径） */
  mu?: number;
  /** 试样轴向长度 m（渗透率换算特征长） */
  length: number;
  /** 盒截面积 A_box m²（并联可加性要求的公共截面基准） */
  area: number;
}

export interface ForchheimerResult {
  /** Stokes 阻抗 Pa·s/m³ */
  A: number;
  /** 惯性系数 Pa·s²/m⁶ */
  B: number;
  /** 固有（黏性）渗透率 m² = μ·L/(A_box·A) */
  kInt: number;
  /** 两点各自表观渗透率 μ·L·Q/(A_box·ΔP)（惯性使低流量点更高） */
  kApp: [number, number];
  /** 两点惯性压降占比 B·Q²/ΔP */
  inertialFraction: [number, number];
  mu: number; length: number; area: number;
}

export function forchheimerTwoPoint(inp: ForchheimerInputs): ForchheimerResult {
  const { q1, dp1, q2, dp2 } = inp;
  if (![q1, dp1, q2, dp2].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('流量与压降须全为正有限值（收到 q1=' + q1 + ' dp1=' + dp1 + ' q2=' + q2 + ' dp2=' + dp2 + '）');
  }
  if (Math.abs(q1 - q2) < 1e-30) {
    throw new Error('两点分离要求 q1 ≠ q2（同流量两点方程奇异）');
  }
  if (inp.length <= 0 || inp.area <= 0) {
    throw new Error('length 与 area 须为正（渗透率换算特征量）');
  }
  const det = q1 * q2 * q2 - q2 * q1 * q1;
  const A = (dp1 * q2 * q2 - dp2 * q1 * q1) / det;
  const B = (q1 * dp2 - q2 * dp1) / det;
  if (!(A > 0)) {
    throw new Error('Stokes 阻抗 A ≤ 0（' + A + '）——压降/流量数据非物理（检查单位：Q 用 m³/s、ΔP 用 Pa）');
  }
  const mu = inp.mu ?? 1.45e-3;
  if (!(mu > 0)) throw new Error('mu 须为正');
  return {
    A, B,
    kInt: (mu * inp.length) / (inp.area * A),
    kApp: [(mu * inp.length * q1) / (inp.area * dp1), (mu * inp.length * q2) / (inp.area * dp2)],
    inertialFraction: [(B * q1 * q1) / dp1, (B * q2 * q2) / dp2],
    mu, length: inp.length, area: inp.area,
  };
}
