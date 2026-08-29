/**
 * Bloch-Floquet 声子晶体能带色散与隔振禁带求解器（v7.0 Stage III）
 *
 * 【模型口径】Born–von Kármán 点阵动力学（质量-弹簧网络）：
 *  - 单胞离散为 N³ 体素质点（仅固相体素携带质量 m = ρs·h³），
 *    26 邻域轴向弹簧（6 面 + 12 棱 + 8 角，等刚度 κ，能量 ½κ·stretch²）；
 *  - Bloch 周期条件 u(x+a) = u(x)·e^{ik·a}：跨胞边界的弹簧携带相位 e^{ik·T·L}，
 *    组装波矢相关 Hermitian 复刚度 K(k)（3N_s 复 DOF）；
 *  - 实化技巧：Hermitian H = A + iB ↔ 实对称 [[A,−B],[B,A]]（特征值成对复制），
 *    全程实数运算，无需复特征值求解器；
 *  - 广义特征问题 K(k)φ = ω²Mφ，M = m·I（集中质量）⇒ 标准特征问题 A = K/m；
 *    子空间迭代（simultaneous iteration + 两趟 Gram-Schmidt 重正交 +
 *    Rayleigh-Ritz Jacobi 小特征分解）求最低 numBands 阶。
 *
 * 【物理定案（门禁 34 守护）】
 *  - Γ 点零模态 = 3 平动（实化后 6 个零 Ritz 值）。物理定案：转动场 u = ω×r
 *    非周期（u(r+L) ≠ u(r)），在 Born–von Kármán PBC 下不是容许 Bloch 模态——
 *    「自由漂浮 6 刚体模态」口径不适用于能带问题（探针 ‖K·u_rot‖ ≠ 0 反证）；
 *  - 声速自洽：κ 用仿射均质化标定（C1111_affine = E*，E* = 0.3·E0·ρ̄² 与
 *    gibson-ashby 同源）⇒ 目标棒波速 c = sqrt(E-star / ρ_eff)；点阵动力学长波
 *    精确性 ⇒ Γ→X 声学支实测斜率应与 c 一致（门禁断言）；
 *  - 支序定案：Γ 点 6 零模态 = 3 平动 + 3 转动；随 k 离开 Γ，3 平动演化声学支
 *    （k ∥ x 时支 2（0 起）为纵波 LA——ω_LA > ω_TA），3 转动演化为光学支；
 *  - 禁带：沿不可约布里渊区路径 Γ-X-M-R-Γ 的「路径禁带」（全向禁带需全 BZ
 *    采样，如实标注），识别器 findBandgaps 为纯函数，门禁用双原子链解析谱锚定。
 *
 * 【诚实边界】弹簧网络是 TPMS 弹性动力学的集总参数近似（非全弹性波 FEM），
 * 光学支定量精度受点阵模型限制；禁带为路径口径；材料阻尼未计。
 */

// ── 类型 ──

export interface PhononicParams {
  /** 单胞体素数/轴（N³ 质点；建议 5~8，UI 用 6） */
  N: number;
  /** 固相掩码 N³（1 = 固相体素质点） */
  solid: Uint8Array;
  /** 基体密度 ρs（kg/m³，默认 TC4 4430） */
  rhoS?: number;
  /** 基体模量 E0（Pa，默认 TC4 110e9） */
  matrixEPa?: number;
  /** 单胞物理尺寸（m；1 period = 1 mm ⇒ 默认 1e-3） */
  cellSizeM?: number;
  /** 求解能带数（≥7，默认 12：6 刚体/声学 + 光学） */
  numBands?: number;
  /** 每段路径 k 点数（含端点，默认 5） */
  kPointsPerSeg?: number;
  /** Lanczos 步数上限（每轮，默认 150） */
  maxIter?: number;
  /** 审计用：覆盖高对称路径（如 ω(k)=ω(−k) 对称性检验） */
  kPathOverride?: [number, number, number][];
}

export interface KPoint {
  label: string;
  /** 波矢（rad/m） */
  kx: number; ky: number; kz: number;
}

export interface BandgapInfo {
  /** 禁带下缘/上缘角频率（rad/s） */
  lower: number;
  upper: number;
  /** 相对禁带宽度 BG% = 2(ωu−ωl)/(ωu+ωl) */
  bgPct: number;
  /** 位于第 between[0] 与 between[1] 支之间（0 起） */
  between: [number, number];
}

