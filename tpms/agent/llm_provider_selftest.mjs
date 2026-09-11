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
if (pass < 14) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 14`); process.exit(1); }
process.exit(fail ? 1 : 0);
