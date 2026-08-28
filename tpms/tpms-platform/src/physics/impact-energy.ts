/**
 * 动态冲击吸能（SEA）与振动模态特性预估（v4.0 阶段 IV）
 *
 * 压溃吸能模型（Gibson-Ashby 平台理想化）：
 *   · 平台应力 σ_pl = C2·σ_ys·ρ̄^1.5（C2=0.3，与 physics/gibson-ashby.ts 同源）
 *   · 密实化应变 ε_d = 1 − 1.4·ρ̄（任务宪章式；ρ̄→1 时 ε_d→负值需钳制）
 *   · 理想化曲线：弹性段 σ = E*·ε 至 ε_y = σ_pl/E*，之后平台段 σ_pl 至 ε_d
 *   · SEA = ∫₀^{ε_d} σ dε / (ρ_s·ρ̄)（单位质量比吸能，J/g）
 *   · 吸能效率 η(ε) = W(ε)/(σ(ε)·ε)；初始峰值压溃应力 σ_peak = κ_ip·σ_pl
 *     （κ_ip=1.2 完美点阵初始峰系数，理想化口径声明）
 *
 * 振动模态（等效均匀梁解析解，非 FEA）：
 *   等效实心梁：E* = C1·ρ̄²·E0（方向轴），ρ* = ρ̄·ρ_s，横截面 L×L（试样边长）
 *   简支梁弯曲 f_n = (n²π/2L²)·√(E*I/ρ*A)；轴向 f = (1/2L)·√(E★/ρ★)；
 *   扭转 f = (1/2L)·√(G/ρ★)，G = E★/(2(1+ν))
 *   正交对称：方形截面 x/y 两向弯曲频率精确相等（审计断言）。
 * 诚实边界：一阶工程估算口径，非 FEA；动态率效应（应变率强化）未计。
 */

import type { TpmType } from '../types';
import { gibsonAshby } from './gibson-ashby';

/** 基体材料（缺省 TC4） */
export const RHO_S_GCMM3 = 4.43;      // g/cm³（TC4）
export const E0_GPA = 110;            // GPa
const C2 = 0.3;
const K_INITIAL_PEAK = 1.2;

export interface CrushResult {
  sigmaPl: number;        // 平台应力（MPa）
  sigmaPeak: number;      // 初始峰值压溃应力（MPa）
  epsilonD: number;       // 密实化应变
  epsilonY: number;       // 平台起始（屈服）应变
  seaJPerG: number;       // 比吸能（J/g）
  seaJPerKg: number;      // 比吸能（J/kg）
  etaAtEpsilonD: number;  // 密实化处吸能效率 η(ε_d)
  workDensity: number;    // W(ε_d) 吸能密度（MJ/m³ = MPa）
}

/**
 * 压溃吸能计算。
 * @param relativeDensity 相对密度 ρ̄（0~1）
 * @param type 曲面类型（C1 平台系数用）
 * @param sigmaYsMPa 基体屈服强度（MPa，TC4 880）
 */
export function computeCrush(relativeDensity: number, type: TpmType, sigmaYsMPa = 880): CrushResult {
  const rho = Math.min(0.9, Math.max(0.03, relativeDensity));
  const ga = gibsonAshby(rho, type);
  const sigmaPl = C2 * sigmaYsMPa * Math.pow(rho, 1.5);
  const eStar = ga.E_Es * E0_GPA * 1000;               // MPa
  const epsilonD = Math.max(0.05, Math.min(0.85, 1 - 1.4 * rho));
  const epsilonY = sigmaPl / eStar;
  const sigmaPeak = K_INITIAL_PEAK * sigmaPl;

  // 分段积分：W(ε) = ∫σ dε
  const work = (e: number): number => {
    if (e <= epsilonY) return 0.5 * eStar * e * e;
    return 0.5 * eStar * epsilonY * epsilonY + sigmaPl * (e - epsilonY);
  };
  const workDensity = work(epsilonD);                          // MPa = MJ/m³
  const rhoStarKgM3 = rho * RHO_S_GCMM3 * 1000;                // kg/m³
  const seaJPerKg = (workDensity * 1e6) / rhoStarKgM3;
  const seaJPerG = seaJPerKg / 1000;
  const eta = work(epsilonD) / (sigmaPl * epsilonD);           // 平台段 σ=σ_pl：η=W/(σ·ε)
  return {
    sigmaPl,
    sigmaPeak,
    epsilonD,
    epsilonY,
    seaJPerG,
    seaJPerKg,
    etaAtEpsilonD: eta,
    workDensity,
  };
}

