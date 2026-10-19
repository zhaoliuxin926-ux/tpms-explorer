/**
 * llm-agent.mjs — M3 Agent 循环：自然语言 → LLM tool calling → CLI 执行
 *
 * 铁律：LLM 只填意图槽位；数值由 validateToolCalls 过 schema 校验（越界拒绝）后交 CLI 确定性执行。
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
  OllamaProvider, MockProvider, OpenAICompatProvider, AnthropicCompatProvider,
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
    else if (s === '--session') a.session = argv[++i];
    else if (s === '--max-rounds') a.maxRounds = Number(argv[++i]);
    else if (s.startsWith('--')) { console.error(`未知选项 ${s}`); process.exit(2); }
    else a._.push(s);
  }
  return a;
}

function runCli(toolName, args, cliOpts = {}) {
  // M3→M4 桥接：tpms_design_verify 不走 tpms.mjs 子命令，直连 tpms-driver 闭环
  if (toolName === 'tpms_design_verify') return runDesignVerify(args, cliOpts);
  // tools.schema 工具名 → CLI 子命令映射（Map 防原型链键穿透，红队 D H-1 同源）
  // tpms_pareto 槽位 snake_case → CLI kebab（schema camelCase≠CLI kebab 映射断裂先例，llm-toolcalling 红队清单）
  const cmdMap = new Map([['tpms_list', 'list'], ['tpms_estimate', 'estimate'], ['tpms_mesh', 'mesh'], ['tpms_scenario', 'scenario'], ['tpms_pareto', 'pareto']]);
  const slotMap = new Map([['target_e_gpa', 'target-e'], ['target_k_nm2', 'target-k']]);
  const cmd = cmdMap.get(toolName);
  if (!cmd) return { status: 2, stdout: '', stderr: `未知工具 ${toolName}` };
  const cliArgs = [TPMS, cmd];
  for (const [k0, v] of Object.entries(args)) {
    const k = slotMap.get(k0) ?? k0;
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
  // timeout 与 runDesignVerify/runVerify 对齐（2026-10-02 审查 L-1：CLI 单命令卡死时 agent 永久挂起）
  const r = spawnSync(process.execPath, cliArgs, { encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** M3→M4 桥接：已校验槽位 → 确定性 design JSON（文件名由白名单 type 派生，单段安全）→ tpms-driver 闭环。
 *  provider 选项转发给 driver（首轮 verify 失败后由同一 LLM 选修复）；TPMS_DRIVER_MOCK_DECISIONS
 *  经 env 自然透传（离线回归：mock 槽位 + mock 修复决策 + 真实 verify 执行）。
 *  design JSON 与 driver 工作副本（.driver.json）、收敛 STL 全部落当前目录（与 CLI 相对路径语义一致）。 */
