/**
 * 组织长入反应-扩散动力学引擎（v7.0 Stage IV）
 *
 * 模拟多孔骨支架植入后 0~28 天的氧气输运、成骨细胞增殖迁移与新生骨矿化沉积。
 *
 * 【控制方程】（使命公式口径）
 *   氧气（对流-反应-扩散）：∂C/∂t + v·∇C = D∇²C − Vmax·C/(Km+C)·ρ_cell
 *   细胞（Logistic 增殖 + 低氧 Heaviside 门控）：
 *     ∂ρ/∂t = D_cell∇²ρ + r·ρ(1 − ρ/ρmax)·H(C − C_hyp)
 *   骨矿化累积：∂m/∂t = r_bone·ρ·H(C − C_min)
 *
 * 【算子分裂定案】（时间尺度分离的工程正确解法，文档化于 WORKFLOW_GUIDE §34）
 *   真实氧气扩散时间 τ = L²/D ≈ 0.05 day ≪ 细胞增殖时间（28 day）——氧气场处于
 *   准静态流形。每日步：先解准稳态扩散-消耗（Jacobi 迭代至收敛），再以 dt = 1 day
 *   显式更新细胞（D_cell 取工程小值满足 dt ≤ h²/6D_cell 稳定性）与矿化累积。
 *   对流项 v·∇C 保留接口（velocity 回调 + 一阶迎风），默认 v = 0（静态培养口径）。
 *
 * 【边界条件】支架外表面流体体素 C = C0（well-perfused 周围组织，Dirichlet）；
 *   细胞仅存在于流体体素；矿化沉积于流体体素（骨基质填充孔隙）。
 *
 * 【诚实边界】单尺度连续介质近似（无细胞个体/血管生成动力学）；氧参数为文献
 *   带工程估算（mm-day 单位制）；矿化-几何增厚经由 isoShift 接口交付上层。
 */

export interface TissueParams {
  /** 体素分辨率/轴（建议 24~32） */
  R: number;
  /** 固相掩码 R³（1 = 支架固相；流体 = 孔隙） */
  solid: Uint8Array;
  /** 模拟天数（默认 28） */
  days?: number;
  /** 氧扩散系数（mm²/day；水中 O2 ~1.7e2，组织内工程取 ~40） */
  DO2?: number;
  /** 边界氧浓度（无量纲化 ~1 = 空气饱和） */
  C0?: number;
  /** 最大氧消耗速率（1/day，按 ρ = ρmax 归一） */
  Vmax?: number;
  /** Michaelis 常数（与 C 同单位） */
  Km?: number;
  /** 细胞扩散系数（mm²/day，工程小值） */
  Dcell?: number;
  /** 细胞增殖率（1/day，成骨细胞 ~0.3-0.7） */
  rGrow?: number;
  /** 最大细胞密度（归一化 1） */
  rhoMax?: number;
  /** 低氧阈值 H(C − C_hyp) */
  Chyp?: number;
  /** 骨矿化率（1/day） */
  rBone?: number;
  /** 矿化最低氧阈值 */
  Cmin?: number;
  /** 准稳态 Jacobi 扫描数/天（默认 220） */
  sweepsPerDay?: number;
  /** 快照间隔（天，默认 1） */
  snapshotEvery?: number;
  /** 对流速场回调（归一化坐标 −1..1 → 速度向量；默认 0） */
  velocity?: (x: number, y: number, z: number) => [number, number, number];
}

export interface TissueDayStat {
  day: number;
  meanO2: number;        // 流体域平均氧（C0 归一）
  viability: number;     // 细胞存活率 = Σρ·H(C>C_hyp)/Σρ
  necrosisPct: number;   // 低氧坏死区体积占比（C < C_hyp 的流体体素）
  mineralPct: number;    // 矿化体积占比（m > 0.5 的流体体素）
}

