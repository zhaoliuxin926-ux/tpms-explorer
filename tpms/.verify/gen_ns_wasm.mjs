// gen_ns_wasm.mjs —— 手工汇编 navier-stokes 内核为 WASM 二进制（不依赖 wabt；
// 自编码 LEB128/段结构，V8 即时验证）。产物以 base64 注入 navier-stokes-solver.ts。
// 用法：node gen_ns_wasm.mjs   （在 .verify/ 下）
import { readFileSync, writeFileSync } from 'node:fs';

// ── LEB128 ──
function u32(v) {
  const out = [];
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
function s32(v) {
  const out = [];
  for (;;) {
    const b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { out.push(b); break; }
    out.push(b | 0x80);
  }
  return out;
}
function f64b(v) {
  const b = new ArrayBuffer(8);
  new Float64Array(b)[0] = v;
  return [...new Uint8Array(b)];
}
function vec(items) { return [...u32(items.length), ...items.flat()]; }
function section(id, payload) { return [id, ...u32(payload.length), ...payload]; }

// ── 操作码 ──
const OP = {
  block: 0x02, loop: 0x03, if: 0x04, else: 0x05, end: 0x0b, br: 0x0c, brif: 0x0d, ret: 0x0f,
  call: 0x10, drop: 0x1a,
  lget: 0x20, lset: 0x21, gget: 0x23, gset: 0x24,
  i32load8u: 0x2d, f64load: 0x2b, f64store: 0x39,
  i32const: 0x41, f64const: 0x44,
  i32eqz: 0x45, i32eq: 0x46, i32lt_s: 0x48, i32ge_s: 0x4e,
  i32add: 0x6a, i32sub: 0x6b, i32mul: 0x6c, i32div_s: 0x6d, i32rem_s: 0x6f, i32shl: 0x74,
  f64add: 0xa0, f64sub: 0xa1, f64mul: 0xa2, f64convert_i32_s: 0xb7,
};
// mem-arg: align=3 (8B) / 0 (1B), offset=0
const memarg = (align) => [align, 0];

// ── 全局索引 ──
const G = { ci: 0, ux: 1, uy: 2, uz: 3, pc: 4, lapx: 5, lapy: 6, lapz: 7, gx: 8, gy: 9, gz: 10, div: 11, uo: 12, po: 13, mo: 14, gnx: 15, gny: 16, gnz: 17, gper: 18 };

// ── nbidx(axis, dir) -> i32 ──
function nbidx() {
  const o = [];
  // locals: 2=coord 3=stride 4=lim 5=a（param 0=axis 1=dir）
  const L = (i) => [...u32(OP.lget), ...u32(i)];
  const Gt = (g) => [...u32(OP.gget), ...u32(g)];
  const S = (i) => [...u32(OP.lset), ...u32(i)];
  const ic = (v) => [OP.i32const, ...s32(v)];
  o.push(...ic(1), ...S(3));
  o.push(...Gt(G.ci), ...S(2));
  o.push(...Gt(G.gnx), ...S(4));
  // axis==1 → coord=ci/nx, stride=nx, lim=ny
  o.push(...L(0), ...ic(1), ...u32(OP.i32eq), OP.if, ...u32(0x40));
  o.push(...Gt(G.ci), ...Gt(G.gnx), ...u32(OP.i32div_s), ...S(2));
  o.push(...Gt(G.gnx), ...S(3));
  o.push(...Gt(G.gny), ...S(4));
  o.push(OP.end);
  // axis==2 → coord=ci/(nx*ny), stride=nx*ny, lim=nz
  o.push(...L(0), ...ic(2), ...u32(OP.i32eq), OP.if, ...u32(0x40));
  o.push(...Gt(G.ci), ...Gt(G.gnx), ...Gt(G.gny), ...u32(OP.i32mul), ...u32(OP.i32div_s), ...S(2));
  o.push(...Gt(G.gnx), ...Gt(G.gny), ...u32(OP.i32mul), ...S(3));
  o.push(...Gt(G.gnz), ...S(4));
  o.push(OP.end);
  // a = coord + dir
  o.push(...L(2), ...L(1), ...u32(OP.i32add), ...S(5));
  // 周期回卷
  o.push(...Gt(G.gper), OP.if, ...u32(0x40));
  o.push(...L(5), ...L(4), ...u32(OP.i32rem_s), ...L(4), ...u32(OP.i32add), ...L(4), ...u32(OP.i32rem_s), ...S(5));
  o.push(OP.else);
  o.push(...L(5), ...ic(0), ...u32(OP.i32lt_s), OP.if, ...u32(0x40), ...Gt(G.ci), OP.ret, OP.end);
  o.push(...L(5), ...L(4), ...u32(OP.i32ge_s), OP.if, ...u32(0x40), ...Gt(G.ci), OP.ret, OP.end);
  o.push(OP.end);
  // ci + (a−coord)*stride
  o.push(...Gt(G.ci), ...L(5), ...L(2), ...u32(OP.i32sub), ...L(3), ...u32(OP.i32mul), ...u32(OP.i32add));
  return o;
}

// ── doDir(axis, dir)：读 param(0)=axis (1)=dir；locals 2=n 3=un 4=uc 5=du 6=dp ──
function doDir() {
  const o = [];
  const L = (i) => [...u32(OP.lget), ...u32(i)];
  const S = (i) => [...u32(OP.lset), ...u32(i)];
  const Gt = (g) => [...u32(OP.gget), ...u32(g)];
  const Gs = (g) => [...u32(OP.gset), ...u32(g)];
  const ic = (v) => [OP.i32const, ...s32(v)];
  const fc = (v) => [OP.f64const, ...f64b(v)];
  o.push(...L(0), ...L(1), ...u32(OP.call), ...u32(0), ...S(2));       // n = nbidx(axis, dir)
  o.push(...L(2), ...Gt(G.ci), ...u32(OP.i32eq), OP.if, ...u32(0x40), OP.ret, OP.end);
  // un = u[n, axis]：uo + (n*3+axis)<<3
  o.push(...Gt(G.uo), ...L(2), ...ic(3), ...u32(OP.i32mul), ...L(0), ...u32(OP.i32add), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add), [OP.f64load, ...memarg(3)], ...S(3));
  // uc = u[ci, axis]
  o.push(...Gt(G.uo), ...Gt(G.ci), ...ic(3), ...u32(OP.i32mul), ...L(0), ...u32(OP.i32add), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add), [OP.f64load, ...memarg(3)], ...S(4));
  // dp = p[n] - p[ci]
  o.push(...Gt(G.po), ...L(2), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add), [OP.f64load, ...memarg(3)]);
  o.push(...Gt(G.po), ...Gt(G.ci), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add), [OP.f64load, ...memarg(3)], OP.f64sub, ...S(6));
  // du = un - uc
  o.push(...L(3), ...L(4), OP.f64sub, ...S(5));
  // 三轴 lap 累加（折叠 if 链：axis==0/1/2）
  const axisEq = (a) => { o.push(...L(0), ...ic(a), ...u32(OP.i32eq), OP.if, ...u32(0x40)); };
  const endIf = () => o.push(OP.end);
  axisEq(0); o.push(...Gt(G.lapx), ...L(5), OP.f64add, ...Gs(G.lapx)); endIf();
  axisEq(1); o.push(...Gt(G.lapy), ...L(5), OP.f64add, ...Gs(G.lapy)); endIf();
  axisEq(2); o.push(...Gt(G.lapz), ...L(5), OP.f64add, ...Gs(G.lapz)); endIf();
  // g[axis] += dp*dir/2
  axisEq(0); o.push(...Gt(G.gx), ...L(6), ...fc(0.5), OP.f64mul, ...L(1), ...u32(OP.f64convert_i32_s), OP.f64mul, OP.f64add, ...Gs(G.gx)); endIf();
  axisEq(1); o.push(...Gt(G.gy), ...L(6), ...fc(0.5), OP.f64mul, ...L(1), ...u32(OP.f64convert_i32_s), OP.f64mul, OP.f64add, ...Gs(G.gy)); endIf();
  axisEq(2); o.push(...Gt(G.gz), ...L(6), ...fc(0.5), OP.f64mul, ...L(1), ...u32(OP.f64convert_i32_s), OP.f64mul, OP.f64add, ...Gs(G.gz)); endIf();
  // div += du*dir/2（仅 x）
  axisEq(0); o.push(...Gt(G.div), ...L(5), ...fc(0.5), OP.f64mul, ...L(1), ...u32(OP.f64convert_i32_s), OP.f64mul, OP.f64add, ...Gs(G.div)); endIf();
  return o;
}

