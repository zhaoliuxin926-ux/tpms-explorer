/**
 * 多轴应力各向异性屈服面与失效包络引擎（v7.0 Stage II）
 *
 * 在主应力空间 (σ1,σ2,σ3)（MPa）构建封闭凸失效包络面，为航空航天与骨科植入物
 * 提供复杂复合受力（双轴拉/压、三轴围压、扭转剪切）下的破坏裕度定量评价。
 *
 * 四个准则（统一「射线距离」口径：从原点沿单位方向 n̂ 走到包络面的距离 r(n̂)）：
 *  1. Hill-48 各向异性二次准则（主应力空间，含静水压力帽以防圆柱开放——帽值
 *     capM 为工程估算口径，文档化于 WORKFLOW_GUIDE §32）
 *  2. Tsai-Wu 拉-压不对称张量准则（主空间对角强度形式，Xt/Xc 双强度精确复现）
 *  3. Gurson 多孔塑性压溃准则（q = 孔隙率，σm 极点解析式 (2σ0/3)·arccosh((1+q²)/2q)）
 *  4. Drucker-Prager 拉压不对称圆锥（σyt/σyc 反演 α,k；压缩侧平台帽封闭）
 *
 * 数学定案（门禁 33 守护）：
 *  - 所有约束域均为凸集且包含原点于内部 ⇒ 包络星形凸，射线距离单值；
 *  - 凸域相交仍凸（Hill×静水帽、DP×压缩帽），中点凸性以行为级断言押注；
 *  - Gurson f 沿射线严格单调（σv(n)² 增 + cosh 增）⇒ 二分法可靠；
 *  - Tsai-Wu 射线距离有解析二次根式（无迭代）。
 */

// ── Hill-48 ──

export interface Hill48Config {
  /** 方向拉伸屈服强度 X(1),Y(2),Z(3)（MPa） */
  X: number; Y: number; Z: number;
  /** 静水压力帽 |σm| ≤ capM（MPa；多孔骨架静水承载工程估算） */
  capM: number;
}

/** Hill 系数 F,G,H 由方向屈服强度反解（F+G=1/Z², F+H=1/Y²... 标准关系） */
export function hill48Constants(c: Hill48Config): { F: number; G: number; H: number } {
  const F = 0.5 * (1 / (c.Y * c.Y) + 1 / (c.Z * c.Z) - 1 / (c.X * c.X));
  const G = 0.5 * (1 / (c.Z * c.Z) + 1 / (c.X * c.X) - 1 / (c.Y * c.Y));
  const H = 0.5 * (1 / (c.X * c.X) + 1 / (c.Y * c.Y) - 1 / (c.Z * c.Z));
  if (!(F > 0 && G > 0 && H > 0)) {
    throw new Error('Hill-48 系数非正：方向屈服强度比值过失衡（需满足四面体不等式）');
  }
  return { F, G, H };
}

/** Hill-48 射线距离：r = 1/√(F(n2−n3)²+G(n3−n1)²+H(n1−n2)²)，与静水帽取 min */
export function hill48RayDist(n: [number, number, number], c: Hill48Config): number {
  const { F, G, H } = hill48Constants(c);
  const hq = F * (n[1] - n[2]) ** 2 + G * (n[2] - n[0]) ** 2 + H * (n[0] - n[1]) ** 2;
  let r = hq > 1e-300 ? 1 / Math.sqrt(hq) : Infinity;
  const mAbs = Math.abs((n[0] + n[1] + n[2]) / 3);
  if (mAbs > 1e-300) r = Math.min(r, c.capM / mAbs);
  return r;
}

// ── Tsai-Wu ──

export interface TsaiWuConfig {
  /** 主方向拉伸/压缩强度 Xt,Xc,Yt,Yc,Zt,Zc（MPa，正数） */
  Xt: number; Xc: number; Yt: number; Yc: number; Zt: number; Zc: number;
}

/** Tsai-Wu 射线距离（解析二次根）：a·r² + b·r − 1 = 0 的正根 */
export function tsaiWuRayDist(n: [number, number, number], c: TsaiWuConfig): number {
  const F1 = 1 / c.Xt - 1 / c.Xc;
  const F2 = 1 / c.Yt - 1 / c.Yc;
  const F3 = 1 / c.Zt - 1 / c.Zc;
  const F11 = 1 / (c.Xt * c.Xc);
  const F22 = 1 / (c.Yt * c.Yc);
  const F33 = 1 / (c.Zt * c.Zc);
  const a = F11 * n[0] * n[0] + F22 * n[1] * n[1] + F33 * n[2] * n[2];
  const b = F1 * n[0] + F2 * n[1] + F3 * n[2];
  if (a <= 1e-300) return Infinity;
  return (-b + Math.sqrt(b * b + 4 * a)) / (2 * a);
}

