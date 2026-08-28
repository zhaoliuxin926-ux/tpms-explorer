/**
 * webgpu_parity_audit.mjs —— 门禁 13：WebGPU 计算管线数学同源审计（纯 Node，无浏览器）
 *
 * 守护对象：GPU 加速层与 CPU 权威路径的数学一致性。
 * 方法：webgpu-evaluator.ts 把场公式编译为单一标量指令 IR，双后端渲染
 * （WGSL 文本 / JS f64 寄存器机）。本审计在 Headless/Node 环境用
 * 「模拟 GPU 计算内核」（JS 寄存器机）对拍 CPU 权威公式：
 *   A. opcode 双后端完备性（任一指令缺失实现即算术非法）
 *   B. WGSL 静态健全性（@compute/storage 布局/花括号配平/f32 字面量卫生）
 *   C. wgsl 模板文件与 TS 内联模板同步（防双源漂移）
 *   D. 8 类内置 TPMS：模拟内核 vs CPU 手写公式，10,000 随机格点 ≤1e-6
 *   E. AST 自定义方程 ×4：模拟内核（desugar+烘焙参数）vs CPU evaluate ≤1e-6
 *   F. Hybrid 混合 ×2（轴向/径向波前 × sigmoid/linear）：vs createHybridField ≤1e-6
 *   G. 端到端：gpuVField 注入 buildSurface → 水密 open=0 + 体积 vs CPU 构建 ≤0.5%
 *   H. Node 无 GPU 环境：evaluateFieldGPU/probeGpuAvailability 优雅返回 null/false
 *
 * 精度口径注记：真实 GPU 为 f32，场值残差 ~1e-7·|F|（对等值面符号判定无影响）；
 * 本审计走 f64 模拟内核，验证的是公式转录正确性。128³ ≤30ms 为 GPU 运行时
 * 目标，headless 环境无物理 GPU，不作 wall-time 断言（UI 状态条实测展示）。
 *
 * 运行：node webgpu_parity_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// ── rolldown 打当前 TS 源码（测源码而非产物）──
const BUNDLE = join(tmpdir(), 'tpms_webgpu_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_webgpu_audit_entry.ts');
  const mods = [
    'src/geometry/webgpu-evaluator.ts:compileFieldKernel, backendCompleteness, evaluateFieldGPU, probeGpuAvailability, hybridWeightReference, type GpuFieldConfig',
    'src/core/tpms-functions.ts:getTpmsFunction, evaluateField',
    'src/core/hybrid-functions.ts:createHybridField',
    'src/core/equation-parser.ts:compileEquation',
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
  ];
  const lines = mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  });
  lines.push(`import { readFileSync } from 'node:fs';`,
    `export const WGSL_FILE = readFileSync(${JSON.stringify(join(PLATFORM, 'src/geometry/shaders/tpms-eval.wgsl'))}, 'utf8');`);
  writeFileSync(entry, lines.join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const {
  compileFieldKernel, backendCompleteness, evaluateFieldGPU, probeGpuAvailability,
  hybridWeightReference, getTpmsFunction, createHybridField, compileEquation,
  buildSurface, globalBufferPool, WGSL_FILE,
} = await import(pathToFileURL(BUNDLE));

// ── 审计框架 ──
let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function relErr(a, b) {
  const denom = Math.max(1e-9, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / denom;
}
/** mulberry32 确定性 RNG（可复现，无跨运行漂移） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const HALF = Math.PI;
const N_POINTS = 10000;

// ── A. opcode 双后端完备性 ──
console.log('\n[A] opcode 后端完备性');
{
  const { missing } = backendCompleteness();
  check('JS/WGSL 双后端 opcode 实现完备', missing.length === 0, missing.join(','));
}

// ── B/C. WGSL 静态健全性 + 模板同步 ──
console.log('\n[B] WGSL 静态健全性 + 模板文件同步');
for (const type of TYPES) {
  const k = compileFieldKernel(mkCfg(type));
  const body = k.wgsl;
  const bal = (body.match(/{/g) || []).length === (body.match(/}/g) || []).length;
  check(`${type}: @compute/storage/配平/无 JS 残留`, body.includes('@compute') && body.includes('@workgroup_size(4, 4, 4)')
    && body.includes('var<storage, read_write>') && bal && !body.includes('Math.')
    && !/let t\d+ = -?\d+;/.test(body));
}
{
  const k = compileFieldKernel(mkCfg('gyroid'));
  const ph = WGSL_FILE.indexOf('{{FIELD_FN}}');
  check('wgsl 模板含唯一占位符', ph >= 0 && WGSL_FILE.indexOf('{{FIELD_FN}}', ph + 1) === -1);
  const head = WGSL_FILE.slice(0, ph), tail = WGSL_FILE.slice(ph + '{{FIELD_FN}}'.length);
  check('wgsl 模板与 TS 内联模板逐字同步（头/尾锚定）',
    k.wgsl.startsWith(head) && k.wgsl.endsWith(tail) && k.wgsl.length > head.length + tail.length);
}

function mkCfg(type) {
  return {
    type, weights: [1, 1, 1, 1], periods: 2, thickness: 1.0, iso: 0, customFormula: '',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
  };
}

// ── 随机格点生成（物理+弧度域）──
function samplePoints(n, k) {
  const rng = mulberry32(20260828);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const px = rng() * 2 - 1, py = rng() * 2 - 1, pz = rng() * 2 - 1;
    pts.push([px * HALF * k, py * HALF * k, pz * HALF * k, px, py, pz]);
  }
  return pts;
}

// ── D. 8 类内置 TPMS 对拍 ──
console.log('\n[D] 内置 TPMS：模拟 GPU 内核 vs CPU 权威公式（10,000 格点 ≤1e-6）');
for (const type of TYPES) {
  const cfg = mkCfg(type);
  const kern = compileFieldKernel(cfg);
  const cpu = getTpmsFunction(type);
  const w = [1, 1, 1, 1];
  const pts = samplePoints(N_POINTS, cfg.periods);
  let maxE = 0;
  for (const [mx, my, mz, px, py, pz] of pts) {
    maxE = Math.max(maxE, relErr(kern.jsEval(mx, my, mz, px, py, pz), cpu(mx, my, mz, w)));
  }
  check(`${type}: max 相对误差 ${maxE.toExponential(2)} ≤1e-6`, maxE <= 1e-6);
}

// ── E. AST 自定义方程对拍 ──
console.log('\n[E] 自定义方程：desugar+参数烘焙 vs CPU evaluate（10,000 格点 ≤1e-6）');
{
  const cases = [
    { expr: 'sin(x)*cos(y) + sin(y)*cos(z)', k: 2, t: 1.0, iso: 0 },
    { expr: 'cos(k*x) + cos(k*y) - 0.4*(cos(2*k*x) + cos(2*k*y) + cos(2*k*z))', k: 3, t: 1.2, iso: 0.1 },
    { expr: 'sqrt(x*x + y*y + z*z) - iso', k: 1, t: 0.8, iso: 2.0 },
    { expr: 'sin(x)*sin(y)*sin(z) + cos(x)*cos(y)*cos(z) + t*0.1*sin(3*z)', k: 2, t: 1.5, iso: -0.2 },
  ];
  for (const { expr, k, t, iso } of cases) {
    const compiled = compileEquation(expr);   // 非法语法会抛错 → 计入 FAIL
    const cfg = { ...mkCfg('custom'), type: 'custom', customFormula: expr, periods: k, thickness: t, iso };
    const kern = compileFieldKernel(cfg);
    const pts = samplePoints(N_POINTS, k);
    let maxE = 0;
    for (const [mx, my, mz] of pts) {
      maxE = Math.max(maxE, relErr(kern.jsEval(mx, my, mz, 0, 0, 0), compiled.evaluate(mx, my, mz, { k, t, iso })));
    }
    check(`"${expr.slice(0, 28)}…" (k=${k},t=${t},iso=${iso}): ${maxE.toExponential(2)} ≤1e-6`, maxE <= 1e-6);
  }
}

// ── F. Hybrid 混合对拍 ──
console.log('\n[F] Hybrid 混合场：波前×混合函数 vs createHybridField（10,000 格点 ≤1e-6）');
{
  const cases = [
    { typeA: 'gyroid', typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1.0, axis: 'x' },
    { typeA: 'schwarz', typeB: 'iwp', blendFunction: 'linear', blendCenter: 0.2, blendWidth: 1.4, axis: 'radial' },
  ];
  for (const hc of cases) {
    const cfg = { ...mkCfg(hc.typeA), hybrid: { enabled: true, ...hc } };
    const kern = compileFieldKernel(cfg);
    const w = [1, 1, 1, 1];
    const dyn = { k: cfg.periods, t: cfg.thickness, iso: cfg.iso };
    const cpuHy = createHybridField(hc.typeA, hc.typeB, { enabled: true, ...hc }, '', '', dyn);
    const pts = samplePoints(N_POINTS, cfg.periods);
    let maxE = 0;
    for (const [mx, my, mz, px, py, pz] of pts) {
      maxE = Math.max(maxE, relErr(kern.jsEval(mx, my, mz, px, py, pz), cpuHy(mx, my, mz, px, py, pz, w)));
    }
    // 权重参照单独对拍（导出的 hybridWeightReference 与 IR 权重路径同源声明）
    check(`hybrid ${hc.typeA}→${hc.typeB} ${hc.blendFunction}-${hc.axis}: ${maxE.toExponential(2)} ≤1e-6`, maxE <= 1e-6);
  }
  const wref = hybridWeightReference({ ...mkCfg('gyroid'), hybrid: { enabled: true, typeA: 'gyroid', typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1.0, axis: 'radial' } });
  check('hybridWeightReference 径向波前可调用', Math.abs(wref(1, 0, 0) - 1 / (1 + Math.exp(-6 * 1))) < 1e-9);
}

// ── G. 端到端：gpuVField 注入 buildSurface ──
console.log('\n[G] 端到端：gpuVField 注入 → 水密 + 体积一致性');
{
  const fillField = (cfg, R) => {
    const kern = compileFieldKernel(cfg);
    const N = R + 1;
    const v = new Float32Array(N * N * N);
    for (let iz = 0; iz < N; iz++) {
      for (let iy = 0; iy < N; iy++) {
        for (let ix = 0; ix < N; ix++) {
          const mx = (-HALF + (ix / R) * 2 * HALF) * cfg.periods;
          const my = (-HALF + (iy / R) * 2 * HALF) * cfg.periods;
          const mz = (-HALF + (iz / R) * 2 * HALF) * cfg.periods;
          v[ix + iy * N + iz * N * N] = kern.jsEval(mx, my, mz, (ix / R) * 2 - 1, (iy / R) * 2 - 1, (iz / R) * 2 - 1);
        }
      }
    }
    return v;
  };
  const openEdges = (res) => {
    const { positions, indices, vertCount, triCount } = res;
    const cnt = new Map();
    const KM = vertCount + 1;
    for (let t = 0; t < triCount * 3; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      for (const [u, v2] of [[a, b], [b, c], [c, a]]) {
        const key = u < v2 ? u * KM + v2 : v2 * KM + u;
        cnt.set(key, (cnt.get(key) ?? 0) + 1);
      }
    }
    void positions;
    let open = 0;
    for (const [, n] of cnt) if (n === 1) open++;
    return open;
  };
  const baseParams = (over) => ({
    type: 'gyroid', iso: 0, periods: 2, resolution: 40, targetPorosity: 0.25,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false, ...over,
  });
  const cases = [
    { label: 'gyroid solid', cfg: mkCfg('gyroid'), over: {} },
    { label: 'diamond shell', cfg: mkCfg('diamond'), over: { type: 'diamond', structureMode: 'shell' } },
  ];
  for (const c of cases) {
    const R = 40;
    const params = baseParams({ ...c.over, resolution: R });
    const cpuRes = buildSurface(params, new (globalBufferPool.constructor)());
    const gpuRes = buildSurface({ ...params, gpuVField: fillField(c.cfg, R) }, new (globalBufferPool.constructor)());
    const openCpu = openEdges(cpuRes), openGpu = openEdges(gpuRes);
    const volDev = Math.abs(gpuRes.meshSolidFraction - cpuRes.meshSolidFraction) / Math.max(1e-9, cpuRes.meshSolidFraction);
    check(`${c.label}: GPU 注入路径水密 open=${openGpu}`, openGpu === 0);
    check(`${c.label}: 固相分数偏差 ${(volDev * 100).toFixed(3)}% ≤0.5%`, volDev <= 0.005);
    check(`${c.label}: 长度校验守卫（错误长度显式抛错）`, (() => {
      try { buildSurface({ ...params, gpuVField: new Float32Array(7) }, new (globalBufferPool.constructor)()); return false; }
      catch { return true; }
    })());
  }
}

// ── H. Node 无 GPU 环境：优雅降级契约 ──
console.log('\n[H] 无 GPU 环境优雅降级');
{
  const res = await evaluateFieldGPU(mkCfg('gyroid'), 48);
  check('evaluateFieldGPU 无 navigator.gpu 返回 null（不抛错）', res === null);
  const ok = await probeGpuAvailability();
  check('probeGpuAvailability 无 navigator.gpu 返回 false', ok === false);
}

// ── 汇总 ──
console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
