/**
 * agent-run.ts — 浏览器 Agent 运行循环（方向 A：Per-Prompt Autonomous Run）
 *
 * 对应 CLI llm-agent.mjs 的 M3 循环（--max-rounds 多轮 tool calling），执行面为页内
 * 状态变更 + 下载触发。治理四件（2026-11-11 三轮定案 + A3-M4）：
 *   1. E5 预算窗口=「单次用户 Prompt 触发的自治闭环周期」——本 Run 内 1..maxRounds
 *      跨轮累计 Σ(periods³ mesh/repair) + 512×verify ≤ 4096 不重置，超限熔断该 Run；
 *   2. E11 写写冲突：显式 out 由 schema-core 拦截器查重；视口写（mesh 无 out）由
 *      checkViewportConflicts 查重（首个保留/重复者拒，8d1bddb 语义）；
 *   3. LLM 只填 schema 槽位，validateToolCalls 越界拒绝；工具执行全为确定性代码；
 *   4. M4 有界修复菜单（A3）：design_verify 失败后的下一轮注入 apply_repair（REPAIR_TOOL
 *      与 tpms-driver 同源），LLM 只能在 patch_design/declare_unreachable 内选——修复
 *      应用为确定性代码，轮上限 MAX_REPAIRS=2，patches.periods³ 计入预算。
 *
 * 本模块零 DOM 依赖（可被 .verify 门禁以脚本化 provider 直接跑真循环）。
 */

import { browserToolsSchema, validateToolCallsIn, checkViewportConflicts, REPAIR_TOOL, schemaToOllamaTools } from './agent-contract';

export interface ToolExecResult {
  ok: boolean;
  /** 给 LLM 的结构化结果（tool 消息 content） */
  summary: string;
  /** design_verify 专用：制造审计 verdict=fail 时置位——触发修复轮 */
  verifyFail?: boolean;
  /** 可选同步状态快照（避免写后立即再发 get-state RPC 在重绘期超时） */
  state?: Record<string, unknown>;
}

export interface ToolImpl {
  name: string;
  /** 是否写主视口状态（参与视口冲突检测） */
  write: boolean;
  exec(args: Record<string, unknown>): Promise<ToolExecResult>;
}

export type AgentEvent =
  | { type: 'round'; round: number; repairMode: boolean }
  | { type: 'tool-start'; name: string; digest: string }
  | { type: 'tool-end'; name: string; result: ToolExecResult; budgetUsed: number }
  | { type: 'repair-applied'; patches: Record<string, unknown>; reason: string }
  | { type: 'llm-error'; code: string; message: string }
  | { type: 'budget-stop'; used: number; limit: number }
  | { type: 'stopped' }
  | { type: 'final'; text: string; rounds: number; budgetUsed: number }
  | { type: 'rejected'; errors: string[] };

export interface RunDeps {
  /** provider.complete(messages, tools) → { toolCalls, raw }（OpenAI 形） */
  complete(messages: Array<Record<string, unknown>>, tools: Array<Record<string, unknown>>): Promise<{ toolCalls: Array<Record<string, unknown>>; raw: string }>;
  toolImpls: Map<string, ToolImpl>;
  /** M4 修复执行器（有界菜单 patch_design 的确定性应用）；缺省则不注入修复轮 */
  repairExec?: (patches: Record<string, unknown>) => Promise<ToolExecResult>;
  maxRounds?: number;
  onEvent?: (e: AgentEvent) => void;
  /** 用户手动停止（停止按钮置位） */
  isStopped?: () => boolean;
  /** 可选多轮对话历史（滑动窗口 user/assistant 消息；不包含 system） */
  history?: Array<Record<string, unknown>>;
}

const RUN_BUDGET = 4096;
const VERIFY_COST = 512;
const SCENARIO_COST = 216;
const PARETO_COST = 64;
const MAX_REPAIRS = 2;
const DEFAULT_MAX_ROUNDS = 6;

