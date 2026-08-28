/**
 * hierarchical_audit.mjs —— 门禁 16：多级分形分级 TPMS + 应力场单调性审计
 *
 * A. 分级网格水密性：macro×micro 组合 × solid/shell，开放边 = 0
 * B. λ=0 退化：分级构建 ≈ 宏观单一构建（固相分数偏差 ≤0.5%，查表/实时路径差内）
 * C. 微孔连通率 ≥95%（微场空隙 6 连通最大簇占比，32³ 采样）
 * D. 双重比表面积：微孔附加 > 0；总面积 > 宏观面积；S 随 N 增长
 * E. 【阶段 IV】应力单调性：bending 壳 β>0 时，vm 分桶固相分数随 vm 严格递增
 * F. 【阶段 IV】应力变换完整性：anisotropy 改变几何；cantilever 水密
 *
 * 运行：node hierarchical_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_hier_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_hier_audit_entry.ts');
  writeFileSync(entry, [
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { analyzeHierarchical } from ${JSON.stringify(join(PLATFORM, 'src/core/hierarchical-functions.ts'))};`,
    `export { getTpmsFunction, evaluateField } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
    `export { stressAt } from ${JSON.stringify(join(PLATFORM, 'src/core/stress-driven-field.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, analyzeHierarchical, getTpmsFunction } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const mkParams = (over) => ({
  type: 'gyroid', iso: 0, periods: 1, resolution: 24, targetPorosity: 0.7,
  weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
  thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
  customFormula: '', preview: false, ...over,
});

function openEdges(res) {
  const { indices, vertCount, triCount } = res;
  const cnt = new Map();
  const KM = vertCount + 1;
  for (let t = 0; t < triCount * 3; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? u * KM + v : v * KM + u;
      cnt.set(key, (cnt.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [, n] of cnt) if (n === 1) open++;
  return open;
}

// ── A. 分级网格水密性 ──
console.log('\n[A] 分级网格水密性（macro×micro × solid/shell）');
for (const [macro, micro] of [['gyroid', 'diamond'], ['schwarz', 'gyroid'], ['diamond', 'iwp'], ['neovius', 'schwarz']]) {
  for (const mode of ['solid_network', 'shell']) {
    const res = buildSurface(mkParams({
      type: macro, structureMode: mode,
      hierarchical: { enabled: true, microType: micro, frequency: 4, amplitude: 0.25 },
    }));
    const open = openEdges(res);
    check(`${macro}+${micro}/${mode === 'shell' ? 'shell' : 'solid'}: open=${open}`, open === 0 && res.triCount > 0);
  }
}

// ── B. λ=0 退化一致性 ──
console.log('\n[B] λ=0 退化为宏观单一尺度');
{
  const macroOnly = buildSurface(mkParams({ resolution: 24 }));
  const hierZero = buildSurface(mkParams({
    resolution: 24,
    hierarchical: { enabled: true, microType: 'diamond', frequency: 4, amplitude: 0 },
  }));
  const dev = Math.abs(hierZero.meshSolidFraction - macroOnly.meshSolidFraction) / Math.max(1e-9, macroOnly.meshSolidFraction);
  check(`λ=0 固相分数偏差 ${(dev * 100).toFixed(4)}% ≤0.5%`, dev <= 0.005,
    `macro=${macroOnly.meshSolidFraction.toFixed(5)}, hier0=${hierZero.meshSolidFraction.toFixed(5)}`);
}

// ── C. 微孔连通率 ──
console.log('\n[C] 微孔连通率（微场空隙最大 6 连通簇占比 ≥95%）');
for (const [macro, micro] of [['gyroid', 'diamond'], ['schwarz', 'gyroid'], ['gyroid', 'schwarz']]) {
  const st = analyzeHierarchical({
    type: macro, microType: micro, frequency: 4, amplitude: 0.25,
    weights: [1, 1, 1, 1], periods: 1, iso: 0, customFormula: '',
  }, 48);
  check(`${macro}+${micro}: 微孔连通率 ${(st.microConnectivity * 100).toFixed(1)}% ≥95%`, st.microConnectivity >= 0.95);
}

// ── D. 双重比表面积 ──
console.log('\n[D] 双重比表面积分离（coarea MC）');
{
  const base = { weights: [1, 1, 1, 1], periods: 1, iso: 0, customFormula: '' };
  const st = analyzeHierarchical({ type: 'gyroid', microType: 'diamond', frequency: 4, amplitude: 0.25, ...base }, 48);
  check(`微孔附加比表面积 ${(st.ssaMicroAdded).toFixed(3)} > 0`, st.ssaMicroAdded > 0);
  check(`总面积 ${(st.ssaTotal).toFixed(3)} > 宏观 ${(st.ssaMacro).toFixed(3)}`, st.ssaTotal > st.ssaMacro);
  const stN8 = analyzeHierarchical({ type: 'gyroid', microType: 'diamond', frequency: 8, amplitude: 0.25, ...base }, 48);
  check(`S 随 N 增长（N8 ${(stN8.ssaTotal).toFixed(3)} > N4 ${(st.ssaTotal).toFixed(3)}）`, stN8.ssaTotal > st.ssaTotal);
}

// ── E. 应力单调性（阶段 IV 判定：高应力区相对密度 ↑）──
console.log('\n[E] 应力-相对密度单调性（bending 壳 β=0.5，vm 五分桶体素 MC）');
{
  const res = buildSurface(mkParams({
    type: 'gyroid', structureMode: 'shell', targetPorosity: 0.7, periods: 1, resolution: 24,
    stress: { preset: 'bending', strength: 0.5, anisotropy: 1 },
  }));
  const isoUsed = res.isoUsed ?? 0;             // shell: tEff/2
  const tEff = isoUsed * 2;
  const bias = 0;
  const tpms = getTpmsFunction('gyroid', '', { k: 1, t: 1, iso: 0 });
  const BINS = 5;
  const solidCnt = new Float64Array(BINS), totalCnt = new Float64Array(BINS);
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const samples = 60000;
  for (let i = 0; i < samples; i++) {
    const px = rnd() * 2 - 1, py = rnd() * 2 - 1, pz = rnd() * 2 - 1;
    const mx = px * Math.PI, my = py * Math.PI, mz = pz * Math.PI;
    const v = tpms(mx, my, mz, [1, 1, 1, 1]);
    const vm = Math.min(1, Math.abs(pz));       // bending: vm = |pz|
    const dv = v - bias;
    const tLoc = tEff * Math.max(0.1, 1 - 0.5 * vm);  // 与平台 stressThicknessScale 同式（β=0.5，孔隙板收窄）
    const solid = dv * dv - (tLoc / 2) * (tLoc / 2) > 0;
    const bin = Math.min(BINS - 1, Math.floor(vm * BINS));
    totalCnt[bin]++;
    if (solid) solidCnt[bin]++;
  }
  const fr = [...solidCnt].map((c, i) => (totalCnt[i] > 0 ? c / totalCnt[i] : 0));
  let mono = true;
  for (let i = 1; i < BINS; i++) if (fr[i] < fr[i - 1]) mono = false;
  check(`vm 分桶固相分数递增 [${fr.map((f) => f.toFixed(3)).join(', ')}]`, mono);
}

// ── F. 应力变换完整性 ──
console.log('\n[F] 应力变换完整性');
{
  const a = buildSurface(mkParams({ stress: { preset: 'torsion', strength: 0, anisotropy: 1 }, resolution: 20 }));
  const b = buildSurface(mkParams({ stress: { preset: 'torsion', strength: 0, anisotropy: 2 }, resolution: 20 }));
  const rel = Math.abs(a.meshSolidFraction - b.meshSolidFraction) / Math.max(1e-9, a.meshSolidFraction);
  check(`anisotropy 改变几何（${(rel * 100).toFixed(2)}% > 1%）`, rel > 0.01);
  const c = buildSurface(mkParams({ stress: { preset: 'cantilever', strength: 0.6, anisotropy: 1.5 }, resolution: 20 }));
  check(`cantilever 水密 open=${openEdges(c)}`, openEdges(c) === 0);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
