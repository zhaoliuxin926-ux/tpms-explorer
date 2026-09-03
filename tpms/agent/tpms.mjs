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

const BUILTIN_TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const MATERIAL_LABELS = { tc4: 'Ti-6Al-4V', polymer: 'PLLA/PLA', thermal: '高导热复合材料(≈Al-SiC)' };

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

const a = parseArgs(process.argv.slice(2));
const json = a.json === true;
const cmd = a._[0];
a._ = a._.slice(1); // 命令字出栈，其余位置参数供子命令校验
if (cmd === 'list') cmdList(json);
else if (cmd === 'estimate') cmdEstimate(a, json);
else {
  console.log('TPMS Agent CLI（M0 纯数学层）');
  console.log('用法:');
  console.log('  node tpms.mjs list');
  console.log('  node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]');
  console.log(`曲面类型: ${BUILTIN_TYPES.join(' ')}`);
  console.log(`材料:     ${Object.keys(core.BASE_MODULUS).join(' ')}`);
  if (cmd !== undefined && cmd !== 'help') { console.error(`\n✗ 未知命令 "${cmd}"`); process.exit(2); }
}
