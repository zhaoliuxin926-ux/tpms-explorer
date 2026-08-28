/**
 * WebGPU 弹塑性大变形求解器 —— CPU 权威路径（v6.0 阶段 I）
 *
 * 数学：全拉格朗日（Total Lagrangian）体素 FEM，8 节点六面体 C3D8、2×2×2 Gauss。
 *   · 几何非线性：Green-Lagrange 应变 E = ½(FᵀF − I)，F = I + Σ u_a⊗∇N_a；
 *   · 材料非线性：Saint-Venant-Kirchhoff 超弹性（PK2 = C:(E − Ep)）+ J2 各向同性
 *     线性硬化塑性（Radial Return Mapping）。J2 取在 PK2 空间——中等应变下的标准
 *     工程近似，旋转精度边界在 WORKFLOW_GUIDE §26 披露；
 *   · 平衡：位移加载 + 修正牛顿（弹性切线）+ 回溯线搜索 + Jacobi-PCG（无矩阵，
 *     与 micro-fea-solver 同一套自由度消除口径：底面全固支、顶面 uz 施加位移）；
 *   · 本构状态机：每步从「已提交状态」出发做总应变试探（NR 迭代幂等），
 *     步收敛后提交 Ep/PEEQ（试验-提交双缓冲，杜绝迭代间塑性双计）；
 *   · 能量台账：ΔW_ext = R·Δuz（收敛步离散虚功恒等式），ΔW_int = Σ S_i:ΔE dV
 *     （步末应力），ΔW_pl = σ̄y·Δε̄p，W_el := W_int − W_pl；门禁 27 守 |W_ext−W_int|/W_ext ≤ 0.5%。
 *
 * GPU 分工：本文件是 CPU 权威路径；WebGPU 计算着色器（shaders/plasticity.wgsl，
 * 由 gpu-plasticity-webgpu.ts 内联模板逐字同步 + 门禁锚定）并行执行逐 GP 本构更新
 * 与应力场输出；稀疏平衡方程求解保持 CPU PCG（混合管线口径，详见 §26）。
 *
 * 单位约定：E0 = 1、单元边长 h = 1（无量纲）。sigmaY/hardening 以 E0 为单位
 * （金属典型 σy/E ≈ 0.01）。结果乘真实 E0 即得物理量纲。
 */

export interface ElasticConstants {
  lambda: number;
  mu: number;
}

/** ν → (λ, μ)：与 micro-fea-solver 同式 */
export function lameFromNu(nu: number): ElasticConstants {
  return {
    lambda: nu / ((1 + nu) * (1 - 2 * nu)),
    mu: 1 / (2 * (1 + nu)),
  };
}

/** Voigt ↔ 3×3 张量（行主序）。应变走工程剪切（Voigt 剪切 = 2×张量）；
 *  应力剪切分量 Voigt = 张量本身（不加倍）——两套转换不可混用
 *  （曾误用应变版转换应力导致返回后剪切翻倍，2026-08-28 定案）。 */
function voigtToTensor(v: ArrayLike<number>): number[] {
  return [v[0], v[3] / 2, v[5] / 2, v[3] / 2, v[1], v[4] / 2, v[5] / 2, v[4] / 2, v[2]];
}
/** 应力专用：Voigt 剪切 = 张量剪切本身（不减半） */
function voigtStressToTensor(v: ArrayLike<number>): number[] {
  return [v[0], v[3], v[5], v[3], v[1], v[4], v[5], v[4], v[2]];
}
function tensorToVoigtStrain(t: ArrayLike<number>): number[] {
  return [t[0], t[4], t[8], 2 * t[1], 2 * t[5], 2 * t[2]];
}
function tensorToVoigtStress(t: ArrayLike<number>): number[] {
  return [t[0], t[4], t[8], t[1], t[5], t[2]];
}

/** StVK：S = C:(E − Ep)，Voigt 工程剪切口径（S4 = μ·Γ4） */
export function stVkPK2(e: ArrayLike<number>, ep: ArrayLike<number>, c: ElasticConstants): number[] {
  const ee = [e[0] - ep[0], e[1] - ep[1], e[2] - ep[2], e[3] - ep[3], e[4] - ep[4], e[5] - ep[5]];
  const tr = ee[0] + ee[1] + ee[2];
  return [
    c.lambda * tr + 2 * c.mu * ee[0],
    c.lambda * tr + 2 * c.mu * ee[1],
    c.lambda * tr + 2 * c.mu * ee[2],
    c.mu * ee[3],
    c.mu * ee[4],
    c.mu * ee[5],
  ];
}

/** von Mises（Voigt 工程剪切标准式：σv² = ½[(σ11−σ22)²+…] + 3(τ12²+τ23²+τ13²)） */
export function vonMisesVoigt(s: ArrayLike<number>): number {
  const a = 0.5 * ((s[0] - s[1]) ** 2 + (s[1] - s[2]) ** 2 + (s[2] - s[0]) ** 2)
    + 3 * (s[3] * s[3] + s[4] * s[4] + s[5] * s[5]);
  return Math.sqrt(a);
}

export interface RadialReturnResult {
  stress: number[];      // 更新后 PK2（Voigt）
  epPlastic: number[];   // 更新后塑性应变（Voigt，Green-Lagrange 口径）
  peeq: number;          // 更新后累计等效塑性应变 ε̄p
  dPeek: number;         // 本增量 dε̄p（0 = 纯弹性）
  yieldStress: number;   // 更新后流动应力 σy + H·ε̄p
}

/**
 * J2 径向返回（各向同性硬化，关联流动），Prandtl-Reuss 张量口径：
 *   流向 m = (3/2)·s_trial/σv_trial（单轴校验 εp11 = ε̄p），dεp = dγ·m，
 *   dγ = f/(3μ+H)，ΔS = −2μ·dεp（返回后 f_new = 0 到机器精度，由门禁 27 断言）。
 */
