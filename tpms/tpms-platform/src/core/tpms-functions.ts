/**
 * TPMS 隐函数核心库
 * 包含 8 种经典 TPMS 曲面 + 自定义公式解析适配层（解析引擎收口于 core/equation-parser.ts：
 * 零依赖 AST 沙箱 + Dual Number 自动微分 + NumPy/MATLAB 代码生成，无 eval）。
 * 所有函数接受弧度域坐标 (mx, my, mz) 和权重数组 w，返回标量场值 V。
 */

import type { TpmType } from '../types';
import { compileEquation, DEFAULT_PARAMS, validateEquation, type EquationParams } from './equation-parser';

/** 权重数组，最多 4 项 */
export type Weights = [number, number, number, number];

/** TPMS 场函数签名 */
export type TpmsFunction = (mx: number, my: number, mz: number, w: Weights) => number;

/** Gyroid: sin x·cos y + sin y·cos z + sin z·cos x */
const gyroid: TpmsFunction = (mx, my, mz, w) =>
  w[0] * Math.sin(mx) * Math.cos(my) +
  w[1] * Math.sin(my) * Math.cos(mz) +
  w[2] * Math.sin(mz) * Math.cos(mx);

/** Diamond: sin x·sin y·sin z + sin x·cos y·cos z + cos x·sin y·cos z + cos x·cos y·sin z (四项权重版)
 *  必须与 surface-nets.ts 渲染查表、ui-helpers.ts 公式栏、单文件版 app.html 保持一致（.verify/parity_math.mjs 守护）。
 *  历史教训：此处曾写成 ccc−sss+css+scs 组合，导致 VTI/hybrid/脚本导出与屏幕渲染是不同曲面。 */
const diamond: TpmsFunction = (mx, my, mz, w) =>
  w[0] * Math.sin(mx) * Math.sin(my) * Math.sin(mz) +
  w[1] * Math.sin(mx) * Math.cos(my) * Math.cos(mz) +
  w[2] * Math.cos(mx) * Math.sin(my) * Math.cos(mz) +
  w[3] * Math.cos(mx) * Math.cos(my) * Math.sin(mz);

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

// ── 自定义公式解析适配层（解析/AD/代码生成统一收口 equation-parser） ─────

/** 动态参数句柄：调用方持有并按构建注入（{k: periods, t: thickness, iso}），
 *  闭包直接读取该对象——每次 getTpmsFunction 新建包装，无跨构建串扰。 */
export type CustomFormulaDyn = EquationParams;

interface CompiledFormula {
  fn: TpmsFunction;
  expr: string;
  /** 供导出链复用的编译结果（AST/AD/代码生成入口） */
  compiled: ReturnType<typeof compileEquation>;
  dyn: CustomFormulaDyn;
}

const compiledCache = new Map<string, CompiledFormula>();

/**
 * 解析用户自定义三维隐函数字符串，编译为可执行闭包（附编译产物与动态参数句柄）。
 * 支持变量：x, y, z（弧度域坐标）与派生球坐标 r, theta, phi；
 * 全局参数：k（周期数）、t（壁厚系数）、iso（基准等值）——均为构建配置值；
 * 常量：PI, E；函数与运算符白名单见 equation-parser.ts。
 * 安全保证：纯 AST 求值，无 eval / new Function / with，无任何属性访问逃逸路径。
 */
export function compileCustomFormula(expr: string): CompiledFormula {
  const key = expr.trim();
  if (compiledCache.has(key)) return compiledCache.get(key)!;
  if (!key) {
    const e = new Error('自定义公式不能为空');
    throw e;
  }
  const compiled = compileEquation(key);
  // 动态参数句柄：默认常量；调用方可通过返回的 dyn 引用注入构建配置
  const dyn: CustomFormulaDyn = { ...DEFAULT_PARAMS };
  const fn: TpmsFunction = (mx, my, mz, _w) => compiled.evaluate(mx, my, mz, dyn);
  const entry: CompiledFormula = { fn, expr: key, compiled, dyn };
  compiledCache.set(key, entry);
  return entry;
}

/** 获取某类型的场函数（含自定义解析；dyn 提供时闭包直读调用方参数对象） */
export function getTpmsFunction(
  type: TpmType,
  customFormula: string = '',
  dyn?: CustomFormulaDyn,
): TpmsFunction {
  if (type === 'custom') {
    if (!customFormula.trim()) throw new Error('自定义类型需要提供公式');
    const entry = compileCustomFormula(customFormula);
    if (dyn) {
      // 直读调用方持有的对象（surface-nets 每次 build 新建，参数变更即时生效）
      const d = dyn;
      return (mx, my, mz, _w) => entry.compiled.evaluate(mx, my, mz, d);
    }
    return entry.fn;
  }
  return TPMS_FUNCTIONS[type as Exclude<TpmType, 'custom'>];
}

/** 缓存最近一次自定义公式的编译结果，避免内层循环重复 Map 查找 */
let cachedCustomEntry: CompiledFormula | null = null;
let cachedCustomExpr = '';

function customEntry(customFormula: string): CompiledFormula {
  if (customFormula !== cachedCustomExpr) {
    cachedCustomEntry = compileCustomFormula(customFormula);
    cachedCustomExpr = customFormula;
  }
  return cachedCustomEntry!;
}

/** 获取自定义公式的编译产物（导出链代码生成 / AD 梯度入口；非法公式抛 EquationParseError） */
export function getCompiledCustomFormula(customFormula: string) {
  return customEntry(customFormula).compiled;
}

/** 校验自定义公式（UI 沙箱实时反馈），透传 equation-parser 结果 */
export function validateCustomFormula(expr: string) {
  return validateEquation(expr);
}

/** 计算给定坐标下的 V 值（供 Worker 批量调用；dyn 可选注入构建参数） */
export function evaluateField(
  type: TpmType,
  mx: number,
  my: number,
  mz: number,
  w: Weights,
  customFormula: string = '',
  dyn?: CustomFormulaDyn,
): number {
  if (type === 'custom') {
    const entry = customEntry(customFormula);
    return entry.compiled.evaluate(mx, my, mz, dyn ?? entry.dyn);
  }
  return TPMS_FUNCTIONS[type](mx, my, mz, w);
}

/**
 * 解析梯度（用于法线计算）。
 * custom 类型走 Dual Number AD（精确到浮点舍入，无差分截断误差）；
 * 内置类型保持中心差分（解析偏导各自内联于 surface-nets 查表路径）。
 */
export function evaluateGradient(
  type: TpmType,
  mx: number,
  my: number,
  mz: number,
  w: Weights,
  customFormula: string = '',
  dyn?: CustomFormulaDyn,
): [number, number, number] {
  if (type === 'custom') {
    const entry = customEntry(customFormula);
    return entry.compiled.gradient(mx, my, mz, dyn ?? entry.dyn);
  }
  const h = 1e-4;
  const f = TPMS_FUNCTIONS[type];
  const fx = (f(mx + h, my, mz, w) - f(mx - h, my, mz, w)) / (2 * h);
  const fy = (f(mx, my + h, mz, w) - f(mx, my - h, mz, w)) / (2 * h);
  const fz = (f(mx, my, mz + h, w) - f(mx, my, mz - h, w)) / (2 * h);
  return [fx, fy, fz];
}
