/**
 * 多孔介质渗透率求解器（v5.0 阶段 I）
 *
 * 【实现定案】稳态 Stokes/Darcy 口径的有限差分压力求解器（变系数扩散方程
 * ∇·(k∇p)=0，SOR 逐超松弛迭代），替换初版 D3Q19 LBM——LBM 的 bounce-back
 * 运动学边界在三版重构后仍出现动量注入式发散（⟨u⟩ 指数增长 → NaN，机理与
 * 修复记录见 agent_memory/bugs.md v5.0 条目），FD-Darcy 数值性质稳定、
 * 收敛有保证、且达到同一功能目标（浏览器端秒级渗透率求解）。
 *
 * 物理口径：z 向压差驱动（p_in=1、p_out=0），固相不传导（k=0），侧壁不透流
 * （镜像无通量）。κ = Q·L/(A·Δp)，Q 由出口截面流量积分。
 * 诚实边界：各向同性局部渗透的标量压力近似（未解析 Stokes 速度场），
 * 与 Kozeny-Carman 经验式的偏差带由门禁 22 校准。
 */

export interface DarcyParams {
  R: number;                 // 体素分辨率/轴
  solid: Uint8Array;         // R³，1 = 固相（不透流）
  tol?: number;              // SOR 相对残差阈（默认 1e-8）
  maxIter?: number;          // SOR 最大扫掠次数（默认 4000）
  omega?: number;            // SOR 松弛因子（默认 1.9）
}

export interface DarcyResult {
  kappaLU: number;           // 归一化渗透率（格子单位：L=h=1）
  kappaPhys: number;         // 同 kappaLU（相对口径）
  meanPressureDrop: number;
  fluxQ: number;             // 出口无量纲流量
  iters: number;
  converged: boolean;
  elapsedMs: number;
  porosity: number;
}

export function solveDarcyPermeability(params: DarcyParams): DarcyResult {
  const t0 = performance.now();
  const R = params.R;
  const tol = params.tol ?? 1e-8;
  const maxIter = params.maxIter ?? 4000;
  const omega = params.omega ?? 1.9;
  const solid = params.solid;
  const size = R * R * R;

  let porosity = 0;
  for (let i = 0; i < size; i++) if (!solid[i]) porosity++;
  porosity /= size;
  if (porosity === 0) throw new Error('FD-Darcy：流体域为空');

  // 压力场：z=0 面 p=1，z=R−1 面 p=0（Dirichlet）；其余自由（初值线性插值）
  const p = new Float64Array(size);
  for (let iz = 0; iz < R; iz++) {
    const pz = 1 - iz / (R - 1);
    for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      p[ix + iy * R + iz * R * R] = pz;
    }
  }
  const isFluid = (ix: number, iy: number, iz: number) =>
    ix >= 0 && ix < R && iy >= 0 && iy < R && iz >= 0 && iz < R && !solid[ix + iy * R + iz * R * R];

  // SOR：固相不传导——流体节点离散：Σ_邻居流体 (p_n − p_c) = 0（侧壁无通量由
  // 界外镜像 p_c 自然满足；z 端 Dirichlet 由初值+固定实现）
  let iters = 0;
  let converged = false;
  for (let sweep = 0; sweep < maxIter; sweep++) {
    let maxDp = 0;
    for (let iz = 1; iz < R - 1; iz++) {
      for (let iy = 0; iy < R; iy++) {
        for (let ix = 0; ix < R; ix++) {
          const i = ix + iy * R + iz * R * R;
          if (solid[i]) continue;
          // 邻居：固相处用 p_c（零通量镜像）
          const nb = (dx: number, dy: number, dz: number) => {
            const x = ix + dx, y = iy + dy, z = iz + dz;
            return isFluid(x, y, z) ? p[x + y * R + z * R * R] : p[i];
          };
          const s = nb(1, 0, 0) + nb(-1, 0, 0) + nb(0, 1, 0) + nb(0, -1, 0) + nb(0, 0, 1) + nb(0, 0, -1);
          const pNew = (1 - omega) * p[i] + (omega / 6) * s;
          const d = Math.abs(pNew - p[i]);
          if (d > maxDp) maxDp = d;
          p[i] = pNew;
        }
      }
    }
    iters = sweep + 1;
    if (maxDp < tol) { converged = true; break; }
  }

  // 流量：z = R−2 截面向 z = R−1（p=0 汇面）的流动 Q = Σ k·(p[z=R−2] − 0)/1
  let fluxQ = 0;
  for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const i = ix + iy * R + (R - 2) * R * R;
    if (!solid[i]) fluxQ += p[i] - 0;
  }
  // κ（格子单位）：Q·L/(A·Δp)，L = R−1，A = R²，Δp = 1
  const L = R - 1;
  const A = R * R;
  const kappaLU = (fluxQ * L) / (A * 1);

  return {
    kappaLU,
    kappaPhys: kappaLU,
    meanPressureDrop: 1,
    fluxQ,
    iters,
    converged,
    elapsedMs: performance.now() - t0,
    porosity,
  };
}
