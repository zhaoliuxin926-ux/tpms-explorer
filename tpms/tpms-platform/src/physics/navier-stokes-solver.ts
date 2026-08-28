/**
 * 稳态低雷诺数不可压缩 Navier-Stokes 求解器（v6.0 阶段 III）
 *
 * 方法：融合显式松弛到稳态（Stokes 占优的微流进口径）——
 *   u' = u + dt·( f − ∇p + ν∇²u )    流体格；固体格强制 u=0（Brinkman 无滑移口径）
 *   p' = p − β·∇·u                   Uzawa 压力修正
 * 中心差分（六邻居，出界/固体邻居退化为自身 → 对 lap/梯度/散度贡献恰为 0）。
 * x/z 周期（channel 模式）或零梯度（darcy 模式）。
 *
 * WASM 加速档（shaders/navier-stokes.wat + .verify/gen_ns_wasm.mjs 手工汇编器）
 * 因 wabt.js 与 V8 的编码分歧暂时降级为 TS 热循环（同功能、同数值），
 * 实验件保留、§28 披露——与 v5.0 LBM→FD-Darcy 降级同口径。
 *
 * 验证（门禁 29）：平面 Poiseuille 解析剖面 ≤1.5%；进出口流量守恒；
 * Darcy 渗透率与 lbm-permeability.ts 的 FD-Darcy 同量级；壁面无滑移。
 */

export interface NSSolverParams {
  nx: number;
  ny: number;
  nz: number;
  /** 1 = 流体，0 = 固体（无滑移） */
  fluid: Uint8Array;
  /** 运动黏度 ν（格点单位，默认 1） */
  nu?: number;
  /**
   * channel：x/z 周期 + y 墙 + 体力 f（Poiseuille 解析锚点）；
   * periodic：全周期 + 体力 f（渗流力学标准口径，TPMS 多孔 κ 测量）。
   * （darcy 入口/出口钳位与 β 修正在多孔域内反馈不稳定，已按标准做法改体力驱动）
   */
  mode: 'channel' | 'periodic';
  bodyForce?: number;
  dt?: number;
  beta?: number;
  maxIter?: number;
  tol?: number;
  /** darcy 模式入口速度 */
  inletU?: number;
}

export interface NSSolverResult {
  u: Float64Array;          // 3N 格心速度
  p: Float64Array;          // N 压力
  umean: number;            // 流体格 |ux| 均值
  umax: number;

  /** 渗透率（格点单位）：κ = ν·ū·L/ΔP（channel 模式 = ū·ν/G） */
  permeability: number;
  iterations: number;
  converged: boolean;
}

/** 单次融合扫掠（TS 权威路径；与实验性 WASM 内核逐算子同构） */
export function sweepNs(
  u: Float64Array, unew: Float64Array, p: Float64Array, fluid: Uint8Array,
  nx: number, ny: number, nz: number, periodic: boolean,
  dt: number, nu: number, fx: number, beta: number,
): void {
  const nb = (axis: number, dir: number, idx: number): number => {
    let a: number, lim: number;
    const k = Math.floor(idx / (nx * ny));
    const j = Math.floor((idx % (nx * ny)) / nx);
    const i = idx % nx;
    if (axis === 0) { a = i + dir; lim = nx; }
    else if (axis === 1) { a = j + dir; lim = ny; }
    else { a = k + dir; lim = nz; }
    if (periodic) a = ((a % lim) + lim) % lim;
    else if (a < 0 || a >= lim) return -1;
    if (axis === 0) return a + j * nx + k * nx * ny;
    if (axis === 1) return i + a * nx + k * nx * ny;
    return i + j * nx + a * nx * ny;
  };
  const N = nx * ny * nz;
  for (let idx = 0; idx < N; idx++) {
    const i3 = idx * 3;
    if (!fluid[idx]) { unew[i3] = 0; unew[i3 + 1] = 0; unew[i3 + 2] = 0; continue; }
    const ux = u[i3], uy = u[i3 + 1], uz = u[i3 + 2], pc = p[idx];
    let lapx = 0, lapy = 0, lapz = 0, gx = 0, gy = 0, gz = 0, div = 0;
    for (const [axis, dir] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]] as const) {
      const n = nb(axis, dir, idx);
      if (n < 0) continue;
      const sgn = dir * 0.5;
      const dp = p[n] - pc;
      // ∇² 的分量各向同性：所有方向的邻居都贡献对应速度分量的差
      // （方向只决定 ∇p 与 div 的轴；2026-08-28 定案：曾误将邻居方向当速度分量，
      //  导致剪切层不发育、速度线性飞升）
      lapx += u[n * 3] - ux;
      lapy += u[n * 3 + 1] - uy;
      lapz += u[n * 3 + 2] - uz;
      if (axis === 0) { gx += dp * sgn; div += (u[n * 3] - ux) * sgn; }
      else if (axis === 1) { gy += dp * sgn; div += (u[n * 3 + 1] - uy) * sgn; }
      else { gz += dp * sgn; div += (u[n * 3 + 2] - uz) * sgn; }
    }
    unew[i3] = ux + dt * (fx - gx + nu * lapx);
    unew[i3 + 1] = uy + dt * (0 - gy + nu * lapy);
    unew[i3 + 2] = uz + dt * (0 - gz + nu * lapz);
    p[idx] = pc - beta * div;
  }
}

export function solveNavierStokes(params: NSSolverParams): NSSolverResult {
  const { nx, ny, nz, fluid } = params;
  const N = nx * ny * nz;
  const nu = params.nu ?? 1;
  const dt = params.dt ?? 0.1;
  const beta = params.beta ?? 0.6;
  const maxIter = params.maxIter ?? 12000;
  const tol = params.tol ?? 1e-7;
  const fx = params.bodyForce ?? 0.01;
  const periodic = true; // channel 与 periodic 均为周期口径（channel 的墙由 mask 表达）

  const u = new Float64Array(N * 3);
  const unew = new Float64Array(N * 3);
  const p = new Float64Array(N);

  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    sweepNs(u, unew, p, fluid, nx, ny, nz, periodic, dt, nu, fx, beta);
    // 收敛：max|Δu|
    let maxDU = 0;
    for (let i = 0; i < N * 3; i++) {
      const d = Math.abs(unew[i] - u[i]);
      if (d > maxDU) maxDU = d;
    }
    u.set(unew);
    iterations = it + 1;
    if (maxDU < tol) { converged = true; break; }
  }

  // 统计
  let umean = 0, umax = 0, nFluid = 0;
  for (let idx = 0; idx < N; idx++) {
    if (!fluid[idx]) continue;
    const a = Math.abs(u[idx * 3]);
    umean += a;
    if (a > umax) umax = a;
    nFluid++;
  }
  umean = nFluid > 0 ? umean / nFluid : 0;

  // 渗透率（Darcy）：κ = ν·ū/G（体力驱动稳态，两模式同式）
  const permeability = umean > 1e-12 ? (umean * nu) / fx : NaN;

  return { u, p, umean, umax, permeability, iterations, converged };
}
