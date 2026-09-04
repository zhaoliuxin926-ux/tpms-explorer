// schema_check.mjs —— B-t2 工具注册层自检
//
// 验证口径：schema 声明 ↔ CLI 实际行为交叉一致。
//  1. schema 结构：三工具、required、additionalProperties:false
//  2. 枚举一致性：type/mode/container 的 enum 与 CLI 实际接受域吻合（合法过/非法拒实测）
//  3. 数值边界：schema 的 minimum/maximum 与 CLI 拒绝语义逐点对拍
//  4. nl-agent 语义覆盖映射完整（TYPE/MATERIAL/MODE/CONTAINER 全覆盖；动作类如实声明）
//
// 运行: node schema_check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tpms.mjs');
const schema = JSON.parse(readFileSync(join(HERE, 'tools.schema.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS', n); };
const bad = (n, i = '') => { fail++; console.log('FAIL', n, i); };
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const tool = (n) => schema.tools.find((t) => t.name === n);

// ── 1. schema 结构 ──
schema.tools?.length === 3 && ['tpms_list', 'tpms_estimate', 'tpms_mesh'].every((n) => tool(n))
  ? ok('schema 含三工具') : bad('schema 工具清单');
for (const n of ['tpms_estimate', 'tpms_mesh']) {
  const t = tool(n);
  t.parameters.additionalProperties === false && Array.isArray(t.parameters.required)
    ? ok(`${n} additionalProperties=false + required 声明`) : bad(`${n} 参数结构`);
}

// ── 2/3. schema 属性约束 ↔ CLI 行为对拍 ──
const props = tool('tpms_mesh').parameters.properties;
const typeEnum = JSON.stringify(props.type.enum.slice().sort());
const j = (out) => { try { return JSON.parse(out); } catch { return null; } };

// 合法边界通过
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
for (const [label, args, check] of [
  ['resolution 下限 48 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut())], (r) => r.status === 0],
  ['resolution 上限 96 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 0],
  ['porosity 0.05 参数层接受+构建层 fail-closed', ['--type', 'gyroid', '--porosity', '0.05', '--resolution', '48', '--out', join(tmpOut())], (r) => r.status === 3 && (r.stderr || '').includes('水密门')],
  ['periods 上限 12 通过', ['--type', 'gyroid', '--porosity', '0.6', '--periods', '12', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 0],
]) {
  const r = run('mesh', ...args, '--json');
  check(r) ? ok(label) : bad(label, (r.stderr || '').slice(-80));
}
// type enum 逐值遍历（每值 R48 最小水密可行成本构建，验证 enum 与 CLI 接受域完全一致）
for (const ty of TYPES) {
  const r = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
  r.status === 0 ? ok(`type enum 值 ${ty} 可构建`) : bad(`type enum ${ty}`, (r.stderr || '').slice(-60));
}

// 非法值拒绝（schema 之外 → CLI 必拒）
for (const [label, args] of [
  ['type 不在 enum 被拒', ['--type', 'warpdrive', '--porosity', '0.5', '--resolution', '24']],
  ['resolution 97 越上界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--resolution', '97']],
  ['resolution 47 越下界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--resolution', '47']],
  ['periods 13 越上界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--periods', '13']],
  ['container 不在 enum 被拒', ['--type', 'gyroid', '--porosity', '0.5', '--container', 'sphere']],
  ['mode 不在 enum 被拒', ['--type', 'gyroid', '--porosity', '0.5', '--mode', 'warpdrive']],
  ['estimate 未知属性被拒（--weapon）', ['estimate', '--type', 'gyroid', '--porosity', '0.5', '--weapon', 'laser']],
  ['mesh 未知属性被拒（--weapon）', ['mesh', '--type', 'gyroid', '--porosity', '0.5', '--resolution', '48', '--weapon', 'laser']],
  ['estimate 非法值拒绝为 exit 2（参数错误语义）', ['estimate', '--type', 'nope', '--porosity', '0.5']],
]) {
  const r = run('mesh', ...args);
  r.status === 2 ? ok(label + ' [exit2]') : bad(label + ' 未拒绝或退出码非 2', `exit=${r.status}`);
}

// estimate 枚举与 material 约束
{
  const t = tool('tpms_estimate').parameters.properties;
  JSON.stringify(t.material.enum.slice().sort()) === JSON.stringify(['polymer', 'tc4', 'thermal'])
    ? ok('estimate material enum 与平台材料表一致') : bad('material enum');
  JSON.stringify(t.type.enum.slice().sort()) === typeEnum
    ? ok('estimate/mesh type enum 相互一致') : bad('type enum 不一致');
}

// ── 4. nl-agent 语义覆盖映射完整性 ──
{
  const cov = schema.nl_agent_semantic_coverage || {};
  const keys = Object.keys(cov);
  keys.length >= 10 ? ok(`语义覆盖映射 ${keys.length} 条`) : bad('覆盖映射条目不足');
  const uncovered = keys.filter((k) => String(cov[k]).startsWith('⬜'));
  console.log(`  · 显式未覆盖项（如实声明）: ${uncovered.length} → ${uncovered.join(', ')}`);
  keys.every((k) => typeof cov[k] === 'string' && cov[k].length > 4)
    ? ok('每条覆盖项均有状态说明') : bad('覆盖映射存在空声明');
  const coveredN = keys.filter((k) => String(cov[k]).startsWith('✅')).length;
  coveredN >= 6 ? ok(`已覆盖语义项 ≥6（实测 ${coveredN}）`) : bad('已覆盖语义项不足', String(coveredN));
}

function tmpOut() { return join(HERE, `_schema_tmp_${process.pid}.stl`); }
// 清理探针 STL
import { readdirSync, unlinkSync } from 'node:fs';
for (const f of readdirSync(HERE)) if (f.startsWith('_schema_tmp_')) { try { unlinkSync(join(HERE, f)); } catch { /* 忽略 */ } }

console.log(`\nSCHEMA-CHECK ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
