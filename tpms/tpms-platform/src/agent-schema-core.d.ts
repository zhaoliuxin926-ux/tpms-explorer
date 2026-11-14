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

declare module '*session-core.mjs' {
  export interface SessionCandidate {
    rank: number;
    type: string;
    porosity: number;
    cellSize: number;
    E_GPa: number;
    kappa_m2: number;
    dist_log10: number;
    meetsTarget: boolean;
  }
  export interface SessionRecommendation {
    id: string;
    createdAt: string;
    tool: 'tpms_pareto';
    input: { targetE: number; targetKappaM2: number; top: number };
    reachable: boolean;
    candidates: SessionCandidate[];
    source: string;
  }
  export interface AgentSessionState {
    schemaVersion: number;
    geometrySemantics: string;
    bindingSemantics: string;
    created: string;
    updated: string;
    recommendations: SessionRecommendation[];
    executions: Array<Record<string, unknown>>;
  }
  export type ReferenceResolution =
    | { status: 'none' }
    | { status: 'reject'; reason: string }
    | { status: 'resolved'; recId: string; ordinal: number; candidate: SessionCandidate; meetsTarget: boolean };
  export const SESSION_SCHEMA_VERSION: number;
  export const GEOMETRY_SEMANTICS: string;
  export const BINDING_SEMANTICS: string;
  export function newSession(): AgentSessionState;
  export function validateSessionObject(s: unknown): AgentSessionState;
  export function recordPareto(
    session: AgentSessionState,
    toolArgs: Record<string, unknown>,
    parsed: Record<string, unknown>,
  ): boolean;
  export function recordExecution(session: AgentSessionState, entry: Record<string, unknown>): void;
  export function candidateToMeshArgs(
    candidate: Pick<SessionCandidate, 'type' | 'porosity' | 'cellSize'>,
    outName?: string,
  ): {
    type: string;
    porosity: number;
    periods: number;
    specimen_size_mm: number;
    resolution: number;
    out?: string;
  };
  export function resolveReference(session: AgentSessionState, instruction: string): ReferenceResolution;
}
