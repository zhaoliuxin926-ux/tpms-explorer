import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'fea_min_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'fea_min_entry.ts');
writeFileSync(entry, `export { solveMicroFEA } from ${JSON.stringify(join(PLATFORM, 'src/physics/micro-fea-solver.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveMicroFEA } = await import(pathToFileURL(BUNDLE).href);
// 4³ 全实心
const R = 4;
const solid = new Uint8Array(R ** 3).fill(1);
const res = solveMicroFEA({ R, solid, nu: 0.2, tol: 1e-9, maxIter: 800 });
console.log('full 4^3: C11', res.C[0][0].toFixed(4), 'C44', res.C[3][3].toFixed(4), 'iters', res.iters.join(','), 'conv', res.converged);
// 去掉中心体素
solid[(2) + 2 * R + 2 * R * R] = 0;
for (const [nuv, tol, mi] of [[0.0, 1e-8, 800], [0.2, 1e-6, 2000], [0.0, 1e-6, 2000]]) {
  const res2 = solveMicroFEA({ R, solid, nu: nuv, tol, maxIter: mi });
  console.log('1-hole nu=' + nuv + ' tol=' + tol + ': C11', res2.C[0][0].toFixed(4), 'C44', res2.C[3][3].toFixed(4), 'iters', res2.iters.join(','), 'conv', res2.converged);
}