export interface PhononicResult {
  /** 高对称路径（Γ-X-M-R-Γ） */
  path: KPoint[];
  /** 累计路径坐标（能带图 x 轴） */
  pathX: number[];
  /** 高对称点刻度：pathX 索引 + 标签（Γ-X-M-R-Γ） */
  ticks: { index: number; label: string; x: number }[];
  /** bands[bandIdx][kIdx] = ω（rad/s），升序 */
  bands: number[][];
  /** 路径禁带（lower 升序） */
  bandgaps: BandgapInfo[];
  /** Γ 点物理零频模态数（PBC 口径 = 3 平动声学支；实化 Ritz 零值数 ÷2） */
  zeroModesAtGamma: number;
  /** 标定目标棒波速 sqrt(E·/ρ_eff)（m/s） */
  cTargetMs: number;
  /** 实测长波纵声学支斜率（Γ→X 前两点拟合，m/s） */
  cMeasuredMs: number;
  /** 相对密度（= 固相体素占比） */
  relativeDensity: number;
  /** 固相体素占比（relativeDensity 别名，UI 兼容） */
  solidFraction: number;
  /** Gibson-Ashby 有效模量（Pa，C1=0.3） */
  eStarPa: number;
  /** 各 k 点子空间迭代轮数（诊断） */
  iterationsUsed: number[];
  elapsedMs: number;
}

/** 禁带识别（纯函数）：相邻支在整条路径上 max(ω_i) < min(ω_{i+1}) 即为路径禁带 */
export function findBandgaps(bands: number[][]): BandgapInfo[] {
  const nb = bands.length;
  const gaps: BandgapInfo[] = [];
  for (let i = 0; i + 1 < nb; i++) {
    let loMax = -Infinity;
    let hiMin = Infinity;
    for (let kk = 0; kk < bands[i].length; kk++) {
      if (bands[i][kk] > loMax) loMax = bands[i][kk];
      if (bands[i + 1][kk] < hiMin) hiMin = bands[i + 1][kk];
    }
    if (hiMin > loMax) {
      gaps.push({
        lower: loMax,
        upper: hiMin,
        bgPct: 2 * (hiMin - loMax) / (hiMin + loMax) * 100,
        between: [i, i + 1],
      });
    }
  }
  return gaps;
}

// ── 26 邻域半空间（每键只记录一次，避免重复弹簧）──
const OFFSETS: [number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
  if (dx === 0 && dy === 0 && dz === 0) continue;
  if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) OFFSETS.push([dx, dy, dz]);
}

interface Bond {
  si: number; sj: number;
  dx: number; dy: number; dz: number;   // 原始偏移（标定用）
  nx: number; ny: number; nz: number;   // 键方向（Gershgorin 界用）
  bxx: number; bxy: number; bxz: number; byy: number; byz: number; bzz: number;  // n̂n̂ᵀ
  tx: number; ty: number; tz: number;   // 跨胞平移（整数胞单位，Bloch 相位）
}

/** Jacobi 特征分解（对称稠密；返回升序特征值；withVec 时同时输出特征向量列） */
function jacobiEig(T: Float64Array, n: number, withVec = false): { values: number[]; vectors: Float64Array | null } {
  const a = new Float64Array(T);
  const v = withVec ? new Float64Array(n * n) : null;
  if (v) for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i * n + j] * a[i * n + j];
    if (off < 1e-28) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p], akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k], aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        if (v) {
          for (let k = 0; k < n; k++) {
            const vkp = v[k * n + p], vkq = v[k * n + q];
            v[k * n + p] = c * vkp - s * vkq;
            v[k * n + q] = s * vkp + c * vkq;
          }
        }
      }
    }
  }
  const ev: number[] = [];
  for (let i = 0; i < n; i++) ev.push(a[i * n + i]);
  const order = ev.map((x, i) => [x, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const values = order.map((o) => o[0]);
  let vectors: Float64Array | null = null;
  if (v) {
    vectors = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      const src = order[j][1];
      for (let r = 0; r < n; r++) vectors[r * n + j] = v[r * n + src];
    }
  }
  return { values, vectors };
}

/** 单 k 点对频谱（审计用）：返回 [+k, −k] 两个 k 点的物理支角频率，
 *  供时间反演对称 ω(k) = ω(−k) 断言（Hermitian K(k) 的数学性质）。 */
