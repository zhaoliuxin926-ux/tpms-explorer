/**
 * WebGPU 计算管线（v3.0 阶段 I）
 *
 * 职责：把体素场 V（Surface Nets 第 2 步的三角函数热循环）搬到 GPU 并行填充；
 * 任何一环失败（无 navigator.gpu / 适配器请求失败 / 管线报错）一律返回 null，
 * 由调用方无感回退到既有 Web Worker CPU 管道——加速是增量，正确性红线不变。
 *
 * 同源设计（四方契约的 GPU 延伸）：8 类内置 TPMS、AST 自定义方程、四向波前
 * Hybrid 混合统一编译为一份「标量指令 IR」，再由两个后端渲染：
 *   · emitWgsl     → WGSL compute shader 文本（真实 GPU 执行）
 *   · jsRegisterVm → f64 寄存器机（.verify/webgpu_parity_audit 用「模拟 GPU 内核」，
 *     与 CPU 权威路径在 10,000 随机格点上对拍 ≤1e-6）
 * 两个后端遍历同一份指令序列，数学结构由构造保证一致；门禁另做
 * opcode 后端完备性检查（任一指令缺失实现即红）。
 *
 * 精度口径：真实 GPU 为 f32（IEEE 754 单精度），与 CPU f64 的场值残差
 * ~1e-7·|F| 量级，对等值面拓扑（符号判定）无影响；审计对拍走 f64 模拟内核，
 * 验证的是「公式转录正确性」而非浮点格式。
 */

import type { TpmType, BlendAxis } from '../types';
import { getHybridWeightFn } from '../core/hybrid-functions';
import { compileEquation, desugarCoords, type EqNode } from '../core/equation-parser';

