/**
 * TPMS 隐函数核心库
 * 包含 8 种经典 TPMS 曲面 + 自定义公式解析器（零依赖递归下降，无 eval）。
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

// ── 自定义公式解析器（零依赖递归下降，无 eval / new Function） ─────

interface CompiledFormula {
  fn: TpmsFunction;
  expr: string;
}

const compiledCache = new Map<string, CompiledFormula>();

/** 白名单函数：名称 → 实现（一元或二元）。min/max/pow 接收两个参数）。 */
const SAFE_FUNCS: Record<string, (a: number, b?: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  pow: (a, b) => Math.pow(a, b as number),
  min: (a, b) => Math.min(a, b as number),
  max: (a, b) => Math.max(a, b as number),
  atan2: (a, b) => Math.atan2(a, b as number),
};

/** 白名单常量 */
const SAFE_CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E };

type Token =
  | { t: 'num'; v: number }
  | { t: 'var'; v: 'x' | 'y' | 'z' }
  | { t: 'const'; v: string }
  | { t: 'func'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

/** tokenizer：把表达式切成 token 流，遇到非法字符立即抛错 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    // 跳过空白
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    // 数字（含小数）
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i + 1, dot = c === '.';
      while (j < n) {
        const cj = expr[j];
        if (cj >= '0' && cj <= '9') { j++; continue; }
        if (cj === '.') { if (dot) throw new Error('数字含有多个小数点'); dot = true; j++; continue; }
        break;
      }
      const num = parseFloat(expr.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`无效数字: ${expr.slice(i, j)}`);
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    // 标识符（变量 / 常量 / 函数名）
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1;
      while (j < n) {
        const cj = expr[j];
        if ((cj >= 'a' && cj <= 'z') || (cj >= 'A' && cj <= 'Z') || (cj >= '0' && cj <= '9') || cj === '_') { j++; continue; }
        break;
      }
      const name = expr.slice(i, j);
      i = j;
      // 后续紧接 ( 视为函数调用
      let k = i;
      while (k < n && (expr[k] === ' ' || expr[k] === '\t')) k++;
      if (k < n && expr[k] === '(') {
        if (!Object.prototype.hasOwnProperty.call(SAFE_FUNCS, name)) throw new Error(`未知或不允许的函数: ${name}`);
        tokens.push({ t: 'func', v: name });
      } else if (name === 'x' || name === 'y' || name === 'z') {
        tokens.push({ t: 'var', v: name });
      } else if (Object.prototype.hasOwnProperty.call(SAFE_CONSTS, name)) {
        tokens.push({ t: 'const', v: name });
      } else {
        throw new Error(`未知标识符: ${name}（仅允许 x/y/z、PI、E 或白名单函数）`);
      }
      continue;
    }
    // 运算符
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      tokens.push({ t: 'op', v: c });
      i++; continue;
    }
    if (c === '(') { tokens.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen' }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma' }); i++; continue; }
    throw new Error(`非法字符: '${c}'（位置 ${i}）`);
  }
  return tokens;
}

/** AST 节点：编译为 (x,y,z) => number 的闭包 */
type Node = (x: number, y: number, z: number) => number;

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      throw new Error(`多余的 token: '${(t as Token & { v?: string }).v ?? (t as Token).t}'`);
    }
    return node;
  }

  // 表达式：加减（左结合，最低优先级）
  private parseExpr(): Node {
    let left = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        this.next();
        const right = this.parseTerm();
        const op = tk.v;
        const l = left;
        left = (x, y, z) => op === '+' ? l(x, y, z) + right(x, y, z) : l(x, y, z) - right(x, y, z);
      } else break;
    }
    return left;
  }

  // 项：乘除（左结合）
  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        this.next();
        const right = this.parseUnary();
        const op = tk.v;
        const l = left;
        left = (x, y, z) => op === '*' ? l(x, y, z) * right(x, y, z) : l(x, y, z) / right(x, y, z);
      } else break;
    }
    return left;
  }

  // 一元：正负号
  private parseUnary(): Node {
    const tk = this.peek();
    if (tk && tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      this.next();
      const operand = this.parseUnary();
      if (tk.v === '-') return (x, y, z) => -operand(x, y, z);
      return operand;
    }
    return this.parsePower();
  }

  // 幂（右结合，最高优先级）
  private parsePower(): Node {
    const base = this.parseAtom();
    const tk = this.peek();
    if (tk && tk.t === 'op' && tk.v === '^') {
      this.next();
      const exp = this.parseUnary(); // 右结合：允许 2^-3
      return (x, y, z) => Math.pow(base(x, y, z), exp(x, y, z));
    }
    return base;
  }

  // 原子：数字 / 变量 / 常量 / 函数调用 / 括号
  private parseAtom(): Node {
    const tk = this.next();
    if (!tk) throw new Error('表达式不完整（缺少操作数）');
    if (tk.t === 'num') {
      const v = tk.v;
      return () => v;
    }
    if (tk.t === 'var') {
      const v = tk.v;
      return (x, y, z) => (v === 'x' ? x : v === 'y' ? y : z);
    }
    if (tk.t === 'const') {
      const v = SAFE_CONSTS[tk.v];
      return () => v;
    }
    if (tk.t === 'func') {
      const lp = this.next();
      if (!lp || lp.t !== 'lparen') throw new Error(`函数 ${tk.v} 后必须紧跟 '('`);
      const args: Node[] = [];
      const first = this.peek();
      if (!first || first.t !== 'rparen') {
        args.push(this.parseExpr());
        while (this.peek() && (this.peek() as Token).t === 'comma') {
          this.next();
          args.push(this.parseExpr());
        }
      }
      const rp = this.next();
      if (!rp || rp.t !== 'rparen') throw new Error(`函数 ${tk.v} 缺少右括号 ')'`);
      const fn = SAFE_FUNCS[tk.v];
      if (typeof fn !== 'function') throw new Error(`内部错误：函数 ${tk.v} 未注册`);
      const fname = tk.v;
      if (fname === 'pow' || fname === 'min' || fname === 'max' || fname === 'atan2') {
        if (args.length !== 2) throw new Error(`${fname} 需要恰好 2 个参数，收到 ${args.length}`);
        const a = args[0], b = args[1];
        return (x, y, z) => fn(a(x, y, z), b(x, y, z));
      }
      if (args.length !== 1) throw new Error(`${fname} 需要恰好 1 个参数，收到 ${args.length}`);
      const a = args[0];
      return (x, y, z) => fn(a(x, y, z));
    }
    if (tk.t === 'lparen') {
      const inner = this.parseExpr();
      const rp = this.next();
      if (!rp || rp.t !== 'rparen') throw new Error("缺少右括号 ')'");
      return inner;
    }
    throw new Error(`意外的 token: '${(tk as Token & { v?: string }).v ?? tk.t}'`);
  }
}

/**
 * 解析用户自定义三维隐函数字符串，编译为可执行闭包。
 * 支持变量：x, y, z；常量：PI, E；
 * 数学函数：sin/cos/tan/asin/acos/atan/sinh/cosh/tanh/exp/log/log2/log10/
 *           sqrt/cbrt/abs/sign/floor/ceil/round/trunc/pow/min/max/atan2；
 * 运算符：+ - * / ^（幂）和一元正负、括号。
 * 安全保证：纯 AST 求值，无 eval / new Function / with，无任何属性访问逃逸路径。
 */
export function compileCustomFormula(expr: string): CompiledFormula {
  const key = expr.trim();
  if (compiledCache.has(key)) return compiledCache.get(key)!;
  if (!key) throw new Error('自定义公式不能为空');

  const tokens = tokenize(key);
  if (tokens.length === 0) throw new Error('表达式为空');
  const parser = new Parser(tokens);
  const node = parser.parse();

  const fn: TpmsFunction = (mx, my, mz, _w) => node(mx, my, mz);
  const compiled: CompiledFormula = { fn, expr: key };
  compiledCache.set(key, compiled);
  return compiled;
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
