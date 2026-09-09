/**
 * r128_tolerance_probe.mjs —— R128 档位容差标定探针（独立运行，不进 CI 调度）
 *
 * 背景：mesh_audit 官方容差矩阵（体积 6% / 倍频 12% / 梯度壳 18%；nm 相对边数
 * 0.2% / 倍频 0.8%）的标定域为 k≤5 / R≤96。R128 档位 2026-09-09 起在 CLI/schema
 * 开放（RES_CAP_HD=128、BufferPool 2.5M），但容差属外推使用——本探针用与 mesh_audit
 * 同款 harness（buildSurface 源码 bundle + 连续公式 MC 参照 + 同一 auditMesh 语义）
 * 在 R128 档位实测各代表族的缺陷率与体积偏差，产出标定数据表，为「容差矩阵外推至
 * R128 是否成立」提供官方依据。
 *
 * 判读（信息性，非门禁）：
 *  - 各案例按 mesh_audit 同款相对容差规则判定 PASS/EXCEED；
 *  - EXCEED = 该族在 R128 需要独立容差档位或可用域声明（登记后再定）。
 *
 * 运行：node r128_tolerance_probe.mjs [--json out.json]   （R128 案例约 4~8 分钟）
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// 与 mesh_audit 同款：rolldown 打当前 TS 源码（bundle 名加 pid 防并行冲突）
const BUNDLE = join(tmpdir(), `tpms_r128_probe_bundle_${process.pid}.mjs`);
{
  const entry = join(tmpdir(), `tpms_r128_probe_entry_${process.pid}.ts`);
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

/** 连续公式 MC 固相分数（与 mesh_audit.continuousSolidFraction 同源语义） */
function continuousSolidFraction(tc, isoUsed, samples = 1_200_000) {
  const k = tc.k;
  const half = Math.PI;
  const w = tc.weights ?? [1, 1, 1, 1];
  const fn = getTpmsFunction(tc.type, '');
  const grad = tc.mode === 'gradient_shell';
  let solid = 0, inside = 0;
  let seed = 123456789;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let s = 0; s < samples; s++) {
    const px = rnd() * 2 - 1, py = rnd() * 2 - 1, pz = rnd() * 2 - 1;
    const bound = Math.max(Math.abs(px) - 1, Math.max(Math.abs(py) - 1, Math.abs(pz) - 1));
    if (bound >= 0) continue;
    inside++;
    const mx = px * half * k, my = py * half * k, mz = pz * half * k;
    const v = fn(mx, my, mz, w);
    let f;
    if (tc.mode === 'solid_network') f = isoUsed - v;
    else if (grad) {
      const scale = tc.gradientDir === 'z' ? 1.5 - (pz + 1) * 0.5 : 1.0;
      f = v * v - (isoUsed * scale) * (isoUsed * scale);
    } else f = v * v - isoUsed * isoUsed;
    if (f > 0) solid++;
  }
  return inside > 0 ? solid / inside : 0;
}

/** 拓扑审计（与 mesh_audit.auditMesh 同语义，只取本探针需要的字段） */
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

// ── R128 标定矩阵：官方案例族的 R128 档位代表（k≤5 标定域内）──
// 类别映射 mesh_audit 容差档：default（6%/0.2%nm）/ tol2k（12%/0.8%nm）/ shell 走 default
const CASES = [
  { name: 'gyroid solid75 k1 R128', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 1, R: 128 },
  { name: 'gyroid solid75 k2 R128', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 2, R: 128 },
  { name: 'gyroid solid75 k3 R128', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 3, R: 128 },
  { name: 'gyroid solid75 k5 R128', type: 'gyroid', mode: 'solid_network', p: 0.75, k: 5, R: 128 },
  { name: 'diamond solid75 k3 R128', type: 'diamond', mode: 'solid_network', p: 0.75, k: 3, R: 128 },
  { name: 'schwarz shell70 k3 R128', type: 'schwarz', mode: 'shell', p: 0.70, k: 3, R: 128 },
  { name: 'gyroid gradshell z75 k3 R128', type: 'gyroid', mode: 'gradient_shell', p: 0.75, k: 3, R: 128, gradientDir: 'z' },
  { name: 'neovius solid75 k3 R128(倍频)', type: 'neovius', mode: 'solid_network', p: 0.75, k: 3, R: 128, tol2k: true },
  { name: 'iwp solid75 k3 R128(倍频)', type: 'iwp', mode: 'solid_network', p: 0.75, k: 3, R: 128, tol2k: true },
  { name: 'frd solid75 k3 R128(倍频)', type: 'frd', mode: 'solid_network', p: 0.75, k: 3, R: 128, tol2k: true },
  { name: 'lidinoid solid75 k2 R128', type: 'lidinoid', mode: 'solid_network', p: 0.75, k: 2, R: 128 },
  { name: 'splitp solid75 k2 R128', type: 'splitp', mode: 'solid_network', p: 0.75, k: 2, R: 128 },
];

const results = [];
let exceed = 0;
for (const tc of CASES) {
  const t0 = Date.now();
  const params = {
    type: tc.type, iso: 0, periods: tc.k, resolution: tc.R, targetPorosity: tc.p,
    weights: tc.weights ?? [1, 1, 1, 1], structureMode: tc.mode, containerShape: 'cube',
    thickness: 1.0, gradientDir: tc.gradientDir ?? 'z',
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
  // mesh_audit 同款相对容差规则外推至 R128
  const edgeTotal = a.triCount * 3;
  const volTol = tc.tol2k ? 0.12 : 0.06;
  const nmTol = tc.tol2k ? Math.max(256, edgeTotal * 0.008) : Math.max(256, edgeTotal * 0.002);
  const misTol = Math.max(256, edgeTotal * 0.004);
  const ok = a.openEdges === 0 && a.degenTris === 0 && a.nonManifoldEdges <= nmTol
    && a.misorientedEdges <= misTol && Math.abs(volRelErr) < volTol;
  if (!ok) exceed++;
  results.push({ ...tc, ...a, volRelErr, wallMs, ok });
  console.log(
    `${ok ? 'PASS ' : 'EXCEED'} ${tc.name}: tris=${a.triCount} 开放=${a.openEdges} 非流形=${a.nonManifoldEdges}(阈${nmTol}) 定向错=${a.misorientedEdges}(阈${misTol}) 退化=${a.degenTris} 体积偏差=${(volRelErr * 100).toFixed(2)}%(阈±${volTol * 100}%) ${wallMs}ms`
  );
}

const jsonIdx = process.argv.indexOf('--json');
const outJson = jsonIdx > -1 ? process.argv[jsonIdx + 1] : join(HERE, 'r128_tolerance_table.json');
writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), domain: 'R128', cases: results }, null, 1));
console.log(`\nJSON 已写 ${outJson}`);
console.log(exceed === 0
  ? '=== R128 标定结论：全部案例在 mesh_audit 相对容差规则外推下 PASS——容差矩阵标定域可正式延伸至 R128（k≤5）==='
  : `=== R128 标定结论：${exceed} 案例超出外推容差——需独立档位或可用域声明（登记后另议）===`);
