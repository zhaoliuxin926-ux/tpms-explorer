/**
 * llm-agent.mjs — M3 Agent 循环：自然语言 → LLM tool calling → CLI 执行
 *
 * 铁律：LLM 只填意图槽位；数值由 validateToolCalls 过 schema 钳制后交 CLI 确定性执行。
 *
 * 用法：
 *   node llm-agent.mjs "设计一个孔隙率 75% 的 Gyroid 骨支架并导出 STL"
 *   node llm-agent.mjs --provider ollama --model qwen2.5:7b "..."
 *   node llm-agent.mjs --provider mock --dry-run "..."   # 离线：只看 LLM 产出，不执行 CLI
 *
 * 退出码：0=成功 2=参数/LLM 输出被拒 3=CLI 构建/水密失败 4=tpms_design_verify 修复轮数耗尽（M3→M4 桥接透传）
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadToolsSchema, validateToolCalls, schemaToOllamaTools,
  OllamaProvider, MockProvider, OpenAICompatProvider,
} from './llm-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPMS = join(HERE, 'tpms.mjs');
const DRIVER = join(HERE, 'tpms-driver.mjs');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--provider') a.provider = argv[++i];
    else if (s === '--model') a.model = argv[++i];
    else if (s === '--base-url') a.baseUrl = argv[++i];
    else if (s === '--api-key') a.apiKey = argv[++i];
    else if (s === '--dry-run') a.dryRun = true;
    else if (s === '--json') a.json = true;
    else if (s.startsWith('--')) { console.error(`未知选项 ${s}`); process.exit(2); }
    else a._.push(s);
  }
  return a;
}

function runCli(toolName, args, cliOpts = {}) {
  // M3→M4 桥接：tpms_design_verify 不走 tpms.mjs 子命令，直连 tpms-driver 闭环
  if (toolName === 'tpms_design_verify') return runDesignVerify(args, cliOpts);
  // tools.schema 工具名 → CLI 子命令映射
  const cmdMap = { tpms_list: 'list', tpms_estimate: 'estimate', tpms_mesh: 'mesh', tpms_scenario: 'scenario' };
  const cmd = cmdMap[toolName];
  if (!cmd) return { status: 2, stdout: '', stderr: `未知工具 ${toolName}` };
  const cliArgs = [TPMS, cmd];
  for (const [k, v] of Object.entries(args)) {
    if (k === 'isoGrad') {
      // schema 对象槽位 → CLI kebab flag "<v0,v1,...>[@band]"（band 缺省 0.4 与 CLI 同默认）
      if (v && typeof v === 'object') {
        const band = v.band ?? 0.4;
        cliArgs.push('--iso-grad', `${v.values.join(',')}@${band}`);
      }
      continue;
    }
    if (v === true) cliArgs.push(`--${k}`);
    else if (v !== false && v !== undefined && v !== null) cliArgs.push(`--${k}`, String(v));
  }
  if (!args.json) cliArgs.push('--json');
  const r = spawnSync(process.execPath, cliArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** M3→M4 桥接：已钳制槽位 → 确定性 design JSON（文件名由白名单 type 派生，单段安全）→ tpms-driver 闭环。
 *  provider 选项转发给 driver（首轮 verify 失败后由同一 LLM 选修复）；TPMS_DRIVER_MOCK_DECISIONS
 *  经 env 自然透传（离线回归：mock 槽位 + mock 修复决策 + 真实 verify 执行）。
 *  design JSON 与 driver 工作副本（.driver.json）、收敛 STL 全部落当前目录（与 CLI 相对路径语义一致）。 */