// ── Gurson ──

export interface GursonConfig {
  /** 基体（致密）屈服强度 σ0（MPa） */
  sigma0: number;
  /** 孔隙率 q ∈ (0,1]（多孔压溃的核心物理参数；q→0 退化为 von Mises 圆柱非封闭） */
  q: number;
}

/** Gurson 屈服函数 f(σv, σm) = σv²/σ0² + 2q·cosh(3σm/2σ0) − 1 − q² */
export function gursonF(sigmaV: number, sigmaM: number, c: GursonConfig): number {
  return (sigmaV * sigmaV) / (c.sigma0 * c.sigma0)
    + 2 * c.q * Math.cosh((3 * sigmaM) / (2 * c.sigma0)) - 1 - c.q * c.q;
}

/** Gurson 静水极点解析值：σm_pole = (2σ0/3)·arccosh((1+q²)/(2q)) */
export function gursonHydrostaticPole(c: GursonConfig): number {
  const arg = (1 + c.q * c.q) / (2 * c.q);
  return (2 * c.sigma0 / 3) * Math.acosh(arg);
}

/** Gurson 射线距离（f 沿射线严格单调 ⇒ 二分；σv = r√(3j2), σm = r·m(n)） */
export function gursonRayDist(n: [number, number, number], c: GursonConfig): number {
  const nbar = (n[0] + n[1] + n[2]) / 3;
  const m = nbar;
  let j2 = 0;
  for (let i = 0; i < 3; i++) j2 += (n[i] - nbar) ** 2;
  j2 *= 0.5;
  const svCoeff = Math.sqrt(3 * j2);   // σv(r) = r·svCoeff
  const f = (r: number) => gursonF(r * svCoeff, r * m, c);
  // f(0) = −(1−q)² < 0（q<1 严格内含原点）
  let hi = 1e-3 * c.sigma0;
  for (let i = 0; i < 220 && f(hi) <= 0; i++) hi *= 1.5;
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) <= 0) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ── Drucker-Prager ──

export interface DpConfig {
  /** 单轴拉伸/压缩屈服（MPa），σyc > σyt > 0（拉压不对称） */
  sigmaYt: number; sigmaYc: number;
  /** 静水压缩帽 I1 ≤ −capI1 封闭（多孔压溃平台口径） */
  capI1: number;
}

/** DP 参数反演：单轴两态精确命中（√J2+αI1=k） */
export function dpConstants(c: DpConfig): { alpha: number; k: number } {
  const alpha = (c.sigmaYc - c.sigmaYt) / (Math.sqrt(3) * (c.sigmaYc + c.sigmaYt));
  const k = c.sigmaYt / Math.sqrt(3) + alpha * c.sigmaYt;
  return { alpha, k };
}

/** DP 射线距离：r = k/(√j2+α·i1)（分母 ≤0 时该方向锥内无界），压缩帽取 min */
export function dpRayDist(n: [number, number, number], c: DpConfig): number {
  const { alpha, k } = dpConstants(c);
  const nbar = (n[0] + n[1] + n[2]) / 3;
  let j2 = 0;
  for (let i = 0; i < 3; i++) j2 += (n[i] - nbar) ** 2;
  j2 *= 0.5;
  const denom = Math.sqrt(j2) + alpha * (n[0] + n[1] + n[2]);
  let r = denom > 1e-300 ? k / denom : Infinity;
  const i1Abs = Math.abs(n[0] + n[1] + n[2]);
  if (i1Abs > 1e-300) r = Math.min(r, c.capI1 / i1Abs);
  return r;
}

// ── 统一口径 ──

export type YieldCriterionKind = 'hill48' | 'tsaiwu' | 'gurson' | 'drucker-prager';

export type YieldConfig = Hill48Config | TsaiWuConfig | GursonConfig | DpConfig;

export const YIELD_CRITERIA_LABEL: Record<YieldCriterionKind, string> = {
  hill48: 'Hill-48 各向异性（+静水帽）',
  tsaiwu: 'Tsai-Wu 拉压不对称',
  gurson: 'Gurson 多孔压溃',
  'drucker-prager': 'Drucker-Prager 圆锥（+压帽）',
};

