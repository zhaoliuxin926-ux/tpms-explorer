// 条件匹配版 DT/FEA 对照（2026-11-01 Codex b 项"成带前须匹配条件"的执行）：
//   几何 k2（R=24 体素=2 周期×12 格/周期，对齐幂律标定 k2）/ σy/E=0.0275（示例 PLA 55/2000，
//   对齐幂律材料口径）/ 应力窗=平台段 20%~40% 应变（对齐 ISO 幂律窗口）。
// 目的：把 DT/FEA 参照比从"固定 R6 算例回归容差"升级为条件匹配带。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const entry = join(process.env.TEMP ?? '/tmp', 'dtmatch_entry.ts');
writeFileSync(entry, `export { runCompressionDigitalTwin } from ${JSON.stringify(join(PLATFORM, 'src/physics/digital-twin-compression.ts'))};`);
const out = join(process.env.TEMP ?? '/tmp', 'dtmatch_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 失败:', r.stdout, r.stderr); process.exit(1); }
const dt = await import('file:///' + out.split('\\').join('/'));

// k2 gyroid 体素化（R=24 全域体素=2 周期×12 格/周期；与 audit 的 R6 同实现扩域）
function voxelizeGyroid(R, targetSolid) {
  const mm = (2 * Math.PI * 2) / R;   // k2：全域 4π
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

const SY_E = 0.0275;   // 示例 PLA 55/2000（对齐幂律标定材料口径）
for (const P of [0.6, 0.65]) {
  const solid = voxelizeGyroid(12, 1 - P);
  const res = dt.runCompressionDigitalTwin({
    R: 12, solid, porosity: P, sigmaYRatio: SY_E, hardening: 0.05,
    steps: 32, maxStrain: 0.40, tol: 1e-5, type: 'gyroid',
    failureStrain: 1.0,   // 关断单元生死（初版漏传：缺省 0.06 触发早期坍塌，20-40% 平台窗不可达）
  });
  const conv = res.allConverged ? 'conv' : `坍塌@${res.collapseStrain?.toFixed(3) ?? '首步'}`;
  console.log(`P=${P} k2R12 refPred=${res.gaPrediction.toFixed(5)} dtRatio=${Number.isFinite(res.dtRatio) ? res.dtRatio.toFixed(5) : 'NaN'} DT/FEA=${Number.isFinite(res.calibrationRatio) ? res.calibrationRatio.toFixed(3) : 'NaN'} ${conv}`);
}
