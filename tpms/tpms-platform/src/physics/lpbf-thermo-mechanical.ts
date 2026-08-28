/**
 * 激光粉末床熔融（LPBF）热-力耦合预测（v6.0 阶段 IV · LPBF Thermo-Mechanical Engine）
 *
 * 热模型：体素网格显式瞬态傅里叶热传导
 *   ρc·∂T/∂t = ∇·(k∇T) + q'''，高斯体热源沿蛇形扫描轨迹移动：
 *   q'''(r) = 2A·P/(π·r0²·d)·exp(−2r²/r0²)（A 吸收率、P 功率、r0 光斑半径、d 层深）
 * 输出：逐格峰值温度、峰值冷却速率 R = |dT/dt|（凝固界面 G×R 口径取扫描线下游梯度×R）、
 *   等效扫描方向温度梯度 G。
 * 力模型（工程估算口径，非热-力全耦合 FEM）：
 *   残余应力 σ_res = min(α·E·ΔT_effective, σ_y)（热收缩受约束、屈服封顶）；
 *   翘曲位移 w ≈ C·α·ΔT_eff·L²/(2·t)（基板切除后单层失衡弯估算，C 为约束系数）。
 * 工艺窗口：能量密度 E_d = P/(v·h·t) vs 键合/球化/未熔合窗口评估。
 *
 * 诚实边界：显式格式受 CFL 稳定性约束（dt ≤ ρc·h²/(6k) 自动钳制）；热-力为解耦
 * 估算（固有应变法口径），非增量热-弹塑性 FEM——WORKFLOW_GUIDE §29 披露。
 */

export interface LPBFMaterialProps {
  rho: number;        // 密度 kg/m³
  c: number;          // 比热 J/(kg·K)
  k: number;          // 导热系数 W/(m·K)
  alpha: number;      // 热膨胀系数 1/K
  E: number;          // 杨氏模量 Pa
  sigmaY: number;     // 屈服强度 Pa
  Tm: number;         // 熔点 K
}

/** Ti-6Al-4V 典型物性（室温-近熔点平均值口径） */
export const TI64: LPBFMaterialProps = {
  rho: 4430, c: 670, k: 17, alpha: 8.6e-6, E: 110e9, sigmaY: 880e6, Tm: 1933,
};

export interface LPBFParams {
  /** 粉末床体素网格 N³（单层切片厚度方向为 z，格边长 dx 米） */
  N: number;
  dx: number;
  material?: LPBFMaterialProps;
  /** 激光功率 W */
  power: number;
  /** 扫描速度 m/s */
  speed: number;
  /** 光斑半径 m（默认 40µm） */
  spotRadius?: number;
  /** 吸收率（默认 0.35，Ti 粉末床口径） */
  absorptivity?: number;
  /** 层深 m（默认 30µm） */
  layerDepth?: number;
  /** 初始/基板温度 K（默认 353K = 80°C 预热口径） */
  T0?: number;
  /** 扫描总时间 s（默认由功率-速度自适应，保证热源扫过全域） */
  totalTime?: number;
  /** 基板切除后约束释放系数（0-1，默认 0.6） */
  constraint?: number;
}

export interface LPBFResult {
  peakTemperature: number;      // 全域峰值温度 K
  meltPoolVoxels: number;       // 超过熔点的格数（熔池体积代理）
  coolingRate: number;          // 峰值冷却速率 R = |dT/dt| K/s
  thermalGradient: number;      // 等效扫描向梯度 G = |∂T/∂x| K/m（峰值）
  gR: number;                   // G×R 凝固冷却参量 K²/s
  residualStress: number;       // 残余应力估算 Pa（屈服封顶）
  distortion: number;           // 翘曲位移估算 m
  energyDensity: number;        // 体能量密度 E_d = P/(v·h·t) J/m³
  window: '键合良好' | '能量不足（未熔合风险）' | '能量过高（球化/气孔风险）';
  stability: { cfl: number; ok: boolean };   // 显式格式 CFL 数
  /** 能量台账：源注入 J 与储能 J、平衡误差（绝热边界守恒口径，门禁 30 守 ≤0.5%） */
  energyInJ: number;
  energyStoredJ: number;
  energyBalance: number;
  timeSteps: number;
  elapsedMs: number;
}

/** 稳态分析参数包（跳过瞬态扫描的直接工艺评估口径——UI 卡片用） */
export function assessProcessWindow(power: number, speed: number, layerDepth: number, hatch = 90e-6): LPBFResult['window'] {
  const Ed = power / (speed * hatch * layerDepth);   // J/m³
  // Ti-6Al-4V LPBF 经验窗口（能量密度口径）：~40-120 J/mm³ 键合良好
  if (Ed < 4e10) return '能量不足（未熔合风险）';
  if (Ed > 1.2e11) return '能量过高（球化/气孔风险）';
  return '键合良好';
}

