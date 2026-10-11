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
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadToolsSchema, validateToolCalls, schemaToOllamaTools, MockProvider,
  OllamaProvider, OpenAICompatProvider, AnthropicCompatProvider,
} from './llm-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, i)); };

const schema = loadToolsSchema();
const tools = schemaToOllamaTools(schema);

// ── 1. schema 结构 ──
ok('schema 含 6 工具（2026-10-06 +tpms_pareto 逆设计）', schema.tools.length === 6, `got ${schema.tools.length}`);
ok('ollama tools 格式完整', tools.every((t) => t.type === 'function' && t.function.name && t.function.parameters));
ok('ollama tools 名称与 schema 一致', tools.map((t) => t.function.name).join() === schema.tools.map((t) => t.name).join());

// ── 1b. AnthropicCompatProvider（2026-10-01 新增：智谱 Coding Plan 通道）──
{
  const { AnthropicCompatProvider } = await import('./llm-provider.mjs');
  let threw = false;
  try { new AnthropicCompatProvider({}); } catch { threw = true; }
  ok('AnthropicCompatProvider 缺 apiKey 拒绝构造', threw);
  const ap = new AnthropicCompatProvider({ apiKey: 'test-key' });
  ok('AnthropicCompatProvider 默认端点/模型（Coding Plan 通道）', ap.baseUrl.includes('/api/anthropic') && ap.model === 'glm-5.3' && ap.maxTokens > 0);
}

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
// 2b1b. tpms_pareto 槽位：schema 通过 + CLI kebab 桥接静态哨兵（2026-10-06 第六工具；
// schema camelCase≠CLI kebab 映射断裂红队先例——runCli slotMap 必须钉）
{
  const v = validateToolCalls(mkCall('tpms_pareto', { target_e_gpa: 2, target_k_nm2: 5 }), schema);
  ok('tpms_pareto 槽位通过 schema（E/κ 必填）', v.ok === true, JSON.stringify(v.errors));
  const src = readFileSync(join(HERE, 'llm-agent.mjs'), 'utf8');
  ok('llm-agent 桥接在位（cmdMap tpms_pareto + slotMap target_e_gpa→target-e）',
    src.includes("['tpms_pareto', 'pareto']") && src.includes("['target_e_gpa', 'target-e']") && src.includes("['target_k_nm2', 'target-k']"));
}
// 2b2. 数量上限：65 个 toolCalls 拒绝（红队 D L-3 防批量 spawn DoS，2026-09-29 补钉）
{
  const calls = Array.from({ length: 65 }, () => mkCall('tpms_estimate', { type: 'gyroid', porosity: 0.65 })[0]);
  const v = validateToolCalls(calls, schema);
  ok('toolCalls 65 个超上限被拒', v.ok === false && v.errors.some((e) => e.includes('64')), JSON.stringify(v.errors));
}
// 2b2b. 数组含 null 元素：结构化拒绝不裸崩（2026-10-02 审查 M-1：网络面 tool_calls:[null]
// 实证可达，此前 TypeError 穿透为 uncaught exit 1 破坏退出码契约）
{
  const v = validateToolCalls([null, { function: { name: 'tpms_estimate', arguments: JSON.stringify({ type: 'gyroid', porosity: 0.65 }) } }], schema);
  ok('toolCalls 含 null 元素结构化拒绝', v.ok === false && v.errors.some((e) => e.includes('须为 object')), JSON.stringify(v.errors));
}
// 2b2c. 顶层非数组：结构化拒绝不裸崩（2026-10-02 复审 M-1：tool_calls:"abc" 网络面可达形态）
{
  const v = validateToolCalls('aaa', schema);
  ok('toolCalls 顶层非数组结构化拒绝', v.ok === false && v.errors.some((e) => e.includes('须为数组')), JSON.stringify(v.errors));
}
// 2b3. 边界：64 个放行（上限处不误伤）
{
  const calls = Array.from({ length: 64 }, () => mkCall('tpms_estimate', { type: 'gyroid', porosity: 0.65 })[0]);
  const v = validateToolCalls(calls, schema);
  ok('toolCalls 恰 64 个放行', v.ok === true, JSON.stringify(v.errors ?? []).slice(0, 80));
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
  // 红队 I P1-1：裸点串（无分隔符形态）曾随 SAFE_PATH_RE 迁移丢失而放行
  const v1 = validateToolCalls(mkCall('tpms_scenario', { design: '..' }), schema);
  const v2 = validateToolCalls(mkCall('tpms_scenario', { design: '.' }), schema);
  ok('design 裸 .. / . 被拒', v1.ok === false && v2.ok === false && v1.errors.some((e) => e.includes('design')) && v2.errors.some((e) => e.includes('design')), JSON.stringify(v1.errors));
}
{
  // 红队 I P1-2：Win 设备名不区分大小写（CON.stl 大写变体曾 ACCEPT）
  const v1 = validateToolCalls(mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, out: 'CON.stl' }), schema);
  const v2 = validateToolCalls(mkCall('tpms_scenario', { design: 'CON' }), schema);
  ok('Win 设备名大小写变体被拒', v1.ok === false && v1.errors.some((e) => e.includes('out')) && v2.ok === false && v2.errors.some((e) => e.includes('design')), JSON.stringify(v1.errors));
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
// 嵌套必填：缺 values 曾通过拦截器后在 runCli.values.join 裸崩（exit1）。
{
  const names = ['tpms_mesh', 'tpms_design_verify'];
  ok('两个 isoGrad schema 均必填 values', names.every((name) =>
    schema.tools.find((t) => t.name === name).parameters.properties.isoGrad.required?.includes('values')));
  for (const name of names) {
    for (const [label, isoGrad] of [['空对象', {}], ['仅 band', { band: 0.4 }]]) {
      const v = validateToolCalls(mkCall(name, { type: 'gyroid', porosity: 0.6, isoGrad }), schema);
      ok(`${name}.isoGrad ${label} 缺必填 values 被拒`,
        v.ok === false && v.errors.some((e) => e.includes('isoGrad') && e.includes('values') && e.includes('缺必填')),
        JSON.stringify(v));
    }
    const isoGrad = { values: [-0.1, 0, 0.1] };
    const v = validateToolCalls(mkCall(name, { type: 'gyroid', porosity: 0.6, isoGrad }), schema);
    ok(`${name}.isoGrad band 可省略且 values 原值保留`,
      v.ok === true && JSON.stringify(v.calls[0].arguments.isoGrad) === JSON.stringify(isoGrad), JSON.stringify(v));
  }
  // 独立小 schema 钉递归实现，避免仅在 isoGrad 上特判掩盖数组内深层 required 漏检。
  const nestedSchema = { tools: [{ name: 'nested_probe', parameters: {
    type: 'object', properties: { entries: { type: 'array', items: {
      type: 'object', properties: { detail: {
        type: 'object', required: ['value'], properties: { value: { type: 'number' } },
      } },
    } } },
  } }] };
  const nested = validateToolCalls(mkCall('nested_probe', { entries: [{ detail: {} }] }), nestedSchema);
  ok('数组内深层 object.required 递归拒绝缺值', nested.ok === false
    && nested.errors.some((e) => e.includes('entries[0].detail') && e.includes('value')), JSON.stringify(nested));
  const r = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--json', '嵌套必填回归'], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1', TPMS_MOCK_TOOLCALLS: JSON.stringify({
      toolCalls: mkCall('tpms_mesh', { type: 'gyroid', porosity: 0.6, isoGrad: {} }),
    }) },
  });
  ok('mock 真实执行入口在 CLI 前拒绝缺 values [exit2]', r.status === 2 && r.stdout === ''
    && /schema.*拒绝/.test(r.stderr || '') && !/TypeError|→ 执行/.test(r.stderr || ''),
    `exit=${r.status} ${r.stderr?.slice(0, 180)}`);
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

