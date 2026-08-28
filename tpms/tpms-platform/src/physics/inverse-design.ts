/**
 * 逆向多目标自适应设计引擎（v4.0 阶段 I · Inverse Design Engine）
 *
 * 「性能定结构」：给定目标力学/传质/孔隙率指标，反演最优 TPMS 拓扑与参数。
 *
 * 前向代理模型（解析式，零几何构建成本）：
 *   E*(p)  = C1(type)·(1−P)²·E0·α          —— Gibson-Ashby 开孔近似 + 方向模量因子 α
 *   κ*(p)  = ε³ / (C_k·Sv²·(1−ε)²)         —— Kozeny-Carman（mm² → m²）
 *   Sv(p)  = cArea(type)/cellSize          —— 单胞解析面积密度（mm⁻¹）
 *   P(p)   = porosity
 * 诚实边界：这是解析代理口径（与平台 UI 的 GA/κ 面板同源同量级），非 FEA；
 * 几何级精确验证请走 CAE 验证包（Stage III）。
 *
 * 参数矢量 p = [porosity, cellSize, anisotropy]（连续）× typeIndex（离散外层枚举）。
 * 求解策略：Nelder-Mead 多起点全局探索 → Levenberg-Marquardt 阻尼最小二乘精化。
 * 主线程运行：解析代理单次前向 <1 µs，NM+LM 全程 <10 ms，Worker 无收益。
 */

import type { TpmType } from '../types';

// ── 常量表（与 gibson-ashby.ts / 物理面板同源口径）──

/** 基体弹性模量（GPa，TC4 钛合金缺省口径） */
export const E0_GPA = 110;

/** Gibson-Ashby C1（引用同 gibson-ashby.ts） */
const C1_MAP: Record<string, number> = {
  gyroid: 0.3, diamond: 0.35, schwarz: 0.3, neovius: 0.35,
  iwp: 0.38, frd: 0.4, lidinoid: 0.32, splitp: 0.33,
};

/** 单胞解析面积密度 cArea（mm⁻¹ @ cellSize=1；Schwarz P 2.31 引自极小曲面经典面积，其余同量级标定） */
const C_AREA: Record<string, number> = {
  gyroid: 3.09, diamond: 3.83, schwarz: 2.31, neovius: 3.0,
  iwp: 3.2, frd: 3.4, lidinoid: 3.3, splitp: 3.2,
};

const KOZENY_C = 5;
const TYPES: TpmType[] = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];

/** 参数矢量与可行域 */
export interface DesignParams {
  type: TpmType;
  porosity: number;      // [0.02, 0.98]
  cellSize: number;      // mm，[1, 5]
  anisotropy: number;    // 方向模量因子 α，[0.5, 2.5]（<1 为方向软化）
}

export interface DesignTargets {
  /** 目标等效弹性模量（GPa；0 = 不约束） */
  ETarget?: number;
  /** 渗透率下限约束 κ ≥ target（m²；0 = 不约束——医学/工程预设均为下界语义） */
  kappaTarget?: number;
  /** 目标孔隙率 [0,1]（0 = 不约束） */
  porosityTarget?: number;
  /** 权重（缺省 1） */
  wE?: number;
  wKappa?: number;
  wP?: number;
}

export interface ForwardPrediction {
  EGPa: number;
  kappaM2: number;
  porosity: number;
  svRatio: number;      // mm⁻¹
}

/** 前向代理模型 */
export function forwardModel(type: TpmType, porosity: number, cellSize: number, anisotropy: number): ForwardPrediction {
  const eps = Math.min(0.99, Math.max(0.02, porosity));
  const rho = 1 - eps;
  const sv = (C_AREA[type] ?? 3.0) / Math.max(0.5, cellSize);
  const eGPa = (C1_MAP[type] ?? 0.3) * rho * rho * E0_GPA * anisotropy;
  const kappaM2 = Math.pow(eps, 3) / (KOZENY_C * sv * sv * Math.pow(rho, 2)) * 1e-6;   // mm² → m²
  return { EGPa: eGPa, kappaM2, porosity: eps, svRatio: sv };
}