export function simulateLPBF(params: LPBFParams): LPBFResult {
  const t0 = performance.now();
  const N = params.N;
  const dx = params.dx;
  const mat = params.material ?? TI64;
  const A = params.absorptivity ?? 0.35;
  const r0 = params.spotRadius ?? 40e-6;
  const depth = params.layerDepth ?? 30e-6;
  const T0 = params.T0 ?? 353;
  const rhoC = mat.rho * mat.c;
  const kappa = mat.k / rhoC;                       // 热扩散率 m²/s
  // 显式稳定步长：dt ≤ dx²/(6κ)，安全系数 0.4
  const dtSafe = (dx * dx) / (6 * kappa) * 0.4;
  const dt = Math.min(dtSafe, 1e-4);
  const totalTime = params.totalTime ?? (N * dx) / Math.max(params.speed, 1e-3) * 2;
  const timeSteps = Math.max(1, Math.ceil(totalTime / dt));
  const power2A = 2 * A * params.power / (Math.PI * r0 * r0 * depth);   // W/m³ 峰值体热源

  const T = new Float64Array(N * N * N).fill(T0);
  const Tnew = new Float64Array(N * N * N);
  const Tpeak = new Float64Array(N * N * N).fill(T0);
  const Tprev = new Float64Array(N * N * N);
  const TEvap = 3600;   // 沸点封顶：超过部分计入蒸发耗能（台账口径）
  let evapLoss = 0;
  // 扫描轨迹：蛇形（每层往返），这里以 z=mid 平面代表单层
  const zLaser = Math.floor(N / 2);
  const trackSpacing = Math.max(1, Math.floor((50e-6) / dx));   // 50µm 道间距

  let peakTemperature = T0;
  let coolingRate = 0;
  let thermalGradient = 0;
  let srcEnergy = 0;
  const cellV = dx * dx * dx;
  const cfl = kappa * dt / (dx * dx);

  for (let step = 0; step < timeSteps; step++) {
    const t = step * dt;
    Tprev.set(T);
    // 激光位置（蛇形）
    const passLen = N * dx;
    const xL = (t * params.speed) % passLen;
    const pass = Math.floor((t * params.speed) / passLen);
    const dir = pass % 2 === 0 ? 1 : -1;
    const xLaser = dir === 1 ? xL : passLen - xL;
    const yLaser = (pass * trackSpacing) % (N * dx);
    const ixL = xLaser / dx, iyL = yLaser / dx;

    // 显式热传导 + 热源（镜像边界 = 绝热，守恒口径）
    for (let iz = 0; iz < N; iz++) {
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const i = ix + iy * N + iz * N * N;
          const xm = ix > 0 ? i - 1 : i, xp = ix < N - 1 ? i + 1 : i;
          const ym = iy > 0 ? i - N : i, yp = iy < N - 1 ? i + N : i;
          const zm = iz > 0 ? i - N * N : i, zp = iz < N - 1 ? i + N * N : i;
          let q = 0;
          // 高斯体热源（激光所在 z 层，格心距离）
          if (iz === zLaser) {
            const dxL = (ix + 0.5 - ixL) * dx;
            const dyL = (iy + 0.5 - iyL) * dx;
            const r2 = dxL * dxL + dyL * dyL;
            const qv = power2A * Math.exp(-2 * r2 / (r0 * r0));
            q = (qv * dt) / rhoC;
            srcEnergy += qv * dt * cellV;
          }
          let ti = T[i] + (kappa * dt / (dx * dx)) * (T[xm] + T[xp] + T[ym] + T[yp] + T[zm] + T[zp] - 6 * T[i]) + q;
          if (ti > TEvap) { evapLoss += rhoC * (ti - TEvap) * cellV; ti = TEvap; }
          Tnew[i] = ti;
          if (ti > Tpeak[i]) Tpeak[i] = ti;
          const cool = (Tprev[i] - ti) / dt;
          if (cool > coolingRate) coolingRate = cool;
          if (ti > peakTemperature) peakTemperature = ti;
        }
      }
    }
    T.set(Tnew);   // Jacobi 双缓冲（守恒口径；曾就地更新泄漏 23.7% 能量，2026-08-28 定案）
    // 等效扫描向梯度（峰值采样：激光后方一格与前方一格温差）
    const iz = zLaser;
    const iyS = Math.min(N - 1, Math.max(0, Math.floor(iyL)));
    const ixS = Math.min(N - 2, Math.max(1, Math.floor(ixL)));
    const gT = Math.abs(T[(ixS + 1) + iyS * N + iz * N * N] - T[(ixS - 1) + iyS * N + iz * N * N]) / (2 * dx);
    if (gT > thermalGradient) thermalGradient = gT;
  }

  // 熔池体素
  let meltPoolVoxels = 0;
  for (let i = 0; i < N * N * N; i++) if (Tpeak[i] >= mat.Tm) meltPoolVoxels++;

  // 力估算：ΔT_eff = min(Tpeak−T0, Tm−T0)（熔化以上温度封顶）
  const dTeff = Math.min(peakTemperature, mat.Tm) - T0;
  const sigmaRes = Math.min(mat.alpha * mat.E * dTeff * (params.constraint ?? 0.6), mat.sigmaY);
  const distortion = (params.constraint ?? 0.6) * mat.alpha * dTeff * (N * dx) * (N * dx) / (2 * depth * 40) ;   // C·α·ΔT·L²/(2t) t=40·depth 口径

  let stored = 0;
  for (let i = 0; i < N * N * N; i++) stored += rhoC * (T[i] - T0) * cellV;
  stored += evapLoss;
  const energyInJ = srcEnergy;
  return {
    peakTemperature,
    meltPoolVoxels,
    coolingRate,
    thermalGradient,
    gR: thermalGradient * coolingRate,
    residualStress: sigmaRes,
    distortion,
    energyDensity: params.power / (params.speed * 90e-6 * depth),
    window: assessProcessWindow(params.power, params.speed, depth),
    stability: { cfl, ok: cfl <= 1 / 6 * 1.01 },
    energyInJ,
    energyStoredJ: stored,
    energyBalance: energyInJ > 1e-12 ? Math.abs(energyInJ - stored) / energyInJ : NaN,
    timeSteps,
    elapsedMs: performance.now() - t0,
  };
}