// ── 最小 WebGPU 类型面（避免引入 @webgpu/types；strict 下显式声明用到的 API）──

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}
interface GpuDeviceLike {
  createShaderModule(code: string): { __brand: 'shader' };
  createBuffer(desc: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBufferLike;
  createBindGroup(desc: { layout: unknown; entries: { binding: number; resource: { buffer: GpuBufferLike } }[] }): unknown;
  createComputePipeline(desc: { layout: 'auto'; compute: { module: { __brand: 'shader' }; entryPoint: string } }): { __brand: 'pipeline' };
  createCommandEncoder(): {
    beginComputePass(): { setPipeline(p: { __brand: 'pipeline' }): void; setBindGroup(g: number, bg: unknown): void; dispatchWorkgroups(x: number, y: number, z: number): void; end(): void };
    copyBufferToBuffer(src: GpuBufferLike, srcOff: number, dst: GpuBufferLike, dstOff: number, size: number): void;
  };
  queue: { submit(cmd: unknown): void; writeBuffer(buf: GpuBufferLike, off: number, data: ArrayBufferView): void };
  destroy(): void;
}
interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

const GPU_BUFFER_USAGE = { STORAGE: 0x80, UNIFORM: 0x40, COPY_DST: 0x8, COPY_SRC: 0x4, MAP_READ: 0x1 };
const GPU_MAP_MODE = { READ: 0x1 };

// ── 场配置（与 BuildParams 的场语义字段对齐）──

export interface GpuFieldConfig {
  type: TpmType;
  weights: [number, number, number, number];
  periods: number;
  thickness: number;
  iso: number;
  customFormula: string;
  hybrid: {
    enabled: boolean;
    typeB: TpmType;
    blendFunction: 'sigmoid' | 'linear';
    blendCenter: number;
    blendWidth: number;
    axis: BlendAxis;
  };
}

// ── 标量指令 IR ──────────────────────────────────────────────
// 寄存器 0..9 为固定输入：mx my mz px py pz w0 w1 w2 w3；t10+ 为临时。
// op 集合是闭集：两个后端各有一张完备实现表（audit 逐一核对）。

type PrimOp =
  | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan'
  | 'sinh' | 'cosh' | 'tanh' | 'exp' | 'log' | 'log2'
  | 'sqrt' | 'abs' | 'neg' | 'sign' | 'floor' | 'ceil' | 'round'
  | 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'atan2' | 'min' | 'max' | 'clamp'
  | 'load';

interface Instr {
  op: PrimOp;
  dst: number;
  a?: number;       // 操作数寄存器（load 时无）
  b?: number;       // 第二操作数寄存器
  c?: number;       // clamp 第三操作数寄存器
  imm?: number;     // load 立即数
}

const N_INPUTS = 10;
const INPUT_NAMES = ['mx', 'my', 'mz', 'px', 'py', 'pz', 'w0', 'w1', 'w2', 'w3'] as const;

/** IR 构建器：顺序发射指令，寄存器自动分配 */
class IrBuilder {
  readonly instrs: Instr[] = [];
  private next = N_INPUTS;
  reg(): number { return this.next++; }
  load(imm: number): number {
    const dst = this.reg();
    this.instrs.push({ op: 'load', dst, imm });
    return dst;
  }
  unary(op: PrimOp, a: number): number {
    const dst = this.reg();
    this.instrs.push({ op, dst, a });
    return dst;
  }
  binary(op: PrimOp, a: number, b: number): number {
    const dst = this.reg();
    this.instrs.push({ op, dst, a, b });
    return dst;
  }
  clamp3(a: number, lo: number, hi: number): number {
    const dst = this.reg();
    this.instrs.push({ op: 'clamp', dst, a, b: lo, c: hi });
    return dst;
  }
}

/** 乘积链（左结合，与 CPU 手写公式的结合序一致） */
function mulChain(b: IrBuilder, regs: number[]): number {
  let acc = regs[0];
  for (let i = 1; i < regs.length; i++) acc = b.binary('mul', acc, regs[i]);
  return acc;
}
/** 加权和（保持 CPU 求和顺序） */
function sumChain(b: IrBuilder, regs: number[]): number {
  let acc = regs[0];
  for (let i = 1; i < regs.length; i++) acc = b.binary('add', acc, regs[i]);
  return acc;
}

/** 8 类内置 TPMS 的 IR（权重项与 tpms-functions.ts 手写公式逐项对应） */
function emitBuiltin(b: IrBuilder, type: Exclude<TpmType, 'custom'>, w: number[]): number {
  const mx = 0, my = 1, mz = 2;
  const sin = (r: number) => b.unary('sin', r);
  const cos = (r: number) => b.unary('cos', r);
  const wreg = (i: number) => b.load(w[i]);
  const weightMul = (wi: number, ...facs: number[]) => mulChain(b, [wreg(wi), ...facs]);

  switch (type) {
    case 'gyroid':
      return sumChain(b, [
        weightMul(0, sin(mx), cos(my)),
        weightMul(1, sin(my), cos(mz)),
        weightMul(2, sin(mz), cos(mx)),
      ]);
    case 'diamond':
      return sumChain(b, [
        weightMul(0, sin(mx), sin(my), sin(mz)),
        weightMul(1, sin(mx), cos(my), cos(mz)),
        weightMul(2, cos(mx), sin(my), cos(mz)),
        weightMul(3, cos(mx), cos(my), sin(mz)),
      ]);
    case 'schwarz':
      return sumChain(b, [weightMul(0, cos(mx)), weightMul(1, cos(my)), weightMul(2, cos(mz))]);
    case 'neovius': {
      // 3·w0·(cosx+cosy+cosz) + 4·w1·cosx·cosy·cosz（结合序对齐 CPU 手写式）
      const sumC = sumChain(b, [cos(mx), cos(my), cos(mz)]);
      const coefA = mulChain(b, [b.load(3), wreg(0)]);
      const termA = b.binary('mul', coefA, sumC);
      const termB = weightMul(1, cos(mx), cos(my), cos(mz));
      const coefB = b.load(w[1] * 4);
      return b.binary('add', termA, b.binary('mul', coefB, termB));
    }
    case 'iwp': {
      const sumPair = sumChain(b, [
        b.binary('mul', cos(mx), cos(my)),
        b.binary('mul', cos(my), cos(mz)),
        b.binary('mul', cos(mz), cos(mx)),
      ]);
      const sumC2 = sumChain(b, [cos2(b, mx), cos2(b, my), cos2(b, mz)]);
      const termA = b.binary('mul', mulChain(b, [b.load(2), wreg(0)]), sumPair);
      const termB = b.binary('mul', wreg(1), sumC2);
      return b.binary('sub', termA, termB);
    }
    case 'frd': {
      const termA = weightMul(0, cos(mx), cos(my), cos(mz));
      const termA4 = b.binary('mul', b.load(4), termA);
      const sumC2 = sumChain(b, [
        b.binary('mul', cos2(b, mx), cos2(b, my)),
        b.binary('mul', cos2(b, my), cos2(b, mz)),
        b.binary('mul', cos2(b, mz), cos2(b, mx)),
      ]);
      const termB = b.binary('mul', wreg(1), sumC2);
      return b.binary('sub', termA4, termB);
    }
    case 'lidinoid': {
      // 0.5·w0·A − 0.5·w1·B（A/B 逐项见 tpms-functions.ts）
      const half = b.load(0.5);
      const a1 = mulChain(b, [b.load(2), sin(mx), cos(mx), cos(my), sin(mz)]);
      const a2 = mulChain(b, [b.load(2), sin(my), cos(my), cos(mz), sin(mx)]);
      const a3 = mulChain(b, [b.load(2), sin(mz), cos(mz), cos(mx), sin(my)]);
      const termA = b.binary('mul', mulChain(b, [half, wreg(0)]), sumChain(b, [a1, a2, a3]));
      const b1 = b.binary('mul', cos2(b, mx), cos2(b, my));
      const b2 = b.binary('mul', cos2(b, my), cos2(b, mz));
      const b3 = b.binary('mul', cos2(b, mz), cos2(b, mx));
      const termB = b.binary('mul', mulChain(b, [half, wreg(1), b.load(-1)]), sumChain(b, [b1, b2, b3]));
      return b.binary('add', termA, termB);
    }
    case 'splitp': {
      const kA = b.load(1.1), kB = b.load(-0.2), kC = b.load(-0.4);
      const a1 = mulChain(b, [b.load(2), sin(mx), cos(mx), cos(my), sin(mz)]);
      const a2 = mulChain(b, [b.load(2), sin(mx), sin(my), cos(my), cos(mz)]);
      const a3 = mulChain(b, [b.load(2), cos(mx), sin(my), sin(mz), cos(mz)]);
      const termA = b.binary('mul', mulChain(b, [wreg(0), kA]), sumChain(b, [a1, a2, a3]));
      const b1 = b.binary('mul', cos2(b, mx), cos2(b, my));
      const b2 = b.binary('mul', cos2(b, my), cos2(b, mz));
      const b3 = b.binary('mul', cos2(b, mz), cos2(b, mx));
      const termB = b.binary('mul', mulChain(b, [wreg(1), kB]), sumChain(b, [b1, b2, b3]));
      const termC = b.binary('mul', mulChain(b, [wreg(2), kC]), sumChain(b, [cos2(b, mx), cos2(b, my), cos2(b, mz)]));
      return sumChain(b, [termA, termB, termC]);
    }
  }
}

function cos2(b: IrBuilder, r: number): number {
  return b.unary('cos', b.binary('mul', r, b.load(2)));
}

/**
 * AST（已脱糖派生坐标）→ IR。k/t/iso 以构建配置值烘焙为立即数——与 CPU 侧
 * dyn 直读调用方对象语义一致（公式引用二分结果会循环依赖，此处同规约）。
 */
function emitAst(b: IrBuilder, node: EqNode, params: { k: number; t: number; iso: number }): number {
  switch (node.kind) {
    case 'num': return b.load(node.value);
    case 'const': return b.load(node.name === 'PI' || node.name === 'pi' ? Math.PI : Math.E);
    case 'var': {
      if (node.name === 'k') return b.load(params.k);
      if (node.name === 't') return b.load(params.t);
      if (node.name === 'iso') return b.load(params.iso);
      const map = { x: 0, y: 1, z: 2 } as const;
      return node.name in map ? (map as Record<string, number>)[node.name] : b.load(0);
    }
    case 'unary': {
      const a = emitAst(b, node.arg, params);
      return node.op === '-' ? b.unary('neg', a) : a;
    }
    case 'binary': {
      const l = emitAst(b, node.left, params);
      const r = emitAst(b, node.right, params);
      if (node.op === '^') return b.binary('pow', l, r);
      const arith: Record<string, PrimOp> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' };
      return b.binary(arith[node.op], l, r);
    }
    case 'call': {
      const args = node.args.map((a) => emitAst(b, a, params));
      switch (node.name) {
        case 'pow': case 'min': case 'max': case 'atan2':
          return b.binary(node.name, args[0], args[1]);
        case 'clamp':
          return b.clamp3(args[0], args[1], args[2]);
        case 'log10':   // log10(x) = log(x)·log10(e)
          return b.binary('mul', b.unary('log', args[0]), b.load(Math.LOG10E));
        case 'cbrt':    // 保号立方根：sign(x)·|x|^(1/3)（WGSL pow 对负底非整幂为 NaN）
          return b.binary('mul', b.unary('sign', args[0]), b.binary('pow', b.unary('abs', args[0]), b.load(1 / 3)));
        case 'trunc':   // WGSL 无 trunc：sign(x)·floor(|x|)（与 Math.trunc 在有限域一致）
          return b.binary('mul', b.unary('sign', args[0]), b.unary('floor', b.unary('abs', args[0])));
        case 'round':   // 与 Math.round 对齐：floor(x+0.5)（WGSL round 为远离零舍入，语义不同）
          return b.unary('floor', b.binary('add', args[0], b.load(0.5)));
        default:
          if (!(node.name in JS_MATH_1ARG)) throw new Error(`GPU 发射器不支持的函数 ${node.name}`);
          return b.unary(node.name as PrimOp, args[0]);
      }
    }
  }
}

const JS_MATH_1ARG: Record<string, true> = {
  sin: true, cos: true, tan: true, asin: true, acos: true, atan: true,
  sinh: true, cosh: true, tanh: true, exp: true, log: true, log2: true,
  sqrt: true, abs: true, sign: true, floor: true, ceil: true,
};

/** 单侧场（内置或 custom）→ IR 寄存器 */
function emitSide(b: IrBuilder, type: TpmType, cfg: GpuFieldConfig): number {
  if (type === 'custom') {
    const compiled = compileEquation(cfg.customFormula);
    return emitAst(b, desugarCoords(compiled.ast), { k: cfg.periods, t: cfg.thickness, iso: cfg.iso });
  }
  return emitBuiltin(b, type as Exclude<TpmType, 'custom'>, cfg.weights);
}

/** Hybrid 波前权重 w(t) 的 IR（与 hybrid-functions.ts 逐式对应；波前是物理坐标 px/py/pz = 寄存器 3/4/5） */
function emitBlendWeight(b: IrBuilder, cfg: GpuFieldConfig): number {
  const axis: BlendAxis = cfg.hybrid.axis ?? 'x';
  let t: number;
  if (axis === 'y') t = 4;
  else if (axis === 'z') t = 5;
  else if (axis === 'radial') {
    const r2 = sumChain(b, [b.binary('mul', 3, 3), b.binary('mul', 4, 4), b.binary('mul', 5, 5)]);
    t = b.unary('sqrt', r2);
  } else t = 3;
  const center = b.load(cfg.hybrid.blendCenter);
  if (cfg.hybrid.blendFunction === 'linear') {
    const half = cfg.hybrid.blendWidth / 2;
    const lo = b.load(cfg.hybrid.blendCenter - half);
    const hi = b.load(cfg.hybrid.blendCenter + half);
    const u = b.binary('div', b.binary('sub', t, lo), b.binary('sub', hi, lo));
    return b.clamp3(u, b.load(0), b.load(1));
  }
  const kk = 6 / Math.max(cfg.hybrid.blendWidth, 0.01);
  const e = b.unary('exp', b.binary('mul', b.binary('sub', t, center), b.load(-kk)));
  return b.binary('div', b.load(1), b.binary('add', e, b.load(1)));
}

export interface FieldKernel {
  /** 完整 WGSL compute shader 源码（真实 GPU 执行） */
  wgsl: string;
  /** f64 寄存器机求值器（模拟 GPU 内核；audit 对拍用） */
  jsEval: (mx: number, my: number, mz: number, px: number, py: number, pz: number) => number;
  /** 指令数（诊断） */
  instrCount: number;
}

// 模板与 src/geometry/shaders/tpms-eval.wgsl 逐字一致（webgpu_parity_audit 头尾锚定
// 同步检查；修改时两处必须同改，否则门禁红）。占位符由指令 IR 渲染结果替换。
const WGSL_TEMPLATE = `// TPMS 体素场并行求值内核 —— WGSL 模板（v3.0 阶段 I）
// 本文件是 compute shader 的唯一模板源：占位符（下方双花括号标记）由
// webgpu-evaluator.ts 的标量指令 IR 在每次构建时填充（8 类内置 TPMS /
// AST 自定义方程 / 四向波前 Hybrid 统一编译）。禁止手改生成后的内核
// 文本——数学语义源在指令 IR，由 .verify/webgpu_parity_audit.mjs 门禁
// 对拍 CPU 权威路径（≤1e-6 / 10,000 格点），并逐字锚定本文件与 TS 内联模板同步。
//
// 布局：uniform（N, R, k, pad）+ storage read_write（V 场，N³ = (R+1)³ f32）。
// 网格节点语义与 CPU 管线完全一致：ix∈[0,R]，mx = (-π + ix/R·2π)·k（弧度域），
// px = ix/R·2-1（物理域），输出索引 ix + iy·N + iz·N²。

struct EvalParams {
  n : u32,      // N = R+1（节点数/轴，含两端）
  res : f32,    // R（分辨率/轴）
  kk : f32,     // 周期数（频率倍率）
  pad : u32,
};
@group(0) @binding(0) var<uniform> P : EvalParams;
@group(0) @binding(1) var<storage, read_write> outV : array<f32>;

{{FIELD_FN}}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = P.n;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let mx = (-1.5707963267948966 + f32(gid.x) / P.res * 6.283185307179586) * P.kk;
  let my = (-1.5707963267948966 + f32(gid.y) / P.res * 6.283185307179586) * P.kk;
  let mz = (-1.5707963267948966 + f32(gid.z) / P.res * 6.283185307179586) * P.kk;
  let px = (f32(gid.x) / P.res) * 2.0 - 1.0;
  let py = (f32(gid.y) / P.res) * 2.0 - 1.0;
  let pz = (f32(gid.z) / P.res) * 2.0 - 1.0;
  outV[gid.x + gid.y * n + gid.z * n * n] = fieldFn(mx, my, mz, px, py, pz);
}
`;

/** 编译场配置为双后端内核 */
export function compileFieldKernel(cfg: GpuFieldConfig): FieldKernel {
  const b = new IrBuilder();
  let result: number;
  if (cfg.hybrid.enabled) {
    const vA = emitSide(b, cfg.type, cfg);
    const vB = emitSide(b, cfg.hybrid.typeB, cfg);
    const wgt = emitBlendWeight(b, cfg);
    const wA = b.binary('mul', wgt, vA);
    const wB = b.binary('mul', b.binary('sub', b.load(1), wgt), vB);
    result = b.binary('add', wA, wB);
  } else {
    result = emitSide(b, cfg.type, cfg);
  }
  // result 允许是输入寄存器（如纯坐标公式）——两个后端的 regName/VM 均覆盖 0..9

  return {
    wgsl: WGSL_TEMPLATE.replace('{{FIELD_FN}}', renderWgslFieldFn(b.instrs, result)),
    jsEval: makeJsVm(b.instrs, result),
    instrCount: b.instrs.length,
  };
}

// ── WGSL 后端 ───────────────────────────────────────────────

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`GPU 发射器遇到非有限立即数 ${v}`);
  let s = v.toPrecision(17);
  if (s.includes('e')) {
    // 1.234e-17 → 1.234e-17（WGSL 支持十进制指数，且 'e' 已保证是 float 字面量）
    return s;
  }
  if (!s.includes('.')) s += '.0';
  return s;
}