const SYSTEM_PROMPT = `你是 TPMS Explorer 平台内的仿真与逆设计助手（浏览器 Agent 模式）。用户用自然语言描述 TPMS 支架或多孔介质设计需求。
你必须通过 tool calling 响应——只填工具定义的参数槽位，不得臆造数值。
工具选择：
- tpms_pareto：逆设计帕累托前沿推荐。给定目标等效模量（target_e_gpa，单位 GPa）与目标渗透率（target_k_nm2，单位 ×10⁻⁹ m²），在 26 族 × 孔隙率 0.55..0.90 × 单胞 2..5 mm 的解析前沿上推荐 top-k 方案。用户询问"推荐什么构型/选型"时优先调用此工具；给出推荐后等待用户选择或指代，除非用户明确要求同时构建，否则不要擅自覆盖视口。
- tpms_mesh：从参数更新当前设计（改变视口几何）；带 out 槽位时在几何重建后导出 STL 文件。明确要求"构建/建模/改成/导出"时使用。
- tpms_scenario：端到端 M5 场景交付与审计模板（参数为 design 单段安全文件名，如 bone_scaffold.json / gyroid_implant.json / diamond_load.json / primitive_flow.json / iwp_stiff.json / current.json），仅当用户明确要求运行场景模板或给出 .json 文件名时使用。
- tpms_estimate：仅估算力学与渗透率指标（E*/屈服强度/Sv/Kozeny-Carman κ，以及 gyroid 的 OpenFOAM R48 CFD 标定 κ），不改设计、不产文件。
- tpms_design_verify：对当前设计做制造与输运几何检查（最小壁厚/孔喉/封闭孔腔/连通性/三向迂曲度）。构建后验证或用户要求"检查可制造性/壁厚/连通性"时使用。
- tpms_list：列曲面族/材料清单。
- apply_repair（仅当上一轮 tpms_design_verify 失败后出现）：在有界修复菜单中选择下一步——patch_design 提交参数补丁（一次一小步，只动与失败相关的槽位）或 declare_unreachable 宣告结构化不可达（如深水区组合）。同一修复连续失败两次后应宣告不可达。
口径：porosity 按用户表述习惯填 0-1 小数或 1-99 百分数；面板实际可调域为孔隙率 60~90、周期数 1~5，超出会被钳制并在结果中披露。
指代条款：当会话层已启用确定性指代绑定时，"构建第 N 个"由确定性会话绑定直接处理；其他指代或无上下文时，先说明再按保守默认处理。
用户面向回复一律用中文，并如实区分解析近似与 FE/CFD 标定口径，严禁将解析估算宣称为已实跑有限元或 CFD 仿真。`;

function toolCallId(c: Record<string, unknown>, i: number): string {
  const fn = c.function as { name?: string } | undefined;
  return (typeof c.id === 'string' && c.id) || `call_${i}_${fn?.name ?? 'x'}`;
}

