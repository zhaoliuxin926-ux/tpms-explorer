/**
 * 水平集（Level-Set）与拓扑导数引导的主动多孔重构（v7.0 Stage V）
 *
 * 以 TPMS 为初始构型，在复杂外载与流场约束下自动演化出兼顾轻量化、高刚度与
 * 低流阻的最优拓扑。
 *
 * 【控制方程】Hamilton-Jacobi 速度对流：
 *   ∂Φ/∂t + V_n·|∇Φ| = 0
 *   Φ = TPMS 场符号函数（>0 固相），Godunov 迎风差分 |∇Φ|。
 *
 * 【法向演化速度】（拓扑导数的工程代理口径，文档化于 WORKFLOW_GUIDE §35）
 *   V_n = wStiff·(σvm_norm − σ̄) − wFlow·(|∇p|_norm − p̄)
 *   - 刚度项：线弹性体素 FEM（solvePlasticityCompression 弹性口径单步）的逐体素
 *     von Mises 应力——高应力区固相增厚（fully-stressed design）；
 *   - 流阻项：FD-Darcy 压力场 |∇p|——高压力梯度界面退让（扩大通道、降低压降）。
 *   - 二项皆为「界面局部敏感度 − 全域均值」的零均值化，保证体积近似守恒。
 *
 * 【再初始化】每 reinitEvery 步用精确 3D EDT（exactEDT，F&H 抛物线包络）重建
 *   符号距离，防 H-J 演化后 |∇Φ| 偏离 1 导致速度场失真。
 *
 * 【柔度口径】线弹性单步的外功 U = ½·F·δ（reaction × strain / 2）——线弹性范围内
 *   精确等于应变能，门禁 36 断言其单调下降。
 *
 * 【诚实边界】体素级 4/6 邻域界面敏感度（非连续伴随法拓扑导数）；柔度为线性
 *   弹性口径（无塑性/大变形）；流阻敏感度为标量压力梯度代理（非完整 Navier-Stokes）。
 */

import { solvePlasticityCompression } from '../physics/gpu-plasticity-solver';
import { solveDarcyPermeability } from '../physics/lbm-permeability';
import { exactEDT } from '../geometry/ct-reconstruction';

export interface LevelSetParams {
  /** 体素分辨率/轴（建议 16~20，弹性求解成本 O(R³)） */
  R: number;
  /** 初始符号场 Φ R³（>0 固相；= iso − V 的调用方约定） */
  phi0: Float64Array;
  /** 演化步数 */
  steps: number;
  /** 刚度目标权重（0~1） */
  wStiff?: number;
  /** 流阻目标权重（0~1） */
  wFlow?: number;
  /** H-J 时间步长（默认 0.4，CFL 安全域） */
  dt?: number;
  /** 再初始化间隔（默认 10） */
  reinitEvery?: number;
  /** 泊松比（默认 0.3） */
  nu?: number;
  /** 每步界面带宽（|Φ| < band 视为界面，默认 2.5 体素） */
  band?: number;
  /** 固相体积分数下限保护（默认 0.05） */
  minSolid?: number;
  /** 上限（默认 0.95） */
  maxSolid?: number;
}

export interface LevelSetResult {
  /** 终态符号场 */
  phi: Float64Array;
  /** 每步柔度（线弹性外功 U = ½Fδ） */
  compliance: number[];
  /** 每步平均界面 |∇p|（流阻代理；wFlow=0 时不计） */
  flowProxy: number[];
  /** 每步固相体积分数 */
  solidFraction: number[];
  /** 终态界面 |∇Φ| 均值（再初始化质量诊断，理想 ≈ 1） */
  gradNormMean: number;
  elapsedMs: number;
}

