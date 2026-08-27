/**
 * 隐函数曲率解析（数值中心差分）
 *
 * 以网格顶点的物理坐标为采样点，对隐函数 F(x,y,z)（当前 TPMS 公式，
 * 混合开启时为 w·f_A+(1-w)·f_B，与渲染场同源）做中心差分求梯度与 Hessian：
 *
 *   平均曲率  H = −(|∇F|²·Tr(H) − ∇F·H·∇Fᵀ) / (2|∇F|³)
 *   高斯曲率  K = (∇F·adj(H)·∇Fᵀ) / |∇F|⁴        （adj(H)=伴随矩阵）
 *
 * 符号约定：|∇F|→0 的临界点用下界钳制 + 数值清洗兜底；混叠自定义公式
 * （如 sin(x·40)）的二阶差分噪声由对称截断分位数归一化吸收——
 * 取 |值| 的 98% 分位数为显示半程 b，s = 0.5 + v/(2b)，超出部分饱和到端色。
 *
 * 步长 h 取物理坐标单位 0.02（弧度域对应 ~0.06·k）：远小于特征波长 π/k，
 * 又足以压制双精度的减法吞没。19 次求值/顶点，仅在用户选择曲率着色时付出。
 */

import type { TpmType } from '../types';
import { getTpmsFunction, type Weights } from '../core/tpms-functions';
import { getHybridWeightFn } from '../core/hybrid-functions';

/** 曲率模式种类 */
export type CurvatureKind = 'mean' | 'gauss';

/** 隐函数场配置（曲率计算对象须与屏幕几何同一公式） */
export interface CurvatureFieldConfig {
  type: TpmType;
  customFormula: string;
  weights: [number, number, number, number];
  periods: number;
  hybrid?: import('../core/hybrid-functions').HybridConfig;  // 轴向可选（缺省 x）
}

const H_STEP = 0.02;

/** 构造物理坐标下的隐函数采样器 F(px,py,pz)；must 与 surface-nets 场填充同源 */
function makeFieldSampler(cfg: CurvatureFieldConfig): (px: number, py: number, pz: number) => number {
  const k = cfg.periods;
  const w = cfg.weights as Weights;
  const PI = Math.PI;
  const fA = getTpmsFunction(cfg.type === 'custom' ? 'custom' : cfg.type, cfg.customFormula);
  if (!cfg.hybrid?.enabled) {
    return (x, y, z) => fA(x * PI * k, y * PI * k, z * PI * k, w);
  }
  const fB = getTpmsFunction(cfg.hybrid.typeB, '');
  const wf = getHybridWeightFn(cfg.hybrid);
  return (x, y, z) => {
    const mx = x * PI * k, my = y * PI * k, mz = z * PI * k;
    const wgt = wf(x, y, z);
    return wgt * fA(mx, my, mz, w) + (1 - wgt) * fB(mx, my, mz, w);
  };
}

/**
 * 单点曲率（F 在 (x,y,z) 处）。返回 [meanH, gaussK]，异常输入经钳制不产 NaN。
 * 19 点模板：1 中心 + 6 轴向（一阶与对角二阶共用）+ 12 角点（交叉二阶）。
 */