function runDesignVerify(args, cliOpts) {
  const design = {};
  for (const k of ['type', 'porosity', 'material', 'periods', 'resolution', 'container', 'mode', 'isoGrad', 'out']) {
    if (args[k] !== undefined) design[k] = args[k];
  }
  // pid 后缀防并发同 type 覆盖（2026-10-02 审查 L-2：与 driver 工作副本 .driver-${pid} 同款竞态）
  const designFile = join(process.cwd(), `tpms-design-${args.type}.${process.pid}.json`);
  writeFileSync(designFile, JSON.stringify(design, null, 2));
  const driverArgs = [DRIVER, '--design', designFile, '--json'];
  if (cliOpts.provider) driverArgs.push('--provider', cliOpts.provider);
  if (cliOpts.model) driverArgs.push('--model', cliOpts.model);
  if (cliOpts.baseUrl) driverArgs.push('--base-url', cliOpts.baseUrl);
  if (cliOpts.apiKey) driverArgs.push('--api-key', cliOpts.apiKey);
  const r = spawnSync(process.execPath, driverArgs, {
    encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
  });
  // 【复审 M-2 裁决】不清理 designFile：schema_check「桥接 design JSON 确定性落盘」断言
  // 以文件存在为桥接证据；同 pid 复用同名覆写已防进程内累积，跨进程孤儿量级与旧固定名相同
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const SYSTEM_PROMPT = `你是 TPMS Explorer 的设计助手。用户用自然语言描述 TPMS 支架设计需求。
你必须通过 tool calling 响应——只填工具定义的参数槽位，不得臆造数值，绝不臆造文件名。
工具选择：
- tpms_mesh：从参数直接构建 STL。绝大多数"设计/建一个 X 支架"意图走这里（含圆柱/立方容器、孔隙率、材料等参数组合）——容器形态不是"验证"意图。
- tpms_scenario：仅当用户明确给出或要求某个设计方案 JSON 文件时使用（design 必填且该文件须真实存在，绝不臆造文件名）。
- tpms_estimate：仅当用户只询力学/渗透估算、明确不需要交付文件时使用。
- tpms_list：仅当用户要列曲面/材料清单时使用。
- tpms_design_verify：用户明确要求"验证到通过/闭环/确保交付质量"或所选曲面族可产性不确定时使用——走 verify+自动修复闭环（换族/降周期/升分辨率），收敛交付或结构化不可达宣告；多轮完整构建，明显慢于 tpms_mesh。
- tpms_pareto：用户表达性能愿望而非具体构型时使用（"我要 E≥2GPa 且渗透率不低于 5e-9 的支架""哪种构型力学最好""推荐一个兼顾传质和刚度的设计"）——逆设计推荐 top-k；返回的是设计参数不是 STL，用户确认后可再走 tpms_mesh 构建。
参数含义与边界见各工具的 description；孔隙率按用户表述习惯选 0-1 小数或 1-99 百分数。
若用户意图模糊，选择最合理的默认并在参数中体现；不要反问。但注意：本对话无历史上下文——用户指令中的指代词（"第一个/上面的/刚才那个"）无可解析对象时，绝不臆测其所指，按模糊意图取默认参数处理，并且必须在最终回复中首先明示"指令中的指代无上下文可解析，已按默认 X 处理"（误导用户以为执行了其所指=最严重的信任破坏）。`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const userMsg = a._.join(' ').trim();
  if (!userMsg) {
    console.error('用法: node llm-agent.mjs [--provider ollama|openai|anthropic|mock] [--model X] [--base-url U] [--api-key K] [--dry-run] [--session 会话.json] "<自然语言指令>"');
    process.exit(2);
  }

  // ── 会话模式（批次 4 S1-S3）：加载 + 确定性指代绑定（先于 provider——指代构建不交给模型猜）──
  let session = null;
  if (a.session) {
    const { loadOrCreateSession, resolveReference } = await import('./agent-session.mjs');
    try {
      session = loadOrCreateSession(a.session);
    } catch (e) {
      // 2026-10-19 推送前复核：损坏会话补 JSON 错误出口（曾只写 stderr，机器可读链路断头）
      console.error(`✗ 会话加载失败：${e.message}`);
      if (a.json) console.log(JSON.stringify({ ok: false, mode: 'session', error: `会话加载失败：${e.message}` }, null, 2));
      process.exitCode = 2; return;
    }
    const ref = resolveReference(session, userMsg);
    if (ref.status === 'reject') {
      console.error(`✗ 指代无法解析：${ref.reason}`);
      process.exitCode = 2; return;
    }
    if (ref.status === 'resolved') {
      const { saveSession, recordExecution } = await import('./agent-session.mjs');
      const c = ref.candidate;
      const out = join(dirname(a.session), `mesh-${ref.recId}-cand${ref.ordinal}-${c.type}-p${Math.round(c.porosity * 100)}.stl`);
      const meshArgs = { type: c.type, porosity: c.porosity, periods: c.cellSize, resolution: 96, out };
      if (a.dryRun) {
        console.error(`[dry-run][session] tpms_mesh ${JSON.stringify(meshArgs)}（来自推荐 ${ref.recId} 第 ${ref.ordinal} 项）`);
        if (a.json) console.log(JSON.stringify({ ok: true, mode: 'session-reference', resolvedFrom: { recId: ref.recId, ordinal: ref.ordinal, candidate: c }, args: meshArgs, dryRun: true }, null, 2));
        process.exitCode = 0; return;
      }
      console.error(`→ [session] 指代绑定：推荐 ${ref.recId} 第 ${ref.ordinal} 项 → tpms_mesh ${c.type} p=${c.porosity} k=${c.cellSize}（确定性提取，不经模型）`);
      const r = runCli('tpms_mesh', meshArgs);
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch { /* */ }
      if (r.status === 0) {
        recordExecution(session, {
          fromRecommendation: ref.recId, candidateIndex: ref.ordinal - 1, tool: 'tpms_mesh',
          args: meshArgs, exit: 0, artifacts: [out],
          resultDigest: parsed ? { porosityEstimate: parsed.porosityEstimate, watertight: parsed.watertight, fileBytes: parsed.fileBytes } : undefined,
          source: 'session-reference 确定性绑定',
        });
        saveSession(a.session, session);
      }
      if (a.json) {
        console.log(JSON.stringify({ ok: r.status === 0, mode: 'session-reference', resolvedFrom: { recId: ref.recId, ordinal: ref.ordinal, candidate: c }, args: meshArgs, results: [{ tool: 'tpms_mesh', args: meshArgs, exit: r.status, result: parsed ?? (r.stdout || '').slice(0, 500) }] }, null, 2));
      } else if (r.status === 0) {
        console.log(`✓ 会话指代构建完成：${out}`);
        console.log(`  来源：推荐 ${ref.recId} 候选 ${ref.ordinal}（${c.type} p=${c.porosity} k=${c.cellSize}，代理估值 E=${c.E_GPa?.toFixed?.(2) ?? c.E_GPa}GPa——解析近似非 FE）`);
      } else {
        console.error(`✗ tpms_mesh exit=${r.status}`);
        if (r.stderr) console.error(r.stderr.slice(0, 300));
      }
      process.exitCode = r.status; return;
    }
    // status==='none'：普通指令 → 走 LLM 路径（推荐结果稍后记录）
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
      // 推理模型（glm-5.x）对对抗/陷阱指令深思可达 150s+，120s 默认间歇击穿
      // （E2 实测 3 次中 1 次超时、2 次 ~130s 正常）；170s 贴回归 spawnSync 180s 上限。
      // TPMS_LLM_TIMEOUT_MS 可覆盖（红队 B3：死端点等待期可调；Ollama 本地路径无服务端
      // 负载方差，维持 provider 默认 120s 不对称是合理差异）
      timeoutMs: Number(process.env.TPMS_LLM_TIMEOUT_MS) || 170_000,
    });
    } catch (e) { console.error('✗ Provider 构造失败: ' + (e?.message ?? e)); process.exitCode = 2; return; } // 红队 C C-6
  } else if (a.provider === 'anthropic') {
    // Anthropic 兼容通道（智谱 Coding Plan 订阅额度在此抵扣；2026-10-01 实测同 key
    // paas/v4 调 5.3 得 429/1113、anthropic 通道成功）：key 走 TPMS_LLM_API_KEY 或 --api-key
    try {
    provider = new AnthropicCompatProvider({
      baseUrl: a.baseUrl ?? process.env.TPMS_LLM_BASE_URL,
      apiKey: a.apiKey ?? process.env.TPMS_LLM_API_KEY,
      model: a.model ?? process.env.TPMS_LLM_MODEL ?? 'glm-5.3',
      timeoutMs: Number(process.env.TPMS_LLM_TIMEOUT_MS) || 170_000,
    });
    } catch (e) { console.error('✗ Provider 构造失败: ' + (e?.message ?? e)); process.exitCode = 2; return; }
  } else {
    provider = new OllamaProvider({ baseUrl: a.baseUrl, model: a.model });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ];

  // ── 有界多轮编排（批次 5 T2/T3）：--max-rounds N（默认 1=历史单轮行为完全不变）。
  // 每轮：provider → schema 拦截器（逐轮校验）→ 执行 → 结果按 tool_call_id 回填历史
  // → 下一轮；模型不再发 toolCalls（纯文本终答）或轮数耗尽即终。轮数硬帽 8。
  // 红队 2026-10-11：非有限数（如 --max-rounds abc → NaN）曾直入循环致裸崩 exit1——
  // 违反退出码契约；参数卫生前置（结构化 exit2）
  if (a.maxRounds !== undefined && (!Number.isFinite(a.maxRounds) || a.maxRounds < 1)) {
    console.error('--max-rounds 需为 ≥1 的有限数字');
    process.exit(2);
  }
  const maxRounds = Math.min(8, Math.max(1, Math.floor(a.maxRounds ?? 1)));
  const results = [];
  let verdict = null;
  let llmOut = null;
  let finalText = '';
  for (let round = 1; round <= maxRounds; round++) {
    let out;
    try {
      out = await provider.complete(messages, tools);
    } catch (e) {
      console.error(`✗ LLM 调用失败（第 ${round} 轮）: ${e.message}`);
      console.error('  提示: ollama 需已启动（ollama serve）且模型已拉取；openai 兼容端点需 TPMS_LLM_API_KEY/TPMS_LLM_BASE_URL 或对应 flag');
      // 【2026-09-12】process.exit 在 undici async 句柄存活时触发 libuv win/async.c 断言（污染退出码）——
      // 全部改 exitCode + return 自然排空（fetch 已完成、定时器已清、Connection: close 下排空即时）
      process.exitCode = 2; return;
    }
    llmOut = out;
    if (!out.toolCalls?.length) {
      if (round === 1) {
        console.error('✗ LLM 未返回 tool calls（仅文本回复）。指令可能过于模糊，或模型不支持 function calling。');
        if (out.raw) console.error(`  LLM 文本: ${out.raw.slice(0, 200)}`);
        process.exitCode = 2; return;
      }
      finalText = out.raw || '';   // 编排终轮：模型给出总结文本，正常收束
      break;
    }

    // 铁律：schema 拦截器逐槽位校验（每轮重新过——T2）
    verdict = validateToolCalls(out.toolCalls, schema);
    if (!verdict.ok) {
      console.error(`✗ LLM 产出被 schema 拦截器拒绝（第 ${round} 轮）:`);
      for (const e of verdict.errors) console.error(`  - ${e}`);
      process.exitCode = 2; return;
    }

    const roundExecuted = [];
    for (const call of verdict.calls) {
      if (a.dryRun) {
        // dry-run 诊断走 stderr：--json 时 stdout 必须是纯 JSON（消费方契约）
        console.error(`[dry-run][r${round}] ${call.name} ${JSON.stringify(call.arguments)}`);
        results.push({ tool: call.name, args: call.arguments, dryRun: true, round });
        roundExecuted.push({ call, result: null });
        continue;
      }
      console.error(`→ 执行 [r${round}] ${call.name} ...`);
      const r = runCli(call.name, call.arguments, { provider: a.provider, model: a.model, baseUrl: a.baseUrl, apiKey: a.apiKey });
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch { /* 非 JSON 输出 */ }
      results.push({ tool: call.name, args: call.arguments, exit: r.status, result: parsed ?? r.stdout.slice(0, 500), round });
      roundExecuted.push({ call, result: parsed ?? r.stdout.slice(0, 500) });
      // 会话模式：tpms_pareto 成功结果落推荐集（S1/S3——候选+代理口径快照）
      if (session && r.status === 0 && call.name === 'tpms_pareto') {
        const { recordPareto } = await import('./agent-session.mjs');
        recordPareto(session, call.arguments, parsed);
      }
      if (r.status !== 0) {
        console.error(`✗ ${call.name} exit=${r.status}`);
        if (r.stderr) console.error(r.stderr.slice(0, 300));
        if (a.json) console.log(JSON.stringify({ ok: false, calls: verdict.calls, results, rounds: round }, null, 2));
        // 退出码透传：CLI 0/2/3；driver 另有 4=修复轮数耗尽（报告 JSON 内有 verdict 详情）
        if (session) { const { saveSession } = await import('./agent-session.mjs'); saveSession(a.session, session); }
        process.exitCode = r.status; return;
      }
    }

    // 结果回填历史（T2：tool_call_id 关联保留——OpenAI/Ollama 原生形态；Anthropic
    // provider 内做 tool_result 块映射）
    messages.push({ role: 'assistant', content: out.raw || '', tool_calls: out.toolCalls });
    for (const { call, result } of roundExecuted) {
      messages.push({ role: 'tool', tool_call_id: call.id ?? call.function?.id ?? `r${round}-${results.length}`, content: JSON.stringify(result ?? {}).slice(0, 4000) });
    }
    if (round === maxRounds && maxRounds > 1) {
      // 轮数耗尽：如实报告（不虚报"模型已完成"）——已执行结果保留在 results
      finalText = `（编排轮数上限 ${maxRounds} 已用尽——以上为已完成的 ${results.length} 次调用结果）`;
    }
  }

  if (a.json) {
    console.log(JSON.stringify({ ok: true, calls: verdict.calls, results, modelNote: (finalText || llmOut.raw || '').slice(0, 300) || undefined, rounds: maxRounds }, null, 2));
  } else {
    console.log('✓ 全部工具执行成功');
    // 模型备注出口（2026-10-06 指代披露对抗：模型在 toolCalls 外的说明文本——如
    // "指代无上下文，已按默认处理"——此前无输出通道，披露要求落空；成功路径同样呈现）
    if (finalText || llmOut.raw) console.log(`ℹ 模型备注: ${(finalText || llmOut.raw).slice(0, 200)}`);
    for (const r of results) console.log(`  ${r.tool}: exit=${r.exit}`);
  }
  // 会话模式：成功路径落盘（推荐集更新/幂等不重复记录）
  if (session) {
    const { saveSession } = await import('./agent-session.mjs');
    saveSession(a.session, session);
  }
  process.exitCode = 0;
}

main();
