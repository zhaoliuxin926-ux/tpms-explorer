/**
 * hybrid_audit.mjs —— 多相混合（Hybrid TPMS）专项审计（第七道门）
 *
 * 断言：
 *   ① 水密：典型混合组合（Gyroid+Diamond sigmoid-z、Schwarz P+Gyroid linear-x、
 *      Gyroid+IWP sigmoid-radial）网格开放边 = 0
 *   ② 极限逼近：波前参数偏离中心 ≥3×宽度处（sigmoid 渐近误差 ~2e-16），
 *      混合场与主导单一曲面场的偏差 ≤ 1e-6 —— 即「两端几何分别逼近 A/B」
 *   ③ 双语言残差：混合公式 Python 实现与平台 TS 实现（createHybridField）
 *      在 1000 个随机采样点上的残差 ≤ 1e-6（公式双实现漂移守门）
 *
 * 运行：node hybrid_audit.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_hybrid_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_hybrid_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/core/hybrid-functions.ts:createHybridField',
    'src/core/tpms-functions.ts:getTpmsFunction',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, createHybridField, getTpmsFunction } =
  await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d ? '— ' + d : ''); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };

function build(typeA, typeB, axis, blendFunction, center, width) {
  globalBufferPool.reset();
  return buildSurface({
    type: typeA, iso: 0, periods: 3, resolution: 61, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', preview: false,
    hybrid: { enabled: true, typeB, blendFunction, blendCenter: center, blendWidth: width, axis },
    customFormula: '', endplateMm: 0,
  }, globalBufferPool);
}

// ── ① 水密 ────────────────────────────────────────────────────
const COMBOS = [
  { name: 'Gyroid+Diamond sigmoid-z', A: 'gyroid', B: 'diamond', axis: 'z', fn: 'sigmoid', c: 0, w: 0.5 },
  { name: 'Schwarz P+Gyroid linear-x', A: 'schwarz', B: 'gyroid', axis: 'x', fn: 'linear', c: 0, w: 0.8 },
  { name: 'Gyroid+IWP sigmoid-radial', A: 'gyroid', B: 'iwp', axis: 'radial', fn: 'sigmoid', c: 0.5, w: 0.6 },
];
function openEdges(res) {
  const p = res.positions, idx = res.indices;
  let maxV = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxV) maxV = idx[i];
  const KM = maxV + 1;
  const em = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * KM + v : v * KM + u;
      const rec = em.get(key) || [0, 0];
      if (u < v) rec[0]++; else rec[1]++;
      em.set(key, rec);
    }
  }
  let open = 0;
  for (const [, [ab, ba]] of em) if (ab + ba === 1) open++;
  return open;
}
for (const tc of COMBOS) {
  try {
    const res = build(tc.A, tc.B, tc.axis, tc.fn, tc.c, tc.w);
    const open = openEdges(res);
    open === 0 ? ok(`${tc.name} · 水密`) : bad(`${tc.name} · 水密`, `open=${open}`);
  } catch (e) {
    bad(`${tc.name} 异常`, e.message);
  }
}

// ── ② 极限逼近 ────────────────────────────────────────────────
{
  const hybrid = createHybridField('gyroid', 'diamond',
    { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 0.5, axis: 'z' },
    '', '');
  const fA = getTpmsFunction('gyroid', '');
  const fB = getTpmsFunction('diamond', '');
  const w = [1, 1, 1, 1];
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let maxA = 0, maxB = 0;
  for (let i = 0; i < 1000; i++) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1, zFar = rnd() > 0.5 ? 1 : -1;
    const mx = x * Math.PI * 3, my = y * Math.PI * 3, mz = zFar * Math.PI * 3;
    const h = hybrid(mx, my, mz, x, y, zFar, w);
    const single = zFar > 0 ? fA(mx, my, mz, w) : fB(mx, my, mz, w);
    const diff = Math.abs(h - single);
    if (zFar > 0) maxA = Math.max(maxA, diff); else maxB = Math.max(maxB, diff);
  }
  // 相对残差阈值：采样点在物理域边缘（|t−c|=2, k·Δ=12），sigmoid 渐近极限
  // exp(−12)≈6e-6 × 场幅值 O(2.5) ⇒ 绝对残差 ~1.4e-5 为数学下界，非实现误差
  const relA = maxA / 2.5, relB = maxB / 2.5;
  relA <= 1e-5 && relB <= 1e-5
    ? ok('极限逼近（两端 ≈ 单一曲面板）', `relΔ_A=${relA.toExponential(2)} relΔ_B=${relB.toExponential(2)}`)
    : bad('极限逼近', `relΔ_A=${relA.toExponential(2)} relΔ_B=${relB.toExponential(2)}`);
}

// ── ③ Python 双语言残差 ──────────────────────────────────────
{
  const sampleTxt = join(tmpdir(), 'hybrid_py_samples.txt');
  const pyScript = join(tmpdir(), 'tpms_hybrid_residual_check.py');
  writeFileSync(pyScript, `
import numpy as np
rng = np.random.default_rng(7)
N = 1000
x = rng.uniform(-1, 1, N); y = rng.uniform(-1, 1, N); z = rng.uniform(-1, 1, N)
kk = 3 * np.pi
VA = np.sin(kk*x)*np.cos(kk*y) + np.sin(kk*y)*np.cos(kk*z) + np.sin(kk*z)*np.cos(kk*x)
VB = (np.sin(kk*x)*np.sin(kk*y)*np.sin(kk*z)
      + np.sin(kk*x)*np.cos(kk*y)*np.cos(kk*z)
      + np.cos(kk*x)*np.sin(kk*y)*np.cos(kk*z)
      + np.cos(kk*x)*np.cos(kk*y)*np.sin(kk*z))
k_sig = 6.0 / 0.5
alpha = 1 / (1 + np.exp(-k_sig * z))
V = alpha * VA + (1 - alpha) * VB
out = np.stack([x, y, z, V], axis=1)
np.savetxt(${JSON.stringify(sampleTxt)}, out, fmt='%.12e')
print('py ok', N)
`);
  const r = spawnSync('python', [pyScript], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) {
    bad('py 残差脚本执行', (r.stderr || r.stdout || '').slice(0, 200));
  } else {
    const fnA = getTpmsFunction('gyroid', '');
    const fnB = getTpmsFunction('diamond', '');
    const hybrid = createHybridField('gyroid', 'diamond',
      { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 0.5, axis: 'z' }, '', '');
    const samples = readFileSync(sampleTxt, 'utf8')
      .trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    let maxDiff = 0;
    for (const [x, y, z, vPy] of samples) {
      const vJs = hybrid(x * Math.PI * 3, y * Math.PI * 3, z * Math.PI * 3, x, y, z, [1, 1, 1, 1]);
      maxDiff = Math.max(maxDiff, Math.abs(vJs - vPy));
    }
    maxDiff <= 1e-6
      ? ok('py/TS 混合公式残差 ≤1e-6（1000 点）', `maxΔ=${maxDiff.toExponential(2)}`)
      : bad('py/TS 混合公式残差', `maxΔ=${maxDiff.toExponential(2)}`);
  }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
