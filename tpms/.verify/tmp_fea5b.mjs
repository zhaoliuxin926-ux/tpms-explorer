import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'fea5b_bundle.mjs');
if (existsSync(BUNDLE)) unlinkSync(BUNDLE);
const entry = join(tmpdir(), 'fea5b_entry.ts');
writeFileSync(entry, `
export function probeU0(R: number) {
  const N1 = R + 1;
  const nDof = N1 * N1 * N1 * 3;
  const U0 = new Float64Array(6 * nDof);
  for (let iz = 0; iz < N1; iz++) for (let iy = 0; iy < N1; iy++) for (let ix = 0; ix < N1; ix++) {
    const nd = ix + iy * N1 + iz * N1 * N1;
    U0[0 * nDof + nd * 3] = ix;
    U0[1 * nDof + nd * 3 + 1] = iy;
    U0[2 * nDof + nd * 3 + 2] = iz;
    U0[3 * nDof + nd * 3 + 0] = iy;
    U0[4 * nDof + nd * 3 + 1] = iz;
    U0[5 * nDof + nd * 3 + 2] = ix;
  }
  let nz3 = 0;
  for (let i = 3 * nDof; i < 4 * nDof; i++) if (U0[i] !== 0) nz3++;
  return { nz3, nDof, sample: U0[3 * nDof + (2 + 2 * N1) * 3] };
}
`);
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('bundle fail', r.stderr); process.exit(1); }
const mod = await import(pathToFileURL(BUNDLE).href);
console.log(mod.probeU0(8));