function runDesignVerify(args, cliOpts) {
  const design = {};
  for (const k of ['type', 'porosity', 'material', 'periods', 'resolution', 'container', 'mode', 'isoGrad', 'out']) {
    if (args[k] !== undefined) design[k] = args[k];
  }
  const designFile = join(process.cwd(), `tpms-design-${args.type}.json`);
  writeFileSync(designFile, JSON.stringify(design, null, 2));
  const driverArgs = [DRIVER, '--design', designFile, '--json'];
  if (cliOpts.provider) driverArgs.push('--provider', cliOpts.provider);
  if (cliOpts.model) driverArgs.push('--model', cliOpts.model);
  if (cliOpts.baseUrl) driverArgs.push('--base-url', cliOpts.baseUrl);
  if (cliOpts.apiKey) driverArgs.push('--api-key', cliOpts.apiKey);
  const r = spawnSync(process.execPath, driverArgs, {
    encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const SYSTEM_PROMPT = `你是 TPMS Explorer 的设计助手。用户用自然语言描述 TPMS 支架设计需求。
你必须通过 tool calling 响应——只填工具定义的参数槽位，不得臆造数值，绝不臆造文件名。
工具选择：
- tpms_mesh：从参数直接构建 STL。绝大多数"设计/建一个 X 支架"意图走这里。
- tpms_scenario：仅当用户明确给出或要求某个设计方案 JSON 文件时使用（design 必填且该文件须真实存在，绝不臆造文件名）。
- tpms_estimate：仅当用户只询力学/渗透估算、明确不需要交付文件时使用。
- tpms_list：仅当用户要列曲面/材料清单时使用。
- tpms_design_verify：用户明确要求"验证到通过/闭环/确保交付质量"或所选曲面族可产性不确定时使用——走 verify+自动修复闭环（换族/降周期/升分辨率），收敛交付或结构化不可达宣告；多轮完整构建，明显慢于 tpms_mesh。
参数含义与边界见各工具的 description；孔隙率按用户表述习惯选 0-1 小数或 1-99 百分数。
若用户意图模糊，选择最合理的默认并在参数中体现；不要反问。`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const userMsg = a._.join(' ').trim();
  if (!userMsg) {
    console.error('用法: node llm-agent.mjs [--provider ollama|openai|mock] [--model X] [--base-url U] [--api-key K] [--dry-run] "<自然语言指令>"');
    process.exit(2);
  }

  const schema = loadToolsSchema();
  const tools = schemaToOllamaTools(schema);

  let provider;
  if (a.provider === 'mock') {
    // 铁律守卫：mock 是回归测试装置，不带 --dry-run 会真实执行 CLI 写盘（红队 A-6）——默认拒绝；
    // TPMS_ALLOW_MOCK_EXEC=1 为显式逃生门（M3→M4 桥接的离线闭环回归：mock 槽位 + 真实 verify 执行）
    if (!a.dryRun && process.env.TPMS_ALLOW_MOCK_EXEC !== '1') {
      console.error('✗ mock provider 仅限 --dry-run 回归（不落盘）；真实执行请用 --provider ollama|openai，或设 TPMS_ALLOW_MOCK_EXEC=1 显式允许（离线闭环回归用）');
      process.exitCode = 2; return;
    }
    // Mock：从 stdin 或环境读预设 toolCalls（回归测试用）
    let preset;
    try {
      preset = process.env.TPMS_MOCK_TOOLCALLS
        ? JSON.parse(process.env.TPMS_MOCK_TOOLCALLS)
        : { toolCalls: [{ function: { name: 'tpms_list', arguments: '{}' } }] };
    } catch { console.error('✗ TPMS_MOCK_TOOLCALLS 非法 JSON'); process.exitCode = 2; return; } // 红队 C C-6
    provider = new MockProvider(preset);
  } else if (a.provider === 'openai') {
    // OpenAI 兼容端点（智谱/DeepSeek/LM Studio/…）：key 走 TPMS_LLM_API_KEY 或 --api-key，不入库
    try {
    provider = new OpenAICompatProvider({
      baseUrl: a.baseUrl ?? process.env.TPMS_LLM_BASE_URL,
      apiKey: a.apiKey ?? process.env.TPMS_LLM_API_KEY,
      model: a.model ?? process.env.TPMS_LLM_MODEL ?? 'glm-4-flash',
    });
    } catch (e) { console.error('✗ Provider 构造失败: ' + (e?.message ?? e)); process.exitCode = 2; return; } // 红队 C C-6
  } else {
    provider = new OllamaProvider({ baseUrl: a.baseUrl, model: a.model });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ];

  let llmOut;
  try {
    llmOut = await provider.complete(messages, tools);
  } catch (e) {
    console.error(`✗ LLM 调用失败: ${e.message}`);
    console.error('  提示: ollama 需已启动（ollama serve）且模型已拉取；openai 兼容端点需 TPMS_LLM_API_KEY/TPMS_LLM_BASE_URL 或对应 flag');
    // 【2026-09-12】process.exit 在 undici async 句柄存活时触发 libuv win/async.c 断言（污染退出码）——
    // 全部改 exitCode + return 自然排空（fetch 已完成、定时器已清、Connection: close 下排空即时）
    process.exitCode = 2; return;
  }

  if (!llmOut.toolCalls?.length) {
    console.error('✗ LLM 未返回 tool calls（仅文本回复）。指令可能过于模糊，或模型不支持 function calling。');
    if (llmOut.raw) console.error(`  LLM 文本: ${llmOut.raw.slice(0, 200)}`);
    process.exitCode = 2; return;
  }

  // 铁律：schema 拦截器逐槽位钳制
  const verdict = validateToolCalls(llmOut.toolCalls, schema);
  if (!verdict.ok) {
    console.error('✗ LLM 产出被 schema 拦截器拒绝:');
    for (const e of verdict.errors) console.error(`  - ${e}`);
    process.exitCode = 2; return;
  }

  const results = [];
  for (const call of verdict.calls) {
    if (a.dryRun) {
      // dry-run 诊断走 stderr：--json 时 stdout 必须是纯 JSON（消费方契约）
      console.error(`[dry-run] ${call.name} ${JSON.stringify(call.arguments)}`);
      results.push({ tool: call.name, args: call.arguments, dryRun: true });
      continue;
    }
    console.error(`→ 执行 ${call.name} ...`);
    const r = runCli(call.name, call.arguments, { provider: a.provider, model: a.model, baseUrl: a.baseUrl, apiKey: a.apiKey });
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* 非 JSON 输出 */ }
    results.push({ tool: call.name, args: call.arguments, exit: r.status, result: parsed ?? r.stdout.slice(0, 500) });
    if (r.status !== 0) {
      console.error(`✗ ${call.name} exit=${r.status}`);
      if (r.stderr) console.error(r.stderr.slice(0, 300));
      if (a.json) console.log(JSON.stringify({ ok: false, calls: verdict.calls, results }, null, 2));
      // 退出码透传：CLI 0/2/3；driver 另有 4=修复轮数耗尽（报告 JSON 内有 verdict 详情）
      process.exitCode = r.status; return;
    }
  }

  if (a.json) {
    console.log(JSON.stringify({ ok: true, calls: verdict.calls, results }, null, 2));
  } else {
    console.log('✓ 全部工具执行成功');
    for (const r of results) console.log(`  ${r.tool}: exit=${r.exit}`);
  }
  process.exitCode = 0;
}

main();