/** 吸能效率 η(ε)：给定应变处的 W(ε)/(σ(ε)·ε)（与 computeCrush 的分段曲线一致） */
export function energyEfficiency(relativeDensity: number, epsilon: number, type: TpmType): number {
  const cr = computeCrush(relativeDensity, type);
  const e = Math.min(epsilon, cr.epsilonD);
  if (e <= 0 || cr.epsilonY <= 0) return 0;
  const sigmaE = e <= cr.epsilonY ? cr.sigmaPl * (e / cr.epsilonY) : cr.sigmaPl;
  const w = e <= cr.epsilonY
    ? 0.5 * (cr.sigmaPl / cr.epsilonY) * e * e
    : 0.5 * (cr.sigmaPl / cr.epsilonY) * cr.epsilonY * cr.epsilonY + cr.sigmaPl * (e - cr.epsilonY);
  return w / (sigmaE * e);
}

export interface ModalResult {
  /** 前 6 阶固有频率（Hz，升序） */
  frequenciesHz: number[];
  /** 模态说明（与频率一一对应） */
  modes: string[];
  /** 第 1 阶固有频率 */
  f1: number;
}

/**
 * 等效梁前 6 阶模态：4 弯曲（x/y 两向 × n=1,2）+ 1 轴向 + 1 扭转，升序。
 * @param relativeDensity 相对密度
 * @param type 曲面类型
 * @param beamLengthMm 试样边长（mm）
 */
export function computeModal(relativeDensity: number, type: TpmType, beamLengthMm: number): ModalResult {
  const rho = Math.min(0.9, Math.max(0.03, relativeDensity));
  const ga = gibsonAshby(rho, type);
  const ePa = ga.E_Es * E0_GPA * 1e9;                    // Pa
  const nu = 0.34;
  const gPa = ePa / 1e9 / (2 * (1 + nu));                // GPa
  const rhoKgM3 = rho * RHO_S_GCMM3 * 1000;
  const L = beamLengthMm / 1000;                          // m

  // 弯曲：Euler-Bernoulli 简支梁 f_n = (n²π/2L²)·√(EI/ρA)
  const I = Math.pow(L, 4) / 12;                          // 方形截面
  const A = L * L;
  const bend = (n: number): number => (n * n * Math.PI / (2 * L * L)) * Math.sqrt((ePa * I) / (rhoKgM3 * A));
  const fBx1 = bend(1), fBx2 = bend(2);
  const fBy1 = bend(1), fBy2 = bend(2);
  // 轴向：f = (1/2L)·√(E/ρ)
  const fAx = (1 / (2 * L)) * Math.sqrt(ePa / rhoKgM3);
  // 扭转：f = (1/2L)·√(G/ρ)
  const fTor = (1 / (2 * L)) * Math.sqrt((gPa * 1e9) / rhoKgM3);

  const all: { f: number; m: string }[] = [
    { f: fBx1, m: '一阶弯曲(x)' },
    { f: fBy1, m: '一阶弯曲(y)' },
    { f: fBx2, m: '二阶弯曲(x)' },
    { f: fBy2, m: '二阶弯曲(y)' },
    { f: fAx, m: '轴向' },
    { f: fTor, m: '扭转' },
  ];
  all.sort((a, b) => a.f - b.f);
  return {
    frequenciesHz: all.map((o) => o.f),
    modes: all.map((o) => o.m),
    f1: all[0].f,
  };
}