// 模型备注双出口（A3 2026-10-11）：provider 捕获的伴随文本（指代披露等）不得在主流程丢失——
// JSON 出口 modelNote 字段与普通出口「ℹ 模型备注」行都必须保留
{
  const env = { ...process.env, TPMS_MOCK_TOOLCALLS: JSON.stringify({
    toolCalls: mkCall('tpms_list', {}), raw: '指代无上下文，已按默认 gyroid 处理',
  }) };
  const rj = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--dry-run', '--json', '备注出口'], {
    encoding: 'utf8', timeout: 10_000, env,
  });
  let jj = null; try { jj = JSON.parse(rj.stdout); } catch { /* */ }
  ok('modelNote 在 JSON 出口保留', rj.status === 0 && typeof jj?.modelNote === 'string' && jj.modelNote.includes('已按默认 gyroid'), JSON.stringify(jj?.modelNote));
  const rp = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--dry-run', '备注出口'], {
    encoding: 'utf8', timeout: 10_000, env,
  });
  ok('模型备注行在普通出口保留', rp.status === 0 && (rp.stdout || '').includes('ℹ 模型备注: ') && (rp.stdout || '').includes('已按默认 gyroid'), `exit=${rp.status} ${(rp.stdout || '').slice(0, 120)}`);
}

