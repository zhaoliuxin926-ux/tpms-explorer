#!/usr/bin/env node
// tpms.mjs —— TPMS Agent CLI（M0：纯数学层，无浏览器依赖）
//
// 定位：专业 Agent 路线的工具层起点——把平台确定性内核暴露为可脚本化命令。
// 诚实边界（继承项目文化）：本层只做材料级数学近似，几何相关指标
//（比表面积/渗透率/孔径）需网格管线，属 M1 范围，此处不臆造。
//
// 用法：
//   node tpms.mjs list
//   node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]
import { loadCore } from './core-loader.mjs';
import { writeFileSync } from 'node:fs';

const BUILTIN_TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const MATERIAL_LABELS = { tc4: 'Ti-6Al-4V', polymer: 'PLLA/PLA', thermal: '高导热复合材料(≈Al-SiC)' };
const STRUCTURE_MODES = ['solid_network', 'shell', 'gradient_shell'];
const CONTAINER_SHAPES = ['cube', 'cylinder'];

const core = await loadCore();

const BOOL_FLAGS = new Set(['json', 'help']);

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    if (t.includes('=')) { // --key=value 形式
      const eq = t.indexOf('=');
      a[t.slice(2, eq)] = t.slice(eq + 1);
      continue;
    }
    const key = t.slice(2);
    if (BOOL_FLAGS.has(key)) { a[key] = true; continue; } // 布尔开关不吞值
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

function die(msg, usage = '') {
  console.error('✗ ' + msg);
  if (usage) console.error(usage);
  process.exit(2);
}

function cmdList(json) {
  const types = BUILTIN_TYPES.map((t) => {
    const { C1 } = core.gibsonAshby(1, t); // ρ̄=1 退化为常数本身
    return { type: t, C1, anisotropy: core.getAnisotropy(t) };
  });
  const materials = Object.fromEntries(Object.entries(core.BASE_MODULUS).map(([k, gpa]) => [
    k, { label: MATERIAL_LABELS[k], modulusGPa: gpa, yieldMPa: core.BASE_YIELD_STRENGTH[k] },
  ]));
  const out = {
    types,
    materials,
    model: { E: 'E*/Es = C1·ρ̄²', sigma: 'σ*/σs = C2·ρ̄^1.5（C2=0.3）', refs: 'Abueidda 2017 / Maskery 2018 / Berger 2017' },
    boundary: '材料级近似；几何相关指标需 M1 网格管线',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('内置曲面（C1 = Gibson-Ashby 刚度系数，anisotropy = 方向模量比）：');
  for (const t of types) console.log(`  ${t.type.padEnd(10)} C1=${t.C1.toFixed(2)}  anisotropy=${t.anisotropy}`);
  console.log('基体材料：');
  for (const [k, m] of Object.entries(materials)) console.log(`  ${k.padEnd(10)} E=${m.modulusGPa} GPa  σ=${m.yieldMPa} MPa  (${m.label})`);
}

function cmdEstimate(a, json) {
  const usage = '用法: node tpms.mjs estimate --type <曲面> --porosity <0~1 或百分数> [--material tc4|polymer|thermal] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"（选项请用 --key value 或 --key=value）`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) {
    die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}（custom 公式沙箱属后续里程碑）`, usage);
  }
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p; // 与平台同口径：>1 视为百分数
  if (pf < 0 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0 ≤ p < 1`, usage);
  const material = String(a.material ?? 'tc4');
  if (!(material in core.BASE_MODULUS)) {
    die(`未知材料 "${material}"，可选: ${Object.keys(core.BASE_MODULUS).join(' ')}`, usage);
  }

  const rel = 1 - pf;
  const { E_Es, sigma_Es, C1 } = core.gibsonAshby(rel, type);
  const C2 = core.gibsonAshby(1, type).sigma_Es; // ρ̄=1 → C2
  const out = {
    command: 'estimate',
    type,
    porosity: pf,
    porosityPercent: pf * 100,
    relativeDensity: rel,
    material,
    materialLabel: MATERIAL_LABELS[material],
    E_over_Es: E_Es,
    youngsModulusGPa: E_Es * core.BASE_MODULUS[material],
    sigma_over_sigmas: sigma_Es,
    yieldStrengthMPa: sigma_Es * core.BASE_YIELD_STRENGTH[material],
    C1,
    C2,
    anisotropy: core.getAnisotropy(type),
    model: 'Gibson-Ashby 开孔泡沫近似: E*/Es=C1·ρ̄², σ*/σs=C2·ρ̄^1.5',
    boundary: '几何相关指标（比表面积/渗透率/孔径/各向异性刚度张量）需网格管线，M1 提供',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 力学估算（Gibson-Ashby 开孔泡沫近似）');
  console.log(`  曲面类型    ${out.type}`);
  console.log(`  孔隙率      ${(pf * 100).toFixed(1)}%（相对密度 ρ̄ = ${rel}）`);
  console.log(`  基体材料    ${material}（${out.materialLabel}）`);
  console.log('  ───────────────────────────────');
  console.log(`  E* / Es     = ${E_Es.toFixed(6)}`);
  console.log(`  E*          = ${out.youngsModulusGPa.toFixed(3)} GPa`);
  console.log(`  σ* / σs     = ${sigma_Es.toFixed(6)}`);
  console.log(`  σ*          = ${out.yieldStrengthMPa.toFixed(1)} MPa`);
  console.log(`  各向异性比  ${out.anisotropy}`);
  console.log('  ───────────────────────────────');
  console.log('  边界: ' + out.boundary);
}

