/**
 * agent-schema-core.d.ts — tpms/agent/schema-core.mjs 的类型声明（方向 A 单源桥）
 *
 * 实现在仓库 tpms/agent/schema-core.mjs（零 Node 依赖纯模块，CLI 与 Web 同源字节）；
 * tsconfig 不开 allowJs，此处以通配 ambient 声明供给 tsc；运行时/打包由 Vite 解析同源文件。
 */
declare module '*schema-core.mjs' {
  export interface ValidatedCall { name: string; arguments: Record<string, unknown>; }
  export interface ToolSchemaDef { name: string; description: string; parameters: Record<string, unknown>; }
  export function validateToolCalls(
    toolCalls: unknown,
    schema: { tools: ToolSchemaDef[] },
  ): { ok: true; calls: ValidatedCall[] } | { ok: false; errors: string[] };
  export function schemaToOllamaTools(schema: { tools: ToolSchemaDef[] }): Array<Record<string, unknown>>;
  export const REPAIR_TYPES: string[];
  export const REPAIR_TOOL: Record<string, unknown>;
}