// CLI 显式会话（批次 4 S1-S3，2026-10-11）：最小旅程=推荐→退出→同 session 指代构建；
// 指代=确定性绑定（不经模型），缺结果/越界/歧义/损坏/语义版本变化全部结构化 exit2
{
  const { mkdtempSync, writeFileSync: wf, readFileSync: rf, existsSync: ef, rmSync: rms } = await import('node:fs');
  const { tmpdir: td } = await import('node:os');
  const dir = mkdtempSync(join(td(), 'tpms-session-'));
  const sess = join(dir, 's.json');
  try {
    // S1 首跑新建 + mock pareto 真实执行落推荐集
    const r1 = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--session', sess, '--json', '推荐支架'], {
      encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1', TPMS_MOCK_TOOLCALLS: JSON.stringify({
        toolCalls: mkCall('tpms_pareto', { target_e_gpa: 2, target_k_nm2: 5, top: 3 }),
      }) },
    });
    let s1 = null; try { s1 = JSON.parse(r1.stdout); } catch { /* */ }
    ok('S1 会话首跑新建+pareto 落推荐集（exit0）', r1.status === 0 && s1?.ok && ef(sess), `exit=${r1.status}`);
    const stored = JSON.parse(rf(sess, 'utf8'));
    ok('S1 会话带版本与几何语义标签（原子 JSON）', stored.schemaVersion === 1 && typeof stored.geometrySemantics === 'string' && stored.geometrySemantics.length > 0);
    ok('S1 推荐候选含代理来源披露（S3 口径随快照）', stored.recommendations.length === 1 && stored.recommendations[0].candidates.length === 3
      && /解析代理/.test(stored.recommendations[0].source));
    ok('S1 会话不含 API key 字段', !/api[_-]?key/i.test(rf(sess, 'utf8')));
    // S2 最小旅程：手搓可控候选（gyroid p0.7 k3）→ 指代构建（确定性，不经模型）
    const crafted = JSON.parse(rf(sess, 'utf8'));
    crafted.recommendations.push({
      id: 'r2', createdAt: '2026-10-11T00:00:00Z', tool: 'tpms_pareto',
      input: { targetE: 2, targetKappaM2: 5e-9, top: 2 }, reachable: true,
      candidates: [
        { rank: 1, type: 'gyroid', porosity: 0.7, cellSize: 3, E_GPa: 2.5, kappa_m2: 6e-9, dist_log10: 0.1, meetsTarget: true },
        { rank: 2, type: 'diamond', porosity: 0.65, cellSize: 4, E_GPa: 2.1, kappa_m2: 5.5e-9, dist_log10: 0.2, meetsTarget: true },
      ],
      source: 'tpms_pareto 解析代理（Gibson-Ashby×Kozeny-Carman，非 FE 精确）',
    });
    wf(sess, JSON.stringify(crafted), 'utf8');
    // dry-run：绑定参数核对（快）
    const rd = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--session', sess, '--dry-run', '--json', '把第一个构建出来'], {
      encoding: 'utf8', timeout: 20_000,
    });
    let jd = null; try { jd = JSON.parse(rd.stdout); } catch { /* */ }
    const wantArgs = { type: 'gyroid', porosity: 0.7, periods: 3, resolution: 96 };
    const gotArgs = jd?.args ?? {};
    ok('S2 指代确定性绑定参数（dry-run 核对完整参数）', rd.status === 0 && jd?.mode === 'session-reference'
      && jd?.resolvedFrom?.recId === 'r2' && jd?.resolvedFrom?.ordinal === 1
      && ['type', 'porosity', 'periods', 'resolution'].every((k) => gotArgs[k] === wantArgs[k]),
      JSON.stringify(jd?.args ?? rd.stdout?.slice(0, 100)));
    // 真实构建：最小旅程终点（STL 落盘+执行记录）
    const rb = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--session', sess, '--json', '把第一个构建出来'], {
      encoding: 'utf8', timeout: 300_000,
    });
    let jb = null; try { jb = JSON.parse(rb.stdout); } catch { /* */ }
    const stl = join(dir, 'mesh-r2-cand1-gyroid-p70.stl');
    const after = JSON.parse(rf(sess, 'utf8'));
    const ex = after.executions?.[0];
    ok('S2 最小旅程：推荐→退出→同会话构建第一项（STL 落盘 exit0）', rb.status === 0 && jb?.mode === 'session-reference' && ef(stl), `exit=${rb.status}`);
    ok('S3 执行记录含候选来源/完整参数/产物位置', ex && ex.fromRecommendation === 'r2' && ex.candidateIndex === 0
      && ex.args?.type === 'gyroid' && ex.args?.porosity === 0.7 && ex.args?.periods === 3
      && Array.isArray(ex.artifacts) && ex.artifacts[0] === stl && ex.resultDigest?.watertight === true,
      JSON.stringify(ex ?? null).slice(0, 120));
    // 拒绝族（全部 exit2）
    const rej = (args, instr, expectSub) => {
      const r = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--session', args, instr], { encoding: 'utf8', timeout: 30_000 });
      return r.status === 2 && (r.stderr || '').includes(expectSub);
    };
    ok('S2 越界指代结构化拒绝（exit2）', rej(sess, '把第五个构建出来', '越界'));
    ok('S2 指代+新参数歧义拒绝（exit2）', rej(sess, '把第一个用孔隙率 80% 构建', '歧义'));
    ok('S2 缺推荐结果拒绝（exit2）', rej(join(dir, 'empty.json'), '把第一个构建出来', '没有任何推荐'), 'empty 会话预写入');
    wf(join(dir, 'empty.json'), JSON.stringify({ schemaVersion: 1, geometrySemantics: stored.geometrySemantics, created: 'x', updated: 'x', recommendations: [], executions: [] }), 'utf8');
    const rNo = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--session', join(dir, 'empty.json'), '把第一个构建出来'], { encoding: 'utf8', timeout: 30_000 });
    ok('S2 缺推荐结果拒绝复核（empty 文件就位后 exit2）', rNo.status === 2 && /没有任何推荐/.test(rNo.stderr || ''));
    wf(join(dir, 'corrupt.json'), '{not json', 'utf8');
    ok('S1 损坏会话明确拒绝（exit2）', rej(join(dir, 'corrupt.json'), 'hi', '损坏'));
    const vOld = JSON.parse(rf(sess, 'utf8'));
    vOld.geometrySemantics = 'v1-ancient';
    wf(join(dir, 'old.json'), JSON.stringify(vOld), 'utf8');
    ok('S3 几何语义版本变化拒绝（旧候选未经核对不得使用）', rej(join(dir, 'old.json'), '把第一个构建出来', '几何语义'));
  } finally {
    rms(dir, { recursive: true, force: true });
  }
}

