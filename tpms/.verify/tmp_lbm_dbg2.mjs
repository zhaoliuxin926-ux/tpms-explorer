import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'lbm2_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'lbm2_entry.ts');
writeFileSync(entry, `export { solveLBMPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveLBMPermeability } = await import(pathToFileURL(BUNDLE).href);
const R = 16;
const solid = new Uint8Array(R ** 3);
for (let iz = 6; iz <= 11; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
  solid[ix + iy * R + iz * R * R] = 1;   // 中部厚板，通道 gap=5（iz 0..5）
}
const res = solveLBMPermeability({ R, solid, maxSteps: 300, bodyForce: 1e-4, tol: 1e-5 });
console.log('plate channel: kappa', res.kappaLU, 'meanUz', res.meanUz, 'steps', res.steps, 'conv', res.converged);
console.log('analytic: kappa = H^3/(12*H_full)·... 简化 gap=5, H_total=16: k = gap^3/(12·R) =', (125 / (12 * 16)).toFixed(4));
