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
// 悬臂剔除（Gemini 修复②升级版：6-连通主干滤波+递归 k-core 剥离——堵三漏网）
if (process.argv.includes('--prune')) {
  const NB = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const at = (i,j,k) => i + j*R + k*R*R;
  const inB = (i,j,k) => i>=0 && i<R && j>=0 && j<R && k>=0 && k<R;
  const nbrs6 = (i,j,k) => { const out=[]; for (const [di,dj,dk] of NB) { const ni=i+di,nj=j+dj,nk=k+dk; if (inB(ni,nj,nk)&&solid[at(ni,nj,nk)]) out.push([ni,nj,nk]); } return out; };
  // 1) 6-连通主分量：BFS 面邻接分量，保留同时连通 z=0 与 z=L 的分量（无则取触 z=0 的最大者）
  const comp = new Int32Array(R*R*R).fill(-1);
  let nComp = 0, main = -1, mainHasL = false;
  for (let v0 = 0; v0 < R*R*R; v0++) {
    if (!solid[v0] || comp[v0] >= 0) continue;
    const cid = nComp++; let has0 = false, hasL = false;
    const stack = [v0]; comp[v0] = cid;
    while (stack.length) {
      const v = stack.pop();
      const i = v % R, j = Math.floor(v / R) % R, k = Math.floor(v / (R*R));
      if (k === 0) has0 = true; if (k === R-1) hasL = true;
      for (const [ni,nj,nk] of nbrs6(i,j,k)) { const nv = at(ni,nj,nk); if (comp[nv] < 0) { comp[nv] = cid; stack.push(nv); } }
    }
    if (has0 && hasL && !mainHasL) { main = cid; mainHasL = true; }
    else if (has0 && main < 0) { main = cid; }   // 无贯通分量时的回退（取首个触底者）
  }
  let rm1 = 0;
  for (let v = 0; v < R*R*R; v++) if (solid[v] && comp[v] !== main) { solid[v] = 0; rm1++; }
  // 2) 递归 k-core 剥离：非加载层 face_count<=1 的死端迭代到不动点（z=0/z=L 加载层豁免）
  let rm2 = 0, pass = 0;
  for (;;) {
    let changed = false; pass++;
    for (let k = 0; k < R; k++) for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const v = at(i,j,k);
      if (!solid[v] || k === 0 || k === R-1) continue;
      if (nbrs6(i,j,k).length < 2) { solid[v] = 0; rm2++; changed = true; }
    }
    if (!changed) break;
  }
  console.log(`[prune v2] 主分量外剔除 ${rm1} + 递归死端剥离 ${rm2}（${pass} 轮）`);
}
const t0 = Date.now();
const res = dt.runCompressionDigitalTwin({
  R, solid, porosity: P, sigmaYRatio: 0.0275, hardening: 0.05,
  steps: 32, maxStrain: 0.40, tol: 1e-5, type: 'gyroid', failureStrain: 1.0,
  onPcgDiag,
});
console.log(`R=${R} P=${P} conv=${res.allConverged} collapse@${res.collapseStrain} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(`诊断条数 ${diags.length}；最后 12 条（step/newton/pcgIters/pApMin/归一化Rayleigh/‖p‖max/detFMin）:`);
for (const d of diags.slice(-12)) {
  const pn = Math.sqrt(d.pNormMax ?? 0);
  const ray = (d.pApMin ?? NaN) / (d.pNormMax || 1);   // 归一化 Rayleigh 商（pAp/p² 近似）
  console.log(`  s${d.step} nr${d.newtonIter} pcg=${d.pcgIters} pApMin=${d.pApMin.toExponential(3)} ray=${ray.toExponential(2)} |p|=${pn.toExponential(2)} detF=${d.detFMin.toFixed(4)}${d.converged ? '' : ' [SPD-break]'}`);
}
// 异常特征扫描：pApMin≤0 或 detF<0.5 或 pcg 打满
const flags = diags.filter(d => !(d.pApMin > 0) || d.detFMin < 0.5 || d.pcgIters >= 2900);
console.log(`异常条 ${flags.length} 条；首条：`, flags[0] ? `s${flags[0].step} nr${flags[0].newtonIter} pApMin=${flags[0].pApMin.toExponential(3)} detF=${flags[0].detFMin.toFixed(4)}` : '无');
// pApMin 与 detFMin 的全程最小
let mp = Infinity, md = Infinity, mpn = 0;
for (const d of diags) { if (d.pApMin < mp) mp = d.pApMin; if (d.detFMin < md) md = d.detFMin; if ((d.pNormMax ?? 0) > mpn) mpn = d.pNormMax; }
console.log(`全程 min pApMin=${mp.toExponential(3)}  min detFMin=${md.toFixed(4)}  max‖p‖²=${mpn.toExponential(3)}`);
// Gemini 预言验证：SPD-break 时 ‖p‖>1e10 且归一化 Rayleigh ≈ 机器零
const brk = diags.find(d => !(d.pApMin > 0));
if (brk) {
  const pn = Math.sqrt(brk.pNormMax ?? 0);
  const ray = brk.pApMin / (brk.pNormMax || 1);
  console.log(`预言验证（SPD-break 条）：‖p‖=${pn.toExponential(2)} ${pn > 1e10 ? '>1e10 ✓' : '<1e10 ✗'}；归一化 Rayleigh=${ray.toExponential(2)} ${Math.abs(ray) < 1e-10 ? '≈机器零 ✓（浮点相消实锤）' : '非机器零 ✗'}`);
}
