import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'lbm3_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'lbm3_entry.ts');
writeFileSync(entry, `export { solveLBMPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveLBMPermeability } = await import(pathToFileURL(BUNDLE).href);
// 极简：全流体无固相，1 步，检查分布是否有限
const R = 8;
const solid = new Uint8Array(R ** 3);
const res = solveLBMPermeability({ R, solid, maxSteps: 1, bodyForce: 1e-4, tol: 1e-4 });
console.log('1-step empty: meanUz', res.meanUz, 'kappa', res.kappaLU, 'NaN?', Number.isNaN(res.meanUz));
const res2 = solveLBMPermeability({ R, solid, maxSteps: 5, bodyForce: 1e-4 });
console.log('5-step empty: meanUz', res2.meanUz, 'NaN?', Number.isNaN(res2.meanUz));

const solid2 = new Uint8Array(R ** 3);
for (let iz = 6; iz <= 11; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) solid2[ix + iy * R + iz * R * R] = 1;
for (const ms of [50, 100, 150, 200, 250, 300]) {
  const res = solveLBMPermeability({ R, solid: solid2, maxSteps: ms, bodyForce: 1e-4, tol: 1e-5 });
  console.log('plate maxSteps=' + ms + ': meanUz', res.meanUz.toExponential(3), 'NaN?', Number.isNaN(res.meanUz));
}
