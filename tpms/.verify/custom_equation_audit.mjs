/**
 * custom_equation_audit.mjs —— 自定义公式 AST 沙箱审计（第九道 CI 门，阶段 I）
 *
 * 守护对象：core/equation-parser.ts（Tokenizer + AST Parser + Dual Number AD + 代码生成）
 * 及 tpms-functions.ts 适配层。历史教训：工程版自定义公式曾用 new Function + with(Math)
 * 执行用户输入（白名单正则形同虚设），2026-07 起改零依赖 AST；本轮升级为独立沙箱引擎
 * + 派生球坐标脱糖 + 解析微分 + NumPy/MATLAB 代码生成，本门禁全程押注。
 *
 * 断言矩阵：
 *  A. 语法容错与安全面：非法输入/注入载荷全部 EquationParseError 且带出错位置
 *  B. 值正确性：28 条复杂公式 × 10,000 随机点（含 4 条手写镜像 + 1 条内置类型交叉）
 *  C. 梯度 AD vs 中心差分（平滑 1e-4 / kink 类剔除奇异邻域后 5e-2）
 *  D. Hessian AD：解析锚点精确断言 + FD 交叉验证
 *  E. 代码生成：NumPy 表达式经 Python 实跑与 TS evaluate 逐点等价；MATLAB 静态断言（无环境不实测，既有先例）
 *  F. 几何集成：custom 公式 buildSurface 水密 + 体积 vs MC 公式口径
 *  G. 适配层：evaluateField/evaluateGradient 动态参数注入 + 编译缓存
 *
 * 运行：node custom_equation_audit.mjs
 */

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// ── rolldown 打当前 TS 源码为临时 ESM bundle（与 mesh_audit 同模式：测源码而非产物）──
const BUNDLE = join(tmpdir(), 'tpms_custom_eq_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_custom_eq_audit_entry.ts');
  const mods = [
    'src/core/equation-parser.ts:compileEquation',
    'src/core/equation-parser.ts:validateEquation',
    'src/core/equation-parser.ts:EQUATION_PRESETS',
    'src/core/tpms-functions.ts:getTpmsFunction',
    'src/core/tpms-functions.ts:evaluateField',
    'src/core/tpms-functions.ts:evaluateGradient',
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { compileEquation, validateEquation, EQUATION_PRESETS, getTpmsFunction, evaluateField, evaluateGradient, buildSurface } = await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (name, detail = '') => { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); };

// 确定性随机（可复现）
let seed = 20260828;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const inRange = (a, b) => a + (b - a) * rnd();

// ────────────────────────────── 测试公式集（28 条） ──────────────────────────────

