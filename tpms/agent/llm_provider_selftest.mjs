/**
 * llm_provider_selftest.mjs — M3 LLM 接入层自检（离线，不依赖 Ollama 进程）
 *
 * 验证口径：
 *   1. schemaToOllamaTools 结构完整
 *   2. validateToolCalls 拦截器：合法值通过、越界拒绝、未知属性拒绝、未知工具拒绝
 *   3. MockProvider → validate → runCli 链路（list 命令端到端）
 *
 * 运行: node llm_provider_selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadToolsSchema, validateToolCalls, schemaToOllamaTools, MockProvider,
} from './llm-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, i)); };

const schema = loadToolsSchema();
const tools = schemaToOllamaTools(schema);

// ── 1. schema 结构 ──
ok('schema 含 4 工具', schema.tools.length === 4, `got ${schema.tools.length}`);
ok('ollama tools 格式完整', tools.every((t) => t.type === 'function' && t.function.name && t.function.parameters));
ok('ollama tools 名称与 schema 一致', tools.map((t) => t.function.name).join() === schema.tools.map((t) => t.name).join());

// ── 2. validateToolCalls 拦截器 ──
const mkCall = (name, args) => [{ function: { name, arguments: JSON.stringify(args) } }];

// 2a. 合法：estimate gyroid 0.65
{
  const v = validateToolCalls(mkCall('tpms_estimate', { type: 'gyroid', porosity: 0.65, material: 'tc4', json: true }), schema);
  ok('合法 estimate 通过', v.ok === true, JSON.stringify(v.errors));
}
// 2b. 合法：porosity=65（百分数，CLI 接受）
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'diamond', porosity: 65, resolution: 64 }), schema);
  ok('porosity=65 百分数通过 schema（CLI 双口径）', v.ok === true, JSON.stringify(v.errors));
}
// 2c. 越界：resolution=200
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, resolution: 200 }), schema);
  ok('resolution=200 越界被拒', v.ok === false && v.errors.some((e) => e.includes('resolution')), JSON.stringify(v.errors));
}
// 2d. 越界：porosity=0
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0 }), schema);
  ok('porosity=0 越界被拒', v.ok === false, JSON.stringify(v.errors));
}
// 2e. 非法 enum：type=warpdrive
{
  const v = validateToolCalls(mkCall('tpms_estimate', { type: 'warpdrive', porosity: 0.5 }), schema);
  ok('type=warpdrive enum 拒绝', v.ok === false && v.errors.some((e) => e.includes('enum')), JSON.stringify(v.errors));
}
// 2f. 未知属性：--weapon
{
  const v = validateToolCalls(mkCall('tpms_estimate', { type: 'gyroid', porosity: 0.5, weapon: 'laser' }), schema);
  ok('未知属性 weapon 被拒', v.ok === false && v.errors.some((e) => e.includes('weapon')), JSON.stringify(v.errors));
}
// 2g. 未知工具
{
  const v = validateToolCalls(mkCall('tpms_warp', { speed: 9 }), schema);
  ok('未知工具 tpms_warp 被拒', v.ok === false && v.errors.some((e) => e.includes('不在')), JSON.stringify(v.errors));
}
// 2h. 缺必填
{
  const v = validateToolCalls(mkCall('tpms_estimate', { type: 'gyroid' }), schema);
  ok('缺必填 porosity 被拒', v.ok === false && v.errors.some((e) => e.includes('porosity')), JSON.stringify(v.errors));
}
// 2i. 非法 JSON arguments
{
  const v = validateToolCalls([{ function: { name: 'tpms_list', arguments: '{bad json' } }], schema);
  ok('非法 JSON arguments 被拒', v.ok === false, JSON.stringify(v.errors));
}
// ── 2j~2w. 红队 A 轮回归（2026-09-12 对抗审查修复钉）──
// 2j. 标量 arguments（曾裸崩 TypeError exit 1）
{
  const v = validateToolCalls([{ function: { name: 'tpms_mesh', arguments: 'null' } }], schema);
  ok('arguments=null 结构化拒绝（非裸崩）', v.ok === false && v.errors[0].includes('object'), JSON.stringify(v.errors));
}
{
  const v = validateToolCalls([{ function: { name: 'tpms_list', arguments: '5' } }], schema);
  ok('arguments=5 结构化拒绝（不静默吞成空参数）', v.ok === false, JSON.stringify(v.errors));
}
{
  const v = validateToolCalls([{ function: { name: 'tpms_list', arguments: '[1,2]' } }], schema);
  ok('arguments 数组被拒', v.ok === false, JSON.stringify(v.errors));
}
// 2m. 原型链键名（曾借 'k in props' 绕过未知属性拒绝；JSON.parse 会产生自有 __proto__ 键）
{
  const v = validateToolCalls([{ function: { name: 'tpms_list', arguments: '{"__proto__":{"x":1},"constructor":1,"toString":1}' } }], schema);
  ok('原型链键名按未知属性拒绝', v.ok === false && v.errors.length >= 3, JSON.stringify(v.errors));
}
// 2n~2o2. 路径狱（out/design 曾零校验=LLM 可控任意写/读）
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, out: '../RT-ESCAPED.stl' }), schema);
  ok('out ../ 穿越被拒', v.ok === false && v.errors.some((e) => e.includes('out')), JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, out: 'C:\\evil.stl' }), schema);
  ok('out 绝对路径被拒', v.ok === false, JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, out: 12345 }), schema);
  ok('out 非字符串被拒', v.ok === false, JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_scenario', { design: 'a/b/../../etc/passwd.json' }), schema);
  ok('design 路径穿越被拒', v.ok === false && v.errors.some((e) => e.includes('design')), JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, out: 'scaffold.stl' }), schema);
  ok('out 合法单段文件名通过', v.ok === true, JSON.stringify(v.errors));
}
// 2q~2t. isoGrad 对象子 schema（曾对象内容零校验）
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, resolution: 96, isoGrad: { values: [-0.12, 0, 0.12], band: 0.4 } }), schema);
  ok('isoGrad 合法对象通过且值保留', v.ok === true && v.calls?.[0]?.arguments?.isoGrad?.values?.length === 3, JSON.stringify(v));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, isoGrad: { values: [-2, 2] } }), schema);
  ok('isoGrad 幅值越 [-1.5,1.5] 被拒', v.ok === false, JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, isoGrad: { values: [0, 0], evil: true } }), schema);
  ok('isoGrad 未知子属性被拒', v.ok === false && v.errors.some((e) => e.includes('evil')), JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, isoGrad: { values: [0] } }), schema);
  ok('isoGrad values 数量 <2 被拒', v.ok === false, JSON.stringify(v.errors));
}
// 2u~2v. 严格类型（曾 "75"→75 / [5]→5 / true→1 强制转换怪象）
{
  const v = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: '75' }), schema);
  ok('porosity 字符串数字被拒（严格 number）', v.ok === false, JSON.stringify(v.errors));
}
{
  const v = validateToolCalls(mkCall('tpms_estimate', { type: 'gyroid', porosity: 0.5, json: 'true' }), schema);
  ok('json 字符串被拒（严格 boolean）', v.ok === false, JSON.stringify(v.errors));
}
// 2w. 逐调用错误归属：坏调用不拖垮好调用的 cleaned 归属（整体仍 ok=false 不执行）
{
  const calls = [
    { function: { name: 'tpms_estimate', arguments: JSON.stringify({ type: 'gyroid', porosity: 0.5 }) } },
    { function: { name: 'tpms_estimate', arguments: JSON.stringify({ type: 'gyroid', porosity: 999 }) } },
  ];
  const v = validateToolCalls(calls, schema);
  ok('批量中坏调用拒绝且好调用不误入执行面', v.ok === false && v.calls === undefined, JSON.stringify(v));
}
// 2x. Ollama 超时默认值（曾无超时=对不响应服务端永久挂起）
{
  const { OllamaProvider } = await import('./llm-provider.mjs');
  const p = new OllamaProvider();
  ok('OllamaProvider 默认 120s 超时', p.timeoutMs === 120_000, String(p.timeoutMs));
}
// 2y. mock + 真实执行守卫（曾可经 TPMS_MOCK_TOOLCALLS 驱动真实落盘）
{
  const r = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '测试'], {
    encoding: 'utf8',
    env: { ...process.env, TPMS_MOCK_TOOLCALLS: '{"toolCalls":[{"function":{"name":"tpms_list","arguments":"{}"}}]}' },
  });
  ok('mock 不带 --dry-run 拒绝真实执行 [exit2]', r.status === 2 && (r.stderr || '').includes('--dry-run'), `exit=${r.status} ${r.stderr?.slice(0, 120)}`);
}

// ── 3. MockProvider → runCli 链路（list 端到端）──
{
  const mock = new MockProvider({ toolCalls: mkCall('tpms_list', {}) });
  const out = await mock.complete([], tools);
  ok('MockProvider 返回 toolCalls', out.toolCalls.length === 1);
  const v = validateToolCalls(out.toolCalls, schema);
  ok('Mock list 通过拦截器', v.ok === true, JSON.stringify(v.errors));
  // 实际执行 CLI list
  const r = spawnSync(process.execPath, [join(HERE, 'tpms.mjs'), 'list', '--json'], { encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* */ }
  ok('CLI list exit=0 且 20 族', r.status === 0 && j?.types?.length === 20, `exit=${r.status} types=${j?.types?.length}`);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 30) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 30`); process.exit(1); }
process.exit(fail ? 1 : 0);
