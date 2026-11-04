// Q2 排障诊断探针（2026-11-04）：R12 快速复现台 + onPcgDiag 埋点数据采集。
// 判别目标（Gemini 判读清单）："坍塌"=PCG 失 SPD 保护中断 vs Newton 线搜索失败 vs 单元翻转。
// 用法：node tpms/.verify/probe_dt_q2_diag.mjs [R=12] [P=0.6]
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const R = Number(process.argv[2] ?? 12);
const P = Number(process.argv[3] ?? 0.6);

const entry = join(process.env.TEMP ?? '/tmp', 'q2diag_entry.ts');
writeFileSync(entry, `export { runCompressionDigitalTwin } from ${JSON.stringify(join(PLATFORM, 'src/physics/digital-twin-compression.ts'))};`);
const out = join(process.env.TEMP ?? '/tmp', 'q2diag_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 失败:', r.stdout, r.stderr); process.exit(1); }
const dt = await import('file:///' + out.split('\\').join('/'));

function voxelizeGyroid(RR, targetSolid) {
  const mm = (2 * Math.PI * 2) / RR;
  const tp = (x, y, z) => Math.sin(x * mm) * Math.cos(y * mm) + Math.sin(y * mm) * Math.cos(z * mm) + Math.sin(z * mm) * Math.cos(x * mm);
  const V = new Float64Array(RR * RR * RR);
  for (let iz = 0; iz < RR; iz++) for (let iy = 0; iy < RR; iy++) for (let ix = 0; ix < RR; ix++)
    V[ix + iy * RR + iz * RR * RR] = tp(ix + 0.5, iy + 0.5, iz + 0.5);
  const sorted = Float64Array.from(V).sort();
  const iso = sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(targetSolid * sorted.length)))];
  const solid = new Uint8Array(RR * RR * RR);
  for (let i = 0; i < V.length; i++) solid[i] = V[i] < iso ? 1 : 0;
  return solid;
}

// 诊断采集：崩溃前的 pApMin / detFMin / PCG 迭代数轨迹（最后 12 条 + 全部异常条）
const diags = [];
const onPcgDiag = (d) => diags.push(d);
let solid = voxelizeGyroid(R, 1 - P);
// 悬臂剔除（Gemini 修复③：共享面<2 的体素迭代剔除到不动点——近机构源头）
if (process.argv.includes('--prune')) {
  const NB = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let removed = 0, pass = 0;
  for (;;) {
    let changed = false; pass++;
    for (let k = 0; k < R; k++) for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const v = i + j * R + k * R * R;
      if (!solid[v]) continue;
      let c = 0;
      for (const [di, dj, dk] of NB) {
        const ni = i + di, nj = j + dj, nk = k + dk;
        if (ni >= 0 && ni < R && nj >= 0 && nj < R && nk >= 0 && nk < R && solid[ni + nj * R + nk * R * R]) c++;
      }
      if (c < 2) { solid[v] = 0; removed++; changed = true; }
    }
    if (!changed) break;
  }
  console.log(`[prune] 剔除悬臂/孤岛体素 ${removed} 个（${pass} 轮不动点）`);
}
const t0 = Date.now();
const res = dt.runCompressionDigitalTwin({
  R, solid, porosity: P, sigmaYRatio: 0.0275, hardening: 0.05,
  steps: 32, maxStrain: 0.40, tol: 1e-5, type: 'gyroid', failureStrain: 1.0,
  onPcgDiag,
});
console.log(`R=${R} P=${P} conv=${res.allConverged} collapse@${res.collapseStrain} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(`诊断条数 ${diags.length}；最后 12 条（step/newton/pcgIters/pApMin/detFMin）:`);
for (const d of diags.slice(-12)) {
  console.log(`  s${d.step} nr${d.newtonIter} pcg=${d.pcgIters} pApMin=${d.pApMin.toExponential(3)} detFMin=${d.detFMin.toFixed(4)}${d.converged ? '' : ' [PCG未达tol]'}`);
}
// 异常特征扫描：pApMin≤0 或 detF<0.5 或 pcg 打满
const flags = diags.filter(d => !(d.pApMin > 0) || d.detFMin < 0.5 || d.pcgIters >= 2900);
console.log(`异常条 ${flags.length} 条；首条：`, flags[0] ? `s${flags[0].step} nr${flags[0].newtonIter} pApMin=${flags[0].pApMin.toExponential(3)} detF=${flags[0].detFMin.toFixed(4)}` : '无');
// pApMin 与 detFMin 的全程最小
let mp = Infinity, md = Infinity;
for (const d of diags) { if (d.pApMin < mp) mp = d.pApMin; if (d.detFMin < md) md = d.detFMin; }
console.log(`全程 min pApMin=${mp.toExponential(3)}  min detFMin=${md.toFixed(4)}`);