// ── M1 几何闭环：参数 → 体素场 → Surface Nets → STL（不经浏览器）──────────
// 自检口径与 .verify/mesh_audit.mjs 同源：开放边/非流形/退化面三硬指标，任一非零
// 即判失败且【不产出 STL】——水密门不过不交货。

function auditMeshIndices(positions, indices) {
  const triCount = indices.length / 3;
  const edgeOut = new Map(); // 无向边 key → [u<v 计数, u>v 计数]
  let degenTris = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i0 === i2) { degenTris++; continue; }
    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = u < v ? u + ',' + v : v + ',' + u;
      let rec = edgeOut.get(k);
      if (!rec) { rec = [0, 0]; edgeOut.set(k, rec); }
      if (u < v) rec[0]++; else rec[1]++;
    }
    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p1] - positions[p0], ay = positions[p1 + 1] - positions[p0 + 1], az = positions[p1 + 2] - positions[p0 + 2];
    const bx = positions[p2] - positions[p0], by = positions[p2 + 1] - positions[p0 + 1], bz = positions[p2 + 2] - positions[p0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz <= 1e-18) degenTris++;
  }
  let openEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0;
  for (const [, [ab, ba]] of edgeOut) {
    const total = ab + ba;
    if (total === 1) openEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (ab === 0 || ba === 0) misorientedEdges++; // total==2 但两三角同向
  }
  return { triCount, degenTris, openEdges, nonManifoldEdges, misorientedEdges };
}

