// 临时实测：DT/FEA 参照比多点带（ρ̄ 扫描，gyroid type 口径）——定新披露带用
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
function bundle(exportLines, name) {
  const entry = join(tmpdir(), `dtband_${name}_entry.ts`);
  writeFileSync(entry, exportLines.join('\n'));
  const out = join(tmpdir(), `dtband_${name}_bundle.mjs`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 失败:', r.stdout, r.stderr); process.exit(1); }
  return out;
}
const dt = await import(pathToFileURL(bundle([
  `export { runCompressionDigitalTwin } from ${JSON.stringify(join(PLATFORM, 'src/physics/digital-twin-compression.ts'))};`,
], 'band')));

// 同 audit 内部实现（voxelizeGyroid 非平台导出）
function voxelizeGyroid(R, targetSolid) {
  const mm = (2 * Math.PI) / R;
  const tp = (x, y, z) => Math.sin(x * mm) * Math.cos(y * mm) + Math.sin(y * mm) * Math.cos(z * mm) + Math.sin(z * mm) * Math.cos(x * mm);
  const V = new Float64Array(R * R * R);
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++)
    V[ix + iy * R + iz * R * R] = tp(ix + 0.5, iy + 0.5, iz + 0.5);
  const sorted = Float64Array.from(V).sort();
  const iso = sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(targetSolid * sorted.length)))];
  const solid = new Uint8Array(R * R * R);
  for (let i = 0; i < V.length; i++) solid[i] = V[i] < iso ? 1 : 0;
  return solid;
}

for (const P of [0.6, 0.65, 0.75]) {
  const solid = voxelizeGyroid(6, 1 - P);
  const res = dt.runCompressionDigitalTwin({
    R: 6, solid, porosity: P, sigmaYRatio: 0.008, hardening: 0.05, steps: 6, maxStrain: 0.025, tol: 1e-5,
    type: 'gyroid',
  });
  console.log(`P=${P} ρ̄=${(1-P).toFixed(2)} refPred=${res.gaPrediction.toFixed(5)} dtRatio=${Number.isFinite(res.dtRatio) ? res.dtRatio.toFixed(5) : 'NaN'} DT/FEA=${Number.isFinite(res.calibrationRatio) ? res.calibrationRatio.toFixed(3) : 'NaN'} conv=${res.allConverged}`);
}