// ── sweep：12 参数 + locals(12=idx 13=N 14=isfl 15=vn) ──
function sweep() {
  const o = [];
  const L = (i) => [...u32(OP.lget), ...u32(i)];
  const S = (i) => [...u32(OP.lset), ...u32(i)];
  const Gt = (g) => [...u32(OP.gget), ...u32(g)];
  const Gs = (g) => [...u32(OP.gset), ...u32(g)];
  const ic = (v) => [OP.i32const, ...s32(v)];
  const fc = (v) => [OP.f64const, ...f64b(v)];
  const f64storeAt = () => [[OP.f64store, ...memarg(3)]];
  const f64loadAt = () => [[OP.f64load, ...memarg(3)]];
  // 地址宏：基址为局部参数（0=uoP 1=unoP 2=poP）；(ci*3 + c)<<3 或 ci<<3
  const addrU = (base, c) => [...L(base), ...Gt(G.ci), ...ic(3), ...u32(OP.i32mul), ...(c ? [...ic(c), ...u32(OP.i32add)] : []), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add)];
  const addrP = (base) => [...L(base), ...Gt(G.ci), ...ic(3), ...u32(OP.i32shl), ...u32(OP.i32add)];

  o.push(...L(0), ...Gs(G.uo));
  o.push(...L(2), ...Gs(G.po));
  o.push(...L(3), ...Gs(G.mo));
  o.push(...L(4), ...Gs(G.gnx));
  o.push(...L(5), ...Gs(G.gny));
  o.push(...L(6), ...Gs(G.gnz));
  o.push(...L(7), ...Gs(G.gper));
  o.push(...L(4), ...L(5), ...u32(OP.i32mul), ...L(6), ...u32(OP.i32mul), ...S(13));
  o.push(...ic(0), ...S(12));
  // block/loop
  o.push(OP.block, ...u32(0x40), OP.loop, ...u32(0x40));
  o.push(...L(12), ...L(13), ...u32(OP.i32ge_s), ...u32(OP.brif), ...u32(1));
  o.push(...L(12), ...Gs(G.ci));
  o.push(...L(3), ...L(12), ...u32(OP.i32add), OP.i32load8u, ...memarg(0), ...S(14));
  // 固体格：u'=0，p 不变，next
  o.push(...L(14), ...u32(OP.i32eqz), OP.if, ...u32(0x40));
  for (const c of [0, 1, 2]) o.push(...addrU(1, c), ...fc(0), ...f64storeAt());
  o.push(...addrP(2), ...addrP(2), ...f64loadAt(), ...f64storeAt());
  o.push(OP.end);
  // 六方向
  for (const [a, d] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    o.push(...ic(a), ...ic(d), ...u32(OP.call), ...u32(1));
  }
  // u' 三分量
  const ucase = (c, hasFx, gIdx, lapIdx) => {
    o.push(...addrU(0, c), ...f64loadAt(), ...S(15));
    o.push(...addrU(1, c));
    o.push(...L(15));
    if (hasFx) o.push(...L(10));
    o.push(...Gt(gIdx), OP.f64sub);
    o.push(...L(9), ...Gt(lapIdx), OP.f64mul, OP.f64add);
    o.push(...L(8), OP.f64mul, OP.f64add, ...f64storeAt());
  };
  const MODE = Number(process.env.UCMODE ?? 7);
  if (MODE & 1) ucase(0, true, G.gx, G.lapx);
  if (MODE & 2) ucase(1, false, G.gy, G.lapy);
  if (MODE & 4) ucase(2, false, G.gz, G.lapz);
  if (MODE === 8) ucase(0, false, G.gy, G.lapy);   // x 寻址 + y 场
  if (MODE === 9) ucase(1, true, G.gx, G.lapx);    // y 寻址 + x 场
  // p' = p - beta*div
  o.push(...addrP(2), ...addrP(2), ...f64loadAt(), ...L(11), ...Gt(G.div), OP.f64mul, OP.f64sub, ...f64storeAt());
  // next
  o.push(...L(12), ...ic(1), ...u32(OP.i32add), ...S(12), ...u32(OP.br), ...u32(0));
  o.push(OP.end, OP.end);
  return o;
}

