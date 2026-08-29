/**
 * 数字孪生准静态单轴压缩与断裂失效预测（v6.0 阶段 II · Digital Twin Compression）
 *
 * 联合 gpu-plasticity-solver 的弹塑性大变形求解：
 *   · 上端板位移加载（Δu 载荷步），实时统计宏观反力 F_total 与工程应变 ε = Δu/L0；
 *   · 最大主应变失效准则：逐单元 Green-Lagrange 应变主值 |ε_max| 超过材料极限时
 *     触发单元生死（Element Deactivation）——逐层塌陷/脆断的代理模型；
 *   · 平台应力 σ_pl：屈服后应变窗口内 σ_engineering = F/A0 的均值；
 *   · Gibson-Ashby 对比：σ_pl/σ_sy = C2·ρ̄^1.5（文献经验式，C2=0.3 与
 *     physics/gibson-ashby.ts 同源）。
 *
 * 诚实边界（WORKFLOW_GUIDE §27 披露）：全积分六面体体素 FEM 对平台应力存在
 * 系统性高估（弯曲主导的细杆网格在粗分辨率下偏刚），DT/GA 比值作为标定常数
 * 披露并由门禁 28 守其跨分辨率稳定性；GA 数字本身是文献口径估计，不是本模型输出。
 */

import { solvePlasticityCompression, type PlasticityResult, type PlasticityStepResult } from './gpu-plasticity-solver';

/** Gibson-Ashby 平台应力系数（与 gibson-ashby.ts 的 C2 同源同值） */
export const GA_C2 = 0.3;

/**
 * 对称 3×3 张量主值（解析 Cardano，行主序 9 分量）。
 * 误差 O(1e-12)（正交不变量路径），由门禁 28 解析基准断言。
 */
export function principalValues3x3(m: ArrayLike<number>): [number, number, number] {
  const [a11, a12, a13, , a22, a23, , , a33] = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
  const p = a12 * a12 + a13 * a13 + a23 * a23;
  if (p === 0) return [Math.max(a11, a22, a33), (a11 + a22 + a33) - Math.max(a11, a22, a33) - Math.min(a11, a22, a33), Math.min(a11, a22, a33)];
  const q = (a11 + a22 + a33) / 3;
  const p1 = (a11 - q) ** 2 + (a22 - q) ** 2 + (a33 - q) ** 2 + 2 * p;
  const p2 = Math.sqrt(p1 / 6);
  // B = (A − qI)/p2
  const b11 = (a11 - q) / p2, b22 = (a22 - q) / p2, b33 = (a33 - q) / p2;
  const b12 = a12 / p2, b13 = a13 / p2, b23 = a23 / p2;
  const detB = b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13);
  const r = detB / 2;
  const phi = Math.acos(Math.max(-1, Math.min(1, r))) / 3;
  const eig1 = q + 2 * p2 * Math.cos(phi);
  const eig3 = q + 2 * p2 * Math.cos(phi + (2 * Math.PI) / 3);
  const eig2 = 3 * q - eig1 - eig3;
  return [eig1, eig2, eig3];
}

/** GL 应变 Voigt（工程剪切）→ 主应变（降序） */
export function principalStrains(eVoigt: ArrayLike<number>): [number, number, number] {
  const t = [eVoigt[0], eVoigt[3] / 2, eVoigt[5] / 2, eVoigt[3] / 2, eVoigt[1], eVoigt[4] / 2, eVoigt[5] / 2, eVoigt[4] / 2, eVoigt[2]];
  return principalValues3x3(t);
}

export interface CompressionTwinParams {
  R: number;
  solid: Uint8Array;
  /** 目标孔隙率 0–1（Gibson-Ashby 对比用相对密度 ρ̄ = 1 − P） */
  porosity: number;
  /** 材料屈服比 σ_sy/E0（无量纲，如 Ti6Al4V ≈ 0.008） */
  sigmaYRatio: number;
  /** 失效极限：最大（拉伸）主应变 > 该值触发单元死亡（Ti6Al4V 延伸率 ≈ 0.10；默认 0.06） */
  failureStrain?: number;
  /** 每步最大杀死比例（渐进压溃口径，默认 0.15） */
  maxKillFraction?: number;
  /** 活性单元比例下限（低于则停杀，防全灭→K 奇异，默认 0.4） */
  activeFloorFraction?: number;
  hardening?: number;
  steps?: number;
  maxStrain?: number;
  tol?: number;
  /** 台账：每步被杀死的单元数 */
  onDeath?: (step: number, killed: number, totalDead: number) => void;
}

export interface CompressionTwinResult {
  /** 工程应力-应变曲线：σ = F/A0（E0 无量纲），ε = Δu/L0 */
  curve: Array<{ strain: number; stress: number; reaction: number; activeElems: number; peeq: number }>;
  /** 平台应力 σ_pl/E0（屈服后窗口均值；未屈服为 NaN） */
  plateauStress: number;
  /** Gibson-Ashby 预测 σ_pl/σ_sy（无量纲比值） */
  gaPrediction: number;
  /** DT 实测平台应力比 σ_pl/σ_sy */
  dtRatio: number;
  /** DT/GA 标定比（跨分辨率稳定量，门禁 28 守其稳定性） */
  calibrationRatio: number;
  /** 累计单元死亡数与死亡时间线 */
  totalDead: number;
  deathTimeline: Array<{ strain: number; killed: number }>;
  /** 塑性耗散能 / 单位参考体积（韧性指标代理） */
  plasticToughness: number;
  /** 终态场（视口着色用） */
  vonMises: Float32Array;
  peeq: Float32Array;
  allConverged: boolean;
  /** 是否检测到坍塌（步发散=结构失稳，曲线在其处截断） */
  collapsed: boolean;
  /** 坍塌应变（最后一个收敛步的应变；未坍塌为 null） */
  collapseStrain: number | null;
  energyDrift: number;
  elapsedMs: number;
}

