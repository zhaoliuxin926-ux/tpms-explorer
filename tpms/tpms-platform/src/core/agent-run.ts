/**
 * agent-run.ts — 浏览器 Agent 运行循环（方向 A：Per-Prompt Autonomous Run）
 *
 * 对应 CLI llm-agent.mjs 的 M3 循环（--max-rounds 多轮 tool calling），执行面为页内
 * 状态变更 + 下载触发。治理三件（2026-11-11 三轮定案）：
 *   1. E5 预算窗口=「单次用户 Prompt 触发的自治闭环周期」——本 Run 内 1..maxRounds
 *      跨轮累计 Σ(periods³ mesh) + 512×verify ≤ 4096 不重置，超限熔断该 Run；
 *      Run 结束交还人类后配额自然重置（浏览器层；CLI 层单批次拦截仍在 schema-core）。
 *   2. E11 写写冲突：显式 out 由 schema-core 拦截器查重；视口写（mesh 无 out）由
 *      agent-contract.checkViewportConflicts 查重（首个保留/重复者拒，8d1bddb 语义）。
 *   3. LLM 只填 schema 槽位，validateToolCalls 越界拒绝；工具执行全为确定性代码。
 *
 * 修复语义 v1：verify 失败诊断回填对话，由 LLM 在下一轮经正常 tpms_mesh 调用修正参数
 *（系统提示约束至多 2 次修复）——M4 有界菜单驱动器留待 A3，不在本模块。
 */

export interface ToolExecResult {
  ok: boolean;
  /** 给 LLM 的结构化结果（tool 消息 content） */
  summary: string;
}

export interface ToolImpl {
  name: string;
  /** 是否写主视口状态（参与视口冲突检测） */
  write: boolean;
  exec(args: Record<string, unknown>): Promise<ToolExecResult>;
}

export type AgentEvent =
  | { type: 'round'; round: number }
  | { type: 'tool-start'; name: string; digest: string }
  | { type: 'tool-end'; name: string; result: ToolExecResult }
  | { type: 'llm-error'; code: string; message: string }
  | { type: 'budget-stop'; used: number; limit: number }
  | { type: 'stopped' }
  | { type: 'final'; text: string; rounds: number; budgetUsed: number }
  | { type: 'rejected'; errors: string[] };

export interface RunDeps {
  /** provider.complete(messages, tools) → { toolCalls, raw }（OpenAI 形） */
  complete(messages: Array<Record<string, unknown>>, tools: Array<Record<string, unknown>>): Promise<{ toolCalls: Array<Record<string, unknown>>; raw: string }>;
  /** schema 拦截器（agent-contract.validateToolCalls） */
  validate(toolCalls: unknown): { ok: true; calls: Array<{ name: string; arguments: Record<string, unknown> }> } | { ok: false; errors: string[] };
  /** 视口写冲突检测（agent-contract.checkViewportConflicts） */
  checkViewport(calls: Array<{ name: string; arguments: Record<string, unknown> }>): { ok: true } | { ok: false; errors: string[] };
  tools: Array<Record<string, unknown>>;      // OpenAI 形工具定义（schemaToOllamaTools 产物）
  toolImpls: Map<string, ToolImpl>;
  maxRounds?: number;
  onEvent?: (e: AgentEvent) => void;
  /** 用户手动停止（停止按钮置位） */
  isStopped?: () => boolean;
}

const RUN_BUDGET = 4096;
const VERIFY_COST = 512;
const DEFAULT_MAX_ROUNDS = 4;