/** Godunov 迎风 |∇Φ|（Osher-Sethian 开关） */
function godunovGrad(
  phi: Float64Array, R: number, i: number, ix: number, iy: number, iz: number, h: number, vSign: number,
): number {
  const at = (x: number, y: number, z: number): number => {
    const xx = x < 0 ? 0 : x >= R ? R - 1 : x;
    const yy = y < 0 ? 0 : y >= R ? R - 1 : y;
    const zz = z < 0 ? 0 : z >= R ? R - 1 : z;
    return phi[xx + yy * R + zz * R * R];
  };
  // 三轴差分
  const dxm = (phi[i] - at(ix - 1, iy, iz)) / h;
  const dxp = (at(ix + 1, iy, iz) - phi[i]) / h;
  const dym = (phi[i] - at(ix, iy - 1, iz)) / h;
  const dyp = (at(ix, iy + 1, iz) - phi[i]) / h;
  const dzm = (phi[i] - at(ix, iy, iz - 1)) / h;
  const dzp = (at(ix, iy, iz + 1) - phi[i]) / h;
  const pick = (a: number, b: number): number => {
    if (vSign > 0) {
      // V>0：信息从背后（低 Φ 侧）传来 → 用后差（若为正）或前差（若为负）
      if (a > 0 && b > 0) return Math.max(a, b);
      if (a > 0) return a;
      if (b < 0) return b;
      return 0;
    }
    if (a < 0 && b < 0) return Math.min(a, b);
    if (b > 0) return b;
    if (a < 0) return a;
    return 0;
  };
  const gx = pick(dxm, dxp);
  const gy = pick(dym, dyp);
  const gz = pick(dzm, dzp);
  return Math.sqrt(gx * gx + gy * gy + gz * gz);
}

