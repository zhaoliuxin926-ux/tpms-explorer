// 红队 E5~E14 黑盒实测探针（2026-11-07 Gemini 回执处置）：逐用例打 validateToolCalls
// 字段名全部对齐 tools.schema.json 实际契约（type/porosity 百分比口径/periods/resolution/out）
import { validateToolCalls, loadToolsSchema } from '../agent/llm-provider.mjs';

const schema = loadToolsSchema();
let pass = 0; const fail = [];
function run(tag, expect, toolCalls) {
  const r = validateToolCalls(toolCalls, schema);
  const blocked = !r.ok;
  const ok = blocked === (expect === '拦截');
  console.log(`[${expect}] ${tag}: ${blocked ? '拦截' : '放行'} ${ok ? '✓' : '✗ 与预期相反'}${blocked ? '  · ' + (r.errors[0] ?? '') : ''}`);
  ok ? pass++ : fail.push(tag);
}
const mesh = (over = {}) => [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 60, periods: 2, resolution: 64, out: 'a.stl', ...over }) } }];
const est = (over = {}) => [{ function: { name: 'tpms_estimate', arguments: JSON.stringify({ type: 'gyroid', porosity: 0.6, ...over }) } }];

{
  const calls = Array.from({ length: 64 }, (_, i) => ({ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 60, periods: 12, resolution: 128, out: `d${String(i).padStart(3, '0')}.stl` }) } }));
  run('E5 64×合法顶格 mesh 唯一 out（组合爆炸面）——联合预算拦截', '拦截', calls);
}
run('E6a 未声明字段走私', '拦截', est({ unregistered_flag: true }));
run('E6b 同名键 last-wins（原始字节流 porosity:0.6,65→合法 65% 双口径）', '放行', [{ function: { name: 'tpms_estimate', arguments: '{"type":"gyroid","porosity":0.6,"porosity":65.0}' } }]);
run('E7a Infinity(1e309)', '拦截', [{ function: { name: 'tpms_estimate', arguments: '{"type":"gyroid","porosity":1e309}' } }]);
run('E7b NaN 字面量', '拦截', [{ function: { name: 'tpms_estimate', arguments: '{"type":"gyroid","porosity":NaN}' } }]);
run('E8a bool 冒充数值', '拦截', mesh({ resolution: true }));
run('E8b 数组包裹数值', '拦截', mesh({ resolution: [64] }));
run('E9 INP 卡片注入 material', '拦截', [{ function: { name: 'tpms_scenario', arguments: JSON.stringify({ design: 'a.stl', material: 'Ti6Al4V\n*RESTART, WRITE, FREQUENCY=999999', out: 's.inp' }) } }]);
for (const [tag, p] of [['E10a %2e%2e', '%2e%2e%2fc.stl'], ['E10b ....//', '....//t.stl'], ['E10c NUL 设备名', 'NUL.stl'], ['E10d 空字节', 'v\u0000.stl'], ['E10e /dev/stdout', '/dev/stdout']]) {
  run(tag, '拦截', mesh({ out: p }));
}
run('E11 批次同 out 写写冲突', '拦截', [
  { function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 60, periods: 1, resolution: 48, out: 'shared.stl' }) } },
  { function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'diamond', porosity: 60, periods: 2, resolution: 48, out: 'shared.stl' }) } }]);
run('E12 契约面 porosity 数组形态', '拦截', [{ function: { name: 'tpms_design_verify', arguments: JSON.stringify({ type: 'gyroid', porosity: [0.55, 0.25] }) } }]);
run('E13 estimate porosity=65（分数口径缺上界？）', '放行', est({ porosity: 65.0 }));
run('E14 pareto 步长退化（契约无扫描域槽位）', '拦截', [{ function: { name: 'tpms_pareto', arguments: JSON.stringify({ target_e_gpa: 1, target_k_nm2: 1, top: 3, porosity_range: [0.2, 0.5], porosity_step: -0.05 }) } }]);
console.log(`\n==== ${pass} 符合预期 / ${fail.length} 相反 ====`);
