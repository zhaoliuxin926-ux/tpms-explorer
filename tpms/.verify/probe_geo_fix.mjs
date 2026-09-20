/**
 * probe_geo_fix.mjs —— geo 切线修复后的可收敛域与活性钉实验（独立，不进 CI）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

function bundle(exportLines, name) {
  const entry = join(tmpdir(), `geofix_${name}_entry.ts`);
  writeFileSync(entry, exportLines.join('\n'));
  const out = join(tmpdir(), `geofix_${name}_bundle.mjs`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在'); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 失败:', r.stderr); process.exit(1); }
  return out;
}

const sol = await import(pathToFileURL(bundle([
  `export { solvePlasticityCompression } from ${JSON.stringify(join(PLATFORM, 'src/physics/gpu-plasticity-solver.ts'))};`,
], 'g')));

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

console.log('== E 域实验：R=6 gyroid 0.35，找 geo 可收敛且迭代数分叉的应变档 ==');
for (const maxStrain of [0.008, 0.012, 0.016, 0.02]) {
  const solid = voxelizeGyroid(6, 0.35);
  const base = { R: 6, solid, nu: 0.3, sigmaY: 0.01, hardening: 0.05, steps: 4, maxStrain, tol: 1e-5 };
  const re = sol.solvePlasticityCompression({ ...base, tangent: 'elastic' });
  const rg = sol.solvePlasticityCompression({ ...base, tangent: 'geo' });
  const itE = re.steps.reduce((a, s) => a + s.iterations, 0);
  const itG = rg.steps.reduce((a, s) => a + s.iterations, 0);
  const fe = re.steps.at(-1)?.reaction ?? NaN;
  const fg = rg.steps.at(-1)?.reaction ?? NaN;
  console.log(`maxStrain=${maxStrain}: elastic conv=${re.allConverged} it=${itE} F=${fe.toExponential(4)} | geo conv=${rg.allConverged} it=${itG} F=${Number.isFinite(fg) ? fg.toExponential(4) : '?'} | itersDiffer=${itE !== itG} | F一致=${Math.abs(fe - fg) / Math.abs(fe) < 0.01}`);
}
console.log('== C 域实验：静水 R=8 全固相默认切线（应已随默认回 elastic 恢复） ==');
{
  const solid = new Uint8Array(8 * 8 * 8).fill(1);
  const res = sol.solvePlasticityCompression({ R: 8, solid, nu: 0.3, sigmaY: 1e9, steps: 4, maxStrain: 0.002, tol: 1e-8, loadMode: 'hydrostatic' });
  console.log('hydrostatic allConverged =', res.allConverged);
}
console.log('== F 域实验：单元生死 R=6 默认切线 ==');
{
  const solid = voxelizeGyroid(6, 0.35);
  const res = sol.solvePlasticityCompression({ R: 6, solid, nu: 0.3, sigmaY: 0.008, hardening: 0.05, steps: 4, maxStrain: 0.02, tol: 1e-5 });
  console.log('death-case allConverged =', res.allConverged);
}
