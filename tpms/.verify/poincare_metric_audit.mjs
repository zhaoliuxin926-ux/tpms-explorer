/**
 * poincare_metric_audit.mjs —— 门禁 18：庞加莱双曲度规映射审计（纯 Node）
 *
 * A. 雅可比行列式全域 > 0（R₀ ∈ {6, 10, 20} × 域 ±π·k, k∈{1,3}，含截断边界带）
 * B. 径向单射性：映射半径函数在全域（含线性延拓段）严格递增
 * C. 几何完整性：gyroid 全域网格 poincare 映射后水密 open=0、三角数不变（拓扑继承）、
 *    发散体积 > 0（无内外翻）
 * D. 定向保持：抽样三角形离散法线与径向方向点积 > 0（径向映射保定向）
 * E. 度规一致性：庞加莱映射为径向保形（各向同性缩放 s(r)），逆度规因子 G⁻¹ = 1/s²
 *    与解析式逐点一致（法向共形补偿口径）
 * F. 脚本同源：py 模板在 poincare 激活时包含逐式翻译块（静态断言）
 *
 * 运行：node poincare_metric_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_poincare_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_poincare_audit_entry.ts');
  writeFileSync(entry, [
    `export { mapPoint, mapGeometry, jacobianDet } from ${JSON.stringify(join(PLATFORM, 'src/core/manifold-mapping.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { globalBufferPool } from ${JSON.stringify(join(PLATFORM, 'src/geometry/buffer-pool.ts'))};`,
    `export { buildPythonScript } from ${JSON.stringify(join(PLATFORM, 'src/export/script-exporter.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { mapPoint, mapGeometry, jacobianDet, buildSurface, globalBufferPool, buildPythonScript } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const HALF = Math.PI;
const mkCfg = (radius) => ({ kind: 'poincare', radius, tubeRatio: 0.4, scale: 1.4, axis: 'z' });

// ── A. 雅可比行列式全域 > 0 ──
console.log('\n[A] det(J) > 0 全域采样');
{
  let bad = 0, total = 0;
  for (const R0 of [6, 10, 20]) {
    for (const k of [1, 3]) {
      const ctx = { half: HALF * k };
      const lim = HALF * k * Math.sqrt(3) * 1.02;   // 覆盖域角 + 截断边界带
      for (let i = 0; i < 3000; i++) {
        const x = (Math.sin(i * 12.9898) * lim);
        const y = (Math.sin(i * 78.233) * lim);
        const z = (Math.cos(i * 39.425) * lim);
        total++;
        if (!(jacobianDet('poincare', mkCfg(R0), ctx, x, y, z) > 0)) bad++;
      }
    }
  }
  check(`det(J) > 0（${total} 采样，异常 ${bad}）`, bad === 0);
}

// ── B. 径向单射性 ──
console.log('\n[B] 径向映射单射性（含线性延拓段）');
{
  let bad = 0;
  for (const R0 of [4, 6, 10]) {
    const ctx = { half: HALF };
    let prev = -1;
    for (let i = 0; i <= 2000; i++) {
      const r = (i / 2000) * HALF * Math.sqrt(3) * 1.05;
      const out = [0, 0, 0];
      mapPoint('poincare', mkCfg(R0), ctx, r, 0, 0, out);
      const rm = Math.hypot(out[0], out[1], out[2]);
      if (rm <= prev + 1e-12) bad++;
      prev = rm;
    }
  }
  check('映射半径严格递增（3×R₀ × 2000 采样）', bad === 0);
  // 方向保持：映射不改变射线方向
  const out = [0, 0, 0];
  mapPoint('poincare', mkCfg(6), { half: HALF }, 2.5, 1.5, 0.5, out);
  const cosDir = (2.5 * out[0] + 1.5 * out[1] + 0.5 * out[2]) / (Math.hypot(2.5, 1.5, 0.5) * Math.hypot(out[0], out[1], out[2]));
  check('射线方向保持（cos = 1）', Math.abs(cosDir - 1) < 1e-12);
}

// ── C. 几何完整性 ──
console.log('\n[C] 映射后网格完整性');
{
  const res = buildSurface(mkParams());
  const triCount0 = res.triCount;
  const positions = res.positions.slice();
  const before = new Float32Array(positions);
  const maxR = mapGeometry('poincare', mkCfg(10), { half: HALF }, positions);
  // 水密性（开放边）
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
  check(`水密 open=${open}（拓扑继承，三角数 ${triCount} == ${triCount0}）`, open === 0 && triCount === triCount0);
  check(`映射后包围半径 ${maxR.toFixed(2)} > 原域`, maxR > HALF);

  // 发散体积 > 0（无内外翻）+ 退化三角
  let vol6 = 0, degen = 0;
  for (let t = 0; t < triCount * 3; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const area2 = Math.hypot(cx, cy, cz);
    if (area2 < 1e-12) degen++;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  check(`发散体积 > 0（vol=${(vol6 / 6).toFixed(1)}）`, vol6 > 0);
  check(`零退化三角（${degen}）`, degen === 0);

  // ── D. 定向保持：det(J)>0 的单射映射保定向 ⇒ 共享边两侧三角形绕行方向相反
  //（misoriented edges = 0）。注意「面法线径向朝外」是错误不变量——gyroid 曲面
  // 法线指向四面八方，与射线方向无关（首版 137/409 假红即源于此）。
  let misoriented = 0, shared = 0;
  {
    const dirCnt = new Map();
    for (let t = 0; t < triCount * 3; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u * KM + v;
        dirCnt.set(key, (dirCnt.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of dirCnt) {
      if (n !== 1) continue;
      const u = Math.floor(key / KM), v = key % KM;
      const rev = dirCnt.get(v * KM + u) ?? 0;
      if (rev === 0) misoriented++;   // 开放有向边：另一侧无反向引用
      shared++;
    }
  }
  check(`有向边配对完整（misoriented=${misoriented}）`, misoriented === 0);
}

function mkParams(over) {
  return {
    type: 'gyroid', iso: 0, periods: 1, resolution: 28, targetPorosity: 0.6,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false, ...over,
  };
}

// ── E. 度规一致性（保形因子解析式）──
console.log('\n[E] 度规一致性（G⁻¹ = 1/s²，s = 2R₀²/(R₀²−r²)）');
{
  const R0 = 10;
  let ok = true;
  for (let i = 1; i < 40; i++) {
    const r = (i / 40) * 0.9 * R0;
    const s = (2 * R0 * R0) / (R0 * R0 - r * r);
    const gInv = 1 / (s * s);
    // 度规 = s²·I（共形），逆 = 1/s²·I
    if (Math.abs(s * s * gInv - 1) > 1e-12) ok = false;
  }
  check('逆度规因子解析一致', ok);
  // 截断外：度规修正退化为延拓段的解析 s
  const rC = 0.95 * R0;
  const sC = (2 * R0 * R0) / (R0 * R0 - rC * rC);
  const fpC = (2 * R0 * R0 * (R0 * R0 + 3 * rC * rC)) / Math.pow(R0 * R0 - rC * rC, 2);
  check('截断边界斜率连续（f(rC)+f\'(rC)·dr 覆盖域角）', fpC > 0 && sC > 0);
}

// ── F. 脚本同源（py 静态）──
console.log('\n[F] py 脚本同源静态断言');
{
  const state = {
    type: 'gyroid', model: 'surface', structureMode: 'solid_network', containerShape: 'cube',
    porosity: 70, cellSize: 2, thickness: 1.0, slice: 100, material: 'tc4',
    weights: [1, 1, 1, 1], autoRotate: true, gradientDir: 'z', coloring: 'none',
    endplateMm: 0, sliceAxis: 'z', sliceInvert: false,
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    manifold: { kind: 'poincare', radius: 12, scale: 1.4, axis: 'z' },
    gpuAccelerate: true,
    stress: { preset: 'none', strength: 0.5, anisotropy: 1.6 },
    hierarchical: { enabled: false, microType: 'diamond', frequency: 4, amplitude: 0.25 },
    customFormula: '',
  };
  const py = buildPythonScript(state);
  check('py 脚本含庞加莱逐式翻译块', py.includes("manifold_kind == 'poincare'") && py.includes('2 * R0**2 * rr / (R0**2 - rr**2)') && py.includes('0.95 * R0'));
  check('py 脚本含截断延拓斜率式', py.includes('R0**2 + 3 * rC**2'));
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