/** 目标泛函 J(p)：加权相对残差平方和 */
export function objective(t: DesignTargets, f: ForwardPrediction): number {
  let j = 0;
  if (t.ETarget && t.ETarget > 0) j += Math.pow((f.EGPa - t.ETarget) / t.ETarget, 2);
  if (t.kappaTarget && t.kappaTarget > 0) j += Math.pow(Math.max(0, (t.kappaTarget - f.kappaM2) / t.kappaTarget), 2);
  if (t.porosityTarget && t.porosityTarget > 0) j += Math.pow(f.porosity - t.porosityTarget, 2);
  return j;
}

const clampP = (p: number) => Math.min(0.98, Math.max(0.02, p));
const clampC = (c: number) => Math.min(5, Math.max(1, c));
// α ∈ [0.5, 2.5]：<1 为方向软化（与 >1 硬化同为合法设计轴）——
// 三处 clamp 必须同域（NM 自由演化/LM 钳制/解报告），曾因下界不一致（1 vs 自由）
// 令 LM 从 NM 终点跳变边界、成本 4e-13→1.2e-1（红测抓获）
const clampA = (a: number) => Math.min(2.5, Math.max(0.5, a));

/**
 * 残差向量（LM 用）。约束语义（与医学/工程预设一致）：
 *   E  = 等值目标（相对残差）
 *   κ  = 下限约束 κ ≥ κ_target（只罚不足：max(0, (κ_t−κ)/κ_t)——
 *        松质骨/散热沉的「κ ≥ 1×10⁻⁸ m²」是下界而非等式，等式语义会因
 *        前向 κ 比下界大 2 个量级而伪不可行（实测 239% 伪残差红测抓获）
 *   P  = 等值目标
 */
function residuals(t: DesignTargets, p: [number, number, number], type: TpmType): number[] {
  const f = forwardModel(type, clampP(p[0]), clampC(p[1]), clampA(p[2]));
  const r: number[] = [];
  if (t.ETarget && t.ETarget > 0) r.push((f.EGPa - t.ETarget) / t.ETarget);
  if (t.kappaTarget && t.kappaTarget > 0) r.push(Math.max(0, (t.kappaTarget - f.kappaM2) / t.kappaTarget));
  if (t.porosityTarget && t.porosityTarget > 0) r.push(f.porosity - t.porosityTarget);
  return r;
}

// ── Nelder-Mead 单纯形（标准自适应系数 α=1, γ=2, β=0.5, δ=0.5）──

type Vec3 = [number, number, number];

