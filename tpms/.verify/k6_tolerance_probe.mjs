/**
 * k6_tolerance_probe.mjs —— k=6 档位容差标定探针（独立运行，不进 CI 调度）
 *
 * 背景：官方容差矩阵标定域为 k≤5（R128 已于 2026-09-10 标定收官），k=6（CLI
 * 默认周期数）从未正式标定——已知锚点：CLI periods=6 raw miso R48 2.90% 超容差、
 * R96 0.55% PASS（bugs.md 登记先例）。本探针在 R{96,128} × k=6 实测代表族，
 * 为「k=6 是否可纳入标定域」提供数据。
 *
 * 判读（信息性，非门禁）：同 mesh_audit 相对容差规则（6%/12% 倍频、0.2%nm、
 * 0.4% 定向）。
 *
 * 运行：node k6_tolerance_probe.mjs   （约 3~5 分钟）
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), `tpms_k6_probe_bundle_${process.pid}.mjs`);
{
  const entry = join(tmpdir(), `tpms_k6_probe_entry_${process.pid}.ts`);
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/core/units.ts:wcToMmFactor',
    'src/core/tpms-functions.ts:getTpmsFunction',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, wcToMmFactor, getTpmsFunction } = await import(pathToFileURL(BUNDLE));

function continuousSolidFraction(tc, isoUsed, samples = 1_200_000) {
  const k = tc.k;
  const half = Math.PI;
  const fn = getTpmsFunction(tc.type, '');
  let solid = 0, inside = 0;
  let seed = 123456789;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let s = 0; s < samples; s++) {
    const px = rnd() * 2 - 1, py = rnd() * 2 - 1, pz = rnd() * 2 - 1;
    if (Math.max(Math.abs(px) - 1, Math.max(Math.abs(py) - 1, Math.abs(pz) - 1)) >= 0) continue;
    inside++;
    const v = fn(px * half * k, py * half * k, pz * half * k, [1, 1, 1, 1]);
    const f = tc.mode === 'shell' ? v * v - isoUsed * isoUsed : isoUsed - v;
    if (f > 0) solid++;
  }
  return inside > 0 ? solid / inside : 0;
}

function auditMesh(positions, indices) {
  const triCount = indices.length / 3 | 0;
  let maxVert = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > maxVert) maxVert = indices[i];
  const KEY_MUL = maxVert + 1;
  const edgeOut = new Map();
  let degenTris = 0;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a === b || b === c || a === c) { degenTris++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? u * KEY_MUL + v : v * KEY_MUL + u;
      let rec = edgeOut.get(k);
      if (!rec) { rec = [0, 0]; edgeOut.set(k, rec); }
      if (u < v) rec[0]++; else rec[1]++;
    }
  }
  let openEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0;
  for (const [, [ab, ba]] of edgeOut) {
    const total = ab + ba;
    if (total === 1) openEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (ab === 0 || ba === 0) misorientedEdges++;
  }
  let vol6 = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  return { triCount, degenTris, openEdges, nonManifoldEdges, misorientedEdges, signedVol: vol6 / 6 };
}

// k=6 标定矩阵：含 R48 历史锚点复测（miso 2.90% 先例）
const CASES = [
  { name: 'gyroid solid75 k6 R48(历史锚点)', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 6, R: 48 },
  { name: 'gyroid solid75 k6 R96', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 6, R: 96 },
  { name: 'gyroid solid75 k6 R128', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 6, R: 128 },
  { name: 'diamond solid75 k6 R96', type: 'diamond', mode: 'solid_network', p: 0.75, k: 6, R: 96 },
  { name: 'diamond solid75 k6 R128', type: 'diamond', mode: 'solid_network', p: 0.75, k: 6, R: 128 },
  { name: 'schwarz shell70 k6 R96', type: 'schwarz', mode: 'shell', p: 0.70, k: 6, R: 96 },
  { name: 'schwarz shell70 k6 R128', type: 'schwarz', mode: 'shell', p: 0.70, k: 6, R: 128 },
  { name: 'lidinoid solid75 k6 R96', type: 'lidinoid', mode: 'solid_network', p: 0.75, k: 6, R: 96 },
  { name: 'lidinoid solid75 k6 R128', type: 'lidinoid', mode: 'solid_network', p: 0.75, k: 6, R: 128 },
  { name: 'splitp solid75 k6 R96', type: 'splitp', mode: 'solid_network', p: 0.75, k: 6, R: 96 },
  { name: 'splitp solid75 k6 R128', type: 'splitp', mode: 'solid_network', p: 0.75, k: 6, R: 128 },
];

const results = [];
let exceed = 0;
for (const tc of CASES) {
  const t0 = Date.now();
  const params = {
    type: tc.type, iso: 0, periods: tc.k, resolution: tc.R, targetPorosity: tc.p,
    weights: [1, 1, 1, 1], structureMode: tc.mode, containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  };
  globalBufferPool.reset();
  let res = null, threw = null;
  try { res = buildSurface(params, globalBufferPool); } catch (e) { threw = e; }
  const wallMs = Date.now() - t0;
  if (threw) {
    results.push({ ...tc, threw: threw.message, wallMs });
    console.log(`${tc.name}: 抛错『${threw.message}』 ${wallMs}ms`);
    exceed++;
    continue;
  }
  const a = auditMesh(res.positions, res.indices);
  const mm3 = Math.pow(wcToMmFactor(tc.k), 3);
  const meshVolMm3 = Math.abs(a.signedVol) * mm3;
  const contFrac = continuousSolidFraction(tc, res.isoUsed);
  const expectedSolid = contFrac * res.envelopeVolume;
  const volRelErr = expectedSolid > 0 ? (meshVolMm3 - expectedSolid) / expectedSolid : NaN;
  const edgeTotal = a.triCount * 3;
  const volTol = 0.06;
  const nmTol = Math.max(256, edgeTotal * 0.002);
  const misTol = Math.max(256, edgeTotal * 0.004);
  const ok = a.openEdges === 0 && a.degenTris === 0 && a.nonManifoldEdges <= nmTol
    && a.misorientedEdges <= misTol && Math.abs(volRelErr) < volTol;
  if (!ok) exceed++;
  results.push({ ...tc, ...a, volRelErr, wallMs, ok });
  console.log(
    `${ok ? 'PASS ' : 'EXCEED'} ${tc.name}: tris=${a.triCount} 开放=${a.openEdges} 非流形=${a.nonManifoldEdges}(阈${nmTol}) 定向错=${a.misorientedEdges}(阈${misTol},${(a.misorientedEdges / edgeTotal * 100).toFixed(2)}%E) 退化=${a.degenTris} 体积偏差=${(volRelErr * 100).toFixed(2)}% ${wallMs}ms`
  );
}

writeFileSync(join(HERE, 'k6_tolerance_table.json'), JSON.stringify({ generatedAt: new Date().toISOString(), domain: 'k=6', cases: results }, null, 1));
console.log(`\nJSON 已写 ${join(HERE, 'k6_tolerance_table.json')}`);
console.log(exceed === 0
  ? '=== k=6 标定结论：全部在外推容差内——标定域可延伸至 k=6 ==='
  : `=== k=6 标定结论：${exceed} 案例超阈——k=6 维持非标定域（如实登记）===`);
