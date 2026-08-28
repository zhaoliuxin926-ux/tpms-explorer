import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'ke_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'ke_entry.ts');
writeFileSync(entry, `export { buildElementKe } from ${JSON.stringify(join(PLATFORM, 'src/physics/micro-fea-solver.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { buildElementKe } = await import(pathToFileURL(BUNDLE).href);
const Ke = buildElementKe(0.2);
let mx = 0, nz = 0;
for (let i = 0; i < 576; i++) { const a = Math.abs(Ke[i]); if (a > 0) nz++; if (a > mx) mx = a; }
console.log('Ke nonzero:', nz, '/576 max:', mx.toExponential(3));
console.log('Ke[0][0..7]:', [0,1,2,3,4,5,6,7].map(j => Ke[j].toFixed(4)).join(','));