// ── 组装模块 ──
function functype(params, results) {
  return [0x60, ...u32(params.length), ...params, ...u32(results.length), ...results];
}
const I = 0x7f, F = 0x7c;
const typeSec = section(1, vec([
  functype([I, I], [I]),          // 0: nbidx
  functype([I, I], []),           // 1: doDir
  functype([I, I, I, I, I, I, I, I, F, F, F, F], []), // 2: sweep
]));
const funcSec = section(3, vec([[0], [1], [2]]));
const memSec = section(5, vec([[0x01, ...u32(1), ...u32(4096)]])); // limits: min1 max4096
// 全局段：19 个可变全局（0=ci i32；1-10 f64；11=div f64；12-18 i32）
function globalEntry(type, initBytes) { return [type, 0x01, ...initBytes]; }
const i32Init = [0x41, ...s32(0), 0x0b];
const f64Init = [0x44, ...f64b(0), 0x0b];
const globalSec = section(6, vec([
  globalEntry(I, i32Init),
  globalEntry(F, f64Init), globalEntry(F, f64Init), globalEntry(F, f64Init), globalEntry(F, f64Init),
  globalEntry(F, f64Init), globalEntry(F, f64Init), globalEntry(F, f64Init),
  globalEntry(F, f64Init), globalEntry(F, f64Init), globalEntry(F, f64Init), globalEntry(F, f64Init),
  globalEntry(I, i32Init), globalEntry(I, i32Init), globalEntry(I, i32Init), globalEntry(I, i32Init),
  globalEntry(I, i32Init), globalEntry(I, i32Init), globalEntry(I, i32Init),
]));
const expSec = section(7, vec([
  [...u32(3), ...Array.from('mem').map((c) => c.charCodeAt(0)), 0x02, ...u32(0)],
  [...u32(5), ...Array.from('sweep').map((c) => c.charCodeAt(0)), 0x00, ...u32(2)],
]));
function codeBody(locals, body) {
  // locals: [[count,type],...]；body = 指令字节数组；结尾 end
  const localDecls = locals.length ? [...vec(locals.map(([n, t]) => [...u32(n), t]))] : [0];
  const b = [...localDecls, ...body.flat(Infinity), OP.end];
  return [...u32(b.length), ...b];
}
const codeSec = section(10, vec([
  codeBody([[4, I]], nbidx()),
  codeBody([[1, I], [4, F]], doDir()),
  codeBody([[3, I], [1, F]], sweep()),
]));