/** 统一射线距离（单位方向 n） */
export function radialDistance(kind: YieldCriterionKind, n: [number, number, number], c: YieldConfig): number {
  const nrm = Math.hypot(n[0], n[1], n[2]);
  const u: [number, number, number] = [n[0] / nrm, n[1] / nrm, n[2] / nrm];
  switch (kind) {
    case 'hill48': return hill48RayDist(u, c as Hill48Config);
    case 'tsaiwu': return tsaiWuRayDist(u, c as TsaiWuConfig);
    case 'gurson': return gursonRayDist(u, c as GursonConfig);
    case 'drucker-prager': return dpRayDist(u, c as DpConfig);
  }
}

// ── 包络面网格（UV 球参数化 + 逐顶点射线距离）──

export interface EnvelopeMesh {
  positions: Float32Array;   // (segV+1)×(segU+1) × 3
  indices: Uint32Array;
  /** 射线距离谱（诊断用） */
  rMin: number;
  rMax: number;
}

/** 单位方向（球坐标：lat ∈ [−π/2, π/2] 极角，lon ∈ [0, 2π)） */
function sphereDir(lat: number, lon: number): [number, number, number] {
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
}

export function buildEnvelopeMesh(kind: YieldCriterionKind, c: YieldConfig, segU = 72, segV = 36): EnvelopeMesh {
  // 封闭索引球：经度环绕（iu 取模，无重复缝列）+ 南北极单顶点（无退化缝边）
  // ⇒ open edges = 0 由构造保证（门禁 33 E 段精确断言）
  const south = 0;
  const north = 1;
  const rows = segV - 1;   // 内部纬线行数（不含极点）
  const vertCount = 2 + rows * segU;
  const positions = new Float32Array(vertCount * 3);
  let rMin = Infinity;
  let rMax = 0;
  const setVert = (idx: number, n: [number, number, number]) => {
    const r = radialDistance(kind, n, c);
    if (!Number.isFinite(r)) throw new Error('包络面射线距离非有限：约束域未封闭');
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    positions[idx * 3] = r * n[0];
    positions[idx * 3 + 1] = r * n[1];
    positions[idx * 3 + 2] = r * n[2];
  };
  setVert(south, [0, 0, -1]);
  setVert(north, [0, 0, 1]);
  for (let iv = 1; iv <= rows; iv++) {
    const lat = -Math.PI / 2 + (iv / segV) * Math.PI;
    for (let iu = 0; iu < segU; iu++) {
      const lon = (iu / segU) * 2 * Math.PI;
      setVert(2 + (iv - 1) * segU + iu, sphereDir(lat, lon));
    }
  }
  const vertOf = (iv: number, iu: number): number => {
    if (iv === 0) return south;
    if (iv === segV) return north;
    return 2 + (iv - 1) * segU + (iu % segU);
  };
  const indices = new Uint32Array(segV * segU * 6);
  let t = 0;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = vertOf(iv, iu);
      const b = vertOf(iv, iu + 1);
      const d = vertOf(iv + 1, iu);
      const e = vertOf(iv + 1, iu + 1);
      if (a === b) {          // 南极扇形（iv=0）
        indices[t++] = a; indices[t++] = d; indices[t++] = e;
      } else if (d === e) {   // 北极扇形（iv=segV−1）
        indices[t++] = a; indices[t++] = d; indices[t++] = b;
      } else {
        indices[t++] = a; indices[t++] = d; indices[t++] = b;
        indices[t++] = b; indices[t++] = d; indices[t++] = e;
      }
    }
  }
  return { positions, indices: indices.slice(0, t), rMin, rMax };
}

// ── 安全系数与临界失效模式 ──

export interface SafetyResult {
  /** 安全系数 = 包络射线距离 / 当前应力模长（>1 安全） */
  sf: number;
  /** 当前应力状态到包络的归一化方向 */
  dir: [number, number, number];
  /** 该方向包络半径（MPa） */
  envelopeRadius: number;
  /** 当前应力模长（MPa） */
  stressNorm: number;
}