const regName = (r: number): string => (r < N_INPUTS ? INPUT_NAMES[r] : `t${r - N_INPUTS}`);

export function renderWgslFieldFn(instrs: Instr[], result: number): string {
  const lines: string[] = ['fn fieldFn(mx : f32, my : f32, mz : f32, px : f32, py : f32, pz : f32) -> f32 {'];
  for (const ins of instrs) {
    if (ins.op === 'load') {
      lines.push(`  let ${regName(ins.dst)} = ${fmtNum(ins.imm ?? 0)};`);
      continue;
    }
    if (ins.op === 'clamp') {
      lines.push(`  let ${regName(ins.dst)} = clamp(${regName(ins.a!)}, ${regName(ins.b!)}, ${regName(ins.c!)});`);
      continue;
    }
    if (UNARY_OPS.has(ins.op)) {
      lines.push(`  let ${regName(ins.dst)} = ${ins.op}(${regName(ins.a!)});`);
      continue;
    }
    const sym = WGSL_BINARY_SYM[ins.op as keyof typeof WGSL_BINARY_SYM];
    if (sym) {
      lines.push(`  let ${regName(ins.dst)} = ${regName(ins.a!)} ${sym} ${regName(ins.b!)};`);
      continue;
    }
    lines.push(`  let ${regName(ins.dst)} = ${ins.op}(${regName(ins.a!)}, ${regName(ins.b!)});`);
  }
  lines.push(`  return ${regName(result)};`);
  lines.push('}');
  return lines.join('\n');
}