export function evolveLevelSet(params: LevelSetParams): LevelSetResult {
  const t0 = Date.now();
  const R = params.R;
  const n = R * R * R;
  const h = 2 / R;
  const phi = new Float64Array(params.phi0);
  if (phi.length !== n) throw new Error(`phi0 长度 ${phi.length} ≠ R³ = ${n}`);
  const wStiff = params.wStiff ?? 1;
  const wFlow = params.wFlow ?? 0;
  const dt = params.dt ?? 0.15;
  const reinitEvery = params.reinitEvery ?? 10;
  const nu = params.nu ?? 0.3;
  const band = params.band ?? 2.5 * h;
  const minSolid = params.minSolid ?? 0.05;
  const maxSolid = params.maxSolid ?? 0.95;

  const compliance: number[] = [];
  const flowProxy: number[] = [];
  const solidFraction: number[] = [];

  const countSolid = (): number => {
    let c = 0;
    for (let i = 0; i < n; i++) if (phi[i] > 0) c++;
    return c / n;
  };
  solidFraction.push(countSolid());

  /** 界面体素掩码（|Φ| ≤ band）与法向符号 */
  let solidMask = new Uint8Array(n);
  const refreshMasks = (): void => {
    for (let i = 0; i < n; i++) solidMask[i] = phi[i] > 0 ? 1 : 0;
  };

  /** 岛清理：保留最大 6 连通固相分量，孤岛强制回空隙（弹性 K 非奇异 + 无浮动粉末）。
   *  H-J 局部演化天然产生孤岛——弹性求解器的连通性守卫会拒绝奇异 K。 */
  const removeIslands = (): void => {
    refreshMasks();
    const label = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0, nComp = 0;
    const stack: number[] = [];
    for (let seed = 0; seed < n; seed++) {
      if (!solidMask[seed] || label[seed] >= 0) continue;
      const id = nComp++;
      let size = 0;
      stack.length = 0;
      stack.push(seed);
      label[seed] = id;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const ix = i % R, iy = Math.floor(i / R) % R, iz = Math.floor(i / (R * R));
        const nbrs = [
          ix > 0 ? i - 1 : -1, ix < R - 1 ? i + 1 : -1,
          iy > 0 ? i - R : -1, iy < R - 1 ? i + R : -1,
          iz > 0 ? i - R * R : -1, iz < R - 1 ? i + R * R : -1,
        ];
        for (const nb of nbrs) {
          if (nb < 0 || !solidMask[nb] || label[nb] >= 0) continue;
          label[nb] = id;
          stack.push(nb);
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
    }
    if (best < 0) return;
    for (let i = 0; i < n; i++) {
      if (solidMask[i] && label[i] !== best) {
        solidMask[i] = 0;
        phi[i] = -Math.abs(phi[i]) - h;   // 强制回空隙侧
      }
    }
  };

  /** 敏感度场：界面体素上的 V_n。
   *  定案（三轮实测教训）：
   *  ① 零均值必须在「界面体素」（|Φ| ≤ 1.5h）上取——首版在 2×band 带上取均值，
   *    面积加权缺失 + 位移控制下的软化假象使固相 0.50 → 0.76（流驱）或 → 0（刚驱
   *    死亡螺旋：细结构应力重分布 → 侵蚀加速）；
   *  ② 速度归一化限幅（max|sens| → 0.25）+ dt=0.15：界面单步移动 ≤ 0.05 归一单位
   *   （≈1 体素），防 H-J 大步长穿透特征；
   *  ③ 柔度口径：求解器为位移控制（fixed δ），经典柔度（固定服务载荷 F₀）=
   *    F₀²/(2k) ∝ 1/reaction——½Fδ 口径在位移控制下随软化下降（假优化信号，
   *    首版 69%「柔度下降」实为结构软化）。 */
  const sensitivity = (): Float64Array => {
    const sens = new Float64Array(n);
    refreshMasks();
    const hInt = 1.5 * h;
    const isInterface = (i: number): boolean => Math.abs(phi[i]) <= hInt;

    // 刚度项：线弹性单步 VM 场（求解深度压低——线性问题首轮即真解，NR 深迭代纯 churn：
    // 27 轮 5.4s 实测；敏感性只需 VM 相对分布）
    const res = solvePlasticityCompression({
      R, solid: solidMask, nu, sigmaY: 1e9, steps: 1, maxStrain: 0.02,
      pcgTol: 1e-3, pcgMaxIter: 250, maxIter: 2, tangent: 'elastic',
    });
    const last = res.steps[res.steps.length - 1];
    compliance.push(last.reaction > 1e-30 ? 1 / last.reaction : Number.POSITIVE_INFINITY);
    const vm = res.cauchy;

    // 流阻项：FD-Darcy 压力梯度
    let gp: Float64Array | null = null;
    if (wFlow > 0) {
      const darcy = solveDarcyPermeability({ R, solid: solidMask, returnPressure: true, maxIter: 2500 });
      if (darcy.p) {
        const p = darcy.p;
        gp = new Float64Array(n);
        for (let iz = 1; iz < R - 1; iz++) for (let iy = 1; iy < R - 1; iy++) for (let ix = 1; ix < R - 1; ix++) {
          const i = ix + iy * R + iz * R * R;
          if (Math.abs(phi[i]) > band * 2) continue;
          const gx2 = (p[i + 1] - p[i - 1]) / (2 * h);
          const gy2 = (p[i + R] - p[i - R]) / (2 * h);
          const gz2 = (p[i + R * R] - p[i - R * R]) / (2 * h);
          gp[i] = Math.sqrt(gx2 * gx2 + gy2 * gy2 + gz2 * gz2);
        }
        let sum = 0, cnt = 0;
        for (let i = 0; i < n; i++) if (gp[i] > 0 && isInterface(i)) { sum += gp[i]; cnt++; }
        flowProxy.push(cnt ? sum / cnt : 0);
      } else {
        flowProxy.push(0);
      }
    } else {
      flowProxy.push(0);
    }

    // 界面零均值 + 归一化（面积一致的体积近似守恒）
    let vmSum = 0, vmCnt = 0, gpSum = 0, gpCnt = 0;
    for (let i = 0; i < n; i++) {
      if (!isInterface(i)) continue;
      vmSum += vm[i]; vmCnt++;
      if (gp && gp[i] > 0) { gpSum += gp[i]; gpCnt++; }
    }
    const vmMean = vmCnt ? vmSum / vmCnt : 0;
    const gpMean = gpCnt ? gpSum / gpCnt : 0;
    let maxAbs = 1e-30;
    for (let i = 0; i < n; i++) {
      if (!isInterface(i)) continue;
      let v = 0;
      if (wStiff > 0) v += wStiff * (vm[i] - vmMean) / Math.max(vmMean, 1e-30);
      if (wFlow > 0 && gp) v -= wFlow * (gp[i] - gpMean) / Math.max(gpMean, 1e-30);
      sens[i] = v;
      if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
    const vScale = 0.25 / maxAbs;
    for (let i = 0; i < n; i++) sens[i] *= vScale;
    return sens;
  };

  // ── 演化主循环 ──
  for (let step = 0; step < params.steps; step++) {
    if (step % reinitEvery === 0) {
      // 再初始化：精确 EDT 重建符号距离
      refreshMasks();
      const voidMask = new Uint8Array(n);
      for (let i = 0; i < n; i++) voidMask[i] = solidMask[i] ? 0 : 1;
      // 语义定案：exactEDT(feature) = 到最近特征体素的距离（feature 点处为 0）
      const dToVoid = exactEDT(voidMask, R);    // 各点 → 最近空隙（固相点处 > 0）
      const dToSolid = exactEDT(solidMask, R);  // 各点 → 最近固相（空隙点处 > 0）
      for (let i = 0; i < n; i++) {
        phi[i] = (solidMask[i] ? 1 : -1) * (solidMask[i] ? dToVoid[i] : dToSolid[i]) * h;
      }
    }

    const sens = sensitivity();
    // 体积 Lagrange 偏置：向初始固相分数回归（零均值速度未做界面面积加权，
    // 纯靠体积守恒约束维持总体积——标准水平集拓扑优化做法）。
    // 定案教训：首版仅设 5%/95% 硬保护，流驱动的面积加权缺失使固相 0.50 → 0.76
    // 单调失控（κ 反降 ×0.19）。
    const sfNow = countSolid();
    const biasRaw = 2.0 * (solidFraction[0] - sfNow);
    const volumeBias = Math.max(-0.2, Math.min(0.2, biasRaw))
      + (sfNow < minSolid ? 0.05 : 0) + (sfNow > maxSolid ? -0.05 : 0);

    // H-J Godunov 更新
    const phiNew = new Float64Array(n);
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      const i = ix + iy * R + iz * R * R;
      const v = sens[i] + volumeBias;
      const g = godunovGrad(phi, R, i, ix, iy, iz, h, v >= 0 ? 1 : -1);
      phiNew[i] = phi[i] - dt * v * g;
    }
    phi.set(phiNew);
    removeIslands();
    solidFraction.push(countSolid());
  }

  // 终态再初始化 + |∇Φ| 诊断
  refreshMasks();
  const voidMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) voidMask[i] = solidMask[i] ? 0 : 1;
  const dToVoid = exactEDT(voidMask, R);
  const dToSolid = exactEDT(solidMask, R);
  for (let i = 0; i < n; i++) {
    phi[i] = (solidMask[i] ? 1 : -1) * (solidMask[i] ? dToVoid[i] : dToSolid[i]) * h;
  }
  let gSum = 0, gCnt = 0;
  for (let iz = 1; iz < R - 1; iz++) for (let iy = 1; iy < R - 1; iy++) for (let ix = 1; ix < R - 1; ix++) {
    const i = ix + iy * R + iz * R * R;
    if (Math.abs(phi[i]) > band) continue;
    const g = Math.sqrt(
      ((phi[i + 1] - phi[i - 1]) / (2 * h)) ** 2 +
      ((phi[i + R] - phi[i - R]) / (2 * h)) ** 2 +
      ((phi[i + R * R] - phi[i - R * R]) / (2 * h)) ** 2,
    );
    gSum += g; gCnt++;
  }

  return {
    phi,
    compliance,
    flowProxy,
    solidFraction,
    gradNormMean: gCnt ? gSum / gCnt : 0,
    elapsedMs: Date.now() - t0,
  };
}

