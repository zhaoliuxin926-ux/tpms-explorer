/**
 * radial-grad.ts —— M(r) 空间映射径向梯度 TPMS 构型（论文几何借鉴战役，2026-09-15）
 *
 * 数学出处（FEA_Bone_Scaffold/MATLAB/Bone_Project/py/scaffold_conformal_map.py，
 * 与发表论文同源、经 nTop 对标验证）：
 *   物理空间 (x1,y1,z1) → 相位空间 (x2,y2,z2) 逆映射（径向 arctanh + 轴向有理双通道）：
 *     u  = min(r1, 0.9999·A)/A，A=√(K/(K−1))（R0=1 归一化域）
 *     x2 = x1·arctanh(u)/(C_rad·r1)，C_rad=√(K(K−1))     —— 径向拉回（中心极限 1/K）
 *     z2 = z1/((1−K)·r1²+K)                              —— 轴向拉回（中心 1/K，边缘 1）
 *   相位场 Schwarz P：P=cos(ωx2)+cos(ωy2)+cos(ωz2)，ω=2π/L（L=2/nCells 归一化）
 *   阈值场（壁厚补偿）：Ca=ta/(kWall·L·K)、Cb=tb/(kWall·L)（kWall=0.2444 Schwarz P 物理壁厚系数）
 *     S_r=1/((1−u²)K)，C_lin=S_r(Cb−Ca)/(1−1/K)+Ca−(Cb−Ca)/(K−1)
 *     封口：C≥1.3 → 3.0（最外缘环带闭合）
 *   实体：|P| ≤ C_Effective（壳语义；K=1 退化为均匀 P，C=0.871 常数 ≈50% 密度）
 *
 * 平台接入：tpmsFn 返回 |P|（radial 模式），biasAt 返回 C_Effective(r1)——
 * 与 stress 坐标包装、isoGrad 渐变 bias 各自同构；等值面 |P|=C(r) 连续 ⟹ 水密天然保持。
 * 坐标约定：模块输入 (X,Y,Z) 为归一化物理域 [−1,1]（wc/π）；
 * ta/tb/尺寸经 sizeMm（域直径 mm）换算归一化（论文 R0=15mm、ta=0.5、tb=nTop 表）。
 */

export interface RadialGradConfig {
  /** 中心膨胀率（≥1；1=均匀 P 无变换） */
  K: number;
  /** 域直径 mm（归一化换算；域内晶胞数由调用方的 periods 承担） */
  sizeMm: number;
  /** 中心壁厚 mm */
  taMm: number;
  /** 边缘壁厚 mm */
  tbMm: number;
}

export const KWALL_SCHWARZ_P = 0.2444;
export const C_UNIFORM_K1 = 0.871;

export function validateRadialGrad(cfg: RadialGradConfig, nCells: number): void {
  if (!(cfg.K >= 1)) throw new Error(`radial-grad K 须 ≥ 1（收到 ${cfg.K}；1=均匀 P 基准）`);
  if (!(cfg.sizeMm > 0) || cfg.sizeMm > 1000) throw new Error(`radial-grad sizeMm 须 0 < L ≤ 1000`);
  if (!(cfg.taMm > 0) || !(cfg.tbMm > 0)) throw new Error('radial-grad ta/tb 须为正壁厚 mm');
  if (!Number.isInteger(nCells) || nCells < 2 || nCells > 48) throw new Error(`radial-grad periods（域内晶胞数）须 2~48 整数（收到 ${nCells}）`);
}

/** 逆映射：归一化物理坐标 → 相位坐标（K>1；K=1 恒等） */
export function radialGradTransform(X: number, Y: number, Z: number, K: number): [number, number, number] {
  if (K === 1) return [X, Y, Z];
  const r1 = Math.sqrt(X * X + Y * Y);
  const A = Math.sqrt(K / (K - 1));
  const u = Math.min(r1, A * 0.9999) / A;            // artanh 奇点截断（论文同款）
  const r1s = Math.max(r1, 1e-6);
  const scale = Math.atanh(u) / (Math.sqrt(K * (K - 1)) * r1s);
  const zDen = (1 - K) * r1 * r1 + K;
  return [X * scale, Y * scale, Z / zDen];
}

/** 阈值场 C_Effective(r1)（K>1 线式自然增长；K=1 均匀常数）。
 *  封口语义（2026-09-15 定案）：不截断 C≥1.3→3 的跳变帽（论文 MC 查表可容忍跳变，
 *  surface-nets 对场不连续产生界面非流形——实测 nm 集中于跳变带 r≈0.83-0.98），
 *  让 C_lin 经 S_r=1/((1−u²)K) 在边缘自然增长过 3（|P|max）——环带自动全实体、场连续，
 *  封口半径= C_lin 过 3 的位置（较论文跳变版微内移，披露）。 */
export function radialGradThreshold(r1: number, K: number, Ln: number, taN: number, tbN: number): number {
  if (K === 1) return C_UNIFORM_K1;
  const Ca = taN / (KWALL_SCHWARZ_P * Ln * K);
  const Cb = tbN / (KWALL_SCHWARZ_P * Ln);
  const A = Math.sqrt(K / (K - 1));
  const u = Math.min(r1, A * 0.9999) / A;
  const Sr = 1 / ((1 - u * u) * K);
  return (Sr * (Cb - Ca)) / (1 - 1 / K) + Ca - (Cb - Ca) / (K - 1);
}

/** 相位场 Schwarz P（归一化相位坐标，ω=2π/Ln） */
export function schwarzPPhase(x2: number, y2: number, z2: number, Ln: number): number {
  const om = (2 * Math.PI) / Ln;
  return Math.cos(om * x2) + Math.cos(om * y2) + Math.cos(om * z2);
}

/** 便捷：归一化物理坐标 → |P|（tpmsFn 包装用） */
export function radialGradAbsP(X: number, Y: number, Z: number, K: number, Ln: number): number {
  const [x2, y2, z2] = radialGradTransform(X, Y, Z, K);
  return Math.abs(schwarzPPhase(x2, y2, z2, Ln));
}

/** 便捷：归一化物理坐标 → 阈值（biasAt 用；ta/tb/size 为 mm 量纲自动归一化） */
export function radialGradThresholdAt(X: number, Y: number, cfg: RadialGradConfig, nCells: number): number {
  const r1 = Math.sqrt(X * X + Y * Y);
  const Ln = 2 / nCells;                              // 归一化晶胞尺寸（域直径=2）
  const taN = (cfg.taMm / cfg.sizeMm) * 2;            // mm → 归一化（域半径=sizeMm/2 ↔ 归一化 1）
  const tbN = (cfg.tbMm / cfg.sizeMm) * 2;
  return radialGradThreshold(r1, cfg.K, Ln, taN, tbN);
}