export function radialReturn(
  eTrial: ArrayLike<number>,
  epOld: ArrayLike<number>,
  peeqOld: number,
  c: ElasticConstants,
  sigmaY: number,
  hardening: number,
): RadialReturnResult {
  const sTrial = stVkPK2(eTrial, epOld, c);
  const vmTrial = vonMisesVoigt(sTrial);
  const yOld = sigmaY + hardening * peeqOld;
  const f = vmTrial - yOld;
  if (f <= 0) {
    return { stress: sTrial, epPlastic: Array.from(epOld), peeq: peeqOld, dPeek: 0, yieldStress: yOld };
  }
  const st = voigtStressToTensor(sTrial);
  const tr = st[0] + st[4] + st[8];
  const dev = [st[0] - tr / 3, st[1], st[2], st[3], st[4] - tr / 3, st[5], st[6], st[7], st[8] - tr / 3];
  const dGamma = f / (3 * c.mu + hardening);
  // ΔS = −2μ·dγ·m，m = (3/2)·dev/σv（Voigt 工程剪切口径换算）
  const kFac = -2 * c.mu * dGamma * 1.5 / vmTrial;
  const sNewT = st.map((x, i) => x + kFac * dev[i]);
  const dEpT = dev.map((x) => 1.5 * dGamma * x / vmTrial);   // dεp = (3/2)·dγ·dev/σv（单轴校验 εp11 = ε̄p）
  const epNewT = voigtToTensor(epOld).map((x, i) => x + dEpT[i]);
  return {
    stress: tensorToVoigtStress(sNewT),
    epPlastic: tensorToVoigtStrain(epNewT),
    peeq: peeqOld + dGamma,
    dPeek: dGamma,
    yieldStress: yOld + hardening * dGamma,
  };
}

// ──────────────────────────────────────────────────────────────
// 体素 FEM 大变形驱动
// ──────────────────────────────────────────────────────────────

/** 8 角点自然坐标（与 micro-fea-solver NODE_XI 同序） */
const NODE_XI: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const GP1 = 1 / Math.sqrt(3);

export interface PlasticityParams {
  R: number;
  solid: Uint8Array;            // R³，1 = 固相体素
  active?: Uint8Array;          // R³ 单元生死掩码（onStep 回调可改写；默认全 1）
  nu?: number;                  // 泊松比（默认 0.3）
  sigmaY?: number;              // 固相屈服强度（E0=1 单位，默认 0.01 ≈ 金属 σy/E）
  hardening?: number;           // 各向同性硬化模量 H（E0 单位，默认 0.05）
  steps?: number;               // 位移载荷步数（默认 8）
  maxStrain?: number;           // 终态工程压应变（正数，默认 0.05）
  tol?: number;                 // NR 残差阈（相对顶面反力，默认 1e-6）
  maxIter?: number;             // 每步 NR 上限（默认 40）
  pcgTol?: number;              // PCG 相对残差（默认 1e-6）
  pcgMaxIter?: number;          // PCG 上限（默认 3000）
  /** 每步收敛后回调：可改写 active 实现单元生死（Stage II 失效判据挂点） */
  onStep?: (ctx: PlasticityStepContext) => void;
  /**
   * 载荷模式：'uniaxial'（默认，底面全固支 + 顶面 uz 位移——数字孪生压溃口径）
   * | 'hydrostatic'（全边界仿射 u = −ε·(x−R/2)，KUBC 解析精确口径——门禁 27 锚点）。
   */
  loadMode?: 'uniaxial' | 'hydrostatic';
  /**
   * 切线口径：'elastic'（默认，纯弹性 Ke，SPD 保证 → Jacobi-CG 鲁棒，修正牛顿线性收敛）
   * | 'geo'（弹性 + 几何刚度，捕获受压屈曲软化）
   * | 'consistent'（再加秩一塑性切线，二次收敛但压缩软化段可失去 SPD 性，CG 可能崩坏）。
   * 残差恒含几何（初始应力）内力项——各口径下平衡方程均为真实 StVK 平衡。
   */
  tangent?: 'elastic' | 'geo' | 'consistent';
}

export interface PlasticityStepContext {
  step: number;
  strain: number;
  reaction: number;             // 顶面反力（压缩为正）
  peeq: Float32Array;           // R³ 逐单元平均 PEEQ
  cauchyVM: Float32Array;       // R³ 逐单元最大 GP von Mises（PK2 口径）
  strainTensor: Float32Array;   // R³×6 逐单元平均 Green-Lagrange 应变
  active: Uint8Array;           // 可变：写 0 即「杀死」单元（后续步退出刚度）
  converged: boolean;
}

export interface PlasticityStepResult {
  strain: number;
  reaction: number;
  maxVM: number;
  maxPEEQ: number;
  avgPEEQ: number;
  energy: { wExt: number; wInt: number; wEl: number; wPl: number; drift: number };
  iterations: number;
  converged: boolean;
  deactivated: number;
}

export interface PlasticityResult {
  R: number;
  solidVoxels: number;
  activeVoxels: number;
  nu: number;
  sigmaY: number;
  hardening: number;
  steps: PlasticityStepResult[];
  peeq: Float32Array;
  vonMises: Float32Array;
  cauchy: Float32Array;
  allConverged: boolean;
  elapsedMs: number;
}

/** 8 节点六面体弹性单元核 24×24（E=1, ν；∫BᵀCB dV 含 |J|=1/8） */
export function buildElasticKe(nu: number): Float64Array {
  const { lambda, mu } = lameFromNu(nu);
  const KE = new Float64Array(24 * 24);
  const gp = [-GP1, GP1];
  const B = new Float64Array(6 * 24);
  const dV = 1 / 8;
  for (const gxi of gp) for (const gyi of gp) for (const gzi of gp) {
    fillB(B, gxi, gyi, gzi);
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      let s0 = 0;
      for (let p = 0; p < 6; p++) {
        const bp = B[p * 24 + i];
        if (bp === 0) continue;
        for (let q = 0; q < 6; q++) {
          let cc: number;
          if (p === q) cc = p < 3 ? lambda + 2 * mu : mu;
          else if (p < 3 && q < 3) cc = lambda;
          else cc = 0;
          s0 += bp * cc * B[q * 24 + j];
        }
      }
      KE[i * 24 + j] += s0 * dV;
    }
  }
  return KE;
}

/** 填充 6×24 线性应变算子 B（参考构型单位体素，行序 ε11,ε22,ε33,γ12,γ23,γ13）
 *  dN/dx = (ξa/4)(1+ηη)(1+ζζ)：N=(1/8)∏(1+ξξa)，∂/∂x = 2·∂/∂ξ ⇒ ξa/8·2 = ξa/4 */
function fillB(B: Float64Array, gxi: number, gyi: number, gzi: number): void {
  B.fill(0);
  for (let a = 0; a < 8; a++) {
    const xi = NODE_XI[a][0], eta = NODE_XI[a][1], zeta = NODE_XI[a][2];
    const dNx = 0.25 * xi * (1 + gyi * eta) * (1 + gzi * zeta);
    const dNy = 0.25 * eta * (1 + gxi * xi) * (1 + gzi * zeta);
    const dNz = 0.25 * zeta * (1 + gxi * xi) * (1 + gyi * eta);
    const i0 = a * 3;
    B[0 * 24 + i0] = dNx;
    B[1 * 24 + i0 + 1] = dNy;
    B[2 * 24 + i0 + 2] = dNz;
    B[3 * 24 + i0] = dNy;         // γ12 对 ux：∂u/∂y
    B[3 * 24 + i0 + 1] = dNx;     // γ12 对 uy：∂v/∂x
    B[4 * 24 + i0 + 1] = dNz;     // γ23 对 uy：∂v/∂z
    B[4 * 24 + i0 + 2] = dNy;     // γ23 对 uz：∂w/∂y
    B[5 * 24 + i0] = dNz;         // γ13 对 ux：∂u/∂z
    B[5 * 24 + i0 + 2] = dNx;     // γ13 对 uz：∂w/∂x
  }
}

