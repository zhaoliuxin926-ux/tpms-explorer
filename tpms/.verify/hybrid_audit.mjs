/**
 * hybrid_audit.mjs —— 多相混合（Hybrid TPMS）专项审计（第七道门）
 *
 * 断言：
 *   ① 水密：典型混合组合（Gyroid+Diamond sigmoid-z、Schwarz P+Gyroid linear-x、
 *      Gyroid+IWP sigmoid-radial）网格开放边 = 0
 *   ② 极限逼近：波前参数偏离中心 ≥3×宽度处，混合场与主导单一曲面场的
 *      相对残差 ≤1e-5——绝对残差数学下界 ~1.4e-5 = sigmoid 渐近极限
 *      exp(−12)≈6e-6 × 场幅值 O(2.5)，非实现误差。即「两端几何分别逼近 A/B」
 *   ③ 双语言残差：混合公式 Python 实现与平台 TS 实现（createHybridField）
 *      在 1000 个随机采样点上的残差 ≤ 1e-6（公式双实现漂移守门）
 *   ④ stress×hybrid 组合（2026-09-12 清欠）：网格贴 warped 混合场零面 ≤5e-3、
 *      素场同点偏移中位数 >0.05（杀静默忽略回归）、组合孔隙率实测位移 >2e-4、水密照常
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
    'src/core/stress-driven-field.ts:transformByStress',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, createHybridField, getTpmsFunction, transformByStress } =
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
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', [pyScript], { encoding: 'utf8', timeout: 60000 });
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

// ── ④ stress×hybrid 组合（2026-09-12 登记项清欠：此前 hybridFn 直调绕过应力 warp，静默忽略）──
// 口径：网格顶点须贴「warped 混合场」零面（组合正确性），且素场在同批点显著偏移
//（杀静默忽略回归）；水密照常硬门。应力 warp 只变换 wc·k 度规坐标，波前留在物理域。
{
  const stressCfg = { preset: 'bending', strength: 0.4, anisotropy: 1.35 };
  const buildStress = (stress) => {
    globalBufferPool.reset();
    return buildSurface({
      type: 'gyroid', iso: 0, periods: 3, resolution: 61, targetPorosity: 0.75,
      weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1.0, gradientDir: 'z', preview: false, ...(stress ? { stress } : {}),
      hybrid: { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 0.5, axis: 'z' },
      customFormula: '', endplateMm: 0,
    }, globalBufferPool);
  };
  const hf = createHybridField('gyroid', 'diamond',
    { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 0.5, axis: 'z' }, '', '');
  const w4 = [1, 1, 1, 1];

  const resS = buildStress(stressCfg);
  const openS = openEdges(resS);
  openS === 0 ? ok('④ 组合水密（gyroid+diamond × bending）') : bad('④ 组合水密', `open=${openS}`);

  // 采样内部顶点（投影域 |p|≤0.97 内；positions 为 wc 域，metric=×k，phys=/π）
  const k3 = 3, pts = [];
  {
    const p = resS.positions;
    for (let vi = 0; vi < resS.vertCount && pts.length < 400; vi++) {
      const x = p[vi * 3] / Math.PI, y = p[vi * 3 + 1] / Math.PI, z = p[vi * 3 + 2] / Math.PI;
      if (Math.abs(x) > 0.9 || Math.abs(y) > 0.9 || Math.abs(z) > 0.9) continue;
      pts.push([x, y, z]);
    }
  }
  const isoUsed = resS.isoUsed;
  let maxWarp = 0, plainShifts = [];
  for (const [x, y, z] of pts) {
    const mx = x * Math.PI * k3, my = y * Math.PI * k3, mz = z * Math.PI * k3;
    const [qx, qy, qz] = transformByStress(stressCfg, mx, my, mz);
    maxWarp = Math.max(maxWarp, Math.abs(hf(qx, qy, qz, x, y, z, w4) - isoUsed));
    plainShifts.push(Math.abs(hf(mx, my, mz, x, y, z, w4) - isoUsed));
  }
  plainShifts.sort((a, b) => a - b);
  const medPlain = plainShifts[Math.floor(plainShifts.length / 2)];
  maxWarp <= 5e-3
    ? ok('④ 组合网格贴 warped 零面（内部顶点 |f∘warp−iso| ≤5e-3）', `max=${maxWarp.toExponential(2)} n=${pts.length}`)
    : bad('④ 组合网格偏离 warped 零面', `max=${maxWarp.toExponential(2)}`);
  medPlain > 0.05
    ? ok('④ 素场在同批顶点显著偏移（warp 真实进入几何，杀静默忽略）', `median|Δ|=${medPlain.toFixed(3)}`)
    : bad('④ 素场偏移不足（疑似静默忽略回归）', `median|Δ|=${medPlain.toFixed(4)}`);

  // 全局几何可观测量：同一显式 iso 下，warped 与素混合场的实测孔隙率必须不同
  //（targetPorosity 二分会重新命中目标——实测孔隙率被设计钉住，不能作 warp 观测量；
  //  固定 iso 后孔隙率才自由反映 warp 重分布）
  {
    const resP = buildStress(null);
    const isoP = resP.isoUsed;
    const buildIso = (stress) => {
      globalBufferPool.reset();
      return buildSurface({
        type: 'gyroid', iso: isoP, periods: 3, resolution: 61,
        weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
        thickness: 1.0, gradientDir: 'z', preview: false, ...(stress ? { stress } : {}),
        hybrid: { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 0.5, axis: 'z' },
        customFormula: '', endplateMm: 0,
      }, globalBufferPool);
    };
    const isoWarped = buildIso(stressCfg), isoPlain = buildIso(null);
    const dIso = Math.abs(isoWarped.porosityEstimate - isoPlain.porosityEstimate);
    dIso > 2e-4
      ? ok('④ 同 iso 下组合孔隙率位移（warp 重分布的全局可观测量）', `Δ=${(dIso * 100).toFixed(3)}pp`)
      : bad('④ 同 iso 下组合孔隙率无位移（疑似静默忽略回归）', `Δ=${(dIso * 100).toFixed(4)}pp`);
  }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
  if (pass < 9) { console.error('GUARD FAIL: 断言执行数 ' + pass + ' < 基线 9（恒真/集体跳过防护，2026-09-04 审查纳管；2026-09-12 ④ 组合节 5→9）'); process.exit(1); }
process.exit(fail ? 1 : 0);
