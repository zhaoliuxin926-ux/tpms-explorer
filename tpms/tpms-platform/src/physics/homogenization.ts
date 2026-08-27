/**
 * RVE 均质化与方向模量（阶段 II 交付：解析路线）
 *
 * 交付形态说明（工程裁决，机理归档 agent_memory/bugs.md）：体素 FE 求解器
 * （矩阵自由 CG / 对称 GS 预条件 / 均值应变约束投影）在开发中遭遇根本障碍——
 *  (1) 删除孔隙的格点均值漂移经泊松耦合污染应力 −18% 且不随分辨率收敛；
 *  (2) 满格 voidK 方案的 CG 在 κ~1/voidK 对比下出现长程正交性丢失的舍入
 *      崩溃（残差漂移 1e+120，重启/GS 预条件/deMean 均不能根治）；
 *  (3) 任何均值钉扎型约束均因「应力 = 六均值分量的线性函数」退化为
 *      φ·C0 / 2φ·C0 几何盲区。
 * 按宪章自愈协议切换解析路线：Voigt–Reuss 精确界 + 迂曲度调制方向刚度
 * （estimateAnisotropicStiffness，已由 micro_physics_audit 审计）+ E(n)
 * 方向模量曲面（本模块）。FE 实现保留于 git 历史供后续多格预条件攻关复用。
 *
 * 方向模量定义：E(n) = 1/(nᵢnⱼnₖnℓ·S_ijkl)，n 为单位方向向量。
 */

// ────────────────────────────── 基体常数 ──────────────────────────────

/** 各向同性基体 6×6 刚度（工程剪变约定 [εxx,εyy,εzz,γxy,γyz,γzx]，E=1） */
export function baseStiffness(nu: number): Float64Array {
  const E = 1;
  const lambda = (nu * E) / ((1 + nu) * (1 - 2 * nu));
  const mu = E / (2 * (1 + nu));
  const C = new Float64Array(36);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) C[i * 6 + j] = lambda;
    C[i * 6 + i] = lambda + 2 * mu;
  }
  C[3 * 6 + 3] = mu;
  C[4 * 6 + 4] = mu;
  C[5 * 6 + 5] = mu;
  return C;
}

/** 各向同性基体 6×6 柔度（E=1）：S11=1、S12=−ν、S44=2(1+ν) */
export function baseCompliance(nu: number): Float64Array {
  const S = new Float64Array(36);
  for (let i = 0; i < 3; i++) {
    S[i * 6 + i] = 1;
    for (let j = 0; j < 3; j++) if (j !== i) S[i * 6 + j] = -nu;
  }
  S[3 * 6 + 3] = 2 * (1 + nu);
  S[4 * 6 + 4] = 2 * (1 + nu);
  S[5 * 6 + 5] = 2 * (1 + nu);
  return S;
}

/**
 * 由正交各向异性三向杨氏模量 + 统一泊松比构造工程柔度矩阵（近似耦合）：
 * S_ii = 1/E_i，法向耦合 −ν/E_j 近似，剪切项取相邻法向柔度和的一半加泊松
 * 修正（保守近似）。UI 的 E(n) 球面热力图与审计一致性检查共用。
 */
export function orthotropicCompliance(E1: number, E2: number, E3: number, nu: number): Float64Array {
  const g1 = Math.max(E1, 1e-9), g2 = Math.max(E2, 1e-9), g3 = Math.max(E3, 1e-9);
  const S = new Float64Array(36);
  S[0] = 1 / g1; S[7] = 1 / g2; S[14] = 1 / g3;
  S[1] = -nu / g2; S[2] = -nu / g3; S[9] = -nu / g3;
  S[4] = S[1]; S[8] = S[2]; S[13] = S[9];
  // 剪切柔度：S44 = (1+ν)(1/E2+1/E3) 等——各向同性极限（E1=E2=E3）精确退化
  // 为 2(1+ν)/E = 1/G，保证均匀 τ 时 E(n) 恒定
  S[21] = (1 + nu) * (1 / g2 + 1 / g3);
  S[28] = (1 + nu) * (1 / g1 + 1 / g3);
  S[35] = (1 + nu) * (1 / g1 + 1 / g2);
  return S;
}

// ────────────────────────────── Voigt–Reuss 精确界 ──────────────────────────────

export interface VrhBounds {
  /** Voigt 上界（并联，等应变）：C_V = φ·C0 */
  cV11: number;
  cV12: number;
  cV44: number;
  /** Reuss 下界（串联，等应力）：真孔隙柔度∞ → k_R = g_R = 0 */
  kR: number;
  gR: number;
  /** Voigt 体模量 φ·k0 */
  kv: number;
  /** Voigt 剪切模量 φ·μ0 */
  gv: number;
}

/**
 * 各向同性两相（固相体积分数 φ + 真孔隙）Voigt/Reuss 精确解析界（E0=1）。
 * Voigt：C_V = φ·C0（并联，等应变）。Reuss：真孔隙柔度∞ → k_R = g_R = 0。
 * 作用：为任何数值均质化结果提供必夹区间与量级参照。
 */
export function vrhBounds(phi: number, nu: number): VrhBounds {
  const C0 = baseStiffness(nu);
  const mu = 1 / (2 * (1 + nu));
  const lam = nu / ((1 + nu) * (1 - 2 * nu));
  const k0 = lam + 2 * mu / 3;
  return {
    cV11: phi * C0[0],
    cV12: phi * C0[1],
    cV44: phi * C0[21],
    kR: 0,
    gR: 0,
    kv: phi * k0,
    gv: phi * mu,
  };
}

// ────────────────────────────── 方向模量 ──────────────────────────────

/**
 * 方向杨氏模量 E(n) = 1/(nᵢnⱼnₖnℓ S_ijkl)。
 * Voigt 工程剪变展开（对称 6×6）：n⁴ 对角 + 2S_ij n_i²n_j²（法向耦合）
 * + S44/S55/S66 剪切项（γxy↔n1n2、γyz↔n2n3、γzx↔n1n3）。
 */
export function directionalModulus(S: Float64Array, nx: number, ny: number, nz: number): number {
  const n1 = nx * nx, n2 = ny * ny, n3 = nz * nz;
  const compliance =
    S[0] * n1 * n1 + S[7] * n2 * n2 + S[14] * n3 * n3
    + 2 * S[1] * n1 * n2 + 2 * S[2] * n1 * n3 + 2 * S[8] * n2 * n3
    + S[21] * n1 * n2 + S[28] * n2 * n3 + S[35] * n1 * n3;
  return compliance > 1e-300 ? 1 / compliance : 0;
}

/** 方向模量球面采样（极角网格）：θ∈[0,π] rows+1 行 × φ∈[0,2π) cols 列，值 = E(n) */
export function sampleDirectionalGrid(S: Float64Array, rows = 36, cols = 72): { rows: number; cols: number; E: Float32Array; emin: number; emax: number } {
  const E = new Float32Array((rows + 1) * cols);
  let emin = Infinity, emax = -Infinity;
  for (let ir = 0; ir <= rows; ir++) {
    const theta = (ir / rows) * Math.PI;
    for (let ic = 0; ic < cols; ic++) {
      const phi = (ic / cols) * 2 * Math.PI;
      const e = directionalModulus(S, Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta));
      E[ir * cols + ic] = e;
      if (e < emin) emin = e;
      if (e > emax) emax = e;
    }
  }
  return { rows, cols, E, emin, emax };
}
