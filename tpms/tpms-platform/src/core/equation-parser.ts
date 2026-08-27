/**
 * 自定义隐函数方程 AST 沙箱引擎（阶段 I 核心组件）
 *
 * 职责：
 *  1. 零依赖递归下降解析：Tokenizer（带位置）→ 显式 AST → 快速闭包求值
 *  2. 前向自动微分（Dual Number AD）：单次遍历得解析梯度 ∇F（D1 jet），
 *     forward-over-forward 嵌套（D2 jet）单次遍历得完整 Hessian
 *  3. 代码生成：AST → NumPy / MATLAB 向量化表达式（脚本导出同源）
 *  4. 预设样例库（教学沙箱面板）
 *
 * 安全保证：纯 AST 求值，无 eval / new Function / with，无属性访问逃逸路径；
 * 标识符全部经白名单校验（未知标识符在 tokenize 阶段即拒绝）。
 *
 * 坐标语义（与 UI 公式栏/platform 渲染场一致）：
 *  - x, y, z 为弧度域坐标 mx = k·wc ∈ [-kπ, kπ]（与权重公式同域）
 *  - r/theta/phi 为派生球坐标（θ 从 +z 极角、φ 方位角），编译期脱糖为
 *    sqrt/acos/atan2 复合节点 —— 微分走通用链式法则，无任何手写特例代数
 *  - 全局参数：k = 周期数(cellSize)、t = 壁厚系数(thickness)、iso = 基准等值(BuildParams.iso)
 *    —— 三者均为构建配置值（非孔隙率二分产物），避免「公式引用二分结果」的循环依赖。
 */

// ────────────────────────────── AST 定义 ──────────────────────────────

export type EqVarName = 'x' | 'y' | 'z' | 'r' | 'theta' | 'phi' | 'k' | 't' | 'iso';

export type EqNode =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: EqVarName }
  | { kind: 'const'; name: string; value: number }
  | { kind: 'unary'; op: '-' | '+'; arg: EqNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: EqNode; right: EqNode }
  | { kind: 'call'; name: string; args: EqNode[] };

/** 解析错误（带出错位置，供沙箱面板错误定位高亮） */
export class EquationParseError extends Error {
  /** 出错字符位置（0 起始，指向出错 token 首字符） */
  public readonly pos: number;
  constructor(message: string, pos: number = 0) {
    super(message);
    this.name = 'EquationParseError';
    this.pos = pos;
  }
}

// ────────────────────────────── 白名单 ──────────────────────────────

/** 白名单函数：名称 → 实现（一元或二元，与平台历史 SAFE_FUNCS 语义一致） */
export const SAFE_FUNCS: Record<string, (a: number, b?: number) => number> = {
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

const BINARY_FUNCS = new Set(['pow', 'min', 'max', 'atan2']);

/** 白名单常量（小写 pi/e 与 PI/E 等价） */
const SAFE_CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E, pi: Math.PI, e: Math.E };

const COORD_VARS = new Set<EqVarName>(['x', 'y', 'z', 'r', 'theta', 'phi']);
const PARAM_VARS = new Set<EqVarName>(['k', 't', 'iso']);
const KNOWN_VARS = new Set<EqVarName>([...COORD_VARS, ...PARAM_VARS]);

// ────────────────────────────── Tokenizer ──────────────────────────────

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'var'; v: EqVarName; pos: number }
  | { t: 'const'; v: string; pos: number }
  | { t: 'func'; v: string; pos: number }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^'; pos: number }
  | { t: 'lparen'; pos: number }
  | { t: 'rparen'; pos: number }
  | { t: 'comma'; pos: number };

/** tokenizer：把表达式切成 token 流，遇到非法字符立即抛错（带位置） */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      const start = i;
      let j = i + 1, dot = c === '.';
      while (j < n) {
        const cj = expr[j];
        if (cj >= '0' && cj <= '9') { j++; continue; }
        if (cj === '.') { if (dot) throw new EquationParseError('数字含有多个小数点', j); dot = true; j++; continue; }
        break;
      }
      const num = parseFloat(expr.slice(i, j));
      if (!Number.isFinite(num)) throw new EquationParseError(`无效数字: ${expr.slice(i, j)}`, start);
      tokens.push({ t: 'num', v: num, pos: start });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      const start = i;
      let j = i + 1;
      while (j < n) {
        const cj = expr[j];
        if ((cj >= 'a' && cj <= 'z') || (cj >= 'A' && cj <= 'Z') || (cj >= '0' && cj <= '9') || cj === '_') { j++; continue; }
        break;
      }
      const name = expr.slice(i, j);
      i = j;
      // 后续（跳过空白）紧接 ( 视为函数调用
      let kk = i;
      while (kk < n && (expr[kk] === ' ' || expr[kk] === '\t')) kk++;
      if (kk < n && expr[kk] === '(') {
        if (!Object.prototype.hasOwnProperty.call(SAFE_FUNCS, name)) {
          throw new EquationParseError(`未知或不允许的函数: ${name}`, start);
        }
        tokens.push({ t: 'func', v: name, pos: start });
      } else if (KNOWN_VARS.has(name as EqVarName)) {
        tokens.push({ t: 'var', v: name as EqVarName, pos: start });
      } else if (Object.prototype.hasOwnProperty.call(SAFE_CONSTS, name)) {
        tokens.push({ t: 'const', v: name, pos: start });
      } else {
        throw new EquationParseError(
          `未知标识符: ${name}（仅允许 x/y/z/r/theta/phi、参数 k/t/iso、常量 PI/E 或白名单函数）`, start);
      }
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      tokens.push({ t: 'op', v: c, pos: i });
      i++; continue;
    }
    if (c === '(') { tokens.push({ t: 'lparen', pos: i }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen', pos: i }); i++; continue; }
    if (c === ',') { tokens.push({ t: 'comma', pos: i }); i++; continue; }
    throw new EquationParseError(`非法字符: '${c}'`, i);
  }
  return tokens;
}