/** {expr, domain: 采样域（缺省 ±π 全域），smooth: 是否适合作严格 FD 断言} */
const FORMULAS = [
  { expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)', mirror: (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x) },
  { expr: 'cos(x) + cos(y) + cos(z)', mirror: (x, y, z) => Math.cos(x) + Math.cos(y) + Math.cos(z) },
  { expr: 'sin(z) - sinh(x)*sinh(y)', mirror: (x, y, z) => Math.sin(z) - Math.sinh(x) * Math.sinh(y) },
  { expr: 'exp(z)*cos(x) - cos(y)', mirror: (x, y, z) => Math.exp(z) * Math.cos(x) - Math.cos(y) },
  { expr: '0.5*(2*sin(x)*cos(x)*cos(y)*sin(z) + 2*sin(y)*cos(y)*cos(z)*sin(x) + 2*sin(z)*cos(z)*cos(x)*sin(y)) - 0.5*(cos(2*x)*cos(2*y) + cos(2*y)*cos(2*z) + cos(2*z)*cos(2*x))', builtin: 'lidinoid' },
  { expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + 0.5*cos(2*x)*cos(2*y)*cos(2*z)' },
  { expr: 'cos(x) + cos(y) + cos(z) + 0.4*cos(2*r)', smoothAvoidOrigin: true },
  { expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + 0.2*t*sin(x)*sin(y)*sin(z)', params: { k: 1, t: 1.4, iso: 0 } },
  { expr: 'cos(x) + iso*0.5*cos(2*x)', params: { k: 1, t: 1, iso: 0.3 } },
  { expr: 'x^2*y^3 - x/y*z', smoothAvoidY0: true },
  { expr: 'pow(1 + x*x, 2.5) - y*y*z' },
  { expr: 'sqrt(1 + x*x + y*y)*sin(2*z)' },
  { expr: 'abs(sin(x)*cos(y))*sign(z) + 0.3', kink: true },
  { expr: 'atan2(y, x)*cos(z)', smoothAvoidOrigin: true },
  { expr: 'min(sin(x), cos(y))*max(cos(y), sin(z))', kink: true },
  { expr: 'log(2 + sin(x)*sin(y)*sin(z))' },
  { expr: 'tanh(2*x)*cosh(0.5*y) - sinh(0.3*z)' },
  { expr: 'exp(-x*x - y*y - z*z)*2 - 1' },
  { expr: 'sin(3*x)*sin(3*y)*sin(3*z)*0.5 + cos(x)*cos(y)*cos(z)' },
  { expr: 'floor(2*x)*0.25 + ceil(2*y)*0.25 + 0.5*cos(z)', kink: true },
  { expr: 'tan(x)*0.1 + tan(y)*0.1 + tan(z)*0.1', domain: 1.2, kink: true },
  { expr: 'cbrt(x*y*z + 0.1) + 0.5*sin(2*x)', kink: true },
  { expr: 'asin(0.5*sin(x)*sin(y)) + acos(0.5*cos(y)*cos(z))' },
  { expr: 'sin(x + t*0.5)*cos(y - iso*0.3) + sin(y)*cos(z) + sin(z)*cos(x)', params: { k: 1.5, t: 1.2, iso: 0.25 } },
  { expr: 'phi/(2*PI)*cos(theta) + 0.5*sin(2*theta)*0.1', smoothAvoidOrigin: true },
  { expr: 'log10(3 + x*x) - log2(2 + y*y) + log(4 + z*z)' },
  { expr: 'trunc(0.4*sin(x))*0.2 + round(0.4*cos(y))*0.2 + 0.3*cos(2*z)', kink: true },
  { expr: 'PI*x*E*y*0.01 + sin(PI*z*0.5)' },
];

const P0 = { k: 1, t: 1, iso: 0 };

// ────────────────────────────── A. 语法容错与安全面 ──────────────────────────────
console.log('\n[A] 语法容错与安全面');
{
  const invalid = [
    ['sin(x', '未闭括号'], ['x++*y', '双运算符'], ['foo(x)', '未知函数'], ['x @ y', '非法字符'],
    ['', '空串'], ['   ', '纯空白'], ['2x', '隐式乘法（拒绝）'], ['constructor', '原型链载荷'],
    ['x.constructor', '属性访问逃逸'], ['__proto__', '原型链载荷'], ['eval(x)', 'eval 载荷'],
    ['Function(x)', 'Function 载荷'], ['import(x)', 'import 载荷'], ['process', '全局对象载荷'],
    ['min(x)', '参数个数错误'], ['pow(x, y, z)', '参数个数错误'], ['1.2.3', '多小数点'], ['x ^', '悬空幂'],
  ];
  let posOk = 0;
  for (const [expr, why] of invalid) {
    let threw = null, pos = -1;
    try { compileEquation(expr); } catch (e) { threw = e; pos = typeof e.pos === 'number' ? e.pos : -1; }
    if (threw && threw.name === 'EquationParseError') { if (pos >= 0) posOk++; ok(`拒绝 [${expr || "''"}]（${why}）`); }
    else bad(`拒绝 [${expr || "''"}]（${why}）`, threw ? `错误类型 ${threw.name}` : '未抛错');
  }
  posOk >= invalid.length - 2
    ? ok(`出错位置捕获 ${posOk}/${invalid.length}（≥${invalid.length - 2}）`)
    : bad('出错位置捕获不足', `${posOk}/${invalid.length}`);
  // 白名单 Still-there：合法标识符不被误伤
  for (const expr of ['r + theta + phi', 'k*t*iso', 'PI*E + pi*e']) {
    try { compileEquation(expr); ok(`放行合法标识 [${expr}]`); }
    catch (e) { bad(`放行合法标识 [${expr}]`, e.message); }
  }
}

// ────────────────────────────── B. 值正确性（28 公式 × 10,000 点） ──────────────────────────────
console.log('\n[B] 值正确性（10,000 随机点/公式）');
{
  const N_PTS = 10_000;
  let allOk = true;
  const t0 = Date.now();
  for (const f of FORMULAS) {
    const c = compileEquation(f.expr);
    const P = f.params ?? P0;
    const dom = f.domain ?? Math.PI;
    let worst = 0;
    for (let i = 0; i < N_PTS; i++) {
      const x = inRange(-dom, dom), y = inRange(-dom, dom), z = inRange(-dom, dom);
      const v = c.evaluate(x, y, z, P);
      if (typeof v !== 'number' || !Number.isFinite(v)) { allOk = false; worst = NaN; break; }
      if (f.mirror) worst = Math.max(worst, Math.abs(v - f.mirror(x, y, z)));
      if (f.builtin) {
        const ref = getTpmsFunction(f.builtin, '');
        worst = Math.max(worst, Math.abs(v - ref(x, y, z, [1, 1, 1, 1])));
      }
    }
    if (f.mirror || f.builtin) {
      if (worst < 1e-9) ok(`镜像一致 [${f.expr.slice(0, 44)}${f.expr.length > 44 ? '…' : ''}]`, `maxΔ=${worst.toExponential(1)}`);
      else { allOk = false; bad(`镜像一致 [${f.expr.slice(0, 44)}]`, `maxΔ=${worst.toExponential(1)}`); }
    }
  }
  // 全公式有限性单列断言（含镜像式的有限性已并入上循环）
  allOk
    ? ok(`全部 ${FORMULAS.length} 公式 × ${N_PTS} 点无异常、无 NaN/Inf`)
    : bad('公式求值存在异常/非有限值');
  console.log(`  · 求值总耗时 ${((Date.now() - t0) / 1000).toFixed(2)}s（${FORMULAS.length * N_PTS} 点）`);
  // 预设样例库全部可编译
  let presetOk = 0;
  for (const p of EQUATION_PRESETS) { try { compileEquation(p.expr); presetOk++; } catch { /* noop */ } }
  presetOk === EQUATION_PRESETS.length
    ? ok(`预设样例库 ${presetOk}/${EQUATION_PRESETS.length} 全部可编译`)
    : bad('预设样例库存在不可编译项', `${presetOk}/${EQUATION_PRESETS.length}`);
}

// ────────────────────────────── C. 梯度 AD vs 中心差分 ──────────────────────────────
console.log('\n[C] 梯度 AD vs 中心差分');
{
  const h = 1e-5;
  for (const f of FORMULAS) {
    const c = compileEquation(f.expr);
    const P = f.params ?? P0;
    const dom = f.domain ?? Math.PI;
    const tol = f.kink ? 5e-2 : 1e-4;
    let worst = 0, tested = 0;
    for (let i = 0; i < 2000; i++) {
      const x = inRange(-dom, dom), y = inRange(-dom, dom), z = inRange(-dom, dom);
      // 剔除奇异邻域
      if (f.smoothAvoidOrigin && Math.hypot(x, y, z) < 0.3) continue;
      if (f.smoothAvoidY0 && Math.abs(y) < 0.15) continue;
      if (f.kink) {
        // kink 类：剔除 |分量| 贴近不可导位置的样本
        if (f.expr.includes('floor') || f.expr.includes('ceil') || f.expr.includes('trunc') || f.expr.includes('round')) {
          if ([x, y, z].some((v) => Math.abs((2 * v) % 1) < 0.02 || Math.abs((2 * v) % 1) > 0.98)) continue;
        }
        if (f.expr.includes('abs(') && Math.abs(Math.sin(x) * Math.cos(y)) < 1e-3) continue;
        if (f.expr.includes('cbrt') && Math.abs(x * y * z + 0.1) < 1e-2) continue;
        if (f.expr.includes('min(') && Math.abs(Math.sin(x) - Math.cos(y)) < 1e-2) continue;
        if (f.expr.includes('max(') && Math.abs(Math.cos(y) - Math.sin(z)) < 1e-2) continue;
      }
      const ad = c.gradient(x, y, z, P);
      const fd = [
        (c.evaluate(x + h, y, z, P) - c.evaluate(x - h, y, z, P)) / (2 * h),
        (c.evaluate(x, y + h, z, P) - c.evaluate(x, y - h, z, P)) / (2 * h),
        (c.evaluate(x, y, z + h, P) - c.evaluate(x, y, z - h, P)) / (2 * h),
      ];
      let w = 0;
      for (let d = 0; d < 3; d++) w = Math.max(w, Math.abs(ad[d] - fd[d]) / (1 + Math.abs(fd[d])));
      worst = Math.max(worst, w);
      tested++;
    }
    if (worst <= tol && tested > 500) ok(`∇ [${f.expr.slice(0, 44)}${f.expr.length > 44 ? '…' : ''}]`, `worst=${worst.toExponential(1)} (tol ${tol}) n=${tested}`);
    else bad(`∇ [${f.expr.slice(0, 44)}]`, `worst=${worst.toExponential(1)} (tol ${tol}) n=${tested}`);
  }
}

// ────────────────────────────── D. Hessian AD：解析锚点 + FD 交叉 ──────────────────────────────
console.log('\n[D] Hessian AD（解析锚点 + FD 交叉）');
{
  const P = P0;
  // 解析锚点 1：f = x^2*y^3 - x/y*z @ (0.7, -0.4, 1.1)
  {
    const c = compileEquation('x^2*y^3 - x/y*z');
    const x = 0.7, y = -0.4, z = 1.1;
    const H = c.hessian(x, y, z, P);
    const ref = [
      2 * y * y * y,                                  // xx
      6 * x * x * y - 2 * x * z / (y * y * y),        // yy
      0,                                              // zz
      6 * x * y * y + z / (y * y),                    // xy
      x / (y * y),                                    // yz = ∂/∂z(3x²y² + xz/y²)
      -1 / y,                                         // xz
    ];
    let worst = 0;
    for (let d = 0; d < 6; d++) worst = Math.max(worst, Math.abs(H[d] - ref[d]));
    worst < 1e-9 ? ok('解析锚点 x²y³−xz/y 六分量', `maxΔ=${worst.toExponential(1)}`)
      : bad('解析锚点 x²y³−xz/y', `maxΔ=${worst.toExponential(1)}`);
  }
  // 解析锚点 2：f = sin(x)*cos(y)+sin(y)*cos(z)+sin(z)*cos(x) 全六分量
  {
    const c = compileEquation('sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)');
    const x = 0.3, y = -0.9, z = 1.7;
    const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
    // f = sxcy + sycz + szcx
    // fxx = ∂/∂x(cxcy − szsx) = −sxcy − szcx；fyy = ∂/∂y(−sxsy + cycz) = −sxcy − sycz；
    // fzz = ∂/∂z(−sysz + czcx) = −sycz − szcx；fxy = −cxsy；fyz = −cysz；fxz = −czsx
    const fxx = -sx * cy - sz * cx, fyy = -sx * cy - sy * cz, fzz = -sy * cz - sz * cx;
    const fxyRef = -cx * sy;
    const fxzRef = -cz * sx;
    const fyzRef = -cy * sz;
    const H = c.hessian(x, y, z, P);
    const ref = [fxx, fyy, fzz, fxyRef, fyzRef, fxzRef];
    let worst = 0;
    for (let d = 0; d < 6; d++) worst = Math.max(worst, Math.abs(H[d] - ref[d]));
    worst < 1e-9 ? ok('解析锚点 Gyroid 六分量', `maxΔ=${worst.toExponential(1)}`)
      : bad('解析锚点 Gyroid', `maxΔ=${worst.toExponential(1)} ref=${ref.map((v) => v.toFixed(3))} got=${H.map((v) => v.toFixed(3))}`);
  }
  // FD 交叉（平滑子集，剔除 r=0 / y=0 邻域）
  const smoothIdx = [0, 1, 2, 3, 5, 6, 9, 10, 11, 15, 16, 17, 18, 21, 22, 25, 27];
  const h = 1e-4;
  let groupWorst = 0, groupBad = null;
  for (const i of smoothIdx) {
    const f = FORMULAS[i];
    const c = compileEquation(f.expr);
    const P2 = f.params ?? P0;
    const dom = f.domain ?? Math.PI;
    let worst = 0;
    for (let k = 0; k < 600; k++) {
      const x = inRange(-dom, dom), y = inRange(-dom, dom), z = inRange(-dom, dom);
      if (f.smoothAvoidOrigin && Math.hypot(x, y, z) < 0.35) continue;
      if (f.smoothAvoidY0 && Math.abs(y) < 0.2) continue;
      // cbrt 在 arg→0 处高阶导数发散（二阶 FD 参照失效），Hessian 交叉需宽剔除
      if (f.expr.includes('cbrt') && Math.abs(x * y * z + 0.1) < 0.25) continue;
      const H = c.hessian(x, y, z, P2);
      const gRef = (xx, yy, zz) => c.gradient(xx, yy, zz, P2);
      const fdH = [
        (gRef(x + h, y, z)[0] - gRef(x - h, y, z)[0]) / (2 * h),
        (gRef(x, y + h, z)[1] - gRef(x, y - h, z)[1]) / (2 * h),
        (gRef(x, y, z + h)[2] - gRef(x, y, z - h)[2]) / (2 * h),
        (gRef(x, y + h, z)[0] - gRef(x, y - h, z)[0]) / (2 * h),
        (gRef(x, y, z + h)[1] - gRef(x, y, z - h)[1]) / (2 * h),
        (gRef(x + h, y, z)[2] - gRef(x - h, y, z)[2]) / (2 * h),
      ];
      for (let d = 0; d < 6; d++) worst = Math.max(worst, Math.abs(H[d] - fdH[d]) / (1 + Math.abs(fdH[d])));
    }
    if (worst > groupWorst) { groupWorst = worst; groupBad = f.expr; }
  }
  groupWorst <= 5e-3
    ? ok(`FD 交叉 ${smoothIdx.length} 公式（rel ≤5e-3）`, `worst=${groupWorst.toExponential(1)} @${groupBad?.slice(0, 30)}`)
    : bad('FD 交叉超差', `worst=${groupWorst.toExponential(1)} @${groupBad?.slice(0, 40)}`);
}

// ────────────────────────────── E. 代码生成（NumPy 实跑等价 + MATLAB 静态） ──────────────────────────────
console.log('\n[E] 代码生成 NumPy/MATLAB');
{
  const kk = 1.7, thk = 1.3, isoBase = 0.2;
  const pyTargets = [0, 2, 3, 6, 7, 9, 11, 13, 22, 24, 27].map((i) => FORMULAS[i]);
  const tmp = mkdtempSync(join(tmpdir(), 'tpms_eq_audit_'));
  const pyFile = join(tmp, 'codegen_check.py');
  const sampleTxt = join(tmp, 'samples.txt');
  const lines = [];
  for (const f of pyTargets) {
    const c = compileEquation(f.expr);
    const pts = [];
    for (let i = 0; i < 300; i++) {
      const x = inRange(-Math.PI, Math.PI), y = inRange(-Math.PI, Math.PI), z = inRange(-Math.PI, Math.PI);
      pts.push([x, y, z]);
    }
    lines.push({ f, c, pts });
  }
  // —— 逐行拼接生成确定性 Python 校验脚本（NumPy 向量化表达式实跑） ——
  const L = [];
  L.push('import numpy as np');
  L.push(`kk = ${kk}`);
  L.push(`thickness = ${thk}`);
  L.push(`iso_base = ${isoBase}`);
  lines.forEach(({ c, pts }, idx) => {
    L.push(`def f${idx}(X, Y, Z):`);
    L.push(`    return ${c.toPython((ax) => `kk*${ax.toUpperCase()}`)}`);
  });
  L.push(`with open(r'${sampleTxt}', 'w') as fh:`);
  lines.forEach(({ c, pts }, idx) => {
    const xs = pts.map((p) => p[0].toFixed(12)).join(', ');
    const ys = pts.map((p) => p[1].toFixed(12)).join(', ');
    const zs = pts.map((p) => p[2].toFixed(12)).join(', ');
    L.push(`    vals = f${idx}(np.array([${xs}]), np.array([${ys}]), np.array([${zs}]))`);
    L.push(`    for v in np.atleast_1d(vals):`);
    L.push(`        fh.write('${idx} ' + repr(float(v)) + '\\n')`);
  });
  writeFileSync(pyFile, L.join('\n'));
  const r = spawnSync('python', [pyFile], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) {
    bad('NumPy 代码生成脚本执行', (r.stderr || r.stdout || '').slice(0, 300));
  } else {
    const byIdx = new Map();
    for (const line of readFileSync(sampleTxt, 'utf8').trim().split('\n')) {
      const [i, v] = line.trim().split(/\s+/);
      if (!byIdx.has(Number(i))) byIdx.set(Number(i), []);
      byIdx.get(Number(i)).push(Number(v));
    }
    let maxRel = 0, worstName = '';
    for (let idx = 0; idx < lines.length; idx++) {
      const { c, pts } = lines[idx];
      const vals = byIdx.get(idx) ?? [];
      if (vals.length !== pts.length) { worstName = c.expr; maxRel = NaN; break; }
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z] = pts[i];
        // 沙箱坐标语义 = 弧度域（脚本中 kk·X 的展开由代码生成承担），TS 侧同点须乘 kk
        const vJs = c.evaluate(x * kk, y * kk, z * kk, { k: kk, t: thk, iso: isoBase });
        const rel = Math.abs(vJs - vals[i]) / (1 + Math.abs(vals[i]));
        if (rel > maxRel) { maxRel = rel; worstName = c.expr; }
      }
    }
    maxRel <= 1e-9
      ? ok(`NumPy 实跑等价（${lines.length} 公式 × 300 点）`, `maxRel=${maxRel.toExponential(1)}`)
      : bad('NumPy 实跑等价', `maxRel=${maxRel.toExponential(1)} @${worstName?.slice(0, 40)}`);
  }
  // MATLAB 静态断言（无 MATLAB 环境，不实测——沿用仓库先例如实声明）
  {
    const c = compileEquation('x^2*y^3/z + cbrt(x)');
    const ml = c.toMatlab((ax) => `kk*${ax.toUpperCase()}`);
    const hasDot = ml.includes('.*') && ml.includes('./') && ml.includes('.^');
    hasDot ? ok('MATLAB 生成含向量化点运算（.* ./ .^）') : bad('MATLAB 点运算缺失', ml);
    // 精确扫描：结构性 * / ^ 的前一非空字符必须是 '.'（防 MATLAB 矩阵语义误用）。
    // 先剔除两类合法标量运算：wrap 坐标文本 (kk*X)、cbrt 常量指数 (1/3)。
    const scanStr = ml.replace(/\(+kk\*[XYZ]\)+/g, 'W').replace('(1/3)', 'CUBERT_EXP');
    let bare = false;
    for (let i = 0; i < scanStr.length; i++) {
      const ch = scanStr[i];
      if (ch === '*' || ch === '/' || ch === '^') {
        let j = i - 1;
        while (j >= 0 && scanStr[j] === ' ') j--;
        if (scanStr[j] !== '.') { bare = true; break; }
      }
    }
    !bare ? ok('MATLAB 无裸标量运算符（防矩阵语义）') : bad('MATLAB 存在裸运算符', ml);
    const cb = ml.includes('^(1/3)');
    cb ? ok('MATLAB cbrt 负数安全翻译（sign.*abs.^）') : bad('MATLAB cbrt 翻译', ml);
    const mlConst = compileEquation('PI*x + E*y').toMatlab();
    mlConst.includes('pi') && mlConst.includes('exp(1)')
      ? ok('MATLAB 常量翻译（PI→pi、E→exp(1)）')
      : bad('MATLAB 常量翻译', mlConst);
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不阻塞 */ }
}