export interface TissueResult {
  R: number;
  /** 氧浓度快照（按 snapshotEvery 抽帧，流体域外为 NaN → 0） */
  o2Frames: Float32Array[];
  /** 细胞密度快照（同帧对齐） */
  cellFrames: Float32Array[];
  /** 矿化密度快照（同帧对齐） */
  mineralFrames: Float32Array[];
  /** 帧对应天 */
  frameDays: number[];
  stats: TissueDayStat[];
  /** 终态质量守恒残差：|流入 − 消耗|/max(流入, ε) */
  massBalance: number;
  /** 核心区（|x|,|y|,|z| < 0.33）终态平均氧 */
  meanO2Core: number;
  /** 表层（r > 0.7）终态平均氧 */
  meanO2Shell: number;
  fluidFraction: number;
  elapsedMs: number;
}

const DEFAULTS = {
  days: 28,
  DO2: 40,       // mm²/day（工程口径）
  C0: 1,
  Vmax: 500,     // 1/day（按氧穿透深度 L_pen=√(2·D·C0/Vmax)≈0.4mm 定标——文献带 200~500µm）
  Km: 0.12,
  Dcell: 0.0002,  // mm²/day（细胞迁移；稳定性 dt ≤ h²/6D ⇒ 0.0002 @R=24）
  rGrow: 0.55,
  rhoMax: 1,
  Chyp: 0.28,
  rBone: 0.09,
  Cmin: 0.18,
  sweepsPerDay: 220,
  snapshotEvery: 2,
};

