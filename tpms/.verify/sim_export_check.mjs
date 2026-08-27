/**
 * sim_export_check.mjs —— 仿真导出与曲率分析校验（纯 Node，无浏览器）
 *
 * 守护对象：
 *  1. CFD Multi-Patch STL：8 类曲面逐一构建 → 分类断言 inlet/outlet/sides/wall
 *     四区块存在、well-formed（solid/endsolid 配对）且 inlet·outlet·wall 面片 >0
 *  2. 曲率分析健壮性：常规/梯度壳/混合/混叠自定义四类工况下，
 *     mean/gauss 两口径输出全程有限值且落在 [0,1]（对称截断分位数的承诺）
 *
 * 运行：node sim_export_check.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_sim_export_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_sim_export_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/export/stl-exporter.ts:buildMultiSolidSTL',
    'src/geometry/vertex-coloring.ts:computeVertexColors',
    'src/core/units.ts:wcToMmFactor',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, buildMultiSolidSTL, computeVertexColors, wcToMmFactor } =
  await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS', n); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };

function build(type, extra = {}) {
  return buildSurface({
    type, iso: 0, periods: 2, resolution: 41, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', preview: false,
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '',
    ...extra,
  }, (globalBufferPool.reset(), globalBufferPool));
}

/** 解析多 solid ASCII STL → { name: triCount } 与配对完整性 */
function parseMultiSolid(text) {
  const counts = {};
  let current = null;
  let pairsOk = true;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('solid ')) {
      current = t.slice(6).trim();
      if (current in counts) pairsOk = false; // 重复开块
      counts[current] = 0;
    } else if (t === 'endfacet') {
      if (!current) { pairsOk = false; continue; }
      counts[current]++;
    } else if (t.startsWith('endsolid ')) {
      const n = t.slice(9).trim();
      if (n !== current) pairsOk = false;
      current = null;
    }
  }
  if (current !== null) pairsOk = false;
  return { counts, pairsOk };
}

// ── Part 1：8 类曲面 CFD 分块 ──────────────────────────────
const TYPES = [
  ['gyroid', ''], ['diamond', ''], ['schwarz', ''], ['neovius', ''],
  ['iwp', ''], ['frd', ''], ['lidinoid', ''], ['splitp', ''],
];
for (const [type, formula] of TYPES) {
  try {
    const res = build(type, type === 'custom' ? {} : {});
    const text = buildMultiSolidSTL(res.positions, res.indices, wcToMmFactor(2), res.normals);
    const { counts, pairsOk } = parseMultiSolid(text);
    const need = ['inlet', 'outlet', 'sides', 'wall'];
    const missing = need.filter((k) => !(k in counts));
    const empty = ['inlet', 'outlet', 'wall'].filter((k) => counts[k] === 0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const totalTris = Math.floor(res.indices.length / 3);
    if (pairsOk && missing.length === 0 && empty.length === 0 && total === totalTris) {
      ok(`${type}: 四区块齐备 wall=${counts.wall} inlet=${counts.inlet} outlet=${counts.outlet} sides=${counts.sides}`);
    } else {
      bad(`${type}`, JSON.stringify({ missing, empty, pairsOk, total, totalTris }));
    }
  } catch (e) {
    bad(`${type} 异常`, e.message);
  }
}

// ── Part 2：曲率数值健壮性（mean/gauss × 4 工况）──────────────
const baseField = (o) => ({ field: { type: o.type ?? 'gyroid', customFormula: o.customFormula ?? '', weights: o.weights ?? [1, 1, 1, 1], periods: o.periods ?? 3 }, hybrid: o.hybrid, gradientDir: o.gradientDir ?? 'z', mode: o.mode });
const CASES = [
  ['gyroid solid k3 · mean', baseField({ mode: 'mean_curvature' })],
  ['gyroid solid k3 · gauss', baseField({ mode: 'gauss_curvature' })],
  ['gradient radial shell · gauss', { ...baseField({ mode: 'gauss_curvature', gradientDir: 'radial' }), field: { type: 'gyroid', customFormula: '', weights: [1.3, 0.7, 1.1, 1], periods: 3 } }],
  ['hybrid sigmoid diamond · mean', { ...baseField({ mode: 'mean_curvature' }), hybrid: { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 } }],
  ['aliasing sin(x*40) · gauss', baseField({ mode: 'gauss_curvature', type: 'custom', customFormula: 'sin(x*40)*sin(y*40)*sin(z*40)', periods: 5 })],
];

const resC = build('gyroid'); // 借一份顶点坐标（S(x) 仅位置相关）
for (const [name, opts] of CASES) {
  try {
    const colors = computeVertexColors(resC.positions, resC.vertCount, opts);
    let badVal = -1;
    for (let i = 0; i < colors.length; i++) {
      if (!Number.isFinite(colors[i]) || colors[i] < -1e-6 || colors[i] > 1 + 1e-6) { badVal = i; break; }
    }
    badVal < 0 ? ok(`曲率无 NaN/Inf · ${name}`) : bad(`曲率越界 · ${name}`, `idx=${badVal}`);
  } catch (e) {
    bad(`曲率异常 · ${name}`, e.message);
  }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