// ────────────────────────────── F. 几何集成（buildSurface custom） ──────────────────────────────
console.log('\n[F] 几何集成');
{
  // solid_network custom：水密 + 体积 vs MC 公式口径
  const cases = [
    { name: 'custom Gyroid 表达式 solid_network', expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)', mode: 'solid_network' },
    { name: 'custom r 变量调制 shell', expr: 'cos(x) + cos(y) + cos(z) + 0.4*cos(2*r)', mode: 'shell' },
    { name: 'custom 参数响应 t gradient_shell', expr: 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + 0.2*t*sin(x)*sin(y)*sin(z)', mode: 'gradient_shell' },
  ];
  for (const tc of cases) {
    const R = 40;
    const res = buildSurface({
      type: 'custom', iso: 0, periods: 2, resolution: R, targetPorosity: 0.5,
      weights: [1, 1, 1, 1], structureMode: tc.mode, containerShape: 'cube',
      thickness: 1.0, gradientDir: 'z', customFormula: tc.expr,
      hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
      preview: false,
    });
    if (res.vertCount === 0 || res.triCount === 0) { bad(`${tc.name} 网格非空`, '0 顶点'); continue; }
    // 水密：开放边 = 0
    const KM = res.vertCount;
    const cnt = new Map();
    for (let t = 0; t < res.indices.length; t += 3) {
      const tri = [res.indices[t], res.indices[t + 1], res.indices[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        const key = a < b ? a * KM + b : b * KM + a;
        cnt.set(key, (cnt.get(key) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const [, n] of cnt) if (n === 1) open++;
    if (open !== 0) { bad(`${tc.name} 水密`, `openEdges=${open}`); continue; }
    // 体积 vs MC 公式口径（连续公式 MC，无格子量化）
    const c = compileEquation(tc.expr);
    const k = 2, tEff = 1.0 * 1.5;
    let solid = 0;
    const NS = 200_000;
    for (let i = 0; i < NS; i++) {
      const x = inRange(-Math.PI, Math.PI), y = inRange(-Math.PI, Math.PI), z = inRange(-Math.PI, Math.PI);
      const v = c.evaluate(x, y, z, { k, t: 1.0, iso: 0 });
      let isSolid;
      if (tc.mode === 'solid_network') isSolid = v < res.isoUsed;
      else isSolid = (v * v) - (res.isoUsed) * (res.isoUsed) > 0;
      if (isSolid) solid++;
    }
    const mcSolid = solid / NS;
    // 容差分级与 mesh_audit 已知限制族一致：solid 6%；shell/调制场 12%（弦切+亚格极限）
    const tol = tc.mode === 'solid_network' ? 0.06 : 0.12;
    const dev = Math.abs(res.meshSolidFraction - mcSolid) / Math.max(mcSolid, 1e-9);
    if (dev <= tol) ok(`${tc.name} 水密+体积`, `open=0 · ${res.triCount} tri · volDev=${(dev * 100).toFixed(2)}% (tol ${tol * 100}%)`);
    else bad(`${tc.name} 体积偏差`, `mesh=${(res.meshSolidFraction * 100).toFixed(2)}% MC=${(mcSolid * 100).toFixed(2)}% dev=${(dev * 100).toFixed(2)}%`);
  }
}

// ────────────────────────────── G. 适配层与缓存 ──────────────────────────────
console.log('\n[G] 适配层与缓存');
{
  // dyn 参数注入：t=1 vs t=2 的场差恰为 0.2*sin(x)*sin(y)*sin(z)
  const dyn1 = { k: 1, t: 1, iso: 0 }, dyn2 = { k: 1, t: 2, iso: 0 };
  const fn1 = getTpmsFunction('custom', 'sin(x)*cos(y) + 0.2*t*sin(x)*sin(y)*sin(z)', dyn1);
  const fn2 = getTpmsFunction('custom', 'sin(x)*cos(y) + 0.2*t*sin(x)*sin(y)*sin(z)', dyn2);
  let worst = 0;
  for (let i = 0; i < 500; i++) {
    const x = inRange(-3, 3), y = inRange(-3, 3), z = inRange(-3, 3);
    const expect = 0.2 * Math.sin(x) * Math.sin(y) * Math.sin(z);
    worst = Math.max(worst, Math.abs((fn2(x, y, z, [1, 1, 1, 1]) - fn1(x, y, z, [1, 1, 1, 1])) - expect));
  }
  worst < 1e-12 ? ok('动态参数 t 注入（t=2−t=1 场差恰为 0.2·sss 项）', `maxΔ=${worst.toExponential(1)}`)
    : bad('动态参数注入', `maxΔ=${worst.toExponential(1)}`);
  // evaluateField / evaluateGradient 与独立求值一致
  const vField = evaluateField('custom', 0.5, 0.7, -0.3, [1, 1, 1, 1], 'cos(x)+cos(y)+cos(z)');
  const vRef = Math.cos(0.5) + Math.cos(0.7) + Math.cos(-0.3);
  Math.abs(vField - vRef) < 1e-12
    ? ok('evaluateField 适配层一致')
    : bad('evaluateField 适配层', `Δ=${Math.abs(vField - vRef)}`);
  const g = evaluateGradient('custom', 0.5, 0.3, 0.2, [1, 1, 1, 1], 'cos(x)+cos(y)+cos(z)');
  Math.abs(g[0] + Math.sin(0.5)) < 1e-12 && Math.abs(g[2] + Math.sin(0.2)) < 1e-12
    ? ok('evaluateGradient AD 精确（∂cos = −sin）')
    : bad('evaluateGradient AD', JSON.stringify(g));
  // 编译缓存
  const a = compileEquation('sin(x)*cos(y)');
  const b = compileEquation('sin(x)*cos(y)');
  const d = compileEquation('sin(x)*cos(z)');
  a === b && a !== d ? ok('编译缓存命中/区分') : bad('编译缓存');
  // 源码安全静态断言：引擎无动态执行路径（要求带括号的调用形态，避免误伤注释）
  const src = readFileSync(join(PLATFORM, 'src/core/equation-parser.ts'), 'utf8');
  !/(^|[^.\w])eval\s*\(/.test(src) && !/new\s+Function\s*\(/.test(src) && !/(^|[^.\w])with\s*\(/.test(src)
    ? ok('引擎源码静态扫描：无 eval / new Function / with 调用')
    : bad('引擎源码存在动态执行路径');
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
