/**
 * TPMS 隐函数核心库
 * 包含 6 种经典 TPMS 曲面 + 自定义公式解析器。
 * 所有函数接受弧度域坐标 (mx, my, mz) 和权重数组 w，返回标量场值 V。
 */

import type { TpmType } from '../types';

/** 权重数组，最多 4 项 */
export type Weights = [number, number, number, number];

/** TPMS 场函数签名 */
export type TpmsFunction = (mx: number, my: number, mz: number, w: Weights) => number;

/** Gyroid: sin x·cos y + sin y·cos z + sin z·cos x */
const gyroid: TpmsFunction = (mx, my, mz, w) =>
  w[0] * Math.sin(mx) * Math.cos(my) +
  w[1] * Math.sin(my) * Math.cos(mz) +
  w[2] * Math.sin(mz) * Math.cos(mx);

/** Diamond: cos x·cos y·cos z - sin x·sin y·sin z (四项权重版) */
const diamond: TpmsFunction = (mx, my, mz, w) =>
  w[0] * Math.cos(mx) * Math.cos(my) * Math.cos(mz) -
  w[1] * Math.sin(mx) * Math.sin(my) * Math.sin(mz) +
  w[2] * Math.cos(mx) * Math.sin(my) * Math.sin(mz) +
  w[3] * Math.sin(mx) * Math.cos(my) * Math.sin(mz);

/** Schwarz P: cos x + cos y + cos z */
const schwarz: TpmsFunction = (mx, my, mz, w) =>
  w[0] * Math.cos(mx) + w[1] * Math.cos(my) + w[2] * Math.cos(mz);

/** Neovius: 3(cos x + cos y + cos z) + 4·cos x·cos y·cos z */
const neovius: TpmsFunction = (mx, my, mz, w) =>
  3 * w[0] * (Math.cos(mx) + Math.cos(my) + Math.cos(mz)) +
  4 * w[1] * Math.cos(mx) * Math.cos(my) * Math.cos(mz);

/** I-WP: 2(cos x·cos y + cos y·cos z + cos z·cos x) - (cos 2x + cos 2y + cos 2z) */
const iwp: TpmsFunction = (mx, my, mz, w) =>
  2 * w[0] * (Math.cos(mx) * Math.cos(my) + Math.cos(my) * Math.cos(mz) + Math.cos(mz) * Math.cos(mx)) -
  w[1] * (Math.cos(2 * mx) + Math.cos(2 * my) + Math.cos(2 * mz));

/** F-RD: 4·cos x·cos y·cos z - (cos 2x·cos 2y + cos 2y·cos 2z + cos 2z·cos 2x) */
const frd: TpmsFunction = (mx, my, mz, w) =>
  4 * w[0] * Math.cos(mx) * Math.cos(my) * Math.cos(mz) -
  w[1] * (Math.cos(2 * mx) * Math.cos(2 * my) + Math.cos(2 * my) * Math.cos(2 * mz) + Math.cos(2 * mz) * Math.cos(2 * mx));

/**
 * Lidinoid（利迪诺曲面）：2 权重
 * 0.5·w0·(2 sinx cosx cosy sinz + 2 siny cosy cosz sinx + 2 sinz cosz cosx siny)
 * − 0.5·w1·(cos2x cos2y + cos2y cos2z + cos2z cos2x)
 * 经典三周期极小曲面，与 Gyroid 同属螺旋对称族但通道更复杂。
 */
const lidinoid: TpmsFunction = (mx, my, mz, w) =>
  w[0] * 0.5 * (
    2 * Math.sin(mx) * Math.cos(mx) * Math.cos(my) * Math.sin(mz) +
    2 * Math.sin(my) * Math.cos(my) * Math.cos(mz) * Math.sin(mx) +
    2 * Math.sin(mz) * Math.cos(mz) * Math.cos(mx) * Math.sin(my)
  ) + w[1] * (-0.5) * (
    Math.cos(2 * mx) * Math.cos(2 * my) +
    Math.cos(2 * my) * Math.cos(2 * mz) +
    Math.cos(2 * mz) * Math.cos(2 * mx)
  );

/**
 * Split-P（分裂 P 曲面）：3 权重
 * 1.1·w0·(2 sinx cosx cosy sinz + 2 sinx siny cosy cosz + 2 cosx siny sinz cosz)
 * − 0.2·w1·(cos2x cos2y + cos2y cos2z + cos2z cos2x)
 * − 0.4·w2·(cos2x + cos2y + cos2z)
 * Schwarz P 的广义分裂变体，兼具 P 型与双曲型特征。
 */
const splitp: TpmsFunction = (mx, my, mz, w) =>
  w[0] * 1.1 * (
    2 * Math.sin(mx) * Math.cos(mx) * Math.cos(my) * Math.sin(mz) +
    2 * Math.sin(mx) * Math.sin(my) * Math.cos(my) * Math.cos(mz) +
    2 * Math.cos(mx) * Math.sin(my) * Math.sin(mz) * Math.cos(mz)
  ) + w[1] * (-0.2) * (
    Math.cos(2 * mx) * Math.cos(2 * my) +
    Math.cos(2 * my) * Math.cos(2 * mz) +
    Math.cos(2 * mz) * Math.cos(2 * mx)
  ) + w[2] * (-0.4) * (
    Math.cos(2 * mx) + Math.cos(2 * my) + Math.cos(2 * mz)
  );

/** 曲面类型 → 函数映射 */
export const TPMS_FUNCTIONS: Record<Exclude<TpmType, 'custom'>, TpmsFunction> = {
  gyroid, diamond, schwarz, neovius, iwp, frd, lidinoid, splitp,
};