const mod = [...[0x00, 0x61, 0x73, 0x6d], ...[0x01, 0x00, 0x00, 0x00], ...typeSec, ...funcSec, ...memSec, ...globalSec, ...expSec, ...codeSec];
const bytes = new Uint8Array(mod);
console.log('module bytes:', bytes.length);

// ── V8 验证 + 冒烟（Poiseuille）──
{
  const wabt = (await import('wabt')).default;
  const w = await wabt();
  const mod2 = w.readWasm(new Uint8Array(bytes), { readDebugNames: false });
  const txt = mod2.toText({ foldExprs: false, inlineExport: false });
  writeFileSync('ns_disasm2.txt', txt);
  const lines = txt.split('\n');
  const f2 = lines.findIndex((l) => l.includes('func (;2;)'));
  for (let i = f2; i < lines.length; i++) {
    if (lines[i].includes('f64.add')) {
      console.log('--- f64.add @disasm', i, '---');
      console.log(lines.slice(i - 6, i + 2).join('\n'));
    }
  }
}
try {
  const inst0 = await WebAssembly.instantiate(bytes);
  console.log('UCMODE', process.env.UCMODE ?? 7, 'V8 OK');
} catch (e) {
  console.log('UCMODE', process.env.UCMODE ?? 7, 'FAIL:', String(e.message).slice(28, 100));
  if (process.env.UCMODE) process.exit(0);
}
const inst = process.env.UCMODE ? null : await WebAssembly.instantiate(bytes);
const mem = inst.instance ? inst.instance.exports.mem : inst.exports.mem;
const sweepFn = inst.instance ? inst.instance.exports.sweep : inst.exports.sweep;
const nx = 24, ny = 12, nz = 12, N = nx * ny * nz;
const unew = new Float64Array(N * 3), p = new Float64Array(N);
const mask = new Uint8Array(N);
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  mask[i + j * nx + k * nx * ny] = (j === 0 || j === ny - 1) ? 0 : 1;
}
const need = (N * 3 * 2 + N) * 8 + N;
mem.grow(Math.ceil(need / 65536) + 1);
const heap = new Float64Array(mem.buffer), mv = new Uint8Array(mem.buffer);
mv.set(mask, 0);
for (let it = 0; it < 8000; it++) {
  heap.set(unew, 0);
  sweepFn(0, N * 24, N * 48, N * 56, nx, ny, nz, 1, 0.1, 1, 0.01, 0.6);
  unew.set(new Float64Array(mem.buffer, N * 24, N * 3));
  p.set(new Float64Array(mem.buffer, N * 48, N));
}
const H = ny - 1;
let maxErr = 0;
for (let j = 1; j < ny - 1; j++) {
  const idx = 0 + j * nx + Math.floor(nz / 2) * nx * ny;
  const uExact = (0.01 * j * (H - j)) / 2;
  maxErr = Math.max(maxErr, Math.abs(unew[idx * 3] - uExact) / uExact);
}
console.log('Poiseuille max profile err:', (maxErr * 100).toFixed(3) + '%');
if (maxErr > 0.02) { console.error('TOO LARGE'); process.exit(1); }

// ── 注入 base64 到 TS ──
const b64 = Buffer.from(bytes).toString('base64');
const solverPath = '../tpms-platform/src/physics/navier-stokes-solver.ts';
let ts = '';
try { ts = readFileSync(solverPath, 'utf8'); } catch { ts = null; }
const B64 = b64.length.toString() + ' bytes';
console.log('base64 length:', b64.length);
writeFileSync('ns_wasm_b64.txt', b64);
console.log('written ns_wasm_b64.txt');