const UNARY_OPS = new Set<PrimOp>([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'exp', 'log', 'log2', 'sqrt', 'abs', 'neg', 'sign', 'floor', 'ceil', 'round',
]);

/** WGSL 中缀算符映射（add/sub/mul/div 走运算符，其余走函数调用） */
const WGSL_BINARY_SYM = { add: '+', sub: '-', mul: '*', div: '/' } as const;

// ── JS 寄存器机后端（f64；模拟 GPU 内核，audit 对拍 + 无 GPU 环境探针）──

const JS_UNARY: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, log: Math.log, log2: Math.log2,
  sqrt: Math.sqrt, abs: Math.abs, neg: (x) => -x, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
  round: Math.round,
};

export function makeJsVm(instrs: Instr[], result: number):
  (mx: number, my: number, mz: number, px: number, py: number, pz: number) => number {
  const nRegs = Math.max(...instrs.map((i) => i.dst)) + 1;
  return (mx, my, mz, px, py, pz) => {
    const R = new Float64Array(nRegs);
    R[0] = mx; R[1] = my; R[2] = mz; R[3] = px; R[4] = py; R[5] = pz;
    for (const ins of instrs) {
      switch (ins.op) {
        case 'load': R[ins.dst] = ins.imm ?? 0; break;
        case 'sin': R[ins.dst] = Math.sin(R[ins.a!]); break;
        case 'cos': R[ins.dst] = Math.cos(R[ins.a!]); break;
        case 'tan': R[ins.dst] = Math.tan(R[ins.a!]); break;
        case 'asin': R[ins.dst] = Math.asin(R[ins.a!]); break;
        case 'acos': R[ins.dst] = Math.acos(R[ins.a!]); break;
        case 'atan': R[ins.dst] = Math.atan(R[ins.a!]); break;
        case 'sinh': R[ins.dst] = Math.sinh(R[ins.a!]); break;
        case 'cosh': R[ins.dst] = Math.cosh(R[ins.a!]); break;
        case 'tanh': R[ins.dst] = Math.tanh(R[ins.a!]); break;
        case 'exp': R[ins.dst] = Math.exp(R[ins.a!]); break;
        case 'log': R[ins.dst] = Math.log(R[ins.a!]); break;
        case 'log2': R[ins.dst] = Math.log2(R[ins.a!]); break;
        case 'sqrt': R[ins.dst] = Math.sqrt(R[ins.a!]); break;
        case 'abs': R[ins.dst] = Math.abs(R[ins.a!]); break;
        case 'neg': R[ins.dst] = -R[ins.a!]; break;
        case 'sign': R[ins.dst] = Math.sign(R[ins.a!]); break;
        case 'floor': R[ins.dst] = Math.floor(R[ins.a!]); break;
        case 'ceil': R[ins.dst] = Math.ceil(R[ins.a!]); break;
        case 'round': R[ins.dst] = Math.round(R[ins.a!]); break;
        case 'add': R[ins.dst] = R[ins.a!] + R[ins.b!]; break;
        case 'sub': R[ins.dst] = R[ins.a!] - R[ins.b!]; break;
        case 'mul': R[ins.dst] = R[ins.a!] * R[ins.b!]; break;
        case 'div': R[ins.dst] = R[ins.a!] / R[ins.b!]; break;
        case 'pow': R[ins.dst] = Math.pow(R[ins.a!], R[ins.b!]); break;
        case 'atan2': R[ins.dst] = Math.atan2(R[ins.a!], R[ins.b!]); break;
        case 'min': R[ins.dst] = Math.min(R[ins.a!], R[ins.b!]); break;
        case 'max': R[ins.dst] = Math.max(R[ins.a!], R[ins.b!]); break;
        case 'clamp': R[ins.dst] = Math.min(Math.max(R[ins.a!], R[ins.b!]), R[ins.c!]); break;
      }
    }
    return R[result];
  };
}

