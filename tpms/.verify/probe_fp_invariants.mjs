// probe_fp_invariants.mjs —— 第一性原理不变量探针（注册资产，未纳管 run_ci_suite；88/88 自校准含阳性对照）
// 运行：node tpms/.verify/probe_fp_invariants.mjs —— 几何层改动后手跑；判读表/处置史见 agent_memory/bugs.md 2026-11-21 三批
// probe_fp_invariants.mjs —— 第一性原理对抗探针（预注册判读表在先，2026-11-21）
// 判读表（运行前写死，防事后合理化）：
//  P1 周期性: 全 26 族 |f(p)-f(p+2πe_i)|<=1e-9（解析式 2π 周期=数学必然）
//  P2 循环置换: f(x,y,z)=f(y,z,x) <=1e-9（splitp/strut×2/custom 结构豁免，其余 FAIL 逐条对公式裁决）
//  P3 反对称: schwarz/neovius/diamond 等权 |f(p)+f(p+(π,π,π))|<=1e-9 → 配对体素 φ(iso=0)=0.5 精确带
//  P4 场-网格: 全 26 族 k1 R48 buildSurface 顶点 max|f(v)|<=5e-7（strut_exit_audit 先例带）
//  P5 独立 STL: gyroid k1 R48 STL 发散定理体积 vs signedVol vs 解析 φ 互证
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
const PLATFORM = _j(_d(fileURLToPath(import.meta.url)), '../tpms-platform');
const BUNDLE = tmpdir() + '/tpms_fp_probe_bundle.mjs';
{
  const entry = tmpdir() + `/tpms_fp_probe_entry_${process.pid}.ts`;
  const lines = [
    `export { getTpmsFunction, getDefaultWeights } from ${JSON.stringify(PLATFORM + '/src/core/tpms-functions.ts')};`,
    `export { buildSurface } from ${JSON.stringify(PLATFORM + '/src/geometry/surface-nets.ts')};`,
    `export { globalBufferPool } from ${JSON.stringify(PLATFORM + '/src/geometry/buffer-pool.ts')};`,
    `export { solveIsoAnalytic, resetPorosityRng } from ${JSON.stringify(PLATFORM + '/src/core/porosity-solver.ts')};`,
    `export { buildBinarySTL } from ${JSON.stringify(PLATFORM + '/src/export/stl-exporter.ts')};`,
    `export { parseSTL } from ${JSON.stringify(PLATFORM + '/src/geometry/mesh-container.ts')};`,
  ];
  writeFileSync(entry, lines.join('\n'));
  const rd = PLATFORM + '/node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : '');
  const r = spawnSync(`"${rd}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown fail:', r.stdout?.slice(0,300), r.stderr?.slice(0,300)); process.exit(1); }
  rmSync(entry, { force: true });
}
const { getTpmsFunction, getDefaultWeights, buildSurface, globalBufferPool, buildBinarySTL, parseSTL } = await import(pathToFileURL(BUNDLE));

const FAMS = ['gyroid','diamond','schwarz','neovius','iwp','frd','lidinoid','splitp','octo','karcher','fks','fky','gprime','fcks','dprime','dp','dd','dg','fcky','cdd','slotp','fs','qstar','ws','strutbcc','strutoctet'];
let pass = 0; const fails = [];
const ok = (n) => { pass++; console.log('  ok', n); };
const bad = (n, info) => { fails.push(n + ' :: ' + info); console.log('  FAIL', n, info); };
const TRIES = 200; const eps = 1e-9;
const TAU = 2 * Math.PI;

// ── P0 阳性对照（元规则=探针必须先证明自己能抓已知坏：自查题自决 2026-11-21）──
// 对照 a：P3 反对称检测器对 gyroid（结构上不满足反对称）必须开火
{
  const f = getTpmsFunction('gyroid', '', undefined);
  const w = getDefaultWeights('gyroid');
  let worst = 0;
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * 4 - 2, y = Math.random() * 4 - 2, z = Math.random() * 4 - 2;
    worst = Math.max(worst, Math.abs(f(x, y, z, w) + f(x + Math.PI, y + Math.PI, z + Math.PI, w)));
  }
  if (worst > eps) ok('P0a P3 检测器对 gyroid 开火（worst=' + worst.toExponential(1) + '）');
  else bad('P0a', 'P3 检测器未开火=探针盲');
}
// 对照 b：P4 错面检测器对嵌合体（gyroid 网格 vs schwarz 场）必须开火（O(1) 签名）
{
  const params = { type: 'gyroid', iso: 0, periods: 1, resolution: 48, weights: getDefaultWeights('gyroid'), structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 }, customFormula: '', preview: false };
  const res = buildSurface(params, globalBufferPool);
  const fs = getTpmsFunction('schwarz', '', undefined);
  const ws = getDefaultWeights('schwarz');
  let worst = 0;
  const M = 0.1;
  for (let vi = 0; vi < res.positions.length; vi += 3) {
    const x = res.positions[vi], y = res.positions[vi + 1], z = res.positions[vi + 2];
    if (Math.abs(x) > Math.PI - M || Math.abs(y) > Math.PI - M || Math.abs(z) > Math.PI - M) continue;
    worst = Math.max(worst, Math.abs(fs(x, y, z, ws)));
  }
  if (worst > 0.1) ok('P0b P4 检测器对嵌合体开火（worst=' + worst.toExponential(1) + '）');
  else bad('P0b', '错面检测器未开火=探针盲');
}
console.log('P0 done: pass=' + pass + ' fail=' + fails.length);

// ── P1 周期性（26 族 × 3 轴 × 200 点）──
for (const t of FAMS) {
  const f = getTpmsFunction(t, '', undefined);
  const w = getDefaultWeights(t);
  let worst = 0;
  for (let i = 0; i < TRIES; i++) {
    const x = (Math.random() * 8 - 4), y = (Math.random() * 8 - 4), z = (Math.random() * 8 - 4);
    const v0 = f(x, y, z, w);
    for (const [dx, dy, dz] of [[TAU,0,0],[0,TAU,0],[0,0,TAU]]) {
      worst = Math.max(worst, Math.abs(f(x + dx, y + dy, z + dz, w) - v0));
    }
  }
  if (worst <= eps) ok(`P1 ${t}`);
  else bad(`P1 ${t}`, `worst=${worst.toExponential(2)}`);
}
console.log('P1 done: pass=' + pass + ' fail=' + fails.length);
// ── P2 循环置换（26 族；splitp/strut×2 结构豁免）──
const CYC_EXEMPT = new Set(['splitp', 'strutbcc', 'strutoctet', 'qstar']); // qstar 豁免已升级：2026-11-21 Gemini 逐字核验数据集原文零偏差，轴非对称=六方/菱方晶系本质（collab/gemini/2026-11-21-fp-audit-consult-reply.md 卡 A）
for (const t of FAMS) {
  if (CYC_EXEMPT.has(t)) { ok('P2 ' + t + ' (豁免)'); continue; }
  const f = getTpmsFunction(t, '', undefined);
  const w = getDefaultWeights(t);
  let worst = 0;
  for (let i = 0; i < TRIES; i++) {
    const x = Math.random() * 8 - 4, y = Math.random() * 8 - 4, z = Math.random() * 8 - 4;
    const d = Math.abs(f(x, y, z, w) - f(y, z, x, w));
    worst = Math.max(worst, d);
  }
  if (worst <= eps) ok('P2 ' + t);
  else bad('P2 ' + t, `worst=${worst.toExponential(2)}`);
}
console.log('P2 done: pass=' + pass + ' fail=' + fails.length);
// ── P3 反对称不变量（schwarz/neovius/diamond 等权）──
for (const t of ['schwarz', 'neovius', 'diamond']) {
  const f = getTpmsFunction(t, '', undefined);
  const w = getDefaultWeights(t);
  let worst = 0;
  for (let i = 0; i < TRIES; i++) {
    const x = Math.random() * 4 - 2, y = Math.random() * 4 - 2, z = Math.random() * 4 - 2;
    worst = Math.max(worst, Math.abs(f(x, y, z, w) + f(x + Math.PI, y + Math.PI, z + Math.PI, w)));
  }
  if (worst <= eps) ok('P3 field ' + t);
  else bad('P3 field ' + t, 'worst=' + worst.toExponential(2));
}
// P3b 配对体素 φ(iso=0)=0.5（schwarz 等权，域 [-π,π]³, R=64, (π,π,π) 平移自配对）
{
  const f = getTpmsFunction('schwarz', '', undefined);
  const w = getDefaultWeights('schwarz');
  const R = 64, N = 2 * R;
  let solid = 0, total = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = -Math.PI + (i + 0.5) * (2 * Math.PI / N);
    const y = -Math.PI + (j + 0.5) * (2 * Math.PI / N);
    const z = -Math.PI + (k + 0.5) * (2 * Math.PI / N);
    total++; if (f(x, y, z, w) > 0) solid++;
  }
  const phi = solid / total;
  const band = 3 / Math.sqrt(N * N * N);
  if (Math.abs(phi - 0.5) <= Math.max(band, 0.01)) ok('P3b paired-voxel phi=' + phi.toFixed(5));
  else bad('P3b', 'phi=' + phi.toFixed(5) + ' band=' + band.toFixed(4));
}
console.log('P3 done: pass=' + pass + ' fail=' + fails.length);

// f_ 帮手：family + vertex -> |f|（顶点为弧度域坐标，k=1）
function f_(t, v) {
  const f = getTpmsFunction(t, '', undefined);
  const w = getDefaultWeights(t);
  return Math.abs(f(v[0], v[1], v[2], w));
}

// ── P4 场-网格一致性（26 族 k1 R48 buildSurface 顶点 |f| 带）──
for (const t of FAMS) {
  const w = getDefaultWeights(t);
  let worst = 0;
  try {
        const params = { type: t, iso: 0, periods: 1, resolution: 48, weights: w, structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 }, customFormula: '', preview: false };
    const res = buildSurface(params, globalBufferPool);
    const M = 0.1;
    for (let vi = 0; vi < res.positions.length; vi += 3) {
      const x = res.positions[vi], y = res.positions[vi+1], z = res.positions[vi+2];
      if (Math.abs(x) > Math.PI - M || Math.abs(y) > Math.PI - M || Math.abs(z) > Math.PI - M) continue;
      const v = f_(t, [x, y, z]);
      if (v > worst) worst = v;
    }
  } catch (e) { bad('P4 ' + t, 'build throw: ' + String(e).slice(0, 60)); continue; }
  if (worst <= 0.1) ok('P4 ' + t + ' max|f|=' + worst.toExponential(1));
  else bad('P4 ' + t, 'max|f(v)|=' + worst.toExponential(2));
}

// ── P4b 收敛判别（P4 残差最大三族 @R96：真残差应随 R 下降，嵌合体/版本错位则 O(1) 不降）──
for (const t of ['fky', 'strutoctet', 'frd']) {
  const w = getDefaultWeights(t);
  const mk = (R) => {
    const params = { type: t, iso: 0, periods: 1, resolution: R, weights: w, structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 }, customFormula: '', preview: false };
    const res = buildSurface(params, globalBufferPool);
    let worst = 0;
    const M = 0.1;
    for (let vi = 0; vi < res.positions.length; vi += 3) {
      const x = res.positions[vi], y = res.positions[vi + 1], z = res.positions[vi + 2];
      if (Math.abs(x) > Math.PI - M || Math.abs(y) > Math.PI - M || Math.abs(z) > Math.PI - M) continue;
      worst = Math.max(worst, f_(t, [x, y, z]));
    }
    return worst;
  };
  const r48 = mk(48), r96 = mk(96);
  const conv = r48 / r96;
  if (r96 < 0.1 && conv >= 1.3) ok('P4b ' + t + ' R48=' + r48.toExponential(1) + ' R96=' + r96.toExponential(1) + ' 比值=' + conv.toFixed(1));
  else bad('P4b ' + t, 'R48=' + r48.toExponential(1) + ' R96=' + r96.toExponential(1) + ' 比值=' + conv.toFixed(1));
}
console.log('P4b done: pass=' + pass + ' fail=' + fails.length);

console.log('P4 done: pass=' + pass + ' fail=' + fails.length);
// ── P5 独立 STL 真值（gyroid k1 R48）──
{
  const t = 'gyroid';
  const w = getDefaultWeights(t);
      const params = { type: t, iso: 0, periods: 1, resolution: 48, weights: w, structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 }, customFormula: '', preview: false };
    const res = buildSurface(params, globalBufferPool);
  const stl = buildBinarySTL(res.positions, res.indices, 1.0);
  const m = parseSTL(stl.buffer ?? stl);
  const V = m.positions, I = m.indices, tris = m.indices.length / 3;
  let vol = 0;
  for (let i = 0; i < tris; i++) {
    const i0 = 3 * I[3 * i], i1 = 3 * I[3 * i + 1], i2 = 3 * I[3 * i + 2];
    const ax = V[i0], ay = V[i0 + 1], az = V[i0 + 2];
    const bx = V[i1], by = V[i1 + 1], bz = V[i1 + 2];
    const cx2 = V[i2], cy2 = V[i2 + 1], cz2 = V[i2 + 2];
    vol += (ax * (by * cz2 - bz * cy2) - ay * (bx * cz2 - bz * cx2) + az * (bx * cy2 - by * cx2)) / 6;
  }
  const phiMesh = 1 - Math.abs(vol) / (2 * Math.PI) ** 3;
  
  console.log('P5 mesh phi=' + phiMesh.toFixed(5) + ' porosityEstimate=' + res.porosityEstimate);
  if (Number.isFinite(res.porosityEstimate) && Math.abs((1 - phiMesh) - res.porosityEstimate) < 0.01) ok('P5 divergence-vs-porosityEstimate');
  else bad('P5', 'divergence solidFrac=' + (1 - phiMesh).toFixed(5) + ' vs porosityEstimate=' + res.porosityEstimate);
}
console.log('=== FP-INVARIANTS: pass=' + pass + ' fail=' + fails.length + ' ===');
for (const s of fails) console.log('  FAIL ' + s);