// ────────────────────────────── Parser（递归下降 → 显式 AST） ──────────────────────────────

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }

  parse(): EqNode {
    if (this.tokens.length === 0) throw new EquationParseError('表达式为空', 0);
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      const label = t.t === 'op' || t.t === 'var' || t.t === 'const' || t.t === 'func' || t.t === 'num' ? String(t.v) : t.t;
      throw new EquationParseError(`多余的 token: '${label}'`, t.pos);
    }
    return node;
  }

  // 加减（左结合，优先级 1）
  private parseExpr(): EqNode {
    let left = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        this.next();
        left = { kind: 'binary', op: tk.v, left, right: this.parseTerm() };
      } else break;
    }
    return left;
  }

  // 乘除（左结合，优先级 2）
  private parseTerm(): EqNode {
    let left = this.parseUnary();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        this.next();
        left = { kind: 'binary', op: tk.v, left, right: this.parseUnary() };
      } else break;
    }
    return left;
  }

  // 一元正负（优先级 3；-x^2 = -(x^2)，与既有平台语义一致）
  private parseUnary(): EqNode {
    const tk = this.peek();
    if (tk && tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      this.next();
      const arg = this.parseUnary();
      return tk.v === '-' ? { kind: 'unary', op: '-', arg } : arg;
    }
    return this.parsePower();
  }

  // 幂（右结合，优先级 4：允许 2^-3）
  private parsePower(): EqNode {
    const base = this.parseAtom();
    const tk = this.peek();
    if (tk && tk.t === 'op' && tk.v === '^') {
      this.next();
      return { kind: 'binary', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  // 原子：数字 / 变量 / 常量 / 函数调用 / 括号
  private parseAtom(): EqNode {
    const tk = this.next();
    if (!tk) throw new EquationParseError('表达式不完整（缺少操作数）', 0);
    if (tk.t === 'num') return { kind: 'num', value: tk.v };
    if (tk.t === 'var') return { kind: 'var', name: tk.v };
    if (tk.t === 'const') return { kind: 'const', name: tk.v, value: SAFE_CONSTS[tk.v] };
    if (tk.t === 'func') {
      const lp = this.next();
      if (!lp || lp.t !== 'lparen') throw new EquationParseError(`函数 ${tk.v} 后必须紧跟 '('`, tk.pos);
      const args: EqNode[] = [];
      const first = this.peek();
      if (!first || first.t !== 'rparen') {
        args.push(this.parseExpr());
        while (this.peek() && (this.peek() as Token).t === 'comma') {
          this.next();
          args.push(this.parseExpr());
        }
      }
      const rp = this.next();
      if (!rp || rp.t !== 'rparen') throw new EquationParseError(`函数 ${tk.v} 缺少右括号 ')'`, tk.pos);
      const arity = BINARY_FUNCS.has(tk.v) ? 2 : 1;
      if (args.length !== arity) {
        throw new EquationParseError(`${tk.v} 需要恰好 ${arity} 个参数，收到 ${args.length}`, tk.pos);
      }
      return { kind: 'call', name: tk.v, args };
    }
    if (tk.t === 'lparen') {
      const inner = this.parseExpr();
      const rp = this.next();
      if (!rp || rp.t !== 'rparen') throw new EquationParseError("缺少右括号 ')'", tk.pos);
      return inner;
    }
    throw new EquationParseError(`意外的 token: '${tk.t}'`, tk.pos);
  }
}

// ────────────────────────────── AST 脱糖（派生球坐标 → 复合节点） ──────────────────────────────

const vr = (name: EqVarName): EqNode => ({ kind: 'var', name });
const add2 = (l: EqNode, r: EqNode): EqNode => ({ kind: 'binary', op: '+', left: l, right: r });
const mul2 = (l: EqNode, r: EqNode): EqNode => ({ kind: 'binary', op: '*', left: l, right: r });
const div2 = (l: EqNode, r: EqNode): EqNode => ({ kind: 'binary', op: '/', left: l, right: r });
const call1 = (name: string, a: EqNode): EqNode => ({ kind: 'call', name, args: [a] });
const call2 = (name: string, a: EqNode, b: EqNode): EqNode => ({ kind: 'call', name, args: [a, b] });

/**
 * 派生坐标脱糖：r → √(x²+y²+z²)，theta → acos(z/r)，phi → atan2(y, x)。
 * 脱糖后微分/求值全部走通用复合规则（精确链式法则），无手写球坐标导数代数。
 * 注：原点处 theta 脱糖式为 acos(0/0)=NaN（诚实奇异），标量路径同样产 NaN，
 * 由上游「非有限值守卫」统一报错。
 */
export function desugarCoords(node: EqNode): EqNode {
  switch (node.kind) {
    case 'var': {
      if (node.name === 'r') {
        return call1('sqrt', add2(mul2(vr('x'), vr('x')), add2(mul2(vr('y'), vr('y')), mul2(vr('z'), vr('z')))));
      }
      if (node.name === 'theta') {
        const r = desugarCoords(vr('r'));
        return call1('acos', div2(vr('z'), r));
      }
      if (node.name === 'phi') {
        return call2('atan2', vr('y'), vr('x'));
      }
      return node;
    }
    case 'unary': return { ...node, arg: desugarCoords(node.arg) };
    case 'binary': return { ...node, left: desugarCoords(node.left), right: desugarCoords(node.right) };
    case 'call': return { ...node, args: node.args.map(desugarCoords) };
    default: return node;
  }
}

// ────────────────────────────── 求值上下文 ──────────────────────────────

/** 全局参数（构建配置值；由调用方注入，全部字段必填） */
export interface EquationParams { k: number; t: number; iso: number }

export const DEFAULT_PARAMS: EquationParams = { k: 1, t: 1, iso: 0 };

/** 求值坐标上下文（脱糖后仅剩直角坐标与全局参数） */
export interface EvalCtx {
  x: number; y: number; z: number;
  k: number; t: number; iso: number;
}

function makeCtx(x: number, y: number, z: number, p: EquationParams): EvalCtx {
  return { x, y, z, k: p.k, t: p.t, iso: p.iso };
}

// ────────────────────────────── 快速闭包求值（标量热路径） ──────────────────────────────

type ScalarNode = (c: EvalCtx) => number;

function compileScalar(node: EqNode): ScalarNode {
  switch (node.kind) {
    case 'num': { const v = node.value; return () => v; }
    case 'const': { const v = node.value; return () => v; }
    case 'var': {
      const name = node.name;
      // 脱糖后 var 仅剩 x/y/z/k/t/iso（EvalCtx 全量键）
      return (c) => (c as unknown as Record<string, number>)[name];
    }
    case 'unary': {
      const a = compileScalar(node.arg);
      return node.op === '-' ? (c) => -a(c) : a;
    }
    case 'binary': {
      const l = compileScalar(node.left), r = compileScalar(node.right);
      switch (node.op) {
        case '+': return (c) => l(c) + r(c);
        case '-': return (c) => l(c) - r(c);
        case '*': return (c) => l(c) * r(c);
        case '/': return (c) => l(c) / r(c);
        case '^': return (c) => Math.pow(l(c), r(c));
      }
      break;
    }
    case 'call': {
      const fn = SAFE_FUNCS[node.name];
      if (BINARY_FUNCS.has(node.name)) {
        const a = compileScalar(node.args[0]), b = compileScalar(node.args[1]);
        return (c) => fn(a(c), b(c));
      }
      const a = compileScalar(node.args[0]);
      return (c) => fn(a(c));
    }
  }
  throw new EquationParseError('内部错误：未知 AST 节点');
}

// ────────────────────────────── Dual Number 自动微分 ──────────────────────────────
// D1 jet：值 + 三个方向偏导（一次遍历得精确 ∇F）
interface D1 { v: number; dx: number; dy: number; dz: number }

const d1num = (v: number): D1 => ({ v, dx: 0, dy: 0, dz: 0 });

/** 一元函数一阶导数表：给定输入 a（和 f(a) 复用），返回 f'(a) */
const D1_DERIVS: Record<string, (a: number, fv: number) => number> = {
  sin: (a) => Math.cos(a),
  cos: (a) => -Math.sin(a),
  tan: (a) => 1 + Math.tan(a) * Math.tan(a),
  asin: (a) => 1 / Math.sqrt(Math.max(1 - a * a, 1e-300)),
  acos: (a) => -1 / Math.sqrt(Math.max(1 - a * a, 1e-300)),
  atan: (a) => 1 / (1 + a * a),
  sinh: (a) => Math.cosh(a),
  cosh: (a) => Math.sinh(a),
  tanh: (_a, fv) => 1 - fv * fv,
  exp: (_a, fv) => fv,
  log: (a) => Math.abs(a) < 1e-300 ? 0 : 1 / a,
  log2: (a) => Math.abs(a) < 1e-300 ? 0 : 1 / (a * Math.LN2),
  log10: (a) => Math.abs(a) < 1e-300 ? 0 : 1 / (a * Math.LN10),
  sqrt: (_a, fv) => fv === 0 ? 0 : 1 / (2 * fv),
  cbrt: (_a, fv) => fv === 0 ? 0 : 1 / (3 * fv * fv),
  abs: (a) => a < 0 ? -1 : a > 0 ? 1 : 0,
  sign: () => 0,
  floor: () => 0, ceil: () => 0, round: () => 0, trunc: () => 0,
};

/** 一元函数二阶导数表（D2 用）；缺省视为 0（整数型函数族） */
const D2_SECOND_DERIVS: Record<string, (a: number, fv: number) => number> = {
  sin: (a) => -Math.sin(a),
  cos: (a) => -Math.cos(a),
  tan: (a) => 2 * Math.tan(a) * (1 + Math.tan(a) * Math.tan(a)),
  asin: (a) => a / Math.pow(Math.max(1 - a * a, 1e-300), 1.5),
  acos: (a) => -a / Math.pow(Math.max(1 - a * a, 1e-300), 1.5),
  atan: (a) => -2 * a / ((1 + a * a) * (1 + a * a)),
  sinh: (a) => Math.sinh(a),
  cosh: (a) => Math.cosh(a),
  tanh: (a) => -2 * Math.tanh(a) * (1 - Math.tanh(a) * Math.tanh(a)),
  exp: (_a, fv) => fv,
  sqrt: (a) => -1 / (4 * Math.pow(Math.max(a, 1e-300), 1.5)),
  cbrt: (a) => a > 0 ? -2 / (9 * Math.pow(a, 5 / 3)) : a < 0 ? 2 / (9 * Math.pow(-a, 5 / 3)) : 0,
  log: (a) => Math.abs(a) < 1e-300 ? 0 : -1 / (a * a),
  log2: (a) => Math.abs(a) < 1e-300 ? 0 : -1 / (a * a * Math.LN2),
  log10: (a) => Math.abs(a) < 1e-300 ? 0 : -1 / (a * a * Math.LN10),
  abs: () => 0,
};

// D1 组合算子（D2 各槽共用，携带二阶信息）
const d1add = (a: D1, b: D1): D1 => ({ v: a.v + b.v, dx: a.dx + b.dx, dy: a.dy + b.dy, dz: a.dz + b.dz });
const d1mul = (a: D1, b: D1): D1 => ({
  v: a.v * b.v,
  dx: a.dx * b.v + a.v * b.dx,
  dy: a.dy * b.v + a.v * b.dy,
  dz: a.dz * b.v + a.v * b.dz,
});
const d1scale = (a: D1, s: number): D1 => ({ v: a.v * s, dx: a.dx * s, dy: a.dy * s, dz: a.dz * s });
const d1recip = (b: D1): D1 => {
  const inv = 1 / b.v, inv2 = inv * inv;
  return { v: inv, dx: -b.dx * inv2, dy: -b.dy * inv2, dz: -b.dz * inv2 };
};

function evalD1(node: EqNode, c: EvalCtx): D1 {
  switch (node.kind) {
    case 'num': case 'const': return d1num(node.value);
    case 'var': {
      const v = (c as unknown as Record<string, number>)[node.name];
      switch (node.name) {
        case 'x': return { v, dx: 1, dy: 0, dz: 0 };
        case 'y': return { v, dx: 0, dy: 1, dz: 0 };
        case 'z': return { v, dx: 0, dy: 0, dz: 1 };
        default: return d1num(v);   // k/t/iso：常参数
      }
    }
    case 'unary': {
      const a = evalD1(node.arg, c);
      return node.op === '-' ? { v: -a.v, dx: -a.dx, dy: -a.dy, dz: -a.dz } : a;
    }
    case 'binary': {
      const l = evalD1(node.left, c), r = evalD1(node.right, c);
      switch (node.op) {
        case '+': return { v: l.v + r.v, dx: l.dx + r.dx, dy: l.dy + r.dy, dz: l.dz + r.dz };
        case '-': return { v: l.v - r.v, dx: l.dx - r.dx, dy: l.dy - r.dy, dz: l.dz - r.dz };
        case '*': return d1mul(l, r);
        case '/': return d1mul(l, d1recip(r));
        case '^': return d1pow(l, r);
      }
      break;
    }
    case 'call': {
      if (node.name === 'pow') return d1pow(evalD1(node.args[0], c), evalD1(node.args[1], c));
      if (node.name === 'atan2') {
        const a = evalD1(node.args[0], c), b = evalD1(node.args[1], c);
        const den = Math.max(a.v * a.v + b.v * b.v, 1e-300);
        return {
          v: Math.atan2(a.v, b.v),
          dx: (b.v * a.dx - a.v * b.dx) / den,
          dy: (b.v * a.dy - a.v * b.dy) / den,
          dz: (b.v * a.dz - a.v * b.dz) / den,
        };
      }
      if (node.name === 'min' || node.name === 'max') {
        const a = evalD1(node.args[0], c), b = evalD1(node.args[1], c);
        // 极小测度平局：取左支（次梯度约定），与 Math.min/max 值语义一致
        const leftWins = node.name === 'min' ? a.v <= b.v : a.v >= b.v;
        return leftWins ? a : b;
      }
      const a = evalD1(node.args[0], c);
      const fv = SAFE_FUNCS[node.name](a.v);
      const d = D1_DERIVS[node.name](a.v, fv);
      return { v: fv, dx: d * a.dx, dy: d * a.dy, dz: d * a.dz };
    }
  }
  throw new EquationParseError('内部错误：未知 AST 节点');
}

/** D1 幂：a>0 用对数链式；常指数走 n·a^(n-1)；其余（负底非整指）值已是 NaN，导数置 0 防 NaN 级联 */
function d1pow(a: D1, b: D1): D1 {
  const v = Math.pow(a.v, b.v);
  const bConst = b.dx === 0 && b.dy === 0 && b.dz === 0;
  if (a.v > 0) {
    const la = Math.log(a.v), ir = b.v / a.v;
    return { v, dx: v * (la * b.dx + ir * a.dx), dy: v * (la * b.dy + ir * a.dy), dz: v * (la * b.dz + ir * a.dz) };
  }
  if (bConst) {
    const c = b.v * Math.pow(a.v, b.v - 1);
    const finite = Number.isFinite(c) ? c : 0;
    return { v, dx: finite * a.dx, dy: finite * a.dy, dz: finite * a.dz };
  }
  return { v, dx: 0, dy: 0, dz: 0 };
}

// D2 jet（forward-over-forward）：v 与三个一阶偏导各自是 D1
// ⇒ 单次遍历得 f、∇F 与完整 Hessian（H[i][j] = result.d[i].d[j]）
// 统一链式：y = F(u)；y.dᵢ = F₁jet ∘ u.dᵢ（F₁ 的 jet 自带 f'' 信息，
// D1 乘积的槽位自动承载二阶交叉项——这就是 forward-over-forward 的核心）。
interface D2 { v: D1; dx: D1; dy: D1; dz: D1 }

/** 一元复合提升：f / f' / f'' 全解析已知 */
function d2lift(a: D2, f: (v: number) => number, fp: (v: number, fv: number) => number, fpp: (v: number, fv: number) => number): D2 {
  const av = a.v.v;
  const fv = f(av);
  const d1 = fp(av, fv);
  const d2v = fpp(av, fv);
  const fpJet: D1 = { v: d1, dx: d2v * a.v.dx, dy: d2v * a.v.dy, dz: d2v * a.v.dz };
  return {
    v: { v: fv, dx: d1 * a.v.dx, dy: d1 * a.v.dy, dz: d1 * a.v.dz },
    dx: d1mul(fpJet, a.dx),
    dy: d1mul(fpJet, a.dy),
    dz: d1mul(fpJet, a.dz),
  };
}

const ZERO_JET: D1 = { v: 0, dx: 0, dy: 0, dz: 0 };
const zeroD2 = (): D2 => ({ v: { ...ZERO_JET }, dx: { ...ZERO_JET }, dy: { ...ZERO_JET }, dz: { ...ZERO_JET } });

function evalD2(node: EqNode, c: EvalCtx): D2 {
  switch (node.kind) {
    case 'num': case 'const': {
      const z: D1 = { v: node.value, dx: 0, dy: 0, dz: 0 };
      const z0: D1 = { v: 0, dx: 0, dy: 0, dz: 0 };
      return { v: z, dx: { ...z0 }, dy: { ...z0 }, dz: { ...z0 } };
    }
    case 'var': {
      // y = xᵢ：y.v = 种子 jet；y.dⱼ = ∂xᵢ/∂xⱼ 的 jet（常数，二阶全零）。
      // k/t/iso 常参数：全零 jet。
      const isParam = node.name === 'k' || node.name === 't' || node.name === 'iso';
      if (isParam) return zeroD2();
      const g: D1 =
        node.name === 'x' ? { v: c.x, dx: 1, dy: 0, dz: 0 } :
        node.name === 'y' ? { v: c.y, dx: 0, dy: 1, dz: 0 } :
        { v: c.z, dx: 0, dy: 0, dz: 1 };
      return {
        v: g,
        dx: { v: g.dx, dx: 0, dy: 0, dz: 0 },
        dy: { v: g.dy, dx: 0, dy: 0, dz: 0 },
        dz: { v: g.dz, dx: 0, dy: 0, dz: 0 },
      };
    }
    case 'unary': {
      const a = evalD2(node.arg, c);
      if (node.op === '+') return a;
      return { v: d1scale(a.v, -1), dx: d1scale(a.dx, -1), dy: d1scale(a.dy, -1), dz: d1scale(a.dz, -1) };
    }
    case 'binary': {
      const l = evalD2(node.left, c), r = evalD2(node.right, c);
      switch (node.op) {
        case '+': return { v: d1add(l.v, r.v), dx: d1add(l.dx, r.dx), dy: d1add(l.dy, r.dy), dz: d1add(l.dz, r.dz) };
        case '-': return {
          v: { v: l.v.v - r.v.v, dx: l.v.dx - r.v.dx, dy: l.v.dy - r.v.dy, dz: l.v.dz - r.v.dz },
          dx: { v: l.dx.v - r.dx.v, dx: l.dx.dx - r.dx.dx, dy: l.dx.dy - r.dx.dy, dz: l.dx.dz - r.dx.dz },
          dy: { v: l.dy.v - r.dy.v, dx: l.dy.dx - r.dy.dx, dy: l.dy.dy - r.dy.dy, dz: l.dy.dz - r.dy.dz },
          dz: { v: l.dz.v - r.dz.v, dx: l.dz.dx - r.dz.dx, dy: l.dz.dy - r.dz.dy, dz: l.dz.dz - r.dz.dz },
        };
        case '*': return {
          v: d1mul(l.v, r.v),
          dx: d1add(d1mul(l.dx, r.v), d1mul(l.v, r.dx)),
          dy: d1add(d1mul(l.dy, r.v), d1mul(l.v, r.dy)),
          dz: d1add(d1mul(l.dz, r.v), d1mul(l.v, r.dz)),
        };
        case '/': {
          // (l/r)ᵢ = lᵢ ∘ (1/r)；F₂ = −l/r² 的 jet = −(l ∘ inv ∘ inv)
          const inv = d1recip(r.v);
          const F2 = d1scale(d1mul(d1mul(inv, inv), l.v), -1);
          return {
            v: d1mul(l.v, inv),
            dx: d1add(d1mul(inv, l.dx), d1mul(F2, r.dx)),
            dy: d1add(d1mul(inv, l.dy), d1mul(F2, r.dy)),
            dz: d1add(d1mul(inv, l.dz), d1mul(F2, r.dz)),
          };
        }
        case '^': return d2pow(l, r);
      }
      break;
    }
    case 'call': {
      if (node.name === 'pow') return d2pow(evalD2(node.args[0], c), evalD2(node.args[1], c));
      if (node.name === 'atan2') {
        const a = evalD2(node.args[0], c), b = evalD2(node.args[1], c);
        // F₁ = b/(a²+b²)，F₂ = −a/(a²+b²)（D1 jet，除法经 d1recip 携带二阶）
        const den = d1add(d1mul(a.v, a.v), d1mul(b.v, b.v));
        const denInv = d1recip(den);
        const F1 = d1mul(b.v, denInv);
        const F2 = d1scale(d1mul(a.v, denInv), -1);
        return {
          v: { v: Math.atan2(a.v.v, b.v.v), dx: F1.v * a.v.dx + F2.v * b.v.dx, dy: F1.v * a.v.dy + F2.v * b.v.dy, dz: F1.v * a.v.dz + F2.v * b.v.dz },
          dx: d1add(d1mul(F1, a.dx), d1mul(F2, b.dx)),
          dy: d1add(d1mul(F1, a.dy), d1mul(F2, b.dy)),
          dz: d1add(d1mul(F1, a.dz), d1mul(F2, b.dz)),
        };
      }
      if (node.name === 'min' || node.name === 'max') {
        const a = evalD2(node.args[0], c), b = evalD2(node.args[1], c);
        const leftWins = node.name === 'min' ? a.v.v <= b.v.v : a.v.v >= b.v.v;
        return leftWins ? a : b;
      }
      const f = SAFE_FUNCS[node.name];
      const fp = D1_DERIVS[node.name];
      const fpp = D2_SECOND_DERIVS[node.name] ?? (() => 0);
      return d2lift(evalD2(node.args[0], c), f, fp, fpp);
    }
  }
  throw new EquationParseError('内部错误：未知 AST 节点');
}

/** D2 幂：a>0 走 exp(b·ln a) 的 D2 复合（精确到 1ulp）；常指数走 jet 标度链式 */
function d2pow(a: D2, b: D2): D2 {
  const av = a.v.v, bv = b.v.v;
  if (av > 0) {
    // u = b·ln a（D2 层复合），再 exp：值与 Math.pow 差 ≤1ulp
    const logJet: D2 = d2lift(a,
      (v) => Math.log(v),
      (v) => Math.abs(v) < 1e-300 ? 0 : 1 / v,
      (v) => Math.abs(v) < 1e-300 ? 0 : -1 / (v * v));
    const u = d2mulJet(b, logJet);          // u = b·ln a
    return d2lift(u, Math.exp, (_v, fv) => fv, (_v, fv) => fv);
  }
  // b 是否为真常数：值 jet 的导数槽全零且三个方向槽 jet 也全零
  const bConst = b.v.dx === 0 && b.v.dy === 0 && b.v.dz === 0
    && b.dx.v === 0 && b.dx.dx === 0 && b.dx.dy === 0 && b.dx.dz === 0
    && b.dy.v === 0 && b.dy.dx === 0 && b.dy.dy === 0 && b.dy.dz === 0
    && b.dz.v === 0 && b.dz.dx === 0 && b.dz.dy === 0 && b.dz.dz === 0;
  const v = Math.pow(av, bv);
  if (bConst) {
    const c1 = bv * Math.pow(av, bv - 1);
    const c2 = bv * (bv - 1) * Math.pow(av, bv - 2);
    const f1 = Number.isFinite(c1) ? c1 : 0;
    const f2 = Number.isFinite(c2) ? c2 : 0;
    const fpJet: D1 = { v: f1, dx: f2 * a.v.dx, dy: f2 * a.v.dy, dz: f2 * a.v.dz };
    return {
      v: { v, dx: f1 * a.v.dx, dy: f1 * a.v.dy, dz: f1 * a.v.dz },
      dx: d1mul(fpJet, a.dx),
      dy: d1mul(fpJet, a.dy),
      dz: d1mul(fpJet, a.dz),
    };
  }
  return { v: { v, dx: 0, dy: 0, dz: 0 }, dx: { ...ZERO_JET }, dy: { ...ZERO_JET }, dz: { ...ZERO_JET } };
}

/** D2 层乘积（各槽按 D1 乘积组合） */
function d2mulJet(l: D2, r: D2): D2 {
  return {
    v: d1mul(l.v, r.v),
    dx: d1add(d1mul(l.dx, r.v), d1mul(l.v, r.dx)),
    dy: d1add(d1mul(l.dy, r.v), d1mul(l.v, r.dy)),
    dz: d1add(d1mul(l.dz, r.v), d1mul(l.v, r.dz)),
  };
}

// ────────────────────────────── 代码生成（NumPy / MATLAB） ──────────────────────────────

const PY_FUNCS: Record<string, string> = {
  sin: 'np.sin', cos: 'np.cos', tan: 'np.tan',
  asin: 'np.arcsin', acos: 'np.arccos', atan: 'np.arctan',
  sinh: 'np.sinh', cosh: 'np.cosh', tanh: 'np.tanh',
  exp: 'np.exp', log: 'np.log', log2: 'np.log2', log10: 'np.log10',
  sqrt: 'np.sqrt', cbrt: 'np.cbrt', abs: 'np.abs', sign: 'np.sign',
  floor: 'np.floor', ceil: 'np.ceil', round: 'np.round', trunc: 'np.trunc',
  pow: 'np.power', min: 'np.minimum', max: 'np.maximum', atan2: 'np.arctan2',
};

const ML_FUNCS: Record<string, (a: string, b?: string) => string> = {
  sin: (a) => `sin(${a})`, cos: (a) => `cos(${a})`, tan: (a) => `tan(${a})`,
  asin: (a) => `asin(${a})`, acos: (a) => `acos(${a})`, atan: (a) => `atan(${a})`,
  sinh: (a) => `sinh(${a})`, cosh: (a) => `cosh(${a})`, tanh: (a) => `tanh(${a})`,
  exp: (a) => `exp(${a})`, log: (a) => `log(${a})`, log2: (a) => `log2(${a})`, log10: (a) => `log10(${a})`,
  sqrt: (a) => `sqrt(${a})`,
  cbrt: (a) => `sign(${a}).*abs(${a}).^(1/3)`,
  abs: (a) => `abs(${a})`, sign: (a) => `sign(${a})`,
  floor: (a) => `floor(${a})`, ceil: (a) => `ceil(${a})`,
  round: (a) => `round(${a})`, trunc: (a) => `fix(${a})`,
  pow: (a, b) => `(${a}).^(${b})`, min: (a, b) => `min(${a}, ${b})`, max: (a, b) => `max(${a}, ${b})`,
  atan2: (a, b) => `atan2(${a}, ${b})`,
};

type Lang = 'py' | 'ml';

/**
 * 坐标基表达式表：脚本导出场景中网格变量 X/Y/Z 是 ±π 域（kk 在公式内侧乘），
 * 而沙箱的 x/y/z 语义是弧度域 —— 通过 coordWrap 把 X 映射为 kk*X 等。
 * r/theta/phi 由（包装后的）x/y/z 表达式一致地导出，保证派生坐标同源。
 */
export type CoordWrap = (axis: 'x' | 'y' | 'z') => string;

function varExprTable(lang: Lang, wrap?: CoordWrap): Record<EqVarName, string> {
  const py = lang === 'py';
  const bx = wrap ? wrap('x') : 'X';
  const by = wrap ? wrap('y') : 'Y';
  const bz = wrap ? wrap('z') : 'Z';
  const sq = (s: string) => (py ? `(${s})**2` : `(${s}).^2`);
  const rExpr = py
    ? `np.sqrt(${sq(bx)} + ${sq(by)} + ${sq(bz)})`
    : `sqrt(${sq(bx)} + ${sq(by)} + ${sq(bz)})`;
  const thetaExpr = py
    ? `np.arccos(np.clip((${bz}) / ${rExpr}, -1, 1))`
    : `acos(min(max((${bz}) / ${rExpr}, -1), 1))`;
  const phiExpr = py
    ? `np.arctan2(${by}, ${bx})`
    : `atan2(${by}, ${bx})`;
  return {
    x: bx, y: by, z: bz,
    r: rExpr, theta: thetaExpr, phi: phiExpr,
    k: 'kk', t: 'thickness', iso: 'iso_base',
  };
}

/** 运算符优先级：1 加减 / 2 乘除 / 3 一元 / 4 幂 / 5 原子 */
function precOf(op: string): number {
  return op === '+' || op === '-' ? 1 : op === '*' || op === '/' ? 2 : 4;
}

function emit(node: EqNode, lang: Lang, parentPrec: number, vars: Record<EqVarName, string>, varsAtomic: boolean): string {
  const py = lang === 'py';
  switch (node.kind) {
    case 'num': {
      const s = String(node.value);
      // MATLAB 对负数字面量在 .^ 下需括号（如 X.^-2 非法）
      return node.value < 0 && parentPrec >= 4 ? `(${s})` : s;
    }
    case 'const': {
      const v = node.value;
      if (py) return v === Math.PI ? 'np.pi' : 'np.e';
      return v === Math.PI ? 'pi' : 'exp(1)';
    }
    case 'var':
      // wrap 场景（脚本导出）下 var 展开式含乘号（kk*X），在任意操作数位置都不是
      // 原子——发射点直接加括号，杜绝 A ./ kk*Z 类左结合误结合
      return varsAtomic ? vars[node.name] : `(${vars[node.name]})`;
    case 'unary': {
      const inner = emit(node.arg, lang, 3, vars, varsAtomic);
      return node.op === '-' ? (parentPrec > 3 ? `(-${inner})` : `-${inner}`) : inner;
    }
    case 'binary': {
      const p = precOf(node.op);
      // 左操作数用 p+1：同级左结合（a*b/c、a-b-c）必须显式括号，
      // 否则代码生成到 Python/MATLAB 后会按左结合误结合（A*B/C ≠ A*(B/C)）
      const l = emit(node.left, lang, p + 1, vars, varsAtomic);
      const r = emit(node.right, lang, p + 1, vars, varsAtomic);
      if (node.op === '^') {
        // 幂运算操作数一律加括号（跨语言优先级差异最安全的做法）。
        // varsAtomic=false（脚本导出 wrap 场景）时 var 展开式（如 kk*X）含乘号，
        // 绝不能当原子——否则 kk*Y**3 会被解析为 kk*(Y³) 而非 (kk·Y)³。
        const atom = (n: EqNode) =>
          n.kind === 'num' || n.kind === 'const' || (n.kind === 'var' && varsAtomic);
        const lb = atom(node.left) ? l : `(${l})`;
        const rb = atom(node.right) && !(node.right.kind === 'num' && node.right.value < 0) ? r : `(${r})`;
        const s = `${lb}${py ? '**' : '.^'}${rb}`;
        return parentPrec > p ? `(${s})` : s;
      }
      let opStr: string;
      if (!py) opStr = node.op === '*' ? '.*' : node.op === '/' ? './' : node.op;
      else opStr = node.op;
      const s = `${l} ${opStr} ${r}`;
      return parentPrec > p ? `(${s})` : s;
    }
    case 'call': {
      const args = node.args.map((a) => emit(a, lang, 0, vars, varsAtomic));
      if (py) return `${PY_FUNCS[node.name]}(${args.join(', ')})`;
      return ML_FUNCS[node.name](args[0], args[1]);
    }
  }
}

// ────────────────────────────── 编译入口 ──────────────────────────────

/** AST 引用情况（供沙箱面板展示与导出脚本前置变量判断） */
export interface EquationUsage {
  /** 用到派生球坐标 r/theta/phi */
  coord: boolean;
  /** 用到全局参数 k/t/iso */
  k: boolean;
  t: boolean;
  iso: boolean;
}

export interface CompiledEquation {
  /** 规范化（trim）后的源表达式 */
  expr: string;
  ast: EqNode;
  usage: EquationUsage;
  /** 标量求值（快速闭包路径，热路径用） */
  evaluate(x: number, y: number, z: number, params: EquationParams): number;
  /** 解析梯度（Dual Number AD，单次遍历，精确到浮点舍入） */
  gradient(x: number, y: number, z: number, params: EquationParams): [number, number, number];
  /** 解析 Hessian（forward-over-forward AD，单次遍历）：[xx, yy, zz, xy, yz, zx] */
  hessian(x: number, y: number, z: number, params: EquationParams): [number, number, number, number, number, number];
  /**
   * NumPy 向量化表达式。默认坐标基 X/Y/Z；脚本导出传 wrap 把网格变量映射到
   * 弧度域（如 X → kk*X）。引用 iso 时需前置 iso_base 定义。
   */
  toPython(wrap?: CoordWrap): string;
  /** MATLAB 向量化表达式（.* ./ .^ 已向量化），坐标语义同 toPython */
  toMatlab(wrap?: CoordWrap): string;
}

function scanUsage(node: EqNode, u: EquationUsage): void {
  switch (node.kind) {
    case 'var':
      if (node.name === 'r' || node.name === 'theta' || node.name === 'phi') u.coord = true;
      else if (node.name === 'k') u.k = true;
      else if (node.name === 't') u.t = true;
      else if (node.name === 'iso') u.iso = true;
      return;
    case 'unary': scanUsage(node.arg, u); return;
    case 'binary': scanUsage(node.left, u); scanUsage(node.right, u); return;
    case 'call': for (const a of node.args) scanUsage(a, u); return;
    default: return;
  }
}

const compiledCache = new Map<string, CompiledEquation>();

/**
 * 编译数学表达式为 CompiledEquation。结果按 trim 后表达式缓存。
 * 抛出 EquationParseError（带出错位置）当语法非法。
 */
export function compileEquation(expr: string): CompiledEquation {
  const key = expr.trim();
  const hit = compiledCache.get(key);
  if (hit) return hit;
  if (!key) throw new EquationParseError('表达式不能为空', 0);

  const tokens = tokenize(key);
  const ast = new Parser(tokens).parse();
  const usage: EquationUsage = { coord: false, k: false, t: false, iso: false };
  scanUsage(ast, usage);
  // 脱糖派生坐标后编译：求值/微分全走通用复合规则
  const core = desugarCoords(ast);
  const scalar = compileScalar(core);

  const compiled: CompiledEquation = {
    expr: key,
    ast,
    usage,
    evaluate: (x, y, z, params) => scalar(makeCtx(x, y, z, params)),
    gradient: (x, y, z, params) => {
      const g = evalD1(core, makeCtx(x, y, z, params));
      return [g.dx, g.dy, g.dz];
    },
    hessian: (x, y, z, params) => {
      const h = evalD2(core, makeCtx(x, y, z, params));
      // h.d[i] = ∂f/∂xᵢ 的 jet，其 d[j] 槽 = ∂²f/∂xᵢ∂xⱼ
      return [h.dx.dx, h.dy.dy, h.dz.dz, h.dx.dy, h.dy.dz, h.dx.dz];
    },
    toPython: (wrap) => emit(ast, 'py', 0, varExprTable('py', wrap), !wrap),
    toMatlab: (wrap) => emit(ast, 'ml', 0, varExprTable('ml', wrap), !wrap),
  };
  compiledCache.set(key, compiled);
  // 缓存防膨胀（UI 拖动输入场景每键一次编译）
  if (compiledCache.size > 64) {
    const first = compiledCache.keys().next().value;
    if (first !== undefined) compiledCache.delete(first);
  }
  return compiled;
}

/** 快速校验（UI 沙箱实时反馈用）：成功返回 usage，失败返回错误对象 */
export function validateEquation(expr: string): { ok: true; usage: EquationUsage } | { ok: false; message: string; pos: number } {
  try {
    const c = compileEquation(expr);
    return { ok: true, usage: c.usage };
  } catch (err) {
    if (err instanceof EquationParseError) return { ok: false, message: err.message, pos: err.pos };
    return { ok: false, message: err instanceof Error ? err.message : String(err), pos: 0 };
  }
}

// ────────────────────────────── 预设样例库 ──────────────────────────────

export interface EquationPreset {
  name: string;
  expr: string;
  desc: string;
}

/**
 * 沙箱预设样例。诚实注记：Batwing 极小曲面尚无已知三角水平集近似（与 Gyroid/P/D
 * 不同族，MathOverflow 467795 / wewanttolearn 2019 均确认），此处为同对称性的
 * 变形 Gyroid 教学演示，非精确 batwing。
 */
export const EQUATION_PRESETS: EquationPreset[] = [
  { name: 'Gyroid 基准', expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)', desc: '教科书 Gyroid 节面，自定义公式的对照起点' },
  { name: 'Schwarz P 基准', expr: 'cos(x) + cos(y) + cos(z)', desc: 'P 曲面节面，三项分离结构' },
  { name: 'Scherk 鞍塔', expr: 'sin(z) - sinh(x)*sinh(y)', desc: 'Scherk 鞍塔面的三角近似，z 向周期堆叠' },
  { name: 'Scherk 指数形式', expr: 'exp(z)*cos(x) - cos(y)', desc: 'Scherk 第一类极小曲面 z=ln(cos y / cos x) 的隐函数形式' },
  { name: 'Lidinoid 高阶变形', expr: '0.5*(2*sin(x)*cos(x)*cos(y)*sin(z) + 2*sin(y)*cos(y)*cos(z)*sin(x) + 2*sin(z)*cos(z)*cos(x)*sin(y)) - 0.5*(cos(2*x)*cos(2*y) + cos(2*y)*cos(2*z) + cos(2*z)*cos(2*x)) + 0.15*sin(3*x)*sin(3*y)*sin(3*z)', desc: 'Lidinoid 节面叠加三倍频微扰，演示高阶谐波变形' },
  { name: 'Batwing 风格变形', expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + 0.5*cos(2*x)*cos(2*y)*cos(2*z)', desc: 'Gyroid+Neovius 型耦合变形演示（注：真 Batwing 无已知三角水平集近似）' },
  { name: '球面波前调制', expr: 'cos(x) + cos(y) + cos(z) + 0.4*cos(2*r)', desc: '用球坐标 r 叠加球面波前，中心对称调制' },
  { name: '参数响应演示', expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + 0.2*t*sin(x)*sin(y)*sin(z)', desc: '引用全局参数 t（壁厚系数）实现壁厚响应场' },
];
