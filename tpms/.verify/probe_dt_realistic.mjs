/**
 * probe_dt_realistic.mjs —— 压溃卡真实掩码求解域探针（独立，不进 CI）
 *
 * 背景：门 28 voxelizeGyroid 用 w=(i+0.5)·2π/R（全域一周期=6 采样/周期），UI
 * voxelizeCurrentTPMS 用 kk 周期映射——k=3 R=8 仅 2.7 采样/周期，NR 首步即不收敛
 * （2026-09-20 走查实证）。本探针扫 (R, k, porosity) 网格找 UI 语义下的可解域。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

function bundle(exportLines, name) {
  const entry = join(tmpdir(), `dtprobe_${name}_entry.ts`);
  writeFileSync(entry, exportLines.join('\n'));
  const out = join(tmpdir(), `dtprobe_${name}_bundle.mjs`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在'); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 失败:', r.stderr); process.exit(1); }
  return out;
}

const dt = await import(pathToFileURL(bundle([
  `export { runCompressionDigitalTwin } from ${JSON.stringify(join(PLATFORM, 'src/physics/digital-twin-compression.ts'))};`,
], 'dt')));

// UI 语义体素化（main.ts voxelizeCurrentTPMS 镜像：kk 周期 + 分位 iso + 边界连通剪除）
function voxelizeUI(R, kk, porosityPct) {
  const V = new Float64Array(R * R * R);
  for (let iz = 0; iz < R; iz++) { const wz = kk * (-Math.PI + 2 * Math.PI * (iz + 0.5) / R);
    for (let iy = 0; iy < R; iy++) { const wy = kk * (-Math.PI + 2 * Math.PI * (iy + 0.5) / R);
      for (let ix = 0; ix < R; ix++) { const wx = kk * (-Math.PI + 2 * Math.PI * (ix + 0.5) / R);
        V[ix + iy * R + iz * R * R] = Math.sin(wx) * Math.cos(wy) + Math.sin(wy) * Math.cos(wz) + Math.sin(wz) * Math.cos(wx);
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
  [8, 1, 75, 8, 0.04], [8, 1, 75, 6, 0.025], [8, 1, 75, 5, 0.02], [8, 1, 75, 12, 0.03],
  [8, 1, 65, 6, 0.025], [8, 1, 60, 8, 0.04],
];
for (const [R, kk, p, steps, maxStrain] of cases) {
  const { solid, pruned } = voxelizeUI(R, kk, p);
  const t0 = Date.now();
  try {
    const res = dt.runCompressionDigitalTwin({ R, solid, porosity: p / 100, sigmaYRatio: 0.008, failureStrain: 0.02, hardening: 0.05, steps, maxStrain, tol: 1e-5 });
    const ms = Date.now() - t0;
    console.log(`R=${R} k=${kk} p=${p}% steps=${steps} maxStr=${maxStrain} pruned=${pruned} → ${res.allConverged ? '全步收敛 ✓' : '坍塌@' + (res.collapseStrain ?? '首步')} · ${ms}ms · σpl=${Number.isFinite(res.plateauStress) ? res.plateauStress.toExponential(2) : '—'} · DT/GA=${Number.isFinite(res.calibrationRatio) ? res.calibrationRatio.toFixed(2) : '—'}`);
  } catch (e) {
    console.log(`R=${R} k=${kk} p=${p}% steps=${steps} → 抛错: ${e.message} · ${Date.now() - t0}ms`);
  }
}