/**
 * 从演化终态提取重建用体素场 V（solid_network 口径：solid ⟺ V < iso）。
 * 返回 N³ Float32Array，可直接作为 surface-nets 的 gpuVField 注入（R 相同口径）。
 */
export function phiToVField(phi: Float64Array, R: number, iso = 0): Float32Array {
  // 契约定案：surface-nets 的 gpuVField 是 (R+1)³ 节点网格，Φ 在 R³ 体素中心 ——
  // 节点值取相邻体素中心均值（每轴 2 邻居钳制边界），Φ=0 层自然落在界面上。
  // 首版直接输出 R³ 被长度守卫拒绝（2744 ≠ 3375，防静默截肢设计按预期工作）。
  const N1 = R + 1;
  const out = new Float32Array(N1 * N1 * N1);
  const at = (ix: number, iy: number, iz: number): number => {
    const xx = ix < 0 ? 0 : ix >= R ? R - 1 : ix;
    const yy = iy < 0 ? 0 : iy >= R ? R - 1 : iy;
    const zz = iz < 0 ? 0 : iz >= R ? R - 1 : iz;
    return phi[xx + yy * R + zz * R * R];
  };
  for (let iz = 0; iz < N1; iz++) for (let iy = 0; iy < N1; iy++) for (let ix = 0; ix < N1; ix++) {
    let acc = 0, cnt = 0;
    for (const dx of [-1, 0]) for (const dy of [-1, 0]) for (const dz of [-1, 0]) {
      acc += at(ix + dx, iy + dy, iz + dz);
      cnt++;
    }
    out[ix + iy * N1 + iz * N1 * N1] = iso - acc / cnt;
  }
  return out;
}