function curvaturesAt(
  F: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number,
): [number, number] {
  const h = H_STEP, h2 = h * h;
  const f00 = F(x, y, z);
  const fxp = F(x + h, y, z), fxm = F(x - h, y, z);
  const fyp = F(x, y + h, z), fym = F(x, y - h, z);
  const fzp = F(x, y, z + h), fzm = F(x, y, z - h);

  const gx = (fxp - fxm) / (2 * h);
  const gy = (fyp - fym) / (2 * h);
  const gz = (fzp - fzm) / (2 * h);

  const fxx = (fxp - 2 * f00 + fxm) / h2;
  const fyy = (fyp - 2 * f00 + fym) / h2;
  const fzz = (fzp - 2 * f00 + fzm) / h2;
  // 交叉项：混合差分 (F₊₊−F₊₋−F₋₊+F₋₋)/(4h²)
  const fxy = (F(x + h, y + h, z) - F(x + h, y - h, z) - F(x - h, y + h, z) + F(x - h, y - h, z)) / (4 * h2);
  const fyz = (F(x, y + h, z + h) - F(x, y + h, z - h) - F(x, y - h, z + h) + F(x, y - h, z - h)) / (4 * h2);
  const fxz = (F(x + h, y, z + h) - F(x + h, y, z - h) - F(x - h, y, z + h) + F(x - h, y, z - h)) / (4 * h2);

  const gl2 = Math.max(gx * gx + gy * gy + gz * gz, 1e-24);
  const gl = Math.sqrt(gl2);
  const gl4inv = 1 / Math.max(gl2 * gl2, 1e-48);
  const gl3inv = 1 / Math.max(gl2 * gl, 1e-36);

  const trace = fxx + fyy + fzz;
  // ∇F·H·∇Fᵀ
  const ghg = gx * gx * fxx + gy * gy * fyy + gz * gz * fzz + 2 * (gx * gy * fxy + gx * gz * fxz + gy * gz * fyz);
  const mean = -(gl2 * trace - ghg) * gl3inv / 2;

  // adj(H)：对称矩阵伴随，对角元
  const a11 = fyy * fzz - fyz * fyz;
  const a22 = fxx * fzz - fxz * fxz;
  const a33 = fxx * fyy - fxy * fxy;
  // ∇F·adj(H)·∇Fᵀ 内联展开：
  // = gx²(fyy·fzz−fyz²) + gy²(fxx·fzz−fxz²) + gz²(fxx·fyy−fxy²)
  //   + 2[ gx·gy(fxz·fyz−fzz·fxy) + gx·gz(fxy·fyz−fyy·fxz) + gy·gz(fxy·fxz−fxx·fyz) ]
  const qaa = gx * gx * a11 + gy * gy * a22 + gz * gz * a33;
  const qab = 2 * (
    gx * gy * (fxz * fyz - fzz * fxy)
    + gx * gz * (fxy * fyz - fyy * fxz)
    + gy * gz * (fxy * fxz - fxx * fyz)
  );
  const gauss = (qaa + qab) * gl4inv;

  // 数值清洗：任何有限性破坏一律归零（配色走中性白）
  const safe = (v: number): number => (Number.isFinite(v) ? (Math.abs(v) > 1e12 ? Math.sign(v) * 1e12 : v) : 0);
  return [safe(mean), safe(gauss)];
}

/**
 * 全顶点曲率标量 → 已归一化到 [0,1] 的数组（对称截断分位数，Cool-Warm 直接可用）。
 * 返回长度 vertCount。
 */
export function estimateCurvatureScalars(
  positions: Float32Array,
  vertCount: number,
  cfg: CurvatureFieldConfig,
  kind: CurvatureKind,
): Float32Array {
  const out = new Float32Array(vertCount);
  if (vertCount === 0 || positions.length < vertCount * 3) return out;
  const F = makeFieldSampler(cfg);
  const INV_PI = 1 / Math.PI;

  const vals = new Float32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const [m, g] = curvaturesAt(F, positions[i * 3] * INV_PI, positions[i * 3 + 1] * INV_PI, positions[i * 3 + 2] * INV_PI);
    vals[i] = kind === 'mean' ? m : g;
  }

  // 对称截断分位数：98% 分位的 |值| 作为显示半程（抽样排序上限 65536 控制成本）
  const stride = Math.max(1, Math.floor(vertCount / 65536));
  const sampleLen = Math.floor((vertCount - 1) / stride) + 1;
  const absSample = new Float32Array(sampleLen);
  for (let j = 0; j < sampleLen; j++) absSample[j] = Math.abs(vals[j * stride]);
  absSample.sort();
  const qIdx = Math.min(absSample.length - 1, Math.floor(absSample.length * 0.98));
  const band = Math.max(absSample[qIdx], 1e-9);

  for (let i = 0; i < vertCount; i++) {
    let s = 0.5 + vals[i] / (2 * band);
    out[i] = s < 0 ? 0 : s > 1 ? 1 : s;
  }
  return out;
}