export function solveKPair(params: PhononicParams, k: [number, number, number]): { plus: number[]; minus: number[] } {
  const res = solvePhononicBands({
    ...params,
    kPointsPerSeg: 3,
    kPathOverride: [k, [-k[0], -k[1], -k[2]]],
  });
  return { plus: res.bands.map((b) => b[0]), minus: res.bands.map((b) => b[1]) };
}

/** 求解能带结构主入口 */
export function solvePhononicBands(params: PhononicParams): PhononicResult {
  const t0 = Date.now();
  const N = params.N;
  const solid = params.solid;
  if (solid.length !== N * N * N) throw new Error(`solid 掩码长度 ${solid.length} ≠ N³ = ${N * N * N}`);
  const rhoS = params.rhoS ?? 4430;
  const E0 = params.matrixEPa ?? 110e9;
  const L = params.cellSizeM ?? 1e-3;
  const h = L / N;
  const numBands = Math.max(7, params.numBands ?? 12);
  const kPerSeg = Math.max(3, params.kPointsPerSeg ?? 5);

  // 固相质点列表
  const solidIdx: number[] = [];
  for (let i = 0; i < solid.length; i++) if (solid[i]) solidIdx.push(i);
  const nS = solidIdx.length;
  if (nS < 8) throw new Error('固相质点过少（<8），无法形成有效点阵');
  const cellToSi = new Int32Array(solid.length).fill(-1);
  for (let s = 0; s < nS; s++) cellToSi[solidIdx[s]] = s;

  // 弹簧网络（26 邻域半空间）
  const bonds: Bond[] = [];
  for (let s = 0; s < nS; s++) {
    const ci = solidIdx[s];
    const ix = ci % N, iy = Math.floor(ci / N) % N, iz = Math.floor(ci / (N * N));
    for (const [dx, dy, dz] of OFFSETS) {
      const jx = ix + dx, jy = iy + dy, jz = iz + dz;
      const qx = ((jx % N) + N) % N, qy = ((jy % N) + N) % N, qz = ((jz % N) + N) % N;
      if (!solid[qx + qy * N + qz * N * N]) continue;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = dx / d, ny = dy / d, nz = dz / d;
      bonds.push({
        si: s, sj: cellToSi[qx + qy * N + qz * N * N],
        dx, dy, dz,
        nx, ny, nz,
        bxx: nx * nx, bxy: nx * ny, bxz: nx * nz, byy: ny * ny, byz: ny * nz, bzz: nz * nz,
        tx: jx < 0 ? -1 : jx >= N ? 1 : 0,
        ty: jy < 0 ? -1 : jy >= N ? 1 : 0,
        tz: jz < 0 ? -1 : jz >= N ? 1 : 0,
      });
    }
  }
  if (bonds.length < nS) throw new Error('弹簧网络退化：键数少于质点数（结构不连通或过稀疏）');

  // Gibson-Ashby 有效模量 + 长波动力矩阵精确反演标定 κ
  // 定案（实测裁决）：仿射 C1111 = (κ/V)Σ|Δr|²n̂x⁴ ≠ 长波声速 —— 中心力网络的
  // 非仿射弛豫使真实长波模量低于仿射值（实测 c_meas/c_affine = 0.53，与 26 键
  // 立方点阵解析比 sqrt(0.972/3.333) = 0.54 吻合）。改用精确反演：
  //   ω_LA²(k→0, k∥x) = κ·h²·k²·S_x/(2·m·N³)，S_x = Σ_bonds dx⁴/d2²·(dx²+dy²+dz²)…
  //   逐键推导：平面波拉伸 = (e·n̂)(e^{iqΔ}−1)，势能 = ½κΣ(e·n̂)²4sin²(qΔ/2)，
  //   小极限 ω²_LA = κ·h²·k²·S_x/(m·N³)，S_x = Σ_bonds dx⁴/d2（d2 = dx²+dy²+dz²）
  //   ⇒ κ = c_target²·m·N³/(h²·S_x)。定案教训：首版推导误带因子 2，实测斜率
  //   恰为 √2 × 目标（3810 vs 2729）反推修正——门禁斜率断言押注整条链。
  const relativeDensity = nS / (N * N * N);
  const eStarPa = 0.3 * E0 * relativeDensity * relativeDensity;
  const rhoEff = rhoS * relativeDensity;
  const cTarget = Math.sqrt(eStarPa / rhoEff);
  let sumX4 = 0;
  for (const b of bonds) {
    const d2 = b.dx * b.dx + b.dy * b.dy + b.dz * b.dz;
    sumX4 += (b.dx * b.dx * b.dx * b.dx) / d2;
  }
  if (!(sumX4 > 0)) throw new Error('长波标定退化：网络无 x 向承载键');
  const mass = rhoS * h * h * h;
  const kappa = (cTarget * cTarget * mass * N * N * N) / (h * h * sumX4);
  const mInv = 1 / (rhoS * h * h * h);
  const nDof = 6 * nS;

  /** A = K(k)/m 的 matvec（实化 Hermitian；列向量布局由调用方切片） */
  const makeMatvec = (kx: number, ky: number, kz: number) => {
    const cph = new Float64Array(bonds.length);
    const sph = new Float64Array(bonds.length);
    for (let bi = 0; bi < bonds.length; bi++) {
      const b = bonds[bi];
      const phi = (kx * b.tx + ky * b.ty + kz * b.tz) * L;
      cph[bi] = Math.cos(phi);
      sph[bi] = Math.sin(phi);
    }
    return (x: Float64Array, y: Float64Array): void => {
      y.fill(0);
      for (let bi = 0; bi < bonds.length; bi++) {
        const b = bonds[bi];
        const i0 = 6 * b.si, j0 = 6 * b.sj;
        const c = cph[bi], s = sph[bi];
        // i←j：Z = −κB·e^{iφ}；复乘 e^{iφ}·(xr+i xi) = (c·xr − s·xi) + i(c·xi + s·xr)
        const xrj = x[j0], yrj = x[j0 + 1], zrj = x[j0 + 2];
        const xij = x[j0 + 3], yij = x[j0 + 4], zij = x[j0 + 5];
        const w1r = c * xrj - s * xij, w1i = c * xij + s * xrj;
        const w2r = c * yrj - s * yij, w2i = c * yij + s * yrj;
        const w3r = c * zrj - s * zij, w3i = c * zij + s * zrj;
        y[i0]     -= b.bxx * w1r + b.bxy * w2r + b.bxz * w3r;
        y[i0 + 1] -= b.bxy * w1r + b.byy * w2r + b.byz * w3r;
        y[i0 + 2] -= b.bxz * w1r + b.byz * w2r + b.bzz * w3r;
        y[i0 + 3] -= b.bxx * w1i + b.bxy * w2i + b.bxz * w3i;
        y[i0 + 4] -= b.bxy * w1i + b.byy * w2i + b.byz * w3i;
        y[i0 + 5] -= b.bxz * w1i + b.byz * w2i + b.bzz * w3i;
        // j←i：共轭 −κB·e^{−iφ}：Re: c·xr + s·xi；Im: c·xi − s·xr
        const xri = x[i0], yri = x[i0 + 1], zri = x[i0 + 2];
        const xii = x[i0 + 3], yii = x[i0 + 4], zii = x[i0 + 5];
        const u1r = c * xri + s * xii, u1i = c * xii - s * xri;
        const u2r = c * yri + s * yii, u2i = c * yii - s * yri;
        const u3r = c * zri + s * zii, u3i = c * zii - s * zri;
        y[j0]     -= b.bxx * u1r + b.bxy * u2r + b.bxz * u3r;
        y[j0 + 1] -= b.bxy * u1r + b.byy * u2r + b.byz * u3r;
        y[j0 + 2] -= b.bxz * u1r + b.byz * u2r + b.bzz * u3r;
        y[j0 + 3] -= b.bxx * u1i + b.bxy * u2i + b.bxz * u3i;
        y[j0 + 4] -= b.bxy * u1i + b.byy * u2i + b.byz * u3i;
        y[j0 + 5] -= b.bxz * u1i + b.byz * u2i + b.bzz * u3i;
      }
      // 对角块 κ·B（Re/Im 同构；本键两端点各加一次）
      for (const b of bonds) {
        for (const o of [6 * b.si, 6 * b.sj]) {
          const xr = x[o], yr = x[o + 1], zr = x[o + 2];
          y[o] += b.bxx * xr + b.bxy * yr + b.bxz * zr;
          y[o + 1] += b.bxy * xr + b.byy * yr + b.byz * zr;
          y[o + 2] += b.bxz * xr + b.byz * yr + b.bzz * zr;
          const xi = x[o + 3], yi = x[o + 4], zi = x[o + 5];
          y[o + 3] += b.bxx * xi + b.bxy * yi + b.bxz * zi;
          y[o + 4] += b.bxy * xi + b.byy * yi + b.byz * zi;
          y[o + 5] += b.bxz * xi + b.byz * yi + b.bzz * zi;
        }
      }
      for (let i = 0; i < nDof; i++) y[i] *= mInv * kappa;
    };
  };

  // ── 两轮 deflate-Lanczos 求单 k 点最低 2×wantPhys 阶（实化谱）──
  // 方法论定案（五轮实测教训，均有探针/稠密对拍证据，详见 WORKFLOW_GUIDE §33）：
  // ① 子空间迭代/幂迭代族直接对 A 迭代收敛到「最大」特征值（Γ 零模态全丢）；
  // ② 移位倒置 B = μI − A 对密集低频谱无加速（θ = μ−λ 全簇贴 μ）；
  // ③ CheFSI 在 λmax 高估窗口下低支放大梯度不足，子空间塌缩跳过真实低阶；
  // ④ 稠密 Cholesky 移位反转子空间迭代对「密集低频簇」收敛比 = 谱自身间距比
  //    （λ27/λ20 ≈ 1.2 → 数百轮），工程不可行；
  // ⑤ 单向量 Lanczos 的 Krylov 空间对每个「不同」特征值只含 1 个方向——实化
  //    配对（×2）与高对称简并丢失。
  // 终案：Lanczos 天然适密集低端（Krylov 对极端谱收敛 ~O(1/√gap)）。run1 得各
  // 不同特征值 + Ritz 向量锁定；run2 在其正交补中得第二副本 ⇒ 实化配对完整。
  // Γ 点的 3 平动零模态由 PBC 解析保证（转动场非周期不容许），解析前置 + 从
  // Lanczos 中 deflate，其余谱段由两轮 Lanczos 完成。
  const solveAtK = (kx: number, ky: number, kz: number): { eigs: number[]; iters: number } => {
    const matvec = makeMatvec(kx, ky, kz);
    const wantPhys = Math.min(numBands, Math.floor(nDof / 2));
    const wantReal = Math.min(2 * wantPhys, nDof);
    const mSteps = Math.min(params.maxIter ?? 150, nDof);

    /** 单轮全重正交 Lanczos；deflate 向量在每次投影中被正交剥离。
     *  返回：Ritz 值（升序）+ 前 nLock 个 Ritz 向量（供下一轮 deflate）。 */
    const lanczosRun = (deflate: Float64Array[]): { values: number[]; lock: Float64Array[]; steps: number } => {
      const Vb: Float64Array[] = [];
      const alpha: number[] = [];
      const beta: number[] = [];
      const v0 = new Float64Array(nDof);
      let s0 = 987654321 + Math.round((kx + ky + kz) * 1e9) + deflate.length * 7919;
      const rnd = () => { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; };
      for (let i = 0; i < nDof; i++) v0[i] = rnd() * 2 - 1;
      // 初始向量 deflate + 归一
      const orthAll = (w: Float64Array): void => {
        for (let pass = 0; pass < 2; pass++) {
          for (const vt of Vb) {
            let dot = 0;
            for (let i = 0; i < nDof; i++) dot += vt[i] * w[i];
            if (dot !== 0) for (let i = 0; i < nDof; i++) w[i] -= dot * vt[i];
          }
          for (const ut of deflate) {
            let dot = 0;
            for (let i = 0; i < nDof; i++) dot += ut[i] * w[i];
            if (dot !== 0) for (let i = 0; i < nDof; i++) w[i] -= dot * ut[i];
          }
        }
      };
      orthAll(v0);
      let nv = 0;
      for (let i = 0; i < nDof; i++) nv += v0[i] * v0[i];
      const n0 = Math.sqrt(nv);
      if (!(n0 > 1e-10)) throw new Error('Lanczos 初始向量退化');
      for (let i = 0; i < nDof; i++) v0[i] /= n0;
      Vb.push(v0);
      let steps = 0;
      for (let j = 0; j < mSteps; j++) {
        steps = j + 1;
        const vj = Vb[j];
        const w = new Float64Array(nDof);
        matvec(vj, w);
        let av = 0;
        for (let i = 0; i < nDof; i++) av += vj[i] * w[i];
        alpha.push(av);
        for (let i = 0; i < nDof; i++) w[i] -= av * vj[i];
        if (j > 0) {
          const b = beta[j - 1];
          const vprev = Vb[j - 1];
          for (let i = 0; i < nDof; i++) w[i] -= b * vprev[i];
        }
        orthAll(w);
        let nn = 0;
        for (let i = 0; i < nDof; i++) nn += w[i] * w[i];
        const bj = Math.sqrt(nn);
        if (bj < 1e-7 * Math.max(1, Math.abs(alpha[0])) || j === mSteps - 1) break;
        beta.push(bj);
        const vn = new Float64Array(nDof);
        for (let i = 0; i < nDof; i++) vn[i] = w[i] / bj;
        Vb.push(vn);
      }
      const mm = alpha.length;
      const T = new Float64Array(mm * mm);
      for (let i = 0; i < mm; i++) T[i * mm + i] = alpha[i];
      for (let i = 0; i + 1 < mm; i++) { T[i * mm + i + 1] = beta[i]; T[(i + 1) * mm + i] = beta[i]; }
      const { values, vectors } = jacobiEig(T, mm, true);
      // Ritz 向量 = V_m · S（前 nLock 列）
      const nLock = Math.min(wantReal, values.length);
      const lock: Float64Array[] = [];
      if (vectors) {
        for (let j = 0; j < nLock; j++) {
          const u = new Float64Array(nDof);
          for (let t = 0; t < mm; t++) {
            const coef = vectors[t * mm + j];
            if (coef === 0) continue;
            const vt = Vb[t];
            for (let r = 0; r < nDof; r++) u[r] += coef * vt[r];
          }
          // 归一（数值卫生）
          let nn = 0;
          for (let r = 0; r < nDof; r++) nn += u[r] * u[r];
          const nrm = Math.sqrt(nn);
          if (nrm > 0) for (let r = 0; r < nDof; r++) u[r] /= nrm;
          lock.push(u);
        }
      }
      return { values, lock, steps };
    };
    // Γ 点（k=0）：解析平移零模态（3 物理 ×2 实化）deflate + 前置
    const atGamma = kx === 0 && ky === 0 && kz === 0;
    const trans: Float64Array[] = [];
    if (atGamma) {
      for (const pass of [0, 1]) {   // pass0: Re 半, pass1: Im 半
        for (let d = 0; d < 3; d++) {
          const t = new Float64Array(nDof);
          for (let s = 0; s < nS; s++) t[6 * s + (pass ? 3 : 0) + d] = 1;
          let nn = 0;
          for (let i = 0; i < nDof; i++) nn += t[i] * t[i];
          for (let i = 0; i < nDof; i++) t[i] /= Math.sqrt(nn);
          trans.push(t);
        }
      }
    }

    const run1 = lanczosRun(atGamma ? trans : []);
    // run1 的值含被 deflate 的零（数值 ~1e-11 残差）——过滤：低于阈值的视为零模态
    let vals1 = run1.values.filter((v) => !(atGamma && v < 1e-6));
    const run2 = lanczosRun([...(atGamma ? trans : []), ...run1.lock]);
    const vals2 = run2.values.filter((v) => !(atGamma && v < 1e-6));
    // 合并实化谱：每个不同值 ×2（run1 + run2 各一次），排序取前 wantReal
    const merged = [...vals1, ...vals2].sort((a, b) => a - b).slice(0, wantReal);
    if (atGamma) {
      // 前置 6 个解析零（3 平动 ×2 实化）
      while (merged.length < wantReal) merged.push(merged.length ? merged[merged.length - 1] : 0);
      const withZeros = [...Array(6).fill(0), ...merged].slice(0, wantReal);
      merged.length = 0;
      merged.push(...withZeros);
    }
    return { eigs: merged, iters: run1.steps + run2.steps };
  };

  // ── 高对称路径 Γ-X-M-R-Γ ──
  let ticks: { index: number; label: string; x: number }[] = [];
  const kMax = Math.PI / L;
  const segs: [string, number, number, number][] = [
    ['Γ', 0, 0, 0], ['X', kMax, 0, 0], ['M', kMax, kMax, 0], ['R', kMax, kMax, kMax], ['Γ', 0, 0, 0],
  ];
  const path: KPoint[] = [];
  const pathX: number[] = [];
  {
    let cum = 0;
    let last: KPoint | null = null;
    for (let sgi = 0; sgi < segs.length - 1; sgi++) {
      const [la, ax, ay, az] = segs[sgi];
      const [, bx, by, bz] = segs[sgi + 1];
      for (let t = 0; t < kPerSeg; t++) {
        if (t === 0 && sgi > 0) continue;
        const f = t / (kPerSeg - 1);
        const kp: KPoint = {
          label: t === 0 ? la : '',
          kx: ax + (bx - ax) * f, ky: ay + (by - ay) * f, kz: az + (bz - az) * f,
        };
        if (last) cum += Math.hypot(kp.kx - last.kx, kp.ky - last.ky, kp.kz - last.kz);
        pathX.push(cum);
        path.push(kp);
        last = kp;
      }
    }
    path[0].label = 'Γ';
    path[pathX.length - 1].label = 'Γ';
  }
  ticks = [0, 1, 2, 3, 4].map((i) => {
    const idx = Math.min(i * (kPerSeg - 1), pathX.length - 1);
    return { index: idx, label: segs[i][0], x: pathX[idx] };
  });
  // 审计路径覆盖（ω(k)=ω(−k) 检验等）
  if (params.kPathOverride && params.kPathOverride.length >= 2) {
    path.length = 0;
    pathX.length = 0;
    ticks = [];
    let cum = 0;
    let last: KPoint | null = null;
    for (const [kx2, ky2, kz2] of params.kPathOverride) {
      const kp: KPoint = { label: '', kx: kx2, ky: ky2, kz: kz2 };
      if (last) cum += Math.hypot(kp.kx - last.kx, kp.ky - last.ky, kp.kz - last.kz);
      pathX.push(cum);
      path.push(kp);
      last = kp;
    }
  }

  // 实化配对展开：实化谱每个复特征值精确出现 2 次（(x,y) 与 (−y,x)），排序后
  // 隔二取一即物理谱（简并物理支保留正确多重度：4 实化副本 → 2 物理支）。
  // 诚实边界：精确对称构型的物理简并若被 Krylov 单方向捕获会少计 1 支
  //（体素化掩码的对称破缺通常已将其劈开）。
  const mergePairs = (eigsReal: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < eigsReal.length && out.length < numBands; i += 2) out.push(eigsReal[i]);
    return out;
  };

  const bands: number[][] = Array.from({ length: numBands }, () => []);
  const iterationsUsed: number[] = [];
  for (const kp of path) {
    const { eigs, iters } = solveAtK(kp.kx, kp.ky, kp.kz);
    iterationsUsed.push(iters);
    const phys = mergePairs(eigs);
    for (let b = 0; b < numBands; b++) {
      const w = b < phys.length ? phys[b] : (phys.length ? phys[phys.length - 1] : 0);
      bands[b].push(Math.sqrt(Math.max(0, w)));
    }
  }

  const bandgaps = findBandgaps(bands);
  // Γ 点零模态：实化口径下每物理模态出现 2 次（Re/Im 配对）。
  // PBC 物理定案：转动场 u = ω×r 非周期（u(r+L) ≠ u(r)），不是容许 Bloch 模态
  // ——刚体零空间 = 3 平动（探针实测 ‖K·u_rot‖ ≠ 0 反证排除），实化后 6 个零 Ritz 值。
  let zeroModes = 0;
  const wRef = Math.max(bands[numBands - 1][0], 1e-30);
  for (let b = 0; b < numBands; b++) if (bands[b][0] < 1e-4 * wRef) zeroModes++;

  // 纵声学支斜率：k ∥ x 时支 2（0 起）为 LA（3 声学支 Γ 简并于 0，ω_LA > ω_TA
  // ⇒ 排序后 LA = 支 2）；Γ→X 前两点割线斜率（与仿射标定目标 c 自洽性由门禁断言）
  const bLA = 2;
  const cMeasured = pathX[2] > pathX[1] ? (bands[bLA][2] - bands[bLA][1]) / (pathX[2] - pathX[1]) : 0;

  return {
    path, pathX, ticks, bands, bandgaps,
    zeroModesAtGamma: zeroModes,
    cTargetMs: cTarget,
    cMeasuredMs: cMeasured,
    solidFraction: relativeDensity,
    relativeDensity,
    eStarPa,
    iterationsUsed,
    elapsedMs: Date.now() - t0,
  };
}
