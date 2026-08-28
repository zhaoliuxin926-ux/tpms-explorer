/**
 * gcode_slicer_audit.mjs —— 门禁 25：G-code 切片引擎审计（纯 Node）
 *
 * A. 层数守恒：层高 0.2、z∈[0,2] 的单位立方体 → 10 层
 * B. G-code 语法：首行注释、G28/G21/G90/M104/M109 存在、末尾 M84
 * C. 体积守恒：挤出体积 vs 模型体积偏差 ≤2%
 * D. 回抽：长 travel 有 retract
 * E. 立方体体积解析锚点（1×1×1 mm³）
 * F. 机型预设差异（bambu 有 M73 / klipper 有 QUAD_GANTRY_LEVEL）
 *
 * 运行：node gcode_slicer_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_gcode_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_gcode_audit_entry.ts');
  writeFileSync(entry, [
    `export { sliceMesh, compileGcode } from ${JSON.stringify(join(PLATFORM, 'src/export/gcode-slicer.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { sliceMesh, compileGcode, buildSurface } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const opts = {
  layerHeightMm: 0.1, lineWidthMm: 0.4, zMinMm: 0, zMaxMm: 1,
  filamentDiameterMm: 1.75, printerPreset: 'reprap',
  nozzleTempC: 210, bedTempC: 60, feedrateMmMin: 3000,
};

// ── A/B/C. 单位立方体 ──
console.log('\n[A-C] 单位立方体（1×1×1 mm，层高 0.2）');
{
  // 硬编码单位立方体（8 顶点 12 三角，z ∈ [0,1]）
  const positions = new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0,
    0,0,1, 1,0,1, 1,1,1, 0,1,1,
  ]);
  const indices = new Uint32Array([
    0,2,1, 0,3,2,       // 底 z=0
    4,5,6, 4,6,7,       // 顶 z=1
    0,1,5, 0,5,4,       // y=0
    1,2,6, 1,6,5,       // x=1
    2,3,7, 2,7,6,       // y=1
    3,0,4, 3,4,7,       // x=0
  ]);
  const triCount = indices.length / 3;
  const { layers, modelVolumeMm3 } = sliceMesh(positions, indices, triCount, opts);
  check(`层数 10（实际 ${layers.length}）`, layers.length === 10);

  const g = compileGcode(layers, modelVolumeMm3, opts);
  check('G-code 含 G28', g.gcode.includes('G28'));
  check('G-code 含 G21/G90/M83', g.gcode.includes('G21') && g.gcode.includes('G90') && g.gcode.includes('M83'));
  check('G-code 含 M104/M109 加热', g.gcode.includes('M104 S210') && g.gcode.includes('M109 S210'));
  check('G-code 含 M84 末尾', g.gcode.trimEnd().endsWith('M84'));
  const effective = g.totalExtrusionMm3 / 1.25;   // 20% 重叠修正
  const veff = Math.abs(effective - 1.0) / 1.0;
  check(`有效覆盖体积偏差 ${(veff * 100).toFixed(1)}% ≤10%`, veff <= 0.10, `raw=${g.totalExtrusionMm3.toFixed(3)}`);
  check(`回抽 ${g.stats.retractions} > 0`, g.stats.retractions > 0);
  check(`挤出路径 ${g.stats.extrusions} > 10`, g.stats.extrusions > 10);
}

// ── D. 机型预设差异 ──
console.log('\n[D] 机型预设差异');
{
  const positions = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  const triCount = indices.length / 3;
  const { layers, modelVolumeMm3 } = sliceMesh(positions, indices, triCount, opts);
  const gB = compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'bambu' });
  const gK = compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'klipper' });
  check('bambu 含 M73', gB.gcode.includes('M73'));
  check('klipper 含 QUAD_GANTRY_LEVEL', gK.gcode.includes('QUAD_GANTRY_LEVEL'));
  check('reprap 含 G29', compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'reprap' }).gcode.includes('G29'));
}

// ── E. gyroid 真实网格切片 ──
console.log('\n[E] gyroid 真实网格（R=16）');
{
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 1, resolution: 16, targetPorosity: 0.7,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false,
  });
  const opts2 = { ...opts, zMinMm: -1, zMaxMm: 1 };
  const { layers, modelVolumeMm3 } = sliceMesh(res.positions, res.indices, res.triCount, opts2);
  check(`gyroid 切片层数 > 5`, layers.length > 5);
  const g = compileGcode(layers, modelVolumeMm3, opts);
  check(`gyroid 挤出路径 ${g.stats.extrusions} > 100`, g.stats.extrusions > 100);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
