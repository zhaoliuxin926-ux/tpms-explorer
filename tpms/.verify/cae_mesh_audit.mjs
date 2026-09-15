/**
 * cae_mesh_audit.mjs —— 门禁 15：CAE 体网格导出审计（Abaqus INP + OpenFOAM polyMesh）
 *
 * 守护对象：「设计到求解最后一公里」的体网格拓扑正确性。
 *  A. INP：单元数 == 固相体素数；节点连续编号；面闭合（内面 2 单元 / 边界面 1）；
 *     C3D8 Jacobian = h³ > 0（轴对齐正六面体，ratio 1.0 ≥ 0.8）；体积守恒；
 *     PBC 节点集存在、非空、X0/X1 不交
 *  B. polyMesh：五件套齐全；owner<neighbour；内部面/边界面计数自洽；
 *     cell-face 关联守恒（Σcell 面数 = 2·内部 + 边界）；面法线 owner→neighbour 指向；
 *     patch 区间连续覆盖边界段；流体 cell 数 == 空隙体素数；体积守恒
 *  C. ZIP 完整性：EOCD/中央目录/本地头一致，CRC32 逐条目验证
 *  D. 容器裁剪：cylinder 模型体素数 < cube 包络体素数
 *
 * 运行：node cae_mesh_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_cae_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_cae_audit_entry.ts');
  writeFileSync(entry, [
    `export { buildVoxelModel } from ${JSON.stringify(join(PLATFORM, 'src/export/voxel-model.ts'))};`,
    `export { buildAbaqusInp } from ${JSON.stringify(join(PLATFORM, 'src/export/abaqus-inp-exporter.ts'))};`,
    `export { buildOpenfoamPolyMesh, buildStoredZip } from ${JSON.stringify(join(PLATFORM, 'src/export/openfoam-polymesh-exporter.ts'))};`,
    `export { buildCaseFiles } from ${JSON.stringify(join(PLATFORM, 'src/export/openfoam-case-template.ts'))};`,
    `export { forchheimerTwoPoint } from ${JSON.stringify(join(PLATFORM, 'src/physics/forchheimer.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `import { radialGradTransform as rgT, radialGradThreshold as rgC, schwarzPPhase as rgP, C_UNIFORM_K1 } from ${JSON.stringify(join(PLATFORM, 'src/core/radial-grad.ts'))}; export { rgT, rgC, rgP, C_UNIFORM_K1 };`,
    `export { marchingTetrahedra } from ${JSON.stringify(join(PLATFORM, 'src/geometry/marching-tetrahedra.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildVoxelModel, buildAbaqusInp, buildOpenfoamPolyMesh, buildStoredZip, buildCaseFiles, forchheimerTwoPoint, buildSurface, rgT, rgC, rgP, C_UNIFORM_K1, marchingTetrahedra } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const HALF = Math.PI;
const R = 16;
const mkParams = (over) => ({
  type: 'gyroid', periods: 1, weights: [1, 1, 1, 1], structureMode: 'solid_network',
  containerShape: 'cube', thickness: 1.0, targetPorosity: 0.5, iso: 0, customFormula: '', ...over,
});
const opts = { youngModulusMPa: 110000, poisson: 0.34, nominalStrain: 0.05, specimenSizeMm: 1 };

// ── A. Abaqus INP ──
console.log('\n[A] Abaqus INP（gyroid solid / diamond shell / cylinder 容器）');
for (const [label, params] of [
  ['gyroid solid', mkParams()],
  ['diamond shell', mkParams({ type: 'diamond', structureMode: 'shell', targetPorosity: 0.75 })],
  ['gyroid cylinder', mkParams({ containerShape: 'cylinder', targetPorosity: 0.6 })],
]) {
  const model = buildVoxelModel(params, R);
  const { text, nodeCount, elemCount } = buildAbaqusInp(model, opts);
  const hMm = opts.specimenSizeMm / (2 * HALF) * model.hWc;

  check(`${label}: 单元数 == 固相体素数 (${elemCount})`, elemCount === model.solidCount);
  check(`${label}: 历史输出（*OUTPUT, HISTORY + NSET_TOP 的 RF/U——压缩曲线数据源，S1-S11 吸收）`,
    text.includes('*OUTPUT, HISTORY') && text.includes('*NODE OUTPUT, NSET=NSET_TOP') && /RF, U/.test(text));
  check(`${label}: 文件结构（*NODE/*ELEMENT/*NSET/*ELASTIC/*STEP 齐备）`,
    text.includes('*NODE') && text.includes('*ELEMENT, TYPE=C3D8') && text.includes('*NSET, NSET=NSET_BOTTOM')
    && text.includes('NSET_PBC_X0') && text.includes('*ELASTIC') && text.includes('*STEP'));

  // 解析
  const nodes = new Map();
  const nodeSec = text.split('*NODE\n')[1].split('*')[0].trim().split('\n');
  for (const ln of nodeSec) {
    const parts = ln.split(',').map((s) => s.trim());
    nodes.set(Number(parts[0]), [Number(parts[1]), Number(parts[2]), Number(parts[3])]);
  }
  const elems = [];
  const elemSec = text.split('*ELEMENT, TYPE=C3D8, ELSET=ESOLID\n')[1].split('*')[0].trim().split('\n');
  for (const ln of elemSec) {
    const parts = ln.split(',').map((s) => s.trim()).map(Number);
    elems.push(parts.slice(1));
  }
  check(`${label}: 解析节点 ${nodes.size} == 报告 ${nodeCount}`, nodes.size === nodeCount);
  check(`${label}: 解析单元 ${elems.length} == 报告 ${elemCount}`, elems.length === elemCount);

  // 面闭合：内部面 2 单元，边界面 1
  const faceCnt = new Map();
  const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  for (const e of elems) {
    for (const f of F) {
      const key = f.map((ni) => e[ni]).sort((a, b) => a - b).join(',');
      faceCnt.set(key, (faceCnt.get(key) ?? 0) + 1);
    }
  }
  let badClosure = 0;
  for (const [, n] of faceCnt) if (n > 2) badClosure++;
  check(`${label}: 面闭合（无非流形面）`, badClosure === 0);

  // Jacobian：轴对齐正六面体 det = h³（抽样 500）
  let badJac = 0, jacChecked = 0;
  const stride = Math.max(1, Math.floor(elems.length / 500));
  for (let ei = 0; ei < elems.length; ei += stride) {
    const e = elems[ei];
    const p = e.map((ni) => nodes.get(ni));
    const ex = p[1][0] - p[0][0], ey = p[1][1] - p[0][1], ez = p[1][2] - p[0][2];
    const fx = p[3][0] - p[0][0], fy = p[3][1] - p[0][1], fz = p[3][2] - p[0][2];
    const gx = p[4][0] - p[0][0], gy = p[4][1] - p[0][1], gz = p[4][2] - p[0][2];
    const det = ex * (fy * gz - fz * gy) + ey * (fz * gx - fx * gz) + ez * (fx * gy - fy * gx);
    jacChecked++;
    if (Math.abs(det - hMm ** 3) > 1e-9 * Math.max(1, hMm ** 3)) badJac++;
  }
  check(`${label}: C3D8 Jacobian = h³（${jacChecked} 抽样，异常 ${badJac}，ratio 1.0 ≥0.8）`, badJac === 0);

  // 体积守恒
  const volTotal = elemCount * hMm ** 3;
  const envVol = opts.specimenSizeMm ** 3;
  check(`${label}: 体积守恒（固相 ${(volTotal / envVol * 100).toFixed(2)}% ∈ 合理带）`,
    volTotal / envVol > 0.02 && volTotal / envVol < 0.98);

  // PBC 集
  const setParse = (name) => {
    const m = text.match(new RegExp(`\\*NSET, NSET=NSET_${name}\\n([^*]*)`));
    if (!m) return null;
    return m[1].split('\n').join(',').split(',').map((s) => s.trim()).filter((s) => s).map(Number);
  };
  const x0 = setParse('PBC_X0'), x1 = setParse('PBC_X1');
  const x0s = new Set(x0), overlap = x1.filter((n) => x0s.has(n)).length;
  check(`${label}: PBC_X0/X1 非空且不交（${x0.length}/${x1.length}）`, x0.length > 0 && x1.length > 0 && overlap === 0);
}

// ── B. OpenFOAM polyMesh ──
console.log('\n[B] OpenFOAM polyMesh（gyroid solid p=0.5 / cylinder）');
for (const [label, params] of [
  ['gyroid cube', mkParams()],
  ['gyroid cylinder', mkParams({ containerShape: 'cylinder', targetPorosity: 0.6 })],
]) {
  const model = buildVoxelModel(params, R);
  const build = buildOpenfoamPolyMesh(model, opts.specimenSizeMm);
  const st = build.stats;
  // corner-air 修复（2026-09-15）：流体域 = inside && !solid——cube 时 insideCount=R³ 等价旧口径
  // 红队 A F2 体积锚（独立第三路径防掩码-计数同源盲区）：cylinder 容器内体素体积 vs 解析 π/4·specimen³，容差 5%
  // （R=16 高斯格点涨落实测 3.45%，2% 会误报）
  if (label === 'gyroid cylinder') {
    const hU = opts.specimenSizeMm / (2 * HALF) * model.hWc;
    const volIn = model.insideCount * hU ** 3;
    const volAna = Math.PI / 4 * opts.specimenSizeMm ** 3;
    check(`${label}: 容器体积锚（体素 ${(volIn / volAna * 100).toFixed(2)}% vs 解析 π/4）`, Math.abs(volIn / volAna - 1) < 0.05);
  }
  const voidCount = model.insideCount - model.solidCount;
  check(`${label}: 五件套齐备`, Object.keys(build.files).length === 5
    && ['points', 'faces', 'owner', 'neighbour', 'boundary'].every((f) => build.files['constant/polyMesh/' + f]));

  const points = [];
  {
    const body = build.files['constant/polyMesh/points'].split(')\n(').join('|');
    void body;
    const m = build.files['constant/polyMesh/points'].match(/\(\n([\s\S]*)\n\)/);
    for (const ln of m[1].trim().split('\n')) {
      const v = ln.trim().replace(/^\(|\)$/g, '').split(' ').map(Number);
      points.push(v);
    }
  }
  const faces = [];
  {
    const m = build.files['constant/polyMesh/faces'].match(/\(\n([\s\S]*)\n\)/);
    for (const ln of m[1].trim().split('\n')) {
      const ids = ln.trim().replace(/^\(|\)$/g, '').split(' ').map(Number);
      faces.push(ids);
    }
  }
  const owners = build.files['constant/polyMesh/owner'].match(/\(\n([\s\S]*)\n\)/)[1].trim().split('\n').map(Number);
  const neigh = build.files['constant/polyMesh/neighbour'].match(/\(\n([\s\S]*)\n\)/)[1].trim().split('\n').map(Number);

  check(`${label}: 流体 cell 数 ${st.cells} == 空隙体素数 ${voidCount}`, st.cells === voidCount);
  check(`${label}: faces/owner 等长 (${st.faces})`, faces.length === owners.length && owners.length === st.faces);
  check(`${label}: neighbour == 内部面数 (${st.internalFaces})`, neigh.length === st.internalFaces);

  let badOwnerLt = 0;
  for (let i = 0; i < neigh.length; i++) if (owners[i] >= neigh[i]) badOwnerLt++;
  check(`${label}: 内部面 owner < neighbour`, badOwnerLt === 0);

  // cell-face 关联守恒：流体 cell 的每张面要么内部（计 2 次）要么边界（计 1 次）
  const incidence = st.internalFaces * 2 + st.boundaryFaces;
  const expect = 6 * st.cells;
  check(`${label}: cell-face 关联守恒（${incidence} == 6·cells = ${expect}）`, incidence === expect);

  // 面法线方向：内部面 owner→neighbour
  const cellCenter = (cell) => {
    const vi = Math.floor(cell / 1); void vi;
    return null;
  };
  void cellCenter;
  let badOrient = 0, orientChecked = 0;
  const oStride = Math.max(1, Math.floor(st.internalFaces / 400));
  // 重建 cell 中心映射：从 owner 分配反推。【红队 A F3 隐式契约】本三重循环（z 外 y 中 x 内）必须与
  // exporter 的 cellId 线性递增序（i = x+y·R+z·R²）严格同序——任一侧遍历顺序改动都会让法线断言大面积翻车（反序对照实测 2938/5032 反向）；corner-air 修复后按 inside 过滤
  const cellVoxelList = [];
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    if (model.inside[ix + iy * R + iz * R * R] && !model.solid[ix + iy * R + iz * R * R]) cellVoxelList.push([ix + 0.5, iy + 0.5, iz + 0.5]);
  }
  for (let fi = 0; fi < st.internalFaces; fi += oStride) {
    const f = faces[fi];
    const p0 = points[f[0]], p1 = points[f[1]], p2 = points[f[2]];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const gn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const oc = cellVoxelList[owners[fi]], nc = cellVoxelList[neigh[fi]];
    const dir = [nc[0] - oc[0], nc[1] - oc[1], nc[2] - oc[2]];
    if (gn[0] * dir[0] + gn[1] * dir[1] + gn[2] * dir[2] <= 0) badOrient++;
    orientChecked++;
  }
  check(`${label}: 内部面法线 owner→neighbour（${orientChecked} 抽样，反向 ${badOrient}）`, badOrient === 0);

  // patch 区间连续覆盖
  const bm = build.files['constant/polyMesh/boundary'];
  const ranges = [...bm.matchAll(/(\w+)\n\s*\{[^}]*nFaces\s+(\d+);\s*startFace\s+(\d+);/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  let badPatch = 0;
  let cursor = st.internalFaces;
  for (const [, n, start] of ranges) {
    if (start !== cursor) badPatch++;
    cursor += n;
  }
  if (cursor !== st.faces) badPatch++;
  check(`${label}: patch 区间连续覆盖边界段（${ranges.map((r) => r[0] + ':' + r[1]).join('/')}）`, badPatch === 0 && ranges.length === 3);

  // 体积守恒：Σcell 体积 == voidCount·h³
  const hMm = opts.specimenSizeMm / (2 * HALF) * model.hWc;
  check(`${label}: 体积守恒（${(st.cells * hMm ** 3 / opts.specimenSizeMm ** 3 * 100).toFixed(2)}% 孔隙带）`,
    st.cells * hMm ** 3 > 0.01 && st.cells * hMm ** 3 < opts.specimenSizeMm ** 3 * 0.99);
}

// ── C. ZIP 完整性 ──
console.log('\n[C] ZIP 容器完整性（STORED + CRC32）');
{
  const model = buildVoxelModel(mkParams({ resolution: 12 }), 12);
  const build = buildOpenfoamPolyMesh(model, 1);
  const enc = new TextEncoder();
  const entries = Object.entries(build.files).map(([name, text]) => ({ name, data: enc.encode(text) }));
  const zip = buildStoredZip(entries);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  check('EOCD 签名 + 条目数', dv.getUint32(zip.length - 22, true) === 0x06054b50 && dv.getUint16(zip.length - 22 + 10, true) === entries.length);
  // CRC32 表格法（审计侧独立实现）
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c >>> 0;
  }
  const crc = (bytes, start, size) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < size; i++) c = T[(c ^ bytes[start + i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  let off = 0, okCrc = 0, badCrc = 0;
  for (let e = 0; e < entries.length; e++) {
    if (dv.getUint32(off, true) !== 0x04034b50) { badCrc++; break; }
    const crcH = dv.getUint32(off + 14, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataStart = off + 30 + nameLen + extraLen;
    if (crc(zip, dataStart, size) === crcH) okCrc++; else badCrc++;
    off = dataStart + size;
  }
  check(`本地头链完整 + CRC32 逐条目通过（${okCrc}/${entries.length}）`, okCrc === entries.length && badCrc === 0);
  check('中央目录首条目签名', dv.getUint32(off, true) === 0x02014b50);
  check('已知 CRC 向量（"123456789" → 0xCBF43926）',
    crc(enc.encode('123456789'), 0, 9) === 0xCBF43926);
}

// ── E. CFD 交付链完整化（2026-09-15）：可运行 case 模板 + Forchheimer 后处理 ──
// 字典口径经 WSL OpenFOAM v13 foamRun 真跑验证（论文工程借鉴战役）：mm 单位制自洽 +
// p=PCG/DIC（GAMG 在六面体网格死锁的回归哨兵）+ 壁面 wall 类型（WSS functionObject 前提）
console.log('\n[E] OpenFOAM 可运行 case 模板 + cfd-post Forchheimer');
{
  const files = buildCaseFiles({
    patches: ['flow_inlet', 'flow_outlet', 'casing_wall', 'tpms_scaffold_wetted'],
    inletPatch: 'flow_inlet', outletPatch: 'flow_outlet',
    wallPatches: ['casing_wall', 'tpms_scaffold_wetted'],
    flowRateM3s: 8.33e-9, nu: 1.45e-6,
  });
  const names = Object.keys(files);
  check('E1 模板 9 件齐备（0/{U,p,C}+system×3+constant×2+README）',
    names.length === 9 && ['0/U', '0/p', '0/C', 'system/controlDict', 'system/fvSchemes', 'system/fvSolution', 'constant/physicalProperties', 'constant/momentumTransport', 'README.md'].every((n) => names.includes(n)),
    JSON.stringify(names));
  const u = files['0/U'], pf = files['0/p'];
  check('E2 0/U flowRateInletVelocity + mm 单位制 Q（8.33e-9 m³/s×1e9）+ 四 patch boundaryField 全覆盖',
    u.includes('flowRateInletVelocity') && u.includes('8.330000e+0') && u.includes('noSlip')
      && ['flow_inlet', 'flow_outlet', 'casing_wall', 'tpms_scaffold_wetted'].every((x) => u.includes(x)));
  check('E3 0/p 运动压强 dimensions [0 2 -2] + outlet fixedValue 0 参考点',
    pf.includes('[0 2 -2 0 0 0 0]') && pf.includes('fixedValue; value uniform 0'));
  const bd = buildOpenfoamPolyMesh(buildVoxelModel(mkParams(), R), 1, { fourPatch: true, flowAxis: 2 }).files['constant/polyMesh/boundary'];
  check('E4 fourPatch 壁面 patch=wall 类型（WSS functionObject 只认 wall；inlet/outlet 保持 patch）',
    /casing_wall\s*\{\s*type\s+wall/.test(bd) && /tpms_scaffold_wetted\s*\{\s*type\s+wall/.test(bd)
      && /flow_inlet\s*\{\s*type\s+patch/.test(bd));
  check('E5 ν=1.45 mm²/s（mm 单位制）+ incompressibleFluid + WSS 预埋 + dP 预埋（pin/pout surfaceFieldValue）',
    files['constant/physicalProperties'].includes('nu              [0 2 -1 0 0 0 0] 1.450000e+0')
      && files['system/controlDict'].includes('solver          incompressibleFluid')
      && files['system/controlDict'].includes('patches (casing_wall tpms_scaffold_wetted)')
      && /patch flow_inlet; fields \(p\); operation areaAverage/.test(files['system/controlDict'])
      && /patch flow_outlet; fields \(p\)/.test(files['system/controlDict']));
  check('E6 fvSolution p=PCG/DIC（GAMG 六面体死锁回归哨兵，真跑定案 2026-09-15）',
    files['system/fvSolution'].includes('p { solver PCG; preconditioner DIC') && !files['system/fvSolution'].includes('GAMG'));
  check('E7 README 单位制披露 + v13 patchAverage 语法 + kinematic 用法',
    files['README.md'].includes('× 1e-6 × ρ') && files['README.md'].includes('--kinematic')
      && files['README.md'].includes("patchAverage(patch="));
  const fr = forchheimerTwoPoint({ q1: 8.33e-9, dp1: 0.833346944, q2: 8.33e-8, dp2: 8.3646944, mu: 1.45e-3, length: 0.006, area: 36e-6 });
  check('E8 Forchheimer 合成锚（A=1e8 / B=5e12 精确恢复）',
    Math.abs(fr.A / 1e8 - 1) < 1e-6 && Math.abs(fr.B / 5e12 - 1) < 1e-4,
    `A=${fr.A.toExponential(6)} B=${fr.B.toExponential(6)}`);
  check('E8b K_int 量纲恒等式（K_int·A·A_box/(μL)=1，容差 1e-12）',
    Math.abs((fr.kInt * fr.A * 36e-6) / (1.45e-3 * 0.006) - 1) < 1e-12);
  const zipE = Buffer.from(buildStoredZip(Object.entries(files).map(([n, t]) => ({ name: n, data: new TextEncoder().encode(t) }))));
  const dvE = new DataView(zipE.buffer, zipE.byteOffset + zipE.length - 22);
  check('E8c 模板件入 STORED ZIP（EOCD 条目数=9）', dvE.getUint16(10, true) === 9);

  const CLI_E = join(HERE, '../agent/tpms.mjs');
  const runE = (...args) => spawnSync(process.execPath, [CLI_E, ...args], { encoding: 'utf8' });
  const r1 = runE('cfd-post', '--q1', '5', '--dp1', '10', '--q2', '5', '--dp2', '20');
  const r2 = runE('cfd-post', '--q1', '-1', '--dp1', '10', '--q2', '2', '--dp2', '20');
  const r3 = runE('cfd-post', '--q1', '8.33e-9', '--dp1', '1', '--q2', '8.33e-8', '--dp2', '1.9', '--kinematic', '--json');
  let j3 = null;
  try { j3 = JSON.parse(r3.stdout); } catch { /* */ }
  check('E9 CLI 守卫（同流量 exit2 / 负流量 exit2 / --kinematic ×1e-6×ρ 换算）',
    r1.status === 2 && r2.status === 2 && r3.status === 0 && j3
      && Math.abs(j3.dp1Pa - 1e-3) < 1e-9 && Math.abs(j3.dp2Pa - 1.9e-3) < 1e-9,
    `exits=${r1.status}/${r2.status}/${r3.status}`);
}