export async function runAgent(userText: string, deps: RunDeps): Promise<void> {
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const onEvent = deps.onEvent ?? (() => {});
  let budgetUsed = 0;
  let repairs = 0;
  let pendingRepair = false;   // 上一轮 verify 失败且还有修复余额 → 本轮注入修复菜单
  const canRepair = () => deps.repairExec != null && repairs < MAX_REPAIRS;

  const baseTools = schemaToOllamaTools(browserToolsSchema());
  const baseSchema = browserToolsSchema();
  const repairTools = [...baseTools, { type: 'function', function: REPAIR_TOOL }];
  const repairSchema = { tools: [...baseSchema.tools, REPAIR_TOOL] };

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(deps.history ?? []),
    { role: 'user', content: userText },
  ];

  for (let round = 1; round <= maxRounds; round++) {
    if (deps.isStopped?.()) { onEvent({ type: 'stopped' }); return; }
    const repairMode = pendingRepair && canRepair();
    onEvent({ type: 'round', round, repairMode });
    const tools = repairMode ? repairTools : baseTools;
    const out = await deps.complete(messages, tools as never);
    // 校验面与 offered 工具面一致：修复轮含 apply_repair（扩展面），常规轮仅基础面
    const checkFinal = validateToolCallsIn(out.toolCalls, repairMode ? repairSchema : baseSchema);
    if (!checkFinal.ok) { onEvent({ type: 'rejected', errors: checkFinal.errors }); return; }
    if (!checkFinal.calls.length) {
      onEvent({ type: 'final', text: out.raw || '（模型未返回文本）', rounds: round, budgetUsed });
      return;
    }
    const vp = checkViewportConflicts(checkFinal.calls);
    if (!vp.ok) { onEvent({ type: 'rejected', errors: vp.errors }); return; }

    // 本轮预算核算（Per-Prompt Run 跨轮累计不重置）
    let roundCost = 0;
    for (const c of checkFinal.calls) {
      if (c.name === 'tpms_mesh' && typeof c.arguments.periods === 'number') roundCost += c.arguments.periods ** 3;
      if (c.name === 'tpms_scenario') roundCost += SCENARIO_COST;
      if (c.name === 'tpms_design_verify') roundCost += VERIFY_COST;
      if (c.name === 'tpms_pareto') roundCost += PARETO_COST;
      if (c.name === 'apply_repair' && typeof c.arguments.patches === 'object' && c.arguments.patches != null
        && typeof (c.arguments.patches as Record<string, unknown>).periods === 'number') {
        roundCost += ((c.arguments.patches as Record<string, unknown>).periods as number) ** 3;
      }
    }
    if (budgetUsed + roundCost > RUN_BUDGET) { onEvent({ type: 'budget-stop', used: budgetUsed, limit: RUN_BUDGET }); return; }
    budgetUsed += roundCost;

    messages.push({ role: 'assistant', content: out.raw || '', tool_calls: out.toolCalls });
    for (const [i, c] of checkFinal.calls.entries()) {
      if (deps.isStopped?.()) { onEvent({ type: 'stopped' }); return; }

      // M4 修复分支：apply_repair 不走 toolImpls，由确定性 repairExec 应用
      if (c.name === 'apply_repair') {
        const action = c.arguments.action;
        const patches = (c.arguments.patches as Record<string, unknown>) ?? {};
        const reason = String(c.arguments.reason ?? '');
        if (action === 'declare_unreachable') {
          onEvent({ type: 'final', text: `结构化不可达宣告：${reason || '（模型未给理由）'}——当前参数组合在本平台可产域外，请换曲面族/容器或调整目标。`, rounds: round, budgetUsed });
          return;
        }
        onEvent({ type: 'repair-applied', patches, reason });
        const applied = await deps.repairExec!(patches);
        messages.push({ role: 'tool', tool_call_id: toolCallId(out.toolCalls[i], i), content: applied.summary });
        repairs++;
        pendingRepair = false; // 修复已应用，交还主循环（LLM 可再 verify 或收尾）
        continue;
      }

      const impl = deps.toolImpls.get(c.name);
      onEvent({ type: 'tool-start', name: c.name, digest: JSON.stringify(c.arguments).slice(0, 120) });
      let res: ToolExecResult;
      if (!impl) res = { ok: false, summary: `工具 ${c.name} 未在浏览器注册面` };
      else {
        try { res = await impl.exec(c.arguments); }
        catch (e) { res = { ok: false, summary: `执行异常：${e instanceof Error ? e.message : String(e)}` }; }
      }
      onEvent({ type: 'tool-end', name: c.name, result: res, budgetUsed });
      if (c.name === 'tpms_design_verify' && res.verifyFail) pendingRepair = true;
      messages.push({ role: 'tool', tool_call_id: toolCallId(out.toolCalls[i], i), content: res.summary });
    }
  }
  onEvent({ type: 'final', text: `已达单次指令轮数上限（${maxRounds}）——请基于当前结果继续追问。`, rounds: maxRounds, budgetUsed });
}