/**
 * 运行数字孪生压缩实验。
 * 失效判据：|ε_principal,max| > failureStrain 的单元从下一步起退出刚度（单元生死）。
 */
export function runCompressionDigitalTwin(params: CompressionTwinParams): CompressionTwinResult {
  const t0 = performance.now();
  const R = params.R;
  const A0 = R * R;               // 初始截面（E0=1, h=1 → 单位换算相消；ε = Δu/L0 由求解器直接给出）
  const failureStrain = params.failureStrain ?? 0.05;
  const rho = Math.max(0.01, 1 - params.porosity);
  const gaRatio = GA_C2 * Math.pow(rho, 1.5);   // σ_pl/σ_sy 文献口径

  const deathTimeline: Array<{ strain: number; killed: number }> = [];
  let totalDead = 0;

  const plas: PlasticityResult = solvePlasticityCompression({
    R,
    solid: params.solid,
    nu: 0.3,
    sigmaY: params.sigmaYRatio,
    hardening: params.hardening ?? 0.05,
    steps: params.steps ?? 8,
    maxStrain: params.maxStrain ?? 0.04,
    tol: params.tol ?? 1e-5,
    tangent: 'geo',
    stopOnDiverge: true,
    onStep: (ctx) => {
      // 最大（拉伸）主应变失效 → 单元生死；每步杀死上限 + 活性下限守卫
      // （压溃主通道由塑性本构承担；死亡只代理拉伸断裂/失稳塌陷）
      let activeCount = 0;
      for (let i = 0; i < R * R * R; i++) if (params.solid[i] && ctx.active[i]) activeCount++;
      const solidCount = (() => { let n = 0; for (let i = 0; i < R * R * R; i++) if (params.solid[i]) n++; return n; })();
      if (activeCount <= solidCount * (params.activeFloorFraction ?? 0.4)) return;
      const maxKill = Math.max(1, Math.floor(activeCount * (params.maxKillFraction ?? 0.15)));
      // 收集超限单元按 |e1| 降序取前 maxKill 个
      const over: Array<{ vi: number; e1: number }> = [];
      for (let i = 0; i < R * R * R; i++) {
        if (!params.solid[i] || !ctx.active[i]) continue;
        const [e1] = principalStrains([
          ctx.strainTensor[i * 6], ctx.strainTensor[i * 6 + 1], ctx.strainTensor[i * 6 + 2],
          ctx.strainTensor[i * 6 + 3], ctx.strainTensor[i * 6 + 4], ctx.strainTensor[i * 6 + 5],
        ]);
        if (e1 > failureStrain) over.push({ vi: i, e1 });
      }
      over.sort((a, b) => b.e1 - a.e1);
      let killed = 0;
      for (const o of over) {
        if (killed >= maxKill) break;
        ctx.active[o.vi] = 0;
        killed++;
      }
      if (killed > 0) {
        totalDead += killed;
        deathTimeline.push({ strain: ctx.strain, killed });
        params.onDeath?.(ctx.step, killed, totalDead);
      }
    },
  });

  // 曲线：σ = F/A0（无量纲 E0=1）
  const steps: PlasticityStepResult[] = plas.steps;
  const curve = steps.map((st) => ({
    strain: st.strain,
    stress: st.reaction / A0,
    reaction: st.reaction,
    activeElems: st.deactivated >= 0 ? plas.activeVoxels : plas.activeVoxels, // 占位：见下
    peeq: st.maxPEEQ,
  }));
  // 逐步活跃单元数由死亡时间线重建
  {
    let active = plas.solidVoxels;
    let di = 0;
    for (const c of curve) {
      while (di < deathTimeline.length && deathTimeline[di].strain < c.strain - 1e-12) {
        active -= deathTimeline[di].killed;
        di++;
      }
      c.activeElems = active;
    }
  }

  // 平台应力：首个 PEEQ>0 步之后的应变窗口 [εy+0.25%, ε_end] 均值
  let plateauStress = NaN;
  {
    let iy = -1;
    for (let i = 0; i < steps.length; i++) if (steps[i].maxPEEQ > 0) { iy = i; break; }
    if (iy >= 0) {
      const e0 = steps[iy].strain + 0.0025;
      let sum = 0, n = 0;
      for (let i = iy; i < steps.length; i++) {
        if (steps[i].strain >= e0) { sum += curve[i].stress; n++; }
      }
      if (n > 0) plateauStress = sum / n;
    }
  }
  const dtRatio = plateauStress / params.sigmaYRatio;

  const collapsed = !plas.allConverged;
  return {
    curve,
    plateauStress,
    gaPrediction: gaRatio,
    dtRatio,
    calibrationRatio: Number.isFinite(dtRatio) ? dtRatio / gaRatio : NaN,
    totalDead,
    deathTimeline,
    plasticToughness: plas.steps[plas.steps.length - 1]?.energy.wPl ?? 0,
    vonMises: plas.vonMises,
    peeq: plas.peeq,
    allConverged: plas.allConverged,
    collapsed,
    collapseStrain: collapsed ? curve[curve.length - 1]?.strain ?? null : null,
    energyDrift: plas.steps[plas.steps.length - 1]?.energy.drift ?? NaN,
    elapsedMs: performance.now() - t0,
  };
}