export function nelderMead(
  f: (p: Vec3) => number,
  start: Vec3,
  maxIter = 400,
  tol = 1e-12,
): { p: Vec3; j: number; iters: number } {
  const scale: Vec3 = [0.15, 0.6, 0.3];   // porosity / cellSize / anisotropy 的初始步长
  // 初单纯形（p0 + scale·e_i，参数域内 clamp 后不再投影——NM 在无界域上自由演化，评估时 clamp）
  const pts: Vec3[] = [start.slice() as Vec3];
  for (let i = 0; i < 3; i++) {
    const q = start.slice() as Vec3;
    q[i] = q[i] + scale[i];
    pts.push(q);
  }
  let vals = pts.map(f);
  let iters = 0;
  for (; iters < maxIter; iters++) {
    const order = [0, 1, 2, 3].sort((a, b) => vals[a] - vals[b]);
    const sorted = order.map((i) => pts[i]);
    const fv = order.map((i) => vals[i]);
    if (Math.abs(fv[3] - fv[0]) < tol * (1 + Math.abs(fv[0]))) {
      pts.length = 0; pts.push(...sorted);
      vals = fv;
      break;
    }
    // 质心（去除最差点）
    const cen: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) cen[k] += sorted[i][k] / 3;
    const worst = sorted[3];
    const reflect: Vec3 = cen.map((c, k) => c + (c - worst[k])) as Vec3;
    const fr = f(reflect);
    if (fr < fv[0]) {
      const expand: Vec3 = cen.map((c, k) => c + 2 * (c - worst[k])) as Vec3;
      const fe = f(expand);
      if (fe < fr) { pts.splice(0, 4, ...sorted.slice(0, 3), expand); vals = [...fv.slice(0, 3), fe]; }
      else { pts.splice(0, 4, ...sorted.slice(0, 3), reflect); vals = [...fv.slice(0, 3), fr]; }
    } else if (fr < fv[2]) {
      pts.splice(0, 4, ...sorted.slice(0, 3), reflect);
      vals = [...fv.slice(0, 3), fr];
    } else {
      const contract: Vec3 = cen.map((c, k) => c + 0.5 * (worst[k] - c)) as Vec3;
      const fc = f(contract);
      if (fc < fv[3]) {
        pts.splice(0, 4, ...sorted.slice(0, 3), contract);
        vals = [...fv.slice(0, 3), fc];
      } else {
        // 收缩到最优点
        for (let i = 1; i < 4; i++) {
          const q = sorted[0].map((c, k) => c + 0.5 * (sorted[i][k] - c)) as Vec3;
          pts[i] = q; vals[i] = f(q);
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i < 4; i++) if (vals[i] < vals[bi]) bi = i;
  return { p: pts[bi], j: vals[bi], iters };
}

// ── Levenberg-Marquardt 阻尼最小二乘（3 参数，数值 Jacobian，手写 3×3 线性求解）──

export function levenbergMarquardt(
  t: DesignTargets,
  type: TpmType,
  start: Vec3,
  maxIter = 60,
): { p: Vec3; cost: number; iters: number } {
  const clampVec = (p: Vec3): Vec3 => [clampP(p[0]), clampC(p[1]), clampA(p[2])];
  let p = clampVec(start);
  let r0 = residuals(t, p, type);
  let cost = r0.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;
  const hh = [1e-5, 1e-4, 1e-5];
  for (let it = 0; it < maxIter; it++) {
    if (cost < 1e-18) break;
    // 数值 Jacobian（前向差分，参数域 clamp 后差分）
    const J: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const m = r0.length;
    for (let k = 0; k < 3; k++) {
      const q = p.slice() as Vec3;
      q[k] = p[k] + hh[k];
      const rq = residuals(t, q, type);
      for (let i = 0; i < m; i++) J[i][k] = (rq[i] - r0[i]) / hh[k];
    }
    // 正规方程 (JᵀJ + λ·diag(JᵀJ))·δ = −Jᵀr
    const jtj = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const jtr = [0, 0, 0];
    for (let i = 0; i < m; i++) {
      for (let a = 0; a < 3; a++) {
        jtr[a] -= J[i][a] * r0[i];
        for (let b = 0; b < 3; b++) jtj[a][b] += J[i][a] * J[i][b];
      }
    }
    for (let a = 0; a < 3; a++) jtj[a][a] *= (1 + lambda);
    // 3×3 高斯消元
    const aug = [
      [jtj[0][0], jtj[0][1], jtj[0][2], jtr[0]],
      [jtj[1][0], jtj[1][1], jtj[1][2], jtr[1]],
      [jtj[2][0], jtj[2][1], jtj[2][2], jtr[2]],
    ];
    const delta: Vec3 = [0, 0, 0];
    let solvable = true;
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let rr = col + 1; rr < 3; rr++) if (Math.abs(aug[rr][col]) > Math.abs(aug[piv][col])) piv = rr;
      if (Math.abs(aug[piv][col]) < 1e-14) { solvable = false; break; }
      [aug[col], aug[piv]] = [aug[piv], aug[col]];
      for (let rr = 0; rr < 3; rr++) {
        if (rr === col) continue;
        const fac = aug[rr][col] / aug[col][col];
        for (let cc = col; cc < 4; cc++) aug[rr][cc] -= fac * aug[col][cc];
      }
    }
    if (!solvable) { lambda *= 10; continue; }
    for (let a = 0; a < 3; a++) delta[a] = aug[a][3] / aug[a][a];
    const qNew = clampVec([p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
    const rNew = residuals(t, qNew, type);
    const costNew = rNew.reduce((sv, v) => sv + v * v, 0);
    if (costNew < cost) {
      const improve = cost - costNew;
      p = qNew;
      r0 = rNew;
      cost = costNew;
      lambda = Math.max(lambda * 0.3, 1e-9);
      if (improve < 1e-16) break;
    } else {
      lambda *= 10;
      if (lambda > 1e8) break;
    }
  }
  return { p, cost, iters: maxIter };
}
// ── 逆向求解入口 ──

export interface InverseSolution {
  type: TpmType;
  params: DesignParams;
  prediction: ForwardPrediction;
  objective: number;
  /** 前向相对误差（有约束的指标各自的 |model−target|/target） */
  errors: { E?: number; kappa?: number; porosity?: number };
}

export interface InverseReport {
  solutions: InverseSolution[];   // 按 J 升序，跨全部 8 类型枚举
  converged: boolean;             // 最优解 J ≤ 收敛阈
  elapsedMs: number;
}

const P_TOL = 1e-10;

/**
 * 逆向求解：8 类型外层枚举 × NM 多起点（2 起点）→ LM 精化，按 J 升序返回。
 */
export function solveInverse(targets: DesignTargets): InverseReport {
  const t0 = performance.now();
  const solutions: InverseSolution[] = [];
  for (const type of TYPES) {
    let best: { p: Vec3; j: number } | null = null;
    // 双起点：几何中点 + 高孔隙率起点
    for (const start of [[0.5, 3, 1.5], [0.75, 2, 1.0]] as Vec3[]) {
      const nm = nelderMead((q) => objective(targets, forwardModel(type, clampP(q[0]), clampC(q[1]), clampA(q[2]))), start);
      const lm = levenbergMarquardt(targets, type, nm.p);
      const cand = { p: lm.p, j: objective(targets, forwardModel(type, clampP(lm.p[0]), clampC(lm.p[1]), clampA(lm.p[2]))) };
      if (cand.j < P_TOL) cand.j = 0;   // 数值噪声清零
      if (!best || cand.j < best.j) best = cand;
    }
    const [porosity, cellSize, anisotropy] = best!.p;
    const cp = clampP(porosity), cc = clampC(cellSize), ca = clampA(anisotropy);
    const prediction = forwardModel(type, cp, cc, ca);
    const errors: InverseSolution['errors'] = {};
    if (targets.ETarget && targets.ETarget > 0) errors.E = Math.abs(prediction.EGPa - targets.ETarget) / targets.ETarget;
    if (targets.kappaTarget && targets.kappaTarget > 0) errors.kappa = Math.max(0, (targets.kappaTarget - prediction.kappaM2) / targets.kappaTarget);
    if (targets.porosityTarget && targets.porosityTarget > 0) errors.porosity = Math.abs(prediction.porosity - targets.porosityTarget);
    solutions.push({
      type,
      params: { type, porosity: cp, cellSize: cc, anisotropy: ca },
      prediction,
      objective: best!.j,
      errors,
    });
  }
  solutions.sort((a, b) => a.objective - b.objective);
  return {
    solutions,
    converged: solutions[0].objective <= 1e-6,
    elapsedMs: performance.now() - t0,
  };
}

// ── 解剖学/工程预设库（目标来自文献典型带的中位量级）──

export interface InversePreset {
  key: string;
  label: string;
  description: string;
  targets: DesignTargets;
}

export const INVERSE_PRESETS: InversePreset[] = [
  {
    key: 'cortical',
    label: '股骨皮质骨',
    description: 'E* 15 GPa 致密承载（孔隙率按 GA 模型自动权衡，典型 20~35%）',
    targets: { ETarget: 15, wE: 1, porosityTarget: 0.25, wP: 1 },
  },
  {
    key: 'trabecular',
    label: '股骨近端松质骨',
    description: 'E* 1.5 GPa + 高孔隙 78% + κ ≥ 1×10⁻⁸ m² 传质',
    targets: { ETarget: 1.5, wE: 1, porosityTarget: 0.78, wP: 1, kappaTarget: 1e-8, wKappa: 1 },
  },
  {
    key: 'heatsink',
    label: '高通量微流体散热沉',
    description: 'κ ≥ 5×10⁻⁸ m² + 高孔隙 82% + 高比表面积',
    targets: { kappaTarget: 5e-8, wKappa: 1, porosityTarget: 0.82, wP: 1 },
  },
];
