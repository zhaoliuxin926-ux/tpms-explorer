/**
 * nl_agent_audit.mjs —— 门禁 31：自然语言 CAD/CAM 代理审计（v6.0 阶段 V）
 *
 * A. 中文多参数指令解析（孔隙率/类型/端板 + 3MF 动作）
 * B. 英文指令解析（porosity/material/container/export stl）
 * C. 边界与安全：孔隙率钳制 [5,95]、端板钳制 [0,10]、unknown 不臆造
 * D. 帮助/重置/仿真/骨支架预设意图
 *
 * 运行：node nl_agent_audit.mjs
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const entry = join(tmpdir(), 'nl31_entry.ts');
writeFileSync(entry, `export { parseNL } from ${JSON.stringify(join(PLATFORM, 'src/core/nl-agent.ts'))};`);
const BUNDLE = join(tmpdir(), 'nl31_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
const { parseNL } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ══ A. 中文多参数指令 ══
console.log('\n[A] 中文多参数指令');
{
  const it = parseNL('给我设计一个孔隙率 75%、采用 Gyroid 结构、上下带 2mm 实心端板、用于股骨修复的人工骨支架，并导出 3MF');
  check('孔隙率 75', it.patches.porosity === 75, String(it.patches.porosity));
  check('类型 Gyroid', it.patches.type === 'gyroid', String(it.patches.type));
  check('端板 2mm', it.patches.endplateMm === 2, String(it.patches.endplateMm));
  check('动作 export-3mf', it.actions.includes('export-3mf'), it.actions.join(','));
  check('骨支架预设', it.actions.includes('preset-bone'));
  check('kind=action', it.kind === 'action');
  check('日志条数 ≥3（参数项）', it.log.length >= 3, String(it.log.length));
  check('置信度 ∈ (0,1]', it.confidence > 0 && it.confidence <= 1);
}

// ══ B. 英文指令 ══
console.log('\n[B] 英文指令');
{
  const it = parseNL('porosity 60 titanium diamond cylinder container export stl');
  check('孔隙率 60', it.patches.porosity === 60, String(it.patches.porosity));
  check('材料 tc4', it.patches.material === 'tc4', String(it.patches.material));
  check('类型 diamond', it.patches.type === 'diamond', String(it.patches.type));
  check('容器圆柱', it.patches.containerShape === 'cylinder', String(it.patches.containerShape));
  check('动作 export-stl', it.actions.includes('export-stl'), it.actions.join(','));
  const it2 = parseNL('cellsize 2.5 wall thickness 0.8 gradient shell');
  check('单元尺寸 2.5', it2.patches.cellSize === 2.5, String(it2.patches.cellSize));
  check('壁厚 0.8', it2.patches.thickness === 0.8, String(it2.patches.thickness));
  check('梯度壳', it2.patches.structureMode === 'gradient_shell', String(it2.patches.structureMode));
}

// ══ C. 边界与安全 ══
console.log('\n[C] 边界钳制与 unknown');
{
  const it = parseNL('孔隙率 300');
  check('孔隙率钳制 ≤95', it.patches.porosity === 95, String(it.patches.porosity));
  const it2 = parseNL('端板 99mm');
  check('端板钳制 ≤10', it2.patches.endplateMm === 10, String(it2.patches.endplateMm));
  const it3 = parseNL('今天天气怎么样');
  check('unknown 不臆造参数', it3.kind === 'unknown' && Object.keys(it3.patches).length === 0);
  check('unknown 引导帮助', it3.reply.includes('帮助'));
  const it4 = parseNL('');
  check('空输入处理', it4.kind === 'unknown' && it4.confidence === 0);
}

// ══ D. 动作意图 ══
console.log('\n[D] 帮助/重置/仿真/预设');
{
  const h = parseNL('help');
  check('help 意图', h.kind === 'help' && h.reply.includes('孔隙率 75%'));
  const r = parseNL('重置为默认参数');
  check('reset 动作', r.actions.includes('reset'), r.actions.join(','));
  const sim = parseNL('运行压溃仿真');
  check('仿真动作', sim.actions.includes('run-simulation'));
  const bone = parseNL('做一个医用钛合金植入支架');
  check('骨支架口径', bone.actions.includes('preset-bone') && bone.patches.material === 'tc4');
}


// ══ E. 毒化输入回归（对抗审查定案：endplate 误配材料/分数孔隙率/非法容器/裸钛）══
console.log('\n[E] 毒化回归');
{
  const e1 = parseNL('porosity 60 with 2mm endplate export stl');
  check('E1 endplate 不误配材料（pla 子串缺陷回归）', e1.patches.material === undefined, String(e1.patches.material));
  const e2 = parseNL('porosity 0.75 gyroid');
  check('E2 分数孔隙率 0.75 → 75%', e2.patches.porosity === 75, String(e2.patches.porosity));
  const e3 = parseNL('球形容器 gyroid');
  check('E3 非法容器 sphere 不产出 patch', e3.patches.containerShape === undefined, String(e3.patches.containerShape));
  const e4 = parseNL('钛 支架');
  check('E4 裸"钛"识别为 tc4', e4.patches.material === 'tc4', String(e4.patches.material));
  const e5 = parseNL('PLA 支架孔隙率 50');
  check('E5 真 PLA 仍识别', e5.patches.material === 'polymer' && e5.patches.porosity === 50);
  const e6 = parseNL('I-WP structure export stl');
  check('E6 I-WP 连字符识别', e6.patches.type === 'iwp', String(e6.patches.type));
  const e7 = parseNL('constructor eval process');
  check('E7 原型链载荷 unknown', e7.kind === 'unknown');
}

console.log(`\n== RESULT: ${passCount} PASS / ${failCount} FAIL ==`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