/** 根据类型获取有效权重项数 */
export function getWeightCount(type: TpmType): number {
  switch (type) {
    case 'gyroid': case 'schwarz': return 3;
    case 'neovius': case 'iwp': case 'frd': return 2;
    case 'lidinoid': return 2;
    case 'splitp': return 3;
    case 'diamond': return 4;
    case 'custom': return 4;
    default: return 3;
  }
}

/** 获取某类型的默认权重 */
export function getDefaultWeights(type: TpmType): Weights {
  const n = getWeightCount(type);
  return [n > 0 ? 1 : 0, n > 1 ? 1 : 0, n > 2 ? 1 : 0, n > 3 ? 1 : 0] as Weights;
}

// ── 自定义公式解析器 ─────────────────────────────────────────────

interface CompiledFormula {
  fn: TpmsFunction;
  expr: string;
}

const compiledCache = new Map<string, CompiledFormula>();

/**
 * 解析用户自定义三维隐函数字符串，编译为可执行函数。
 * 支持变量：x, y, z；数学函数：sin, cos, tan, exp, log, sqrt, abs, pow, min, max, PI, E
 * 安全限制：仅允许白名单内的 token，拒绝任意代码执行。
 */
export function compileCustomFormula(expr: string): CompiledFormula {
  const key = expr.trim();
  if (compiledCache.has(key)) return compiledCache.get(key)!;

  const sanitized = sanitizeExpression(key);
  const fnBody = `with(Math){ return ${sanitized}; }`;

  // 使用 Function 构造器（比 eval 安全，但仍需 sanitize 前置）
  const fn = new Function('x', 'y', 'z', fnBody) as (x: number, y: number, z: number) => number;

  const wrapped: TpmsFunction = (mx, my, mz, _w) => fn(mx, my, mz);
  const compiled: CompiledFormula = { fn: wrapped, expr: key };
  compiledCache.set(key, compiled);
  return compiled;
}

/** 表达式 sanitize：只允许白名单字符和函数名 */
function sanitizeExpression(expr: string): string {
  // 1) 替换常量
  let s = expr.replace(/\bPI\b/g, 'Math.PI').replace(/\bE\b/g, 'Math.E');
  // 2) 替换数学函数（加 Math. 前缀）
  const safeFuncs = ['sin', 'cos', 'tan', 'exp', 'log', 'sqrt', 'abs', 'pow', 'min', 'max', 'floor', 'ceil', 'round'];
  for (const f of safeFuncs) {
    s = s.replace(new RegExp(`\\b${f}\\b(\\s*\\()`, 'g'), `Math.${f}$1`);
  }
  // 3) 拒绝危险字符
  const dangerous = /[;{}]|\b(?:eval|Function|constructor|prototype|window|document|globalThis|process|require|import|fetch)\b/i;
  if (dangerous.test(s)) {
    throw new Error('表达式包含不允许的字符或函数');
  }
  // 4) 只允许数字、运算符、括号、变量 x/y/z、Math. 前缀
  const allowed = /^[\d\s\+\-\*\/\^\(\)\.,x y zM a t h\.]+$/;
  if (!allowed.test(s)) {
    throw new Error('表达式包含非法字符');
  }
  // 5) 替换 ^ 为 **
  s = s.replace(/\^/g, '**');
  return s;
}

/** 获取某类型的场函数（含自定义解析） */
export function getTpmsFunction(type: TpmType, customFormula: string = ''): TpmsFunction {
  if (type === 'custom') {
    if (!customFormula.trim()) throw new Error('自定义类型需要提供公式');
    return compileCustomFormula(customFormula).fn;
  }
  return TPMS_FUNCTIONS[type as Exclude<TpmType, 'custom'>];
}

/** 缓存最近一次自定义公式的编译结果，避免内层循环重复 Map 查找 */
let cachedCustomFn: TpmsFunction | null = null;
let cachedCustomExpr = '';

/** 计算给定坐标下的 V 值（供 Worker 批量调用） */
export function evaluateField(
  type: TpmType,
  mx: number,
  my: number,
  mz: number,
  w: Weights,
  customFormula: string = ''
): number {
  if (type === 'custom') {
    if (customFormula !== cachedCustomExpr) {
      cachedCustomFn = compileCustomFormula(customFormula).fn;
      cachedCustomExpr = customFormula;
    }
    return cachedCustomFn!(mx, my, mz, w);
  }
  return TPMS_FUNCTIONS[type](mx, my, mz, w);
}

/** 解析梯度（用于法线计算） */
export function evaluateGradient(
  type: TpmType,
  mx: number,
  my: number,
  mz: number,
  w: Weights,
  customFormula: string = ''
): [number, number, number] {
  const h = 1e-4;
  let f: TpmsFunction;
  if (type === 'custom') {
    if (customFormula !== cachedCustomExpr) {
      cachedCustomFn = compileCustomFormula(customFormula).fn;
      cachedCustomExpr = customFormula;
    }
    f = cachedCustomFn!;
  } else {
    f = TPMS_FUNCTIONS[type];
  }
  const fx = (f(mx + h, my, mz, w) - f(mx - h, my, mz, w)) / (2 * h);
  const fy = (f(mx, my + h, mz, w) - f(mx, my - h, mz, w)) / (2 * h);
  const fz = (f(mx, my, mz + h, w) - f(mx, my, mz - h, w)) / (2 * h);
  return [fx, fy, fz];
}
