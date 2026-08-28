import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'darcy_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'darcy_entry.ts');
writeFileSync(entry, `export { solveDarcyPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveDarcyPermeability } = await import(pathToFileURL(BUNDLE).href);
// 解析锚点：单一直通道（z 向贯穿，截面 1 体素）κ = L·A_ch/(A_total)·(1/1)…
const R = 12;
const solid = new Uint8Array(R ** 3);
for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
  const centerTube = ix === 6 && iy === 6;
  if (!centerTube) solid[ix + iy * R + iz * R * R] = 1;
}
const res = solveDarcyPermeability({ R, solid, tol: 1e-10, maxIter: 20000 });
console.log('single tube: kappaLU', res.kappaLU.toFixed(5), 'iters', res.iters, 'conv', res.converged, `${res.elapsedMs.toFixed(0)}ms`);
// 解析：管内压降线性 dp/dz = −1/(R−1)；Q = k_tube·A_tube·|dp/dz|，κ_eff = Q·L/A_total
// k_tube = 1（同介质），A_tube = 1，L = R−1，A_total = R² → κ_eff = 1·1·(R−1)/R² /(1) = 11/144
console.log('analytic κ_eff =', ((R - 1) / (R * R)).toFixed(5));