/** 应力安全系数：σ0 沿其径向等比放大至包络的倍数（星形凸包络下精确） */
export function safetyFactor(kind: YieldCriterionKind, c: YieldConfig, sigma0: [number, number, number]): SafetyResult {
  const norm = Math.hypot(sigma0[0], sigma0[1], sigma0[2]);
  if (!(norm > 1e-12)) throw new Error('应力状态为零向量：安全系数无定义');
  const dir: [number, number, number] = [sigma0[0] / norm, sigma0[1] / norm, sigma0[2] / norm];
  const r = radialDistance(kind, dir, c);
  return { sf: r / norm, dir, envelopeRadius: r, stressNorm: norm };
}

/** 多准则竞争：返回最危险（SF 最小）的准则（临界失效模式） */
export function criticalMode(
  configs: { kind: YieldCriterionKind; config: YieldConfig }[],
  sigma0: [number, number, number],
): { kind: YieldCriterionKind; result: SafetyResult } | null {
  let best: { kind: YieldCriterionKind; result: SafetyResult } | null = null;
  for (const { kind, config } of configs) {
    const result = safetyFactor(kind, config, sigma0);
    if (!best || result.sf < best.result.sf) best = { kind, result };
  }
  return best;
}

// ── 脚手架工程推导（UI 数据源，门禁 33 一致性锚点）──

import { estimateAnisotropicStiffness, BASE_YIELD_STRENGTH } from './gibson-ashby';

export interface ScaffoldYieldDerivation {
  /** 相对密度 ρ̄ */
  rho: number;
  /** 基体屈服强度 σys（MPa） */
  sigmaYs: number;
  /** 平台/有效屈服强度 σ_pl = C2·σys·ρ̄^1.5（与 impact-energy C2=0.3 同源）（MPa） */
  sigmaPl: number;
  /** 方向模量比（estimateAnisotropicStiffness 一阶几何调制） */
  E: [number, number, number];
  hill: Hill48Config;
  tsaiwu: TsaiWuConfig;
  gurson: GursonConfig;
  dp: DpConfig;
  /** 推导口径说明（诚实边界，随读数展示） */
  notes: string;
}

/**
 * 从当前结构参数推导四准则配置（工程估算口径，与渲染/统计同源）：
 *  - 方向屈服 X_i = σ_pl·√(E_i/Ē)：弯曲主导标度 σ∝√E 的一阶映射（文献带 ±30%，如实披露）；
 *  - 拉/压不对称：点阵弯曲主导构型拉弱于压，σyt = 0.7σ_pl，σyc = σ_pl；
 *  - Gurson q = 孔隙率（钳制 [0.05, 0.9] 防 q→0 圆柱退化）；σ0 = 基体 σys；
 *  - Hill 静水帽 capM = 2σ_pl；DP 压缩帽 capI1 = 3σ_pl（多孔压溃平台工程估算）。
 */
export function deriveScaffoldYieldConfigs(
  relativeDensity: number,
  type: string,
  porosityFrac: number,
  materialKey: string,
): ScaffoldYieldDerivation {
  const rho = Math.min(0.95, Math.max(0.02, relativeDensity));
  const matKey = materialKey === 'auto' ? 'tc4' : materialKey;
  const sigmaYs = BASE_YIELD_STRENGTH[matKey] ?? BASE_YIELD_STRENGTH.tc4;
  const sigmaPl = 0.3 * sigmaYs * Math.pow(rho, 1.5);
  const anis = estimateAnisotropicStiffness(rho, type);
  const E = anis.E;
  const Eavg = (E[0] + E[1] + E[2]) / 3;
  const Xi = E.map((e) => Math.max(1e-6, sigmaPl * Math.sqrt(e / Eavg))) as [number, number, number];
  const sigmaYt = 0.7 * sigmaPl;
  return {
    rho,
    sigmaYs,
    sigmaPl,
    E,
    hill: { X: Xi[0], Y: Xi[1], Z: Xi[2], capM: 2 * sigmaPl },
    tsaiwu: { Xt: sigmaYt, Xc: sigmaPl, Yt: 0.7 * Xi[1], Yc: Xi[1], Zt: 0.7 * Xi[2], Zc: Xi[2] },
    gurson: { sigma0: sigmaYs, q: Math.min(0.9, Math.max(0.05, porosityFrac)) },
    dp: { sigmaYt, sigmaYc: sigmaPl, capI1: 3 * sigmaPl },
    notes: `σ_pl=C2·σys·ρ̄^1.5（C2=0.3 与冲击吸能同源）· 方向强度=σ_pl·√(E_i/Ē) 一阶映射 · 拉压比 0.7 · 帽值为工程估算`,
  };
}
