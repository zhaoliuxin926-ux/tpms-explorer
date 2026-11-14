/**
 * agent-contract.ts — Agent 契约桥（方向 A：CLI/Web 单源合流）
 *
 * 契约与拦截器物理单源：直接引用 tpms/agent/tools.schema.json 与 schema-core.mjs
 *（validateToolCalls 含 E5 联合算力预算 + E11 写写冲突，红队 17 案同源语义），
 * Vite 静态打包进浏览器产物——不复制第二份 schema，43 条回归契约跨端逐位一致。
 *
 * 浏览器工具面 = 6 工具（list/estimate/mesh/scenario/design_verify/pareto——与 tools.schema.json 100% 满配）；
 * 其中 tpms_scenario 以安全单段文件名路由至内置场景模板库或当前视口设计并产出 M5 验证报告，
 * 由 .verify/agent_bridge_audit.mjs 同源锁门断言「注册面 ⊆ schema 注册面」。
 */
import { validateToolCalls as validateCore, REPAIR_TOOL as REPAIR_TOOL_CORE, schemaToOllamaTools } from '../../../agent/schema-core.mjs';
import {
  SESSION_SCHEMA_VERSION,
  GEOMETRY_SEMANTICS,
  BINDING_SEMANTICS,
  newSession,
  validateSessionObject,
  recordPareto,
  recordExecution,
  candidateToMeshArgs,
  resolveReference,
  type AgentSessionState,
  type SessionCandidate,
  type SessionRecommendation,
  type ReferenceResolution,
} from '../../../agent/session-core.mjs';
import rawSchema from '../../../agent/tools.schema.json';

export interface ToolSchemaDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOLS_SCHEMA = rawSchema as unknown as { tools: ToolSchemaDef[] };

/** 浏览器注册面（与 CLI schema 6 工具完全同源：list/estimate/mesh/scenario/design_verify/pareto） */
export const BROWSER_TOOL_NAMES = [
  'tpms_list',
  'tpms_estimate',
  'tpms_mesh',
  'tpms_scenario',
  'tpms_design_verify',
  'tpms_pareto',
] as const;

export {
  SESSION_SCHEMA_VERSION,
  GEOMETRY_SEMANTICS,
  BINDING_SEMANTICS,
  newSession,
  validateSessionObject,
  recordPareto,
  recordExecution,
  candidateToMeshArgs,
  resolveReference,
  type AgentSessionState,
  type SessionCandidate,
  type SessionRecommendation,
  type ReferenceResolution,
};

export function browserToolsSchema(): { tools: ToolSchemaDef[] } {
  return { tools: TOOLS_SCHEMA.tools.filter((t) => (BROWSER_TOOL_NAMES as readonly string[]).includes(t.name)) };
}

/** LLM toolCalls → schema 拦截（E5 预算/E11 写冲突/越界拒绝，与 CLI 同源同语义） */
export function validateToolCalls(toolCalls: unknown): { ok: true; calls: Array<{ name: string; arguments: Record<string, unknown> }> } | { ok: false; errors: string[] } {
  return validateCore(toolCalls, browserToolsSchema());
}

/** 扩展面校验（修复轮：基础面 + REPAIR_TOOL；schema 形状与 schema-core 同构） */
export function validateToolCallsIn(toolCalls: unknown, schema: { tools: ToolSchemaDef[] }): { ok: true; calls: Array<{ name: string; arguments: Record<string, unknown> }> } | { ok: false; errors: string[] } {
  return validateCore(toolCalls, schema);
}

/** M4 修复菜单（apply_repair 有界策略，与 tpms-driver 同源）——浏览器修复轮注入用 */
export const REPAIR_TOOL = REPAIR_TOOL_CORE as unknown as ToolSchemaDef;

/** schemaToOllamaTools 转出口（agent-run 构建工具清单用，schema-core 单源） */
export { schemaToOllamaTools };

/** 视口写冲突虚拟槽位（E11 浏览器层：未显式指定 out 的视口写调用同轮互斥） */
export const VIEWPORT_OUT = '__active_viewport__';

/**
 * 浏览器写写冲突检测（Gemini Q1 定案 + 第三轮 E11 语义对齐 8d1bddb：
 * 首个保留执行、重复者精准拒绝——非整批连坐，同轮只读查询不受牵连）。
 * CLI 层的同 out 磁盘冲突由 schema-core 的 E11 拦截器负责（显式 out 重复仍拒）；
 * 本层只补浏览器特有语义：写主视口（tpms_mesh 未带 out）的调用每轮至多一个。
 */
export function checkViewportConflicts(
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
): { ok: true } | { ok: false; errors: string[] } {
  const WRITE_TOOLS = ['tpms_mesh', 'tpms_scenario'];
  let viewportSeen = false;
  const errors: string[] = [];
  for (const c of calls) {
    if (!WRITE_TOOLS.includes(c.name)) continue;
    const hasFileOut = typeof c.arguments.out === 'string' && c.arguments.out.length > 0;
    if (hasFileOut) continue; // 显式文件导出走磁盘名冲突语义（schema-core E11 已查重）
    if (viewportSeen) errors.push(`tool ${c.name}: 本轮已有视口写调用（${VIEWPORT_OUT} 写写冲突，首个保留/重复者拒，E11 浏览器层）`);
    else viewportSeen = true;
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