export function simulateTissueGrowth(params: TissueParams): TissueResult {
  const t0 = Date.now();
  const R = params.R;
  const solid = params.solid;
  if (solid.length !== R * R * R) throw new Error(`solid 掩码长度 ${solid.length} ≠ R³ = ${R * R * R}`);
  const P = { ...DEFAULTS, ...params } as Required<Omit<TissueParams, 'solid' | 'R' | 'velocity'>>;
  const h = 2 / R;                      // 归一化坐标步长（域 [−1,1]）
  const h2 = h * h;
  const n = R * R * R;
  const days = P.days;
  const vel = params.velocity ?? null;

  const fluid = new Uint8Array(n);
  let fluidCount = 0;
  for (let i = 0; i < n; i++) if (!solid[i]) { fluid[i] = 1; fluidCount++; }
  if (fluidCount === 0) throw new Error('流体域为空：掩码全为固相');

  /** 外表面流体体素（well-perfused Dirichlet 边界） */
  const isBoundaryFluid = (ix: number, iy: number, iz: number): boolean =>
    ix === 0 || iy === 0 || iz === 0 || ix === R - 1 || iy === R - 1 || iz === R - 1;

  // ── 状态场 ──
  const C = new Float64Array(n);
  const rho = new Float64Array(n);
  const mineral = new Float64Array(n);
  const Cn = new Float64Array(n);
  const rhoN = new Float64Array(n);

  // 初始：全流体域均匀接种（体外灌流培养/体内骨髓腔接种口径）。
  // 定案教训：首版仅表层接种——细胞迁移长度 √(2Dt) ≈ 0.1mm ≪ 域尺寸，内部
  // 永远无细胞 → 氧消耗只发生在表层，核心氧无分化信号（门禁 B 假边缘通过）。
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const i = ix + iy * R + iz * R * R;
    if (!fluid[i]) continue;
    C[i] = P.C0;
    rho[i] = 0.15 * P.rhoMax;
  }

  const o2Frames: Float32Array[] = [];
  const cellFrames: Float32Array[] = [];
  const mineralFrames: Float32Array[] = [];
  const frameDays: number[] = [];
  const stats: TissueDayStat[] = [];

  const pushFrame = (day: number): void => {
    const fo = new Float32Array(n);
    const fc = new Float32Array(n);
    const fm = new Float32Array(n);
    fo.set(C); fc.set(rho); fm.set(mineral);
    o2Frames.push(fo); cellFrames.push(fc); mineralFrames.push(fm);
    frameDays.push(day);
  };

  /** 逐日统计 */
  const computeStats = (day: number): TissueDayStat => {
    let sumC = 0, sumRho = 0, sumRhoAlive = 0, necroVol = 0, mineralVol = 0, fluidVol = 0;
    for (let i = 0; i < n; i++) {
      if (!fluid[i]) continue;
      fluidVol++;
      sumC += C[i];
      if (C[i] < P.Chyp) necroVol++;
      sumRho += rho[i];
      if (C[i] > P.Chyp) sumRhoAlive += rho[i];
      if (mineral[i] > 0.5 * P.rhoMax) mineralVol++;
    }
    return {
      day,
      meanO2: sumC / fluidVol,
      viability: sumRho > 1e-12 ? sumRhoAlive / sumRho : 1,
      necrosisPct: (necroVol / fluidVol) * 100,
      mineralPct: (mineralVol / fluidVol) * 100,
    };
  };

  /** 准稳态扩散-消耗：∇²C = Vmax·ρ·C/((Km+C)·D) 的 7 点 Jacobi 定点迭代。
   *  定案教训：首版写成「C + (D/h²)·lap − r」的杂交格式（有效扩散数 6 ≫ 稳定域）
   *  指数爆 NaN——准稳态解的正确迭代 = C_new = (Σ6邻居 − h²·src(C_old))/6，
   *  src = 消耗/D，固相邻居镜像（无渗漏边界条件）。 */
  const solveQuasiStatic = (sweeps: number): void => {
    for (let it = 0; it < sweeps; it++) {
      let maxDelta = 0;
      for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
        const i = ix + iy * R + iz * R * R;
        if (!fluid[i]) { Cn[i] = 0; continue; }
        if (isBoundaryFluid(ix, iy, iz)) { Cn[i] = P.C0; continue; }
        // 无渗漏：固相/域外邻居镜像自身
        const xm = fluid[i - 1] ? C[i - 1] : C[i];
        const xp = fluid[i + 1] ? C[i + 1] : C[i];
        const ym = fluid[i - R] ? C[i - R] : C[i];
        const yp = fluid[i + R] ? C[i + R] : C[i];
        const zm = fluid[i - R * R] ? C[i - R * R] : C[i];
        const zp = fluid[i + R * R] ? C[i + R * R] : C[i];
        const nb = xm + xp + ym + yp + zm + zp;
        // Michaelis-Menten 源项（显式，源/扩散比受 h²·Vmax/(D·Km) 约束 ≪ 6）
        const src = (P.Vmax * (rho[i] / P.rhoMax) * C[i] / (P.Km + C[i])) / P.DO2;
        let next = (nb - h2 * src) / 6;
        // 迎风对流（默认 v=0 时为零贡献；系数 0.5 为工程迎风权重）
        if (vel) {
          const [vx, vy, vz] = vel((ix / (R - 1)) * 2 - 1, (iy / (R - 1)) * 2 - 1, (iz / (R - 1)) * 2 - 1);
          const upx = vx > 0 ? C[fluid[i - 1] ? i - 1 : i] : C[fluid[i + 1] ? i + 1 : i];
          const upy = vy > 0 ? C[fluid[i - R] ? i - R : i] : C[fluid[i + R] ? i + R : i];
          const upz = vz > 0 ? C[fluid[i - R * R] ? i - R * R : i] : C[fluid[i + R * R] ? i + R * R : i];
          next -= (vx * (C[i] - upx) + vy * (C[i] - upy) + vz * (C[i] - upz)) * 0.5;
        }
        Cn[i] = Math.max(0, next);
        const d = Math.abs(Cn[i] - C[i]);
        if (d > maxDelta) maxDelta = d;
      }
      C.set(Cn);
      if (maxDelta < 1e-8 * P.C0) break;
    }
  };

  /** 质量守恒核算：边界层→内部面通量 vs 总消耗（终态）。
   *  定案：Dirichlet C0 固定在边界流体层上，穿入通量发生在「边界层与其内部
   *  流体邻居」之间（首版对域外面积分得零通量 → 残差 2e15% 假红）。 */
  const massBalanceResidual = (): number => {
    let fluxIn = 0;
    const isB = (ix: number, iy: number, iz: number): boolean =>
      ix === 0 || iy === 0 || iz === 0 || ix === R - 1 || iy === R - 1 || iz === R - 1;
    let consumptionInterior = 0;
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      const i = ix + iy * R + iz * R * R;
      if (!fluid[i]) continue;
      if (isB(ix, iy, iz)) {
        // 边界流体层：向内部流体邻居的流出通量（外部供给由 Dirichlet 面隐式承载）
        const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (const [dx, dy, dz] of faces) {
          const nx = ix + dx, ny = iy + dy, nz = iz + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= R || ny >= R || nz >= R) continue;
          const ni = nx + ny * R + nz * R * R;
          if (!fluid[ni] || isB(nx, ny, nz)) continue;
          fluxIn += P.DO2 * (C[i] - C[ni]) * h;
        }
        continue;
      }
      consumptionInterior += (P.Vmax * (rho[i] / P.rhoMax) * C[i] / (P.Km + C[i])) * h2 * h;
    }
    // 守恒口径：边界层→内部面通量 应等于 内部域消耗（边界层自身消耗由 Dirichlet
    // 面直接供养，不在此通量内——首版与全域消耗比较混入边界层份额 → 40% 假残差）
    return Math.abs(fluxIn - consumptionInterior) / Math.max(fluxIn, 1e-12);
  };

  pushFrame(0);
  stats.push(computeStats(0));

  // ── 时间推进：每日 = 准稳态氧 → 细胞显式步 → 矿化累积 ──
  const dtCell = 1;   // 1 day
  for (let day = 1; day <= days; day++) {
    solveQuasiStatic(P.sweepsPerDay);

    // 细胞：Logistic 增殖（低氧门控）+ 扩散（显式，稳定性 dt ≤ h²/6D_cell）
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      const i = ix + iy * R + iz * R * R;
      if (!fluid[i]) { rhoN[i] = 0; continue; }
      const xm = fluid[i - 1] ? rho[i - 1] : rho[i];
      const xp = fluid[i + 1] ? rho[i + 1] : rho[i];
      const ym = fluid[i - R] ? rho[i - R] : rho[i];
      const yp = fluid[i + R] ? rho[i + R] : rho[i];
      const zm = fluid[i - R * R] ? rho[i - R * R] : rho[i];
      const zp = fluid[i + R * R] ? rho[i + R * R] : rho[i];
      const lap = (xm + xp + ym + yp + zm + zp - 6 * rho[i]) / h2;
      const H = C[i] > P.Chyp ? 1 : 0;
      const growth = P.rGrow * rho[i] * (1 - rho[i] / P.rhoMax) * H;
      rhoN[i] = Math.min(P.rhoMax, Math.max(0, rho[i] + dtCell * (P.Dcell * lap + growth)));
    }
    rho.set(rhoN);

    // 矿化累积（低氧区停止矿化）
    for (let i = 0; i < n; i++) {
      if (!fluid[i]) continue;
      if (C[i] > P.Cmin) mineral[i] += P.rBone * (rho[i] / P.rhoMax) * dtCell * (C[i] > P.Chyp ? 1 : 0.25);
    }

    stats.push(computeStats(day));
    if (day % P.snapshotEvery === 0 || day === days) pushFrame(day);
  }

  // 终态自洽：最后一次细胞更新改变了 ρ，重解准稳态氧再核算守恒
  solveQuasiStatic(P.sweepsPerDay);

  // 核心区 vs 表层氧（孔隙输运能力的度量）
  let coreSum = 0, coreN = 0, shellSum = 0, shellN = 0;
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const i = ix + iy * R + iz * R * R;
    if (!fluid[i]) continue;
    const x = (ix / (R - 1)) * 2 - 1, y = (iy / (R - 1)) * 2 - 1, z = (iz / (R - 1)) * 2 - 1;
    const r2 = x * x + y * y + z * z;
    if (r2 < 0.33) { coreSum += C[i]; coreN++; }
    if (r2 > 1.4) { shellSum += C[i]; shellN++; }
  }

  return {
    R,
    o2Frames,
    cellFrames,
    mineralFrames,
    frameDays,
    stats,
    massBalance: massBalanceResidual(),
    meanO2Core: coreN ? coreSum / coreN : 0,
    meanO2Shell: shellN ? shellSum / shellN : 0,
    fluidFraction: fluidCount / n,
    elapsedMs: Date.now() - t0,
  };
}
