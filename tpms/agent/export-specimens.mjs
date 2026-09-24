#!/usr/bin/env node
/**
 * export-specimens.mjs — 物理试样矩阵批量导出（6 构型 × 3 重复 = 18，或 --once 单份）
 * 与 PHYSICAL_TESTING_PROTOCOL.md §一 同源。
 *
 * 运行: node tpms/agent/export-specimens.mjs [--out specimens] [--once]
 * 输出: S{i}_{tag}.stl + .json 元数据 + .err（空=成功）
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join(HERE, 'tpms.mjs');

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : 'specimens';
const ONCE = process.argv.includes('--once');

const MATRIX = [
  { id: 'S1_G60', type: 'gyroid', porosity: 0.6 },
  { id: 'S2_G75', type: 'gyroid', porosity: 0.75 },
  { id: 'S3_D60', type: 'diamond', porosity: 0.6 },
  { id: 'S4_D75', type: 'diamond', porosity: 0.75 },
  { id: 'S5_FK60', type: 'fcky', porosity: 0.6 },
  { id: 'S6_FK75', type: 'fcky', porosity: 0.75 },
];
const REPS = ONCE ? [1] : [1, 2, 3];

mkdirSync(join(ROOT, OUT), { recursive: true });
let ok = 0, fail = 0;
for (const m of MATRIX) {
  for (const rep of REPS) {
    const id = ONCE ? m.id : `${m.id}_r${rep}`;
    const stl = join(ROOT, OUT, `${id}.stl`);
    const args = ['mesh', '--type', m.type, '--porosity', String(m.porosity),
      '--resolution', '96', '--periods', '8', '--out', stl, '--json'];
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 300_000 });
    const errPath = join(ROOT, OUT, `${id}.err`);
    const jsonPath = join(ROOT, OUT, `${id}.json`);
    if (r.status === 0) {
      try { writeFileSync(jsonPath, r.stdout ?? '{}', 'utf8'); } catch { /* */ }
      writeFileSync(errPath, '', 'utf8');
      console.log('OK  ', id);
      ok++;
    } else {
      writeFileSync(errPath, (r.stderr || '').slice(-500), 'utf8');
      console.log('FAIL', id, r.status);
      fail++;
    }
  }
}
console.log(`\nEXPORT-SPECIMENS ${ok} ok / ${fail} fail`);
process.exit(fail ? 1 : 0);
