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
 * 退出码：0=成功 2=参数/LLM 输出被拒 3=CLI 构建/水密失败
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadToolsSchema, validateToolCalls, schemaToOllamaTools,
  OllamaProvider, MockProvider,
} from './llm-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPMS = join(HERE, 'tpms.mjs');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--provider') a.provider = argv[++i];
    else if (s === '--model') a.model = argv[++i];
    else if (s === '--base-url') a.baseUrl = argv[++i];
    else if (s === '--dry-run') a.dryRun = true;
    else if (s === '--json') a.json = true;
    else if (s.startsWith('--')) { console.error(`未知选项 ${s}`); process.exit(2); }
    else a._.push(s);
  }
  return a;
}

function runCli(toolName, args) {
  // tools.schema 工具名 → CLI 子命令映射
  const cmdMap = { tpms_list: 'list', tpms_estimate: 'estimate', tpms_mesh: 'mesh', tpms_scenario: 'scenario' };
  const cmd = cmdMap[toolName];
  if (!cmd) return { status: 2, stdout: '', stderr: `未知工具 ${toolName}` };
  const cliArgs = [TPMS, cmd];
  for (const [k, v] of Object.entries(args)) {
    if (v === true) cliArgs.push(`--${k}`);
    else if (v !== false && v !== undefined && v !== null) cliArgs.push(`--${k}`, String(v));
  }
  if (!args.json) cliArgs.push('--json');
  const r = spawnSync(process.execPath, cliArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const SYSTEM_PROMPT = `你是 TPMS Explorer 的设计助手。用户用自然语言描述 TPMS 支架设计需求。
你必须通过 tool calling 响应——只填工具定义的参数槽位，不得臆造数值。
参数含义与边界见各工具的 description。优先使用 tpms_scenario（端到端交付）或 tpms_mesh（仅 STL）。
若用户意图模糊，选择最合理的默认并在参数中体现；不要反问。`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const userMsg = a._.join(' ').trim();
  if (!userMsg) {
    console.error('用法: node llm-agent.mjs [--provider ollama|mock] [--model X] [--dry-run] "<自然语言指令>"');
    process.exit(2);
  }

  const schema = loadToolsSchema();
  const tools = schemaToOllamaTools(schema);

  let provider;
  if (a.provider === 'mock') {
    // Mock：从 stdin 或环境读预设 toolCalls（回归测试用）
    const preset = process.env.TPMS_MOCK_TOOLCALLS
      ? JSON.parse(process.env.TPMS_MOCK_TOOLCALLS)
      : { toolCalls: [{ function: { name: 'tpms_list', arguments: '{}' } }] };
    provider = new MockProvider(preset);
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
    console.error('  提示: 确认 Ollama 已启动（ollama serve）且模型已拉取（ollama pull qwen2.5:7b）');
    process.exit(2);
  }

  if (!llmOut.toolCalls?.length) {
    console.error('✗ LLM 未返回 tool calls（仅文本回复）。指令可能过于模糊，或模型不支持 function calling。');
    if (llmOut.raw) console.error(`  LLM 文本: ${llmOut.raw.slice(0, 200)}`);
    process.exit(2);
  }

  // 铁律：schema 拦截器逐槽位钳制
  const verdict = validateToolCalls(llmOut.toolCalls, schema);
  if (!verdict.ok) {
    console.error('✗ LLM 产出被 schema 拦截器拒绝:');
    for (const e of verdict.errors) console.error(`  - ${e}`);
    process.exit(2);
  }

  const results = [];
  for (const call of verdict.calls) {
    if (a.dryRun) {
      console.log(`[dry-run] ${call.name} ${JSON.stringify(call.arguments)}`);
      results.push({ tool: call.name, args: call.arguments, dryRun: true });
      continue;
    }
    console.error(`→ 执行 ${call.name} ...`);
    const r = runCli(call.name, call.arguments);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { /* 非 JSON 输出 */ }
    results.push({ tool: call.name, args: call.arguments, exit: r.status, result: parsed ?? r.stdout.slice(0, 500) });
    if (r.status !== 0) {
      console.error(`✗ ${call.name} exit=${r.status}`);
      if (r.stderr) console.error(r.stderr.slice(0, 300));
      if (a.json) console.log(JSON.stringify({ ok: false, calls: verdict.calls, results }, null, 2));
      process.exit(r.status === 3 ? 3 : 2);
    }
  }

  if (a.json) {
    console.log(JSON.stringify({ ok: true, calls: verdict.calls, results }, null, 2));
  } else {
    console.log('✓ 全部工具执行成功');
    for (const r of results) console.log(`  ${r.tool}: exit=${r.exit}`);
  }
  process.exit(0);
}

main();
