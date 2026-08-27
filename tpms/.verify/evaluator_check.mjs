// 求值器安全回归（正式套件，纯 Node；TS 源码经 rolldown 打包后导入）
// 覆盖：9 项功能语义 + 24 项攻击载荷拦截 + 编译缓存 + 空/非法输入
// 运行：node evaluator_check.mjs（在 tpms/.verify/ 下）
// 【阶段 I 改造】tpms-functions 现依赖 equation-parser（extensionless 相对导入），
// Node TS 直跑不支持；改用与 mesh_audit 同款 rolldown 临时 bundle 模式。
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const PLATFORM = join(dirname(fileURLToPath(import.meta.url)), '../tpms-platform');
const BUNDLE = tmpdir() + '/tpms_evaluator_check_bundle.mjs';
{
  const entry = tmpdir() + `/tpms_evaluator_check_entry_${process.pid}.ts`;
  writeFileSync(entry, `export { compileCustomFormula, getTpmsFunction, getDefaultWeights } from ${JSON.stringify(PLATFORM + '/src/core/tpms-functions.ts')};`);
  const rolldown = PLATFORM + '/node_modules/.bin/rolldown.cmd';
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
}
const { compileCustomFormula, getTpmsFunction, getDefaultWeights } = await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info = '') => { fail++; console.log('FAIL', name, info); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const W = [1, 1, 1, 1];

// ── 功能语义（9 项）──
const f1 = compileCustomFormula('sin(x) + cos(y)').fn;
near(f1(0, 0, 0, W), 1) ? ok('F1 sin(0)+cos(0)=1') : bad('F1', String(f1(0, 0, 0, W)));

const f2 = compileCustomFormula('x^2 + 3').fn;
near(f2(2, 0, 0, W), 7) ? ok('F2 幂运算 2^2+3=7') : bad('F2', String(f2(2, 0, 0, W)));

const f3 = compileCustomFormula('pi * 2').fn;
near(f3(0, 0, 0, W), Math.PI * 2) ? ok('F3 常量 pi') : bad('F3', String(f3(0, 0, 0, W)));

const f4 = compileCustomFormula('e').fn;
near(f4(0, 0, 0, W), Math.E) ? ok('F4 常量 e') : bad('F4', String(f4(0, 0, 0, W)));

const f5 = compileCustomFormula('pow(x, 3)').fn;
near(f5(2, 0, 0, W), 8) ? ok('F5 pow(2,3)=8') : bad('F5', String(f5(2, 0, 0, W)));

const f6 = compileCustomFormula('-x + 5').fn;
near(f6(3, 0, 0, W), 2) ? ok('F6 一元负号') : bad('F6', String(f6(3, 0, 0, W)));

// 编译缓存：同表达式两次编译返回同一对象
const c1 = compileCustomFormula('sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)');
const c2 = compileCustomFormula('sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)');
c1 === c2 ? ok('F7 编译缓存命中（同一对象）') : bad('F7 缓存', '两次编译返回不同对象');

// Schwarz P 复现：cos x + cos y + cos z 与内置函数一致
const f8 = compileCustomFormula('cos(x) + cos(y) + cos(z)').fn;
const builtin8 = getTpmsFunction('schwarz');
let f8ok = true;
for (const [x, y, z] of [[0.3, 0.7, 1.1], [-1.2, 0.4, 2.0], [2.5, 2.5, 2.5]]) {
  if (!near(f8(x, y, z, W), builtin8(x, y, z, W), 1e-12)) f8ok = false;
}
f8ok ? ok('F8 Schwarz P 自定义公式与内置一致') : bad('F8 Schwarz P');

// Gyroid 复现（含权重应用）
const f9 = compileCustomFormula('sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)').fn;
const builtin9 = getTpmsFunction('gyroid');
const w9 = getDefaultWeights('gyroid');
near(f9(0.9, 1.4, 2.2, W), builtin9(0.9, 1.4, 2.2, w9), 1e-12)
  ? ok('F9 Gyroid 自定义公式与内置一致') : bad('F9 Gyroid');

// ── 攻击载荷拦截（24 项：必须 throw，不得求值出值或产生副作用）──
const PAYLOADS = [
  'constructor',                       // 原型链属性
  '__proto__.polluted = 1',            // 原型污染
  '__proto__[x]',                      // 原型链访问
  'toString',                          // Object.prototype.toString
  'valueOf',                           // Object.prototype.valueOf
  'hasOwnProperty',
  'constructor.constructor("return 1")',
  'this',
  'window',
  'globalThis',
  'self',
  'document.cookie',
  'process',
  'module.exports',
  'require("fs")',
  'import("fs")',
  'fetch("http://evil")',
  'Function("return 1")',
  'eval("1+1")',
  'new Function("return 1")()',
  'alert(1)',
  '(() => 1)()',
  'JavaScript:void(0)',
  'delete window',
];
PAYLOADS.forEach((p, i) => {
  try {
    const { fn } = compileCustomFormula(p);
    const v = fn(0, 0, 0, W);
    // 编译意外成功且求值返回了数值 → 拦截失败
    bad(`P${i + 1} 拦截 "${p.slice(0, 28)}"`, `求值返回 ${v}`);
  } catch {
    ok(`P${i + 1} 拦截 "${p.slice(0, 28)}"`);
  }
});
// 原型未被污染的双保险
({}).polluted === undefined
  ? ok('P25 全局原型无污染残留') : bad('P25 原型被污染');

// 空/非法输入
let threw = false;
try { compileCustomFormula('   '); } catch { threw = true; }
threw ? ok('E1 空表达式拒绝') : bad('E1 空表达式被接受');
threw = false;
try { compileCustomFormula('sin('); } catch { threw = true; }
threw ? ok('E2 未闭合括号拒绝') : bad('E2 语法错误被接受');
threw = false;
try { getTpmsFunction('custom', ''); } catch { threw = true; }
threw ? ok('E3 custom 无公式拒绝') : bad('E3 custom 空公式被接受');

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail > 0 ? 1 : 0);
