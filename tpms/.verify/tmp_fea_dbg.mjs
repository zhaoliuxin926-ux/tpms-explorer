import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'fea_dbg_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'fea_dbg_entry.ts');
writeFileSync(entry, `export { solveMicroFEA } from ${JSON.stringify(join(PLATFORM, 'src/physics/micro-fea-solver.ts'))};\nexport { getTpmsFunction } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveMicroFEA, getTpmsFunction } = await import(pathToFileURL(BUNDLE).href);
const logs = [];
globalThis.__feaDbg = (msg) => logs.push(msg);
function voxelGyroid(R, w) {
  const solid = new Uint8Array(R ** 3);
  const tpm = getTpmsFunction('gyroid', '', { k: 1, t: 1, iso: 0 });
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const x = ((ix + 0.5) / R) * 2 * Math.PI - Math.PI;
    const y = ((iy + 0.5) / R) * 2 * Math.PI - Math.PI;
    const z = ((iz + 0.5) / R) * 2 * Math.PI - Math.PI;
    if (tpm(x, y, z, [1, 1, 1, 1]) < -w) solid[ix + iy * R + iz * R * R] = 1;
  }
  return solid;
}
const solid = voxelGyroid(20, -0.55);
const res = solveMicroFEA({ R: 20, solid, nu: 0.2, tol: 1e-6, maxIter: 600 });
for (const m of logs) console.log(m);
console.log('C44', res.C[3][3].toFixed(4), 'C11', res.C[0][0].toFixed(4));