function cmdMesh(a, json) {
  const usage = '用法: node tpms.mjs mesh --type <曲面> --porosity <0~1|百分数> [--periods 6] [--resolution 64] [--container cube|cylinder] [--mode solid_network|shell|gradient_shell] [--out 文件.stl] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}`, usage);
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p;
  if (pf < 0.05 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0.05 ≤ p < 1（近全实心的网格无工程意义）`, usage);
  const periods = a.periods === undefined ? 6 : Number(a.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 16) die('periods 须为 1~16 整数', usage);
  // 平台缓冲池容量硬约束：N³ > 1e6 即 throw（units.ts 分辨率档位 R≤99）——CLI 上限对齐
  const resolution = a.resolution === undefined ? 64 : Number(a.resolution);
  if (!Number.isInteger(resolution) || resolution < 24 || resolution > 96) die('resolution 须为 24~96 整数（平台缓冲池 N³≤1e6 约束）', usage);
  const container = String(a.container ?? 'cube');
  if (!CONTAINER_SHAPES.includes(container)) die(`未知容器 "${container}"，可选: ${CONTAINER_SHAPES.join(' ')}`, usage);
  const mode = String(a.mode ?? 'solid_network');
  if (!STRUCTURE_MODES.includes(mode)) die(`未知结构模式 "${mode}"，可选: ${STRUCTURE_MODES.join(' ')}`, usage);

  const params = {
    type, iso: 0, periods, resolution, targetPorosity: pf,
    weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
    thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  };
  core.globalBufferPool.reset();
  let res;
  try {
    res = core.buildSurface(params, core.globalBufferPool);
  } catch (e) {
    // 平台几何失败全部走 throw（容量/非有限场/退化场），统一转 CLI 语义
    die('网格构建失败: ' + (e?.message ?? String(e)));
  }

  const audit = auditMeshIndices(res.positions, res.indices);
  const watertight = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
  // porosityEstimate 平台口径为小数（=1−发散固相/包络，surface-nets 内建钳制），恒 ≤1
  const porEst = res.porosityEstimate;
  const out = {
    command: 'mesh', type, porosity: pf, periods, resolution, container, mode,
    vertCount: res.vertCount, triCount: res.triCount,
    isoUsed: res.isoUsed,
    porosityEstimate: porEst,
    porosityDeviation: Math.abs(porEst - pf),
    audit, watertight,
    scaleMmPerWc: core.wcToMmFactor(periods),
    boundary: '水密自检 = mesh_audit 同款三硬指标（开放边/非流形/退化面，索引空间）；misoriented 为观测值不设门（导出翻转后全局定向一致性是平台已知盲区）；孔隙率为网格发散体积实测口径，与目标值的口径差随分辨率收敛',
  };
  if (!watertight) {
    if (json) console.log(JSON.stringify(out, null, 2));
    die(`水密门未过：开放边=${audit.openEdges} 非流形边=${audit.nonManifoldEdges} 退化面=${audit.degenTris} —— 不产出 STL`);
  }
  const outFile = String(a.out ?? `tpms-${type}-p${Math.round(pf * 100)}.stl`);
  const scale = core.wcToMmFactor(periods);
  const stl = core.buildBinarySTL(res.positions, res.indices, scale, res.normals);
  writeFileSync(outFile, Buffer.from(stl));
  out.file = outFile;
  out.fileBytes = stl.byteLength;
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 网格导出（Surface Nets，构造性水密）');
  console.log(`  曲面/孔隙率  ${type} @ ${(pf * 100).toFixed(1)}%（等值常数 iso=${res.isoUsed.toFixed(4)}）`);
  console.log(`  结构/容器    ${mode} / ${container}，${periods} 周期 × ${resolution}³ 体素`);
  console.log('  ───────────────────────────────');
  console.log(`  顶点/三角形  ${res.vertCount} / ${res.triCount}`);
  console.log(`  实测孔隙率   ${(porEst * 100).toFixed(2)}%（目标 ${(pf * 100).toFixed(1)}%，偏差 ${(Math.abs(porEst - pf) * 100).toFixed(2)}pp）`);
  if (Math.abs(porEst - pf) > 0.05) console.log('  ⚠ 偏差偏大：二分与网格实测的口径差随分辨率收敛，建议提高 --resolution（上限 96）');
  console.log(`  水密自检     开放边=${audit.openEdges} 非流形=${audit.nonManifoldEdges} 退化面=${audit.degenTris} → 通过（索引空间定向观测 misoriented=${audit.misorientedEdges}）`);
  console.log(`  STL 已写入   ${outFile}（${(stl.byteLength / 1024).toFixed(1)} KB，单位 mm，${scale.toFixed(4)} mm/wc）`);
}


const a = parseArgs(process.argv.slice(2));
const json = a.json === true;
const cmd = a._[0];
a._ = a._.slice(1); // 命令字出栈，其余位置参数供子命令校验
if (cmd === 'list') cmdList(json);
else if (cmd === 'estimate') cmdEstimate(a, json);
else if (cmd === 'mesh') cmdMesh(a, json);
else {
  console.log('TPMS Agent CLI（M0 数学层 + M1 几何闭环）');
  console.log('用法:');
  console.log('  node tpms.mjs list');
  console.log('  node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]');
  console.log('  node tpms.mjs mesh --type gyroid --porosity 0.65 [--periods 6] [--resolution 64] [--out 文件.stl] [--json]');
  console.log(`曲面类型: ${BUILTIN_TYPES.join(' ')}`);
  console.log(`材料:     ${Object.keys(core.BASE_MODULUS).join(' ')}`);
  if (cmd !== undefined && cmd !== 'help') { console.error(`\n✗ 未知命令 "${cmd}"`); process.exit(2); }
}