/** 求解全流程：位移步进 → 修正牛顿 → 径向返回 → 能量台账 */
export function solvePlasticityCompression(params: PlasticityParams): PlasticityResult {
  const t0 = performance.now();
  const R = params.R;
  const N1 = R + 1;
  const nu = params.nu ?? 0.3;
  const sigmaY = params.sigmaY ?? 0.01;
  const hardening = params.hardening ?? 0.05;
  const nSteps = params.steps ?? 8;
  const maxStrain = params.maxStrain ?? 0.05;
  const tol = params.tol ?? 1e-6;
  const maxIter = params.maxIter ?? 40;
  const pcgTol = params.pcgTol ?? 1e-6;
  const pcgMaxIter = params.pcgMaxIter ?? 3000;
  const tangentMode = params.tangent ?? 'geo';
  const lame = lameFromNu(nu);

  const solid = params.solid;
  const active = params.active ?? new Uint8Array(R * R * R).fill(1);
  if (active.length !== R * R * R) throw new Error('active 掩码长度必须为 R³');

  const elems: number[] = [];
  for (let i = 0; i < R * R * R; i++) if (solid[i]) elems.push(i);
  if (elems.length === 0) throw new Error('弹塑性求解：固相体素为空');
  const nSolid = elems.length;

  // 连通性守卫（与 micro-fea 同口径）：固相 6 连通触及网格边界（K 非奇异前提）
  {
    const seen = new Uint8Array(R * R * R);
    const queue = new Int32Array(R * R * R);
    let head = 0, tail = 0;
    const push = (v: number) => { if (!seen[v] && solid[v]) { seen[v] = 1; queue[tail++] = v; } };
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      if (ix === 0 || ix === R - 1 || iy === 0 || iy === R - 1 || iz === 0 || iz === R - 1) push(ix + iy * R + iz * R * R);
    }
    while (head < tail) {
      const v = queue[head++];
      const vx = v % R, vy = ((v / R) | 0) % R, vz = (v / (R * R)) | 0;
      if (vx > 0) push(v - 1);
      if (vx < R - 1) push(v + 1);
      if (vy > 0) push(v - R);
      if (vy < R - 1) push(v + R);
      if (vz > 0) push(v - R * R);
      if (vz < R - 1) push(v + R * R);
    }
    let island = 0;
    for (let i = 0; i < R * R * R; i++) if (solid[i] && !seen[i]) island++;
    if (island > 0) throw new Error('弹塑性求解：固相含 ' + island + ' 个孤立体素（K 奇异）');
  }

  const nNodes = N1 * N1 * N1;
  const nDof = nNodes * 3;
  const nodeIdx = (x: number, y: number, z: number) => x + y * N1 + z * N1 * N1;

  const loadMode = params.loadMode ?? 'uniaxial';
  const isBottom = new Uint8Array(nNodes);
  const isTop = new Uint8Array(nNodes);
  // prescribed DOF 表：u_pre(dof) = −s·off（s 为当前应变标量）
  const isPrescribed = new Uint8Array(nDof);
  const prescDof: number[] = [];
  const prescOff: number[] = [];
  for (let iy = 0; iy < N1; iy++) for (let ix = 0; ix < N1; ix++) {
    isBottom[nodeIdx(ix, iy, 0)] = 1;
    isTop[nodeIdx(ix, iy, R)] = 1;
  }
  if (loadMode === 'uniaxial') {
    for (let nd = 0; nd < nNodes; nd++) {
      if (isBottom[nd]) for (let d = 0; d < 3; d++) { isPrescribed[nd * 3 + d] = 1; prescDof.push(nd * 3 + d); prescOff.push(0); }
      else if (isTop[nd]) { isPrescribed[nd * 3 + 2] = 1; prescDof.push(nd * 3 + 2); prescOff.push(R); }
    }
  } else {
    // hydrostatic：全部边界面仿射（中心对称）
    for (let iz = 0; iz < N1; iz++) for (let iy = 0; iy < N1; iy++) for (let ix = 0; ix < N1; ix++) {
      if (ix !== 0 && ix !== R && iy !== 0 && iy !== R && iz !== 0 && iz !== R) continue;
      const nd = nodeIdx(ix, iy, iz);
      for (let d = 0; d < 3; d++) { isPrescribed[nd * 3 + d] = 1; prescDof.push(nd * 3 + d); prescOff.push([ix, iy, iz][d] - R / 2); }
    }
  }
  /** 把 prescribed 位移按当前应变 s 施加到 U */
  function applyPrescribed(Uarr: Float64Array, sNow: number): void {
    for (let i = 0; i < prescDof.length; i++) Uarr[prescDof[i]] = -sNow * prescOff[i];
  }

  const Ke = buildElasticKe(nu);

  // 单元节点表
  const elemNodes = new Int32Array(nSolid * 8);
  for (let s = 0; s < nSolid; s++) {
    const vi = elems[s];
    const iz = (vi / (R * R)) | 0, iy = ((vi % (R * R)) / R) | 0, ix = vi % R;
    const ns = [nodeIdx(ix, iy, iz), nodeIdx(ix + 1, iy, iz), nodeIdx(ix + 1, iy + 1, iz), nodeIdx(ix, iy + 1, iz),
      nodeIdx(ix, iy, iz + 1), nodeIdx(ix + 1, iy, iz + 1), nodeIdx(ix + 1, iy + 1, iz + 1), nodeIdx(ix, iy + 1, iz + 1)];
    for (let a = 0; a < 8; a++) elemNodes[s * 8 + a] = ns[a];
  }

  // 8 个 Gauss 点的 6×24 B 算子（预计算，唯一几何真源）
  const Bg = new Float64Array(8 * 6 * 24);
  for (let g = 0; g < 8; g++) {
    const gxi = (g & 1) ? GP1 : -GP1;
    const gyi = (g & 2) ? GP1 : -GP1;
    const gzi = (g & 4) ? GP1 : -GP1;
    fillB(Bg.subarray(g * 6 * 24, (g + 1) * 6 * 24) as Float64Array, gxi, gyi, gzi);
  }

  // GP 状态（已提交）：E、Ep、PEEQ、流动应力
  const Egp = new Float64Array(nSolid * 8 * 6);
  const EgpOld = new Float64Array(nSolid * 8 * 6);
  const Epgp = new Float64Array(nSolid * 8 * 6);
  const EpgpTrial = new Float64Array(nSolid * 8 * 6);
  const PEEQgp = new Float64Array(nSolid * 8);
  const PEEQgpTrial = new Float64Array(nSolid * 8);
  const Sgp = new Float64Array(nSolid * 8 * 6);
  const yieldNow = new Float64Array(nSolid * 8);
  // 一致弹塑性切线的秩一项：w = C_el·m（m = ∂σv/∂S）， yielded GP 才参与修正
  const tanW = new Float64Array(nSolid * 8 * 6);
  const tanYield = new Float64Array(nSolid * 8);

  /** 内力组装：从已提交状态对总应变做本构试探（NR 幂等），写 Sgp/yieldNow/试验状态 */
  function internalForce(U: Float64Array, out: Float64Array): void {
    out.fill(0, 0, nDof);
    const epOld6 = new Array(6).fill(0);
    for (let s = 0; s < nSolid; s++) {
      if (!active[elems[s]]) continue;
      const nbase = s * 8;
      for (let g = 0; g < 8; g++) {
        // F = I + Σ u_a ⊗ ∇N_a（∇N 自 B 矩阵行提取：B[p·24+i0+d] 即 ∂Nd/∂xp）
        let f11 = 1, f12 = 0, f13 = 0, f21 = 0, f22 = 1, f23 = 0, f31 = 0, f32 = 0, f33 = 1;
        const goff = g * 6 * 24;
        for (let a = 0; a < 8; a++) {
          const nd = elemNodes[nbase + a];
          const ux = U[nd * 3], uy = U[nd * 3 + 1], uz = U[nd * 3 + 2];
          const i0 = a * 3;
          f11 += ux * Bg[goff + 0 * 24 + i0]; f12 += ux * Bg[goff + 3 * 24 + i0]; f13 += ux * Bg[goff + 5 * 24 + i0];
          f21 += uy * Bg[goff + 3 * 24 + i0 + 1]; f22 += uy * Bg[goff + 1 * 24 + i0 + 1]; f23 += uy * Bg[goff + 4 * 24 + i0 + 1];
          f31 += uz * Bg[goff + 5 * 24 + i0 + 2]; f32 += uz * Bg[goff + 4 * 24 + i0 + 2]; f33 += uz * Bg[goff + 2 * 24 + i0 + 2];
        }
        // C = FᵀF → E（Voigt 工程剪切）
        const c11 = f11 * f11 + f21 * f21 + f31 * f31;
        const c22 = f12 * f12 + f22 * f22 + f32 * f32;
        const c33 = f13 * f13 + f23 * f23 + f33 * f33;
        const c12 = f11 * f12 + f21 * f22 + f31 * f32;
        const c23 = f12 * f13 + f22 * f23 + f32 * f33;
        const c13 = f11 * f13 + f21 * f23 + f31 * f33;
        const ev = [0.5 * (c11 - 1), 0.5 * (c22 - 1), 0.5 * (c33 - 1), c12, c23, c13];
        const iGP = s * 8 + g;
        const gi = iGP * 6;
        for (let k = 0; k < 6; k++) Egp[gi + k] = ev[k];
        for (let k = 0; k < 6; k++) epOld6[k] = Epgp[gi + k];
        const rr = radialReturn(ev, epOld6, PEEQgp[iGP], lame, sigmaY, hardening);
        yieldNow[iGP] = rr.yieldStress;
        for (let k = 0; k < 6; k++) {
          Sgp[gi + k] = rr.stress[k];
          EpgpTrial[gi + k] = rr.epPlastic[k];
        }
        PEEQgpTrial[iGP] = rr.peeq;
        // 一致切线秩一项：dS = C_el·dε − w·(wᵀdε)/(3μ+H)，m = ∂σv/∂S（Voigt 工程剪切）
        if (rr.dPeek > 0) {
          tanYield[iGP] = 1;
          const S = rr.stress;
          const vm = vonMisesVoigt(S);
          const m0 = (2 * S[0] - S[1] - S[2]) / (2 * vm);
          const m1 = (2 * S[1] - S[0] - S[2]) / (2 * vm);
          const m2 = (2 * S[2] - S[0] - S[1]) / (2 * vm);
          const m3 = 3 * S[3] / vm, m4 = 3 * S[4] / vm, m5 = 3 * S[5] / vm;
          const mtr = m0 + m1 + m2;
          tanW[gi] = lame.lambda * mtr + 2 * lame.mu * m0;
          tanW[gi + 1] = lame.lambda * mtr + 2 * lame.mu * m1;
          tanW[gi + 2] = lame.lambda * mtr + 2 * lame.mu * m2;
          tanW[gi + 3] = lame.mu * m3;
          tanW[gi + 4] = lame.mu * m4;
          tanW[gi + 5] = lame.mu * m5;
        } else {
          tanYield[iGP] = 0;
        }
        // f_int^e = ∫BᵀS dV = Σ_g Bᵀ·S·(1/8)
        for (let i = 0; i < 24; i++) {
          const v = Bg[goff + 0 * 24 + i] * rr.stress[0]
            + Bg[goff + 1 * 24 + i] * rr.stress[1]
            + Bg[goff + 2 * 24 + i] * rr.stress[2]
            + Bg[goff + 3 * 24 + i] * rr.stress[3]
            + Bg[goff + 4 * 24 + i] * rr.stress[4]
            + Bg[goff + 5 * 24 + i] * rr.stress[5];
          if (v !== 0) out[elemNodes[nbase + (i - (i % 3)) / 3] * 3 + (i % 3)] += v / 8;
        }
        // 几何（初始应力）内力项：∫(∇u·S)·∇N_a dV —— TL 公式 B_NL 部分，
        // 缺失则平衡方程非真实 StVK 平衡（2026-08-28 定案）
        const S0 = rr.stress[0], S1 = rr.stress[1], S2 = rr.stress[2], S3s = rr.stress[3], S4s = rr.stress[4], S5s = rr.stress[5];
        const u11 = f11 - 1, u22 = f22 - 1, u33 = f33 - 1, u12x = f12, u21x = f21, u13x = f13, u31x = f31, u23x = f23, u32x = f32;
        const H11 = S0 * u11 + S3s * u21x + S5s * u31x;
        const H12 = S0 * u12x + S3s * u22 + S5s * u32x;
        const H13 = S0 * u13x + S3s * u23x + S5s * u33;
        const H21 = S3s * u11 + S1 * u21x + S4s * u31x;
        const H22 = S3s * u12x + S1 * u22 + S4s * u32x;
        const H23 = S3s * u13x + S1 * u23x + S4s * u33;
        const H31 = S5s * u11 + S4s * u21x + S2 * u31x;
        const H32 = S5s * u12x + S4s * u22 + S2 * u32x;
        const H33 = S5s * u13x + S4s * u23x + S2 * u33;
        for (let a = 0; a < 8; a++) {
          const i0 = a * 3;
          const dNx = Bg[goff + 0 * 24 + i0], dNy = Bg[goff + 1 * 24 + i0 + 1], dNz = Bg[goff + 2 * 24 + i0 + 2];
          const nd2 = elemNodes[nbase + a];
          out[nd2 * 3] += (H11 * dNx + H12 * dNy + H13 * dNz) / 8;
          out[nd2 * 3 + 1] += (H21 * dNx + H22 * dNy + H23 * dNz) / 8;
          out[nd2 * 3 + 2] += (H31 * dNx + H32 * dNy + H33 * dNz) / 8;
        }
      }
    }
  }

  /** 弹塑性切线 mat-vec（无矩阵）：Ke 弹性核 + 已屈服 GP 的秩一修正（一致切线） */
  const eu = new Float64Array(24);
  const kv = new Float64Array(24);
  const deV = new Float64Array(6);
  const geoG = new Float64Array(24);
  function matVecFree(x: Float64Array, y: Float64Array): void {
    y.fill(0, 0, nDof);
    for (let s = 0; s < nSolid; s++) {
      if (!active[elems[s]]) continue;
      const base = s * 8;
      for (let a = 0; a < 8; a++) {
        const nd = elemNodes[base + a];
        eu[a * 3] = x[nd * 3]; eu[a * 3 + 1] = x[nd * 3 + 1]; eu[a * 3 + 2] = x[nd * 3 + 2];
      }
      for (let i = 0; i < 24; i++) {
        const row = i * 24;
        let s0 = 0;
        for (let j = 0; j < 24; j++) s0 += Ke[row + j] * eu[j];
        kv[i] = s0;
      }
      // 已屈服 GP 的秩一一致切线修正：−Bᵀ·[w·(wᵀ·B·eu)/(3μ+H)]·dV（仅 consistent 口径）
      let anyYield = false;
      if (tangentMode === 'consistent') {
        for (let g = 0; g < 8; g++) if (tanYield[s * 8 + g]) { anyYield = true; break; }
      }if (anyYield) {
        for (let g = 0; g < 8; g++) {
          if (!tanYield[s * 8 + g]) continue;
          const gi = (s * 8 + g) * 6;
          const Bg0 = g * 6 * 24;
          deV[0] = deV[1] = deV[2] = deV[3] = deV[4] = deV[5] = 0;
          for (let i = 0; i < 24; i++) {
            const bi = eu[i];
            if (bi === 0) continue;
            deV[0] += Bg[Bg0 + i] * bi;
            deV[1] += Bg[Bg0 + 24 + i] * bi;
            deV[2] += Bg[Bg0 + 48 + i] * bi;
            deV[3] += Bg[Bg0 + 72 + i] * bi;
            deV[4] += Bg[Bg0 + 96 + i] * bi;
            deV[5] += Bg[Bg0 + 120 + i] * bi;
          }
          const wde = tanW[gi] * deV[0] + tanW[gi + 1] * deV[1] + tanW[gi + 2] * deV[2]
            + tanW[gi + 3] * deV[3] + tanW[gi + 4] * deV[4] + tanW[gi + 5] * deV[5];
          const cScale = -wde / (3 * lame.mu + hardening) / 8;
          const se0 = cScale * tanW[gi], se1 = cScale * tanW[gi + 1], se2 = cScale * tanW[gi + 2],
            se3 = cScale * tanW[gi + 3], se4 = cScale * tanW[gi + 4], se5 = cScale * tanW[gi + 5];
          for (let i = 0; i < 24; i++) {
            kv[i] -= (Bg[Bg0 + i] * se0 + Bg[Bg0 + 24 + i] * se1 + Bg[Bg0 + 48 + i] * se2
              + Bg[Bg0 + 72 + i] * se3 + Bg[Bg0 + 96 + i] * se4 + Bg[Bg0 + 120 + i] * se5);
          }
        }
      }
      // 几何刚度 mat-vec：y_a += Σ_b (G_a·∇N_b)·v_b（geo/consistent 口径启用；
      // 纯 elastic 口径不含屈曲软化，交由残差侧几何项 + 弹性切线收敛兜底）
      if (tangentMode !== 'elastic') {
        const G = geoG;
        for (let g = 0; g < 8; g++) {
          const gi = (s * 8 + g) * 6;
          const Bg0 = g * 6 * 24;
          const S0 = Sgp[gi], S1 = Sgp[gi + 1], S2 = Sgp[gi + 2], S3s = Sgp[gi + 3], S4s = Sgp[gi + 4], S5s = Sgp[gi + 5];
          for (let a = 0; a < 8; a++) {
            const i0 = a * 3;
            const dNx = Bg[Bg0 + 0 * 24 + i0], dNy = Bg[Bg0 + 1 * 24 + i0 + 1], dNz = Bg[Bg0 + 2 * 24 + i0 + 2];
            G[a * 3] = S0 * dNx + S3s * dNy + S5s * dNz;
            G[a * 3 + 1] = S3s * dNx + S1 * dNy + S4s * dNz;
            G[a * 3 + 2] = S5s * dNx + S4s * dNy + S2 * dNz;
          }
          for (let a = 0; a < 8; a++) {
            const gx = G[a * 3], gy = G[a * 3 + 1], gz = G[a * 3 + 2];
            if (gx === 0 && gy === 0 && gz === 0) continue;
            for (let b = 0; b < 8; b++) {
              const i0 = b * 3;
              const c = gx * Bg[Bg0 + 0 * 24 + i0] + gy * Bg[Bg0 + 1 * 24 + i0 + 1] + gz * Bg[Bg0 + 2 * 24 + i0 + 2];
              const nd2 = elemNodes[base + b];
              kv[b * 3] += c * x[nd2 * 3];
              kv[b * 3 + 1] += c * x[nd2 * 3 + 1];
              kv[b * 3 + 2] += c * x[nd2 * 3 + 2];
            }
          }
        }
      }
      for (let a = 0; a < 8; a++) {
        const nd = elemNodes[base + a];
        y[nd * 3] += kv[a * 3];
        y[nd * 3 + 1] += kv[a * 3 + 1];
        y[nd * 3 + 2] += kv[a * 3 + 2];
      }
    }
  }

  // Jacobi 对角（active 单元连缀计数 × Ke 对角均值 / 8）
  const diag = new Float64Array(nDof);
  let keDiagAvg = 0;
  for (let i = 0; i < 24; i++) keDiagAvg += Ke[i * 24 + i];
  keDiagAvg /= 24;
  function refreshDiag(): void {
    const cnt = new Int32Array(nNodes);
    for (let s = 0; s < nSolid; s++) {
      if (!active[elems[s]]) continue;
      for (let a = 0; a < 8; a++) cnt[elemNodes[s * 8 + a]]++;
    }
    for (let nd = 0; nd < nNodes; nd++) {
      const d = (cnt[nd] * keDiagAvg) / 8 || 1;
      diag[nd * 3] = d; diag[nd * 3 + 1] = d; diag[nd * 3 + 2] = d;
    }
  }
  refreshDiag();

  // PCG 工作区（预分配）
  const pcgB = new Float64Array(nDof);
  const pcgR = new Float64Array(nDof);
  const pcgZ = new Float64Array(nDof);
  const pcgP = new Float64Array(nDof);
  const pcgAp = new Float64Array(nDof);

  /** prescribed 行清零——保持 CG 迭代向量落在 K_ff 子空间 */
  function zeroPrescribed(v: Float64Array): void {
    for (let i = 0; i < prescDof.length; i++) v[prescDof[i]] = 0;
  }

  /** PCG：K_ff·du = −r_f（bottom 全固定、top uz 给定位移，其余自由；tolOverride 供非精确牛顿） */
  function solveIncrement(r: Float64Array, out: Float64Array, tolOverride?: number): number {
    const tolPcg = tolOverride ?? pcgTol;
    let bNorm = 0;
    pcgB.fill(0, 0, nDof);
    for (let nd = 0; nd < nNodes; nd++) {
      for (let d = 0; d < 3; d++) {
        const i = nd * 3 + d;
        const free = !isPrescribed[nd * 3 + d];
        if (free) { pcgB[i] = -r[i]; bNorm += pcgB[i] * pcgB[i]; }
      }
    }
    bNorm = Math.sqrt(bNorm);
    if (bNorm < 1e-30) return 0;
    out.fill(0, 0, nDof);
    pcgR.set(pcgB);
    for (let i = 0; i < nDof; i++) pcgZ[i] = pcgR[i] / (diag[i] || 1);
    pcgP.set(pcgZ);
    let rz = 0;
    for (let i = 0; i < nDof; i++) rz += pcgR[i] * pcgZ[i];
    let iter = 0;
    for (; iter < pcgMaxIter; iter++) {
      matVecFree(pcgP, pcgAp);
      zeroPrescribed(pcgAp);   // 关键：防 prescribed 行污染 r→z→p（否则算子非对称，残差指数增长）
      let pAp = 0;
      for (let i = 0; i < nDof; i++) pAp += pcgP[i] * pcgAp[i];
      if (!(pAp > 1e-300)) break;
      const alpha = rz / pAp;
      let rr2 = 0, rzN = 0;
      for (let i = 0; i < nDof; i++) {
        out[i] += alpha * pcgP[i];
        pcgR[i] -= alpha * pcgAp[i];
        rr2 += pcgR[i] * pcgR[i];
      }
      if (Math.sqrt(rr2) / bNorm < tolPcg) { iter++; break; }
      for (let i = 0; i < nDof; i++) pcgZ[i] = pcgR[i] / (diag[i] || 1);
      for (let i = 0; i < nDof; i++) rzN += pcgR[i] * pcgZ[i];
      const beta = rzN / rz;
      for (let i = 0; i < nDof; i++) pcgP[i] = pcgZ[i] + beta * pcgP[i];
      rz = rzN;
    }
    // prescribed 行在 PCG 全程保持 0（pcgB/pcgP 均以 0 起），无需回写；
    // 此处绝不可清 top 的 ux/uy——它们是自由行（曾在此整体清零导致 du≡0，2026-08-28 实录）
    return iter;
  }

  /** 自由行残差范数 */
  function freeResidualNorm(f: Float64Array): number {
    let n = 0;
    for (let i = 0; i < nDof; i++) {
      if (isPrescribed[i]) continue;
      n += f[i] * f[i];
    }
    return Math.sqrt(n);
  }

  const U = new Float64Array(nDof);
  const Utrial = new Float64Array(nDof);
  const UprevSub = new Float64Array(nDof);
  const fint = new Float64Array(nDof);
  const du = new Float64Array(nDof);
  const results: PlasticityStepResult[] = [];
  let wExt = 0, wInt = 0, wPl = 0;
  let allConverged = true;
  let totalDeactivated = 0;

  const peeqField = new Float32Array(R * R * R);
  const vmField = new Float32Array(R * R * R);
  const strainField = new Float32Array(R * R * R * 6);

  function topReaction(): number {
    let f = 0;
    for (let nd = 0; nd < nNodes; nd++) if (isTop[nd]) f += fint[nd * 3 + 2];
    return -f;
  }

  /** 载荷量级（NR 收敛阈的归一化尺度） */
  function reactionMagnitude(): number {
    if (loadMode === 'uniaxial') return Math.abs(topReaction());
    let n = 0;
    for (let i = 0; i < prescDof.length; i++) n += fint[prescDof[i]] * fint[prescDof[i]];
    return Math.sqrt(n);
  }

  function refreshElementFields(): void {
    peeqField.fill(0); vmField.fill(0);
    for (let s = 0; s < nSolid; s++) {
      const vi = elems[s];
      if (!active[vi]) continue;
      let peeqAvg = 0, vmMax = 0;
      for (let g = 0; g < 8; g++) {
        peeqAvg += PEEQgpTrial[s * 8 + g];
        const gi = (s * 8 + g) * 6;
        vmMax = Math.max(vmMax, vonMisesVoigt([Sgp[gi], Sgp[gi + 1], Sgp[gi + 2], Sgp[gi + 3], Sgp[gi + 4], Sgp[gi + 5]]));
      }
      peeqField[vi] = peeqAvg / 8;
      vmField[vi] = vmMax;
      const gi6 = s * 8 * 6;
      for (let k = 0; k < 6; k++) {
        let avg = 0;
        for (let g = 0; g < 8; g++) avg += Egp[gi6 + g * 6 + k];
        strainField[vi * 6 + k] = avg / 8;
      }
    }
  }

  function countActive(): number {
    let n = 0;
    for (let i = 0; i < R * R * R; i++) if (solid[i] && active[i]) n++;
    return n;
  }

  /** 单次修正牛顿（到给定应变 sGoal）：弹性/几何切线 + 最优 α 线搜索；失败时 U 保持可继续迭代 */
  function runNR(sGoal: number): { converged: boolean; iterations: number } {
    for (let iter = 0; iter < maxIter; iter++) {
      Utrial.set(U);
      applyPrescribed(Utrial, sGoal);
      internalForce(Utrial, fint);
      const rNorm0 = freeResidualNorm(fint);
      if (!Number.isFinite(rNorm0)) return { converged: false, iterations: iter + 1 };
      const fScale = Math.max(reactionMagnitude(), 1e-12);
      if (rNorm0 <= tol * fScale) { U.set(Utrial); return { converged: true, iterations: iter + 1 }; }
      // 非精确牛顿：PCG 容差随残差收缩（早期松、后期紧），砍掉无效迭代
      const pcgT = Math.min(1e-2, Math.max(pcgTol, 0.01 * rNorm0 / fScale));
      solveIncrement(fint, du, pcgT);
      // 回溯线搜索：α ∈ {1, 1/2, 1/4} 取残差最小者；无改善则判失败（上层回退子步）
      let bestAlpha = 0, bestNorm = rNorm0;
      for (let ls = 0; ls < 4; ls++) {
        const alpha = 0.5 ** ls;
        Utrial.set(U);
        for (let i = 0; i < nDof; i++) Utrial[i] += alpha * du[i];
        applyPrescribed(Utrial, sGoal);
        internalForce(Utrial, fint);
        const rn = freeResidualNorm(fint);
        if (rn < bestNorm * (1 - 1e-4)) { bestNorm = rn; bestAlpha = alpha; }
      }
      if (bestAlpha === 0) return { converged: false, iterations: iter + 1 };
      Utrial.set(U);
      for (let i = 0; i < nDof; i++) Utrial[i] += bestAlpha * du[i];
      applyPrescribed(Utrial, sGoal);
      U.set(Utrial);
    }
    return { converged: false, iterations: maxIter };
  }

  /** 累计一个已收敛子步的能量台账（虚功方向导数口径：与收敛步 f·Δu 机器精度恒等） */
  function accumulateEnergy(peeqOldSub: Float64Array): void {
    // W_ext = Σ_presc f_int·Δu，Δu 取实测（U − UprevSub）——回退/往返子步恒成立
    let dWextSub = 0;
    if (loadMode === 'uniaxial') {
      for (let nd = 0; nd < nNodes; nd++) if (isTop[nd]) dWextSub += fint[nd * 3 + 2] * (U[nd * 3 + 2] - UprevSub[nd * 3 + 2]);
    } else {
      for (let i = 0; i < prescDof.length; i++) dWextSub += fint[prescDof[i]] * (U[prescDof[i]] - UprevSub[prescDof[i]]);
    }
    stepWextAcc += dWextSub;
    for (let s = 0; s < nSolid; s++) {
      if (!active[elems[s]]) continue;
      const nbase = s * 8;
      for (let g = 0; g < 8; g++) {
        const goff = g * 6 * 24;
        // F(u_i) 与 dF(Δu)（Δu = U − UprevSub）
        let f11 = 1, f12 = 0, f13 = 0, f21 = 0, f22 = 1, f23 = 0, f31 = 0, f32 = 0, f33 = 1;
        let d11 = 0, d12 = 0, d13 = 0, d21 = 0, d22 = 0, d23 = 0, d31 = 0, d32 = 0, d33 = 0;
        for (let a = 0; a < 8; a++) {
          const nd = elemNodes[nbase + a];
          const i0 = a * 3;
          const ux = U[nd * 3], uy = U[nd * 3 + 1], uz = U[nd * 3 + 2];
          const wx = U[nd * 3] - UprevSub[nd * 3], wy = U[nd * 3 + 1] - UprevSub[nd * 3 + 1], wz = U[nd * 3 + 2] - UprevSub[nd * 3 + 2];
          const b0 = Bg[goff + 0 * 24 + i0], b1 = Bg[goff + 1 * 24 + i0 + 1], b2 = Bg[goff + 2 * 24 + i0 + 2];
          const b01 = Bg[goff + 3 * 24 + i0], b10 = Bg[goff + 3 * 24 + i0 + 1];
          const b12 = Bg[goff + 4 * 24 + i0 + 1], b21 = Bg[goff + 4 * 24 + i0 + 2];
          const b02 = Bg[goff + 5 * 24 + i0], b20 = Bg[goff + 5 * 24 + i0 + 2];
          f11 += ux * b0; f12 += ux * b01; f13 += ux * b02;
          f21 += uy * b10; f22 += uy * b1; f23 += uy * b12;
          f31 += uz * b20; f32 += uz * b21; f33 += uz * b2;
          d11 += wx * b0; d12 += wx * b01; d13 += wx * b02;
          d21 += wy * b10; d22 += wy * b1; d23 += wy * b12;
          d31 += wz * b20; d32 += wz * b21; d33 += wz * b2;
        }
        // dE = sym(Fᵀ·dF)（Voigt 工程剪切）
        const c11 = f11 * d11 + f21 * d21 + f31 * d31;
        const c22 = f12 * d12 + f22 * d22 + f32 * d32;
        const c33 = f13 * d13 + f23 * d23 + f33 * d33;
        const c12 = f11 * d12 + f21 * d22 + f31 * d32;
        const c21 = f12 * d11 + f22 * d21 + f32 * d31;
        const c23 = f12 * d13 + f22 * d23 + f32 * d33;
        const c32 = f13 * d12 + f23 * d22 + f33 * d32;
        const c13 = f11 * d13 + f21 * d23 + f31 * d33;
        const c31 = f13 * d11 + f23 * d21 + f33 * d31;
        const iGP = s * 8 + g;
        const gi = iGP * 6;
        const dev0 = 0.5 * (c11 + c11), dev1 = 0.5 * (c22 + c22), dev2 = 0.5 * (c33 + c33);
        const dev3 = c12 + c21, dev4 = c23 + c32, dev5 = c13 + c31;
        stepWintAcc += (Sgp[gi] * dev0 + Sgp[gi + 1] * dev1 + Sgp[gi + 2] * dev2
          + Sgp[gi + 3] * dev3 + Sgp[gi + 4] * dev4 + Sgp[gi + 5] * dev5) / 8;
        const dpeeq = PEEQgp[iGP] - peeqOldSub[iGP];
        if (dpeeq > 0) stepWplAcc += (yieldNow[iGP] - hardening * dpeeq / 2) * dpeeq / 8;
      }
    }
  }

  let stepWextAcc = 0, stepWintAcc = 0, stepWplAcc = 0;
  let fracCarry = 1;

  for (let step = 1; step <= nSteps; step++) {
    const strain = (step / nSteps) * maxStrain;
    const strainPrev = ((step - 1) / nSteps) * maxStrain;
    const totalDs = strain - strainPrev;
    void strain;

    // 手风琴子步：NR 失败即减半重试，成功后步长恢复（上限 6 次回退）
    let frac = fracCarry;          // 跨步记忆：上一步回退过的步长不盲目恢复满步长
    let sApplied = strainPrev;
    stepWextAcc = 0; stepWintAcc = 0; stepWplAcc = 0;
    let iterTotal = 0;
    let stepConverged = false;
    for (let safety = 0; safety < 60; safety++) {
      const sGoal = sApplied + totalDs * frac;
      UprevSub.set(U);
      EgpOld.set(Egp);
      const peeqOldSub = PEEQgp.slice();
      const nr = runNR(sGoal);
      iterTotal += nr.iterations;
      if (nr.converged) {
        Epgp.set(EpgpTrial);
        PEEQgp.set(PEEQgpTrial);
        accumulateEnergy(peeqOldSub);
        (globalThis as any).__plasSubDbg?.(`sub s=${sGoal.toExponential(3)} wExtAcc=${stepWextAcc.toExponential(4)} wIntAcc=${stepWintAcc.toExponential(4)} freeR=${freeResidualNorm(fint).toExponential(3)}`);
        sApplied = sGoal;
        frac = Math.min(1, frac * 2);
        fracCarry = frac;
        if (Math.abs(sApplied - strain) <= 1e-12 * Math.max(maxStrain, 1e-12)) { stepConverged = true; break; }
      } else {
        // 回滚到子步起点：失败尝试的半路 U 不得污染重试轨迹（塑性已提交态不受影响）
        U.set(UprevSub);
        frac /= 2;
        fracCarry = frac;
        if (frac < 1 / 256) break;
      }
    }
    // 步长施加到位（数值容差）即认为整步收敛
    if (Math.abs(sApplied - strain) <= 1e-12 * Math.max(maxStrain, 1e-12)) stepConverged = true;
    if (!stepConverged) allConverged = false;
    wExt += stepWextAcc;
    wInt += stepWintAcc;
    wPl += stepWplAcc;
    const reaction = topReaction();
    const converged = stepConverged;

    refreshElementFields();
    let deactivated = 0;
    if (params.onStep) {
      const nBefore = countActive();
      params.onStep({ step, strain, reaction, peeq: peeqField, cauchyVM: vmField, strainTensor: strainField, active, converged });
      deactivated = nBefore - countActive();
      totalDeactivated += deactivated;
      if (deactivated > 0) refreshDiag();
    }

    const drift = Math.abs(wExt) > 1e-30 ? Math.abs(wExt - wInt) / Math.abs(wExt) : 0;
    let maxVM = 0, maxPEEQ = 0, peeqSum = 0, peeqCount = 0;
    for (let i = 0; i < R * R * R; i++) {
      if (!solid[i] || !active[i]) continue;
      maxVM = Math.max(maxVM, vmField[i]);
      maxPEEQ = Math.max(maxPEEQ, peeqField[i]);
      peeqSum += peeqField[i];
      peeqCount++;
    }
    results.push({
      strain,
      reaction,
      maxVM,
      maxPEEQ,
      avgPEEQ: peeqCount > 0 ? peeqSum / peeqCount : 0,
      energy: { wExt, wInt, wEl: wInt - wPl, wPl, drift },
      iterations: iterTotal,
      converged,
      deactivated,
    });
  }

  // 终态 Cauchy 应力（push-forward σ = (1/J)·F·S·Fᵀ，逐 GP → 单元平均）
  const cauchy = new Float32Array(R * R * R * 6);
  for (let s = 0; s < nSolid; s++) {
    const vi = elems[s];
    if (!active[vi]) continue;
    const acc = new Float64Array(6);
    for (let g = 0; g < 8; g++) {
      let f11 = 1, f12 = 0, f13 = 0, f21 = 0, f22 = 1, f23 = 0, f31 = 0, f32 = 0, f33 = 1;
      const Bm = g * 6 * 24;
      for (let a = 0; a < 8; a++) {
        const nd = elemNodes[s * 8 + a];
        const ux = U[nd * 3], uy = U[nd * 3 + 1], uz = U[nd * 3 + 2];
        const i0 = a * 3;
        f11 += ux * Bg[Bm + 0 * 24 + i0]; f12 += ux * Bg[Bm + 3 * 24 + i0]; f13 += ux * Bg[Bm + 5 * 24 + i0];
        f21 += uy * Bg[Bm + 3 * 24 + i0 + 1]; f22 += uy * Bg[Bm + 1 * 24 + i0 + 1]; f23 += uy * Bg[Bm + 4 * 24 + i0 + 1];
        f31 += uz * Bg[Bm + 5 * 24 + i0 + 2]; f32 += uz * Bg[Bm + 4 * 24 + i0 + 2]; f33 += uz * Bg[Bm + 2 * 24 + i0 + 2];
      }
      const J = f11 * (f22 * f33 - f23 * f32) - f12 * (f21 * f33 - f23 * f31) + f13 * (f21 * f32 - f22 * f31);
      const gi = (s * 8 + g) * 6;
      const S0 = Sgp[gi], S1 = Sgp[gi + 1], S2 = Sgp[gi + 2], S3 = Sgp[gi + 3], S4 = Sgp[gi + 4], S5 = Sgp[gi + 5];
      // F·S（对称 S）
      const m11 = f11 * S0 + f12 * S3 + f13 * S5, m12 = f11 * S3 + f12 * S1 + f13 * S4, m13 = f11 * S5 + f12 * S4 + f13 * S2;
      const m21 = f21 * S0 + f22 * S3 + f23 * S5, m22 = f21 * S3 + f22 * S1 + f23 * S4, m23 = f21 * S5 + f22 * S4 + f23 * S2;
      const m31 = f31 * S0 + f32 * S3 + f33 * S5, m32 = f31 * S3 + f32 * S1 + f33 * S4, m33 = f31 * S5 + f32 * S4 + f33 * S2;
      acc[0] += (f11 * m11 + f12 * m21 + f13 * m31) / J;
      acc[1] += (f21 * m12 + f22 * m22 + f23 * m32) / J;
      acc[2] += (f31 * m13 + f32 * m23 + f33 * m33) / J;
      acc[3] += (f11 * m12 + f12 * m22 + f13 * m32) / J;
      acc[4] += (f21 * m13 + f22 * m23 + f23 * m33) / J;
      acc[5] += (f11 * m13 + f12 * m23 + f13 * m33) / J;
    }
    for (let k = 0; k < 6; k++) cauchy[vi * 6 + k] = acc[k] / 8;
  }

  return {
    R,
    solidVoxels: nSolid,
    activeVoxels: countActive(),
    nu, sigmaY, hardening,
    steps: results,
    peeq: peeqField,
    vonMises: vmField,
    cauchy,
    allConverged,
    elapsedMs: performance.now() - t0,
  };
}