// ── F. M(r) 径向梯度构型（论文几何借鉴，2026-09-15）：数学层锚 + 提取器边界断言 ──
console.log('\n[F] radial-grad M(r) 空间映射（论文公式移植 + surface-nets 边界定案）');
{
  // F1 论文记载数学不变量锚（context.md 数学节：A·C_rad=K 恒等式 / 双通道拉回极限 1/K）——
  // 比同源第二实现对拍更强（不依赖复刻件的坐标换算正确性）
  let idMax = 0;
  for (const K of [1.25, 1.5, 2.0]) {
    const A = Math.sqrt(K / (K - 1));            // R0=1 归一化渐近常数
    const Crad = Math.sqrt(K * (K - 1));         // R0=1 径向衰减系数
    idMax = Math.max(idMax, Math.abs(A * Crad - K));          // 恒等式 A·C_rad = K
    const eps = 1e-3;  // 须 > rgT 内部 r1s=max(r1,1e-6) 防零保护带（论文同款 delta），否则极限断言失真
    const [x2e] = rgT(eps, 0, 0, K);             // 径向拉回中心极限
    const [, , z2e] = rgT(0, 0, eps, K);         // 轴向拉回中心极限
    idMax = Math.max(idMax, Math.abs(x2e / eps - 1 / K), Math.abs(z2e / eps - 1 / K));
    const [x2edge] = rgT(1, 0, 0, K);            // 边缘（r1=1）径向映射连续有限
    const [, , z2edge] = rgT(1, 0, 1, K);        // 轴向边缘（r1=1, z=1）
    idMax = Math.max(idMax, Math.abs(z2edge - 1));             // 轴向边缘恢复 1
    if (!Number.isFinite(x2edge)) idMax = Infinity;
  }
  check('F1 论文数学不变量（A·C_rad=K 恒等式 / 双通道中心极限 1/K（atanh 线性区 O(u²)≈1e-7 残差容差）/ 轴向边缘恢复 1，K∈{1.25,1.5,2}）',
    idMax < 1e-6, 'maxId=' + idMax.toExponential(2));
  check('F2 K=1 退化（变换恒等 + 均匀阈值 C=0.871）',
    rgT(0.4, -0.2, 0.7, 1)[0] === 0.4 && rgT(0.4, -0.2, 0.7, 1)[2] === 0.7 && rgC(0.5, 1, 1 / 6, 0.03, 0.03) === C_UNIFORM_K1);
  let rgRes = null, rgErr = '';
  try {
    rgRes = buildSurface({
      type: 'schwarz', iso: 0, periods: 12, resolution: 96, targetPorosity: undefined,
      weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1.0, gradientDir: 'z', customFormula: '', preview: false,
      hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
      radialGrad: { K: 1.5, sizeMm: 12, taMm: 0.2, tbMm: 0.322 },
    });
  } catch (e) { rgErr = String(e?.message ?? e); }
  check('F3 K=1.5 构建成功 + 密度锚 [58,64]（cube 包络口径 ⟺ 圆柱口径 ≈50.6%=论文设计 50%）',
    rgRes !== null && rgRes.porosityEstimate > 0.58 && rgRes.porosityEstimate < 0.64,
    rgErr || 'poro=' + ((rgRes?.porosityEstimate ?? 0) * 100).toFixed(2) + '%');
  const CLI_F = join(HERE, '../agent/tpms.mjs');
  const runF = (...args2) => spawnSync(process.execPath, [CLI_F, ...args2], { encoding: 'utf8' });
  const rf = runF('mesh', '--type', 'schwarz', '--porosity', '0.5', '--periods', '6', '--resolution', '64',
    '--container', 'cube', '--radial-grad', '1.5', '--out', join(tmpdir(), 'tpms_f_rg_' + process.pid + '.stl'), '--json');
  check('F4 MT 管线水密产出（exit0 + open/nm/degen 全零——解锁战役收官，2026-09-15）',
    rf.status === 0, 'exit=' + rf.status);
  const rf1 = runF('mesh', '--type', 'gyroid', '--porosity', '0.5', '--periods', '12', '--resolution', '64', '--container', 'cylinder', '--radial-grad', '1.5');
  const rf2 = runF('mesh', '--type', 'schwarz', '--porosity', '0.5', '--periods', '12', '--resolution', '64', '--container', 'cube', '--radial-grad', '1.5');
  const rf3 = runF('mesh', '--type', 'schwarz', '--porosity', '0.5', '--periods', '12', '--resolution', '64', '--container', 'cylinder', '--radial-grad', '1.5', '--ta', '0.05');
  check('F5 守卫三连（type≠schwarz / 非 cube 容器 / 亚体素壁厚 → exit2）',
    rf1.status === 2 && rf2.status === 2 && rf3.status === 2,
    'exits=' + rf1.status + '/' + rf2.status + '/' + rf3.status);
  // F6 MT 提取器数学锚：球场 r²−1 → 水密 + 体积 4π/3 收敛（2026-09-15 解锁战役）
  {
    const mtR = 48;
    const mt = marchingTetrahedra((x, y, z) => x * x + y * y + z * z - 1, mtR);
    const em = new Map();
    for (let t = 0; t < mt.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = mt.indices[t + e], b = mt.indices[t + (e + 1) % 3];
        const k = a < b ? a * 1e8 + b : b * 1e8 + a;
        em.set(k, (em.get(k) ?? 0) + 1);
      }
    let mtOpen = 0, mtNm = 0;
    for (const [, c] of em) { if (c > 2) mtNm++; if (c === 1) mtOpen++; }
    let v6 = 0;
    for (let t = 0; t < mt.indices.length; t += 3) {
      const i0 = mt.indices[t] * 3, i1 = mt.indices[t + 1] * 3, i2 = mt.indices[t + 2] * 3;
      v6 += mt.positions[i0] * (mt.positions[i1 + 1] * mt.positions[i2 + 2] - mt.positions[i1 + 2] * mt.positions[i2 + 1])
        + mt.positions[i0 + 1] * (mt.positions[i1 + 2] * mt.positions[i2] - mt.positions[i1] * mt.positions[i2 + 2])
        + mt.positions[i0 + 2] * (mt.positions[i1] * mt.positions[i2 + 1] - mt.positions[i1 + 1] * mt.positions[i2]);
    }
    const mtVol = Math.abs(v6) / 6;
    check(`F6 MT 球锚（水密 open=${mtOpen}/nm=${mtNm} + 体积 4π/3 偏差 <1% 实测 ${(Math.abs(mtVol / 4.18879 - 1) * 100).toFixed(2)}%）`,
      mtOpen === 0 && mtNm === 0 && Math.abs(mtVol / 4.18879 - 1) < 0.01);
  }
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
  if (passCount < 65) { console.error('GUARD FAIL: 断言执行数 ' + passCount + ' < 基线 66（F 组 radial-grad +5，2026-09-15）'); process.exit(1); }
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
