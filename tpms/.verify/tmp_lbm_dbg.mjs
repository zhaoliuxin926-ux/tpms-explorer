import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'lbm_dbg_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'lbm_dbg_entry.ts');
writeFileSync(entry, `export { solveLBMPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const { solveLBMPermeability } = await import(pathToFileURL(BUNDLE).href);
// 平板通道（泊肃叶）：z=6 与 z=11 为固相板，gap=4（z 7..10）
const R = 16;
const solid = new Uint8Array(R ** 3);
for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
  if (iz === 6 || iz === 11) solid[ix + iy * RL_OR(RL_dummy) ] = 1;
}
function RL_OR(x) { return x; }
