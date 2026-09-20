/**
 * probe_dt_tangent.mjs —— 压溃「步2必败」根因判别（独立，不进 CI）
 *
 * 反常签名：步1任意大小收敛、步2任意大小发散（手风琴子步至 1/256 仍败）。
 * 假设：默认 tangent='geo'（弹性+几何刚度）在细长体素骨架上过了临界屈曲应变后
 * 切线失去 SPD——子步长无关的失稳=数值屈曲（可能是真实物理的离散化呈现）。
 * 判别矩阵：elastic 切线对照（SPD 保证不屈曲）× 分辨率敏感性（屈曲应变随 R 漂移=离散伪影）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

function bundle(exportLines, name) {
  const entry = join(tmpdir(), `dttan_${name}_entry.ts`);
  writeFileSync(entry, exportLines.join('\n'));
  const out = join(tmpdir(), `dttan_${name}_bundle.mjs`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在'); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 失败:', r.stderr); process.exit(1); }
  return out;
}

const mod = await import(pathToFileURL(bundle([
  `export { solvePlasticityCompression } from ${JSON.stringify(join(PLATFORM, 'src/physics/gpu-plasticity-solver.ts'))};`,
  `export { getTpmsFunction } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
  `export { runCompressionDigitalTwin } from ${JSON.stringify(join(PLATFORM, 'src/physics/digital-twin-compression.ts'))};`,
], 'tan')));

const subLog = [];
(globalThis).__plasSubDbg = (s) => subLog.push(s);
let nanEvt = null;
let lsLog = [];
(globalThis).__plasLsDbg = (d) => { if (lsLog.length < 6) lsLog.push(d); };
(globalThis).__plasNaNDbg = (sGoal, U, Ut, fint, nDof) => {
  if (nanEvt) return;
  const stat = (a) => { let nan = 0, inf = 0, mx = 0; for (let i = 0; i < nDof; i++) { const v = a[i]; if (Number.isNaN(v)) nan++; else if (!Number.isFinite(v)) inf++; else mx = Math.max(mx, Math.abs(v)); } return { nan, inf, mx: +mx.toFixed(4) }; };
  nanEvt = { sGoal, U: stat(U), Utrial: stat(Ut), fint: stat(fint) };
};

function voxelizeUI(R, kk, porosityPct, useLookup = false) {
  const V = new Float64Array(R * R * R);
  for (let iz = 0; iz < R; iz++) { const wz = kk * (-Math.PI + 2 * Math.PI * (iz + 0.5) / R);
    for (let iy = 0; iy < R; iy++) { const wy = kk * (-Math.PI + 2 * Math.PI * (iy + 0.5) / R);
      for (let ix = 0; ix < R; ix++) { const wx = kk * (-Math.PI + 2 * Math.PI * (ix + 0.5) / R);
        V[ix + iy * R + iz * R * R] = useLookup ? mod.getTpmsFunction('gyroid', '').call(null, wx, wy, wz, [1, 1, 1]) : Math.sin(wx) * Math.cos(wy) + Math.sin(wy) * Math.cos(wz) + Math.sin(wz) * Math.cos(wx);
  }}}
  const sorted = Float64Array.from(V).sort();
  const targetSolid = Math.max(0.02, Math.min(0.98, 1 - porosityPct / 100));
  const iso = sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(targetSolid * sorted.length)))];
  const solid = new Uint8Array(R * R * R);
  for (let i = 0; i < V.length; i++) solid[i] = V[i] < iso ? 1 : 0;
  const seen = new Uint8Array(R * R * R), queue = new Int32Array(R * R * R);
  let head = 0, tail = 0;
  const push = v => { if (!seen[v] && solid[v]) { seen[v] = 1; queue[tail++] = v; } };
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++)
    if (ix === 0 || ix === R - 1 || iy === 0 || iy === R - 1 || iz === 0 || iz === R - 1) push(ix + iy * R + iz * R * R);
  while (head < tail) { const v = queue[head++]; const vx = v % R, vy = ((v / R) | 0) % R, vz = (v / (R * R)) | 0;
    if (vx > 0) push(v - 1); if (vx < R - 1) push(v + 1); if (vy > 0) push(v - R); if (vy < R - 1) push(v + R); if (vz > 0) push(v - R * R); if (vz < R - 1) push(v + R * R);
  }
  let pruned = 0;
  for (let i = 0; i < V.length; i++) if (solid[i] && !seen[i]) { solid[i] = 0; pruned++; }
  return { solid, pruned };
}

const cases = [
  { tag: 'p75-k1-R8-ELASTIC', R: 8, k: 1, p: 75, tangent: 'elastic' },
  { tag: 'p75-k1-R8-GEO',     R: 8, k: 1, p: 75, tangent: 'geo' },
  { tag: 'p75-k1-R8-ELASTIC-紧PCG', R: 8, k: 1, p: 75, tangent: 'elastic', pcgTol: 1e-10, pcgMaxIter: 30000, maxIter: 200 },
  { tag: 'p75-k3-R8-GEO-UI默认', R: 8, k: 3, p: 75, tangent: 'geo' },
  { tag: 'p75-k1-R8-GEO-查表掩码', R: 8, k: 1, p: 75, tangent: 'geo', useLookup: true },
  { tag: 'p75-k1-R8-Wrapper全链', R: 8, k: 1, p: 75, wrapper: true },
  { tag: 'p65-k1-R8-Wrapper全链', R: 8, k: 1, p: 65, wrapper: true },
];
for (const c of cases) {
  lsLog = [];
  const { solid, pruned } = voxelizeUI(c.R, c.k, c.p, c.useLookup);
  const t0 = Date.now();
  subLog.length = 0;
  try {
    if (c.wrapper) {
      const res = mod.runCompressionDigitalTwin({ R: c.R, solid, porosity: c.p / 100, sigmaYRatio: 0.008, failureStrain: 0.02, hardening: 0.05, steps: 8, maxStrain: 0.04, tol: 1e-5 });
      console.log(`[${c.tag}] pruned=${pruned} ${Date.now() - t0}ms allConv=${res.allConverged} 坍塌@${res.collapseStrain ?? 'null'} σpl=${Number.isFinite(res.plateauStress) ? res.plateauStress.toExponential(3) : '—'} DT/GA=${Number.isFinite(res.calibrationRatio) ? res.calibrationRatio.toFixed(2) : '—'} dead=${res.totalDead}`);
      continue;
    }
    const res = mod.solvePlasticityCompression({ R: c.R, solid, nu: 0.3, sigmaY: 0.008, hardening: 0.05, steps: 8, maxStrain: 0.04, tol: 1e-5, maxIter: c.maxIter ?? 40, pcgTol: c.pcgTol ?? 1e-6, pcgMaxIter: c.pcgMaxIter ?? 3000, tangent: c.tangent });
    const steps = res.steps.map(s => `ε=${s.strain.toFixed(4)}${s.converged ? '✓' : '✗'}F=${Number.isFinite(s.reaction) ? s.reaction.toExponential(2) : '?'}it=${s.iterations}`).join(' ');
    console.log(`[${c.tag}] pruned=${pruned} ${Date.now() - t0}ms allConv=${res.allConverged} :: ${steps}`);
    if (subLog.length) console.log(`   子步: ${subLog.slice(-4).join(' | ')}`);
    if (lsLog.length) console.log('   LS失败: ' + lsLog.map(d => `s=${d.sGoal.toExponential(3)} r0=${d.rNorm0.toExponential(3)} fS=${d.fScale.toExponential(3)} pcgIt=${d.pcgIt}/${d.pcgMaxIter} pcgT=${d.pcgT.toExponential(2)}`).join(' ; '));
    if (nanEvt) console.log(`   NaN事件: sGoal=${nanEvt.sGoal.toExponential(4)} U=${JSON.stringify(nanEvt.U)} Utrial=${JSON.stringify(nanEvt.Utrial)} fint=${JSON.stringify(nanEvt.fint)}`);
  } catch (e) {
    console.log(`[${c.tag}] pruned=${pruned} 抛错: ${e.message} ${Date.now() - t0}ms`);
  }
}