// 正文超时：真实本地 HTTP，正常/慢正文/挂正文/慢错误正文/正常错误五种交付。
// 挂正文另设服务器熔断，旧实现也会有限时间内失败，避免测试自身永久挂起。
{
  const timeoutMs = 200;
  const timers = new Set();
  const server = createServer((req, res) => {
    req.resume();
    const mode = req.url.split('/')[1];
    const isError = mode === 'slow-error' || mode === 'error';
    res.writeHead(isError ? 503 : 200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    const payload = req.url.endsWith('/api/chat')
      ? { message: { content: 'local-note', tool_calls: mkCall('tpms_list', {}) } }
      : req.url.endsWith('/v1/messages')
        ? { content: [{ type: 'text', text: 'local-note' }, { type: 'tool_use', id: 'local-call', name: 'tpms_list', input: {} }] }
        : { choices: [{ message: { content: 'local-note', tool_calls: mkCall('tpms_list', {}) } }] };
    const end = () => mode === 'hang' ? res.destroy() : res.end(isError ? 'local unavailable' : JSON.stringify(payload));
    if (mode === 'normal' || mode === 'error') end();
    else {
      const timer = setTimeout(end, timeoutMs * 4);
      timers.add(timer);
      res.once('close', () => { clearTimeout(timer); timers.delete(timer); });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const Provider of [OllamaProvider, OpenAICompatProvider, AnthropicCompatProvider]) {
      for (const mode of ['normal', 'slow', 'hang', 'slow-error', 'error']) {
        const provider = new Provider({ baseUrl: `${base}/${mode}`, apiKey: 'local-test-key',
          timeoutMs: mode === 'normal' || mode === 'error' ? 5000 : timeoutMs });
        let result = null, error = null;
        try { result = await provider.complete([{ role: 'user', content: 'local probe' }], tools); }
        catch (e) { error = e; }
        if (mode === 'normal') {
          const v = result && validateToolCalls(result.toolCalls, schema);
          ok(`${Provider.name} 正常正文保留工具与备注`, error === null && result?.raw === 'local-note'
            && v?.ok === true && v.calls?.[0]?.name === 'tpms_list', error?.message ?? JSON.stringify(result));
        } else if (mode === 'error') {
          const prefix = Provider === OllamaProvider ? 'Ollama' : 'HTTP';
          ok(`${Provider.name} 正常错误正文保留 HTTP 格式`, error?.message === `${prefix} 503: local unavailable`, error?.message);
        } else {
          const prefix = Provider === OllamaProvider ? 'Ollama' : '端点';
          ok(`${Provider.name} ${mode} 正文受同一超时保护`,
            error?.message === `${prefix} ${timeoutMs}ms 无响应（timeout）`, error?.message ?? JSON.stringify(result));
        }
      }
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// T2 工具历史兼容（批次 5）：Anthropic 通道 tool_call_id↔tool_result 关联 + 有界多轮编排
{
  const captured = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { captured.push(JSON.parse(body)); } catch { /* */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const prov = new AnthropicCompatProvider({ baseUrl: `http://127.0.0.1:${srv.address().port}`, apiKey: 'local', timeoutMs: 5000 });
    await prov.complete([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '列清单' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_7', type: 'function', function: { name: 'tpms_list', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_7', content: '{"types":26}' },
    ], tools);
    const body = captured[0];
    const tu = body?.messages?.find((m) => m.role === 'assistant')?.content?.find((b) => b.type === 'tool_use');
    const tr = body?.messages?.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'))?.content?.find((b) => b.type === 'tool_result');
    ok('Anthropic 工具历史映射：tool_use 块携带原 ID', tu?.id === 'call_7' && tu?.name === 'tpms_list');
    ok('Anthropic 工具历史映射：tool_result 按 tool_use_id 关联', tr?.tool_use_id === 'call_7' && tr?.content === '{"types":26}');
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
  const env2 = { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1', TPMS_MOCK_TOOLCALLS: JSON.stringify({
    rounds: [
      { toolCalls: mkCall('tpms_list', {}), raw: '先看清单' },
      { toolCalls: [], raw: '清单已确认，任务完成' },
    ],
  }) };
  const rm2 = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--max-rounds', '3', '--json', '先列清单再总结'], { encoding: 'utf8', timeout: 60_000, env: env2 });
  let jm2 = null; try { jm2 = JSON.parse(rm2.stdout); } catch { /* */ }
  ok('T2 有界编排两轮收束（r1 执行→r2 纯文本终答 exit0）', rm2.status === 0 && jm2?.ok && jm2?.results?.length === 1 && jm2?.results?.[0]?.round === 1 && /任务完成/.test(jm2?.modelNote ?? ''), `exit=${rm2.status}`);
  const env3 = { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1', TPMS_MOCK_TOOLCALLS: JSON.stringify({
    rounds: [
      { toolCalls: mkCall('tpms_list', {}) },
      { toolCalls: mkCall('tpms_list', {}) },
    ],
  }) };
  const rm3 = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--max-rounds', '2', '--json', '一直列'], { encoding: 'utf8', timeout: 60_000, env: env3 });
  let jm3 = null; try { jm3 = JSON.parse(rm3.stdout); } catch { /* */ }
  ok('T3 轮数耗尽如实报告（不虚报完成，已完成结果保留）', rm3.status === 0 && jm3?.results?.length === 2 && /轮数上限 2 已用尽/.test(jm3?.modelNote ?? ''), `exit=${rm3.status} results=${jm3?.results?.length}`);
  const rm1 = spawnSync(process.execPath, [join(HERE, 'llm-agent.mjs'), '--provider', 'mock', '--dry-run', '--json', '单轮回归'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, TPMS_MOCK_TOOLCALLS: JSON.stringify({ toolCalls: mkCall('tpms_list', {}) }) } });
  ok('默认单轮行为完全不变（无 --max-rounds 兼容回归）', rm1.status === 0, `exit=${rm1.status}`);
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
  ok('CLI list exit=0 且 26 族', r.status === 0 && j?.types?.length === 26, `exit=${r.status} types=${j?.types?.length}`);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 87) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 87（82 + T2 工具历史/有界编排 5，2026-10-11 批次 5）`); process.exit(1); }
process.exit(fail ? 1 : 0);