const SYSTEM_PROMPT = `你是 TPMS Explorer 平台内的设计助手（浏览器 Agent 模式）。用户用自然语言描述 TPMS 支架设计需求。
你必须通过 tool calling 响应——只填工具定义的参数槽位，不得臆造数值。
工具选择：
- tpms_mesh：从参数更新当前设计（改变视口几何）；带 out 槽位时在几何重建后导出 STL 文件。绝大多数"设计/建一个 X 支架"意图走这里。
- tpms_estimate：仅估算力学指标（E*/屈服强度，Gibson-Ashby 解析口径），不改设计、不产文件。
- tpms_design_verify：对当前设计做制造几何检查（最小壁厚/孔喉/封闭孔腔/连通性）。构建后验证或用户要求"检查可制造性/壁厚"时使用。
- tpms_list：列曲面族/材料清单。
修复原则：tpms_design_verify 报壁厚不足等失败时，优先降 periods 或换曲面族后重调 tpms_mesh（至多 2 次修复尝试）；确定不可达时如实告知，不反复重试。
口径：porosity 按用户表述习惯填 0-1 小数或 1-99 百分数；面板实际可调域为孔隙率 60~90、周期数 1~5，超出会被钳制并在结果中披露。
指代条款：本循环无跨请求历史——"第一个/刚才那个"等指代无上下文可解析时，按默认参数处理并在回复中首先明示。
用户面向回复一律用中文。`;

function toolCallId(c: Record<string, unknown>, i: number): string {
  const fn = c.function as { name?: string } | undefined;
  return (typeof c.id === 'string' && c.id) || `call_${i}_${fn?.name ?? 'x'}`;
}

export async function runAgent(userText: string, deps: RunDeps): Promise<void> {
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const onEvent = deps.onEvent ?? (() => {});
  let budgetUsed = 0;
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userText },
  ];

  for (let round = 1; round <= maxRounds; round++) {
    if (deps.isStopped?.()) { onEvent({ type: 'stopped' }); return; }
    onEvent({ type: 'round', round });
    const out = await deps.complete(messages, deps.tools);
    const check = deps.validate(out.toolCalls);
    if (!check.ok) { onEvent({ type: 'rejected', errors: check.errors }); return; }
    if (!check.calls.length) {
      onEvent({ type: 'final', text: out.raw || '（模型未返回文本）', rounds: round, budgetUsed });
      return;
    }
    const vp = deps.checkViewport(check.calls);
    if (!vp.ok) { onEvent({ type: 'rejected', errors: vp.errors }); return; }

    // 本轮预算核算（Per-Prompt Run 跨轮累计不重置）
    let roundCost = 0;
    for (const c of check.calls) {
      if (c.name === 'tpms_mesh' && typeof c.arguments.periods === 'number') roundCost += c.arguments.periods ** 3;
      if (c.name === 'tpms_design_verify') roundCost += VERIFY_COST;
    }
    if (budgetUsed + roundCost > RUN_BUDGET) { onEvent({ type: 'budget-stop', used: budgetUsed, limit: RUN_BUDGET }); return; }
    budgetUsed += roundCost;

    // 回填 assistant tool_calls 后顺序执行
    messages.push({ role: 'assistant', content: out.raw || '', tool_calls: out.toolCalls });
    for (const [i, c] of check.calls.entries()) {
      if (deps.isStopped?.()) { onEvent({ type: 'stopped' }); return; }
      const impl = deps.toolImpls.get(c.name);
      onEvent({ type: 'tool-start', name: c.name, digest: JSON.stringify(c.arguments).slice(0, 120) });
      let res: ToolExecResult;
      if (!impl) res = { ok: false, summary: `工具 ${c.name} 未在浏览器注册面` };
      else {
        try { res = await impl.exec(c.arguments); }
        catch (e) { res = { ok: false, summary: `执行异常：${e instanceof Error ? e.message : String(e)}` }; }
      }
      onEvent({ type: 'tool-end', name: c.name, result: res });
      messages.push({ role: 'tool', tool_call_id: toolCallId(out.toolCalls[i], i), content: res.summary });
    }
  }
  onEvent({ type: 'final', text: `已达单次指令轮数上限（${maxRounds}）——请基于当前结果继续追问。`, rounds: maxRounds, budgetUsed });
}