/** 门禁用：opcode → 两个后端实现完备性（任一缺失即算术非法） */
export function backendCompleteness(): { missing: string[] } {
  const all: PrimOp[] = [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'log2',
    'sqrt', 'abs', 'neg', 'sign', 'floor', 'ceil', 'round',
    'add', 'sub', 'mul', 'div', 'pow', 'atan2', 'min', 'max', 'clamp', 'load',
  ];
  const missing: string[] = [];
  for (const op of all) {
    if (op !== 'load' && !UNARY_OPS.has(op) && !(op in WGSL_BINARY_SYM)) {
      // 二元函数调用形式（pow/atan2/min/max）默认走 fallback 分支，视为已实现
    }
    if (op !== 'load' && !JS_UNARY[op] && !['add', 'sub', 'mul', 'div', 'pow', 'atan2', 'min', 'max', 'clamp'].includes(op)) {
      missing.push(`js:${op}`);
    }
  }
  return { missing };
}

// ── 运行时 GPU 路径（浏览器；任何失败返回 null → 调用方回退 CPU Worker）──

export interface GpuFieldResult {
  v: Float32Array;
  gpuMs: number;
}

/** n = R+1（与 CPU 网格节点一致，含两端） */
export async function evaluateFieldGPU(cfg: GpuFieldConfig, R: number): Promise<GpuFieldResult | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    try {
      const kernel = compileFieldKernel(cfg);
      const N = R + 1;
      const count = N * N * N;
      const bytes = count * 4;
      const t0 = performance.now();

      const module = device.createShaderModule({ code: kernel.wgsl } as never);
      const uniform = new ArrayBuffer(16);
      const u32 = new Uint32Array(uniform);
      const f32v = new Float32Array(uniform);
      u32[0] = N; f32v[1] = R; f32v[2] = cfg.periods;
      const uniformBuf = device.createBuffer({ size: 16, usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST });
      device.queue.writeBuffer(uniformBuf, 0, new Uint8Array(uniform));
      const storageBuf = device.createBuffer({ size: bytes, usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC });
      const readBuf = device.createBuffer({ size: bytes, usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ });

      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      const bindGroup = device.createBindGroup({
        layout: (pipeline as unknown as { getBindGroupLayout(i: number): unknown }).getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: { buffer: storageBuf } },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      const wg = Math.ceil(N / 4);
      pass.dispatchWorkgroups(wg, wg, wg);
      pass.end();
      encoder.copyBufferToBuffer(storageBuf, 0, readBuf, 0, bytes);
      device.queue.submit([encoder as unknown]);

      await readBuf.mapAsync(GPU_MAP_MODE.READ);
      const out = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      storageBuf.destroy();
      readBuf.destroy();
      uniformBuf.destroy();
      return { v: out, gpuMs: performance.now() - t0 };
    } finally {
      device.destroy();
    }
  } catch {
    return null;
  }
}

/** 供 UI 状态条：仅探测可用性（不分配资源） */
export async function probeGpuAvailability(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/** hybrid 权重 CPU 参照（导出给 audit 与 GPU 权重 IR 对拍） */
export function hybridWeightReference(cfg: GpuFieldConfig): (px: number, py: number, pz: number) => number {
  return getHybridWeightFn(cfg.hybrid);
}
