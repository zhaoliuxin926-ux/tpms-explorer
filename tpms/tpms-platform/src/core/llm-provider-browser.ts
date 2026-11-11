/**
 * llm-provider-browser.ts — 浏览器 LLM Provider 子集（方向 A）
 *
 * 从 CLI llm-provider.mjs 四通道裁剪：OpenAI 兼容（DeepSeek/OpenRouter 等 CORS 放行端点）
 * + Ollama 本地（OLLAMA_ORIGINS）+ 无 Key 规则兜底（由 main.ts 路径决策，非本模块）。
 *
 * CORS 口径（2026-11-11 实测定案，collab/gemini/2026-11-11-agent-platform-gemini-verdict.md）：
 * 智谱 open.bigmodel.cn 网关=自域白名单，浏览器直连不可达——默认端点列表不含智谱；
 * GO 端点：api.deepseek.com（Origin 回显）/ https://openrouter.ai/api/v1（ACAO *）。
 *
 * Key 纪律（红线）：只存本浏览器 sessionStorage（标签页级，默认）或用户显式勾选后的
 * localStorage（键=BYO_KEY_STORAGE）；严禁进入 DesignState/分享 URL/任何导出产物
 *（.verify/agent_bridge_audit.mjs 结构级审计）。
 *
 * 超时口径（第三轮定案）：单轮总超时对齐 CLI E2 教训=170s（glm-5.x thinking 长尾 150s+
 * 实测），首包 15s 双层 AbortController——防死锁又不误杀长思考链。
 */

/** BYO key 的唯一存储键（sessionStorage 默认；勾选记住后镜像到 localStorage） */
export const BYO_KEY_STORAGE = 'tpms.byo.key';
/** 非敏感 Agent 配置（provider/baseUrl/model/remember）的 localStorage 键 */
export const AGENT_CFG_STORAGE = 'tpms.agent.cfg';

export type AgentProviderKind = 'rules' | 'openai' | 'ollama';

export interface AgentCfg {
  kind: AgentProviderKind;
  baseUrl?: string;
  model?: string;
  rememberKey: boolean;
}

export const DEFAULT_ENDPOINTS: Record<'openai' | 'ollama', string> = {
  openai: 'https://api.deepseek.com',       // CORS GO（2026-11-11 实测）
  ollama: 'http://127.0.0.1:11434',
};

export const DEFAULT_MODELS: Record<'openai' | 'ollama', string> = {
  openai: 'deepseek-chat',
  ollama: 'qwen2.5:7b',
};

/** 五类确定性错误（Gemini Q1 Error Taxonomy；ERR_NO_KEY 在路径决策层处理） */
export type LlmErrorCode =
  | 'ERR_CORS_OR_NETWORK'
  | 'ERR_AUTH_QUOTA'
  | 'ERR_HTTP'
  | 'ERR_TIMEOUT_FIRSTBYTE'
  | 'ERR_TIMEOUT_TOTAL'
  | 'ERR_BAD_PAYLOAD';

export class BrowserLlmError extends Error {
  code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface LlmMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: unknown[]; tool_call_id?: string; }

export interface LlmCompletion { toolCalls: Array<Record<string, unknown>>; raw: string; }

export interface BrowserProvider {
  kind: 'openai' | 'ollama';
  complete(messages: LlmMessage[], tools: Array<Record<string, unknown>>): Promise<LlmCompletion>;
}

const FIRST_BYTE_MS = 15_000;
const TOTAL_MS = 170_000;

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ status: number; json: unknown }> {
  const ac = new AbortController();
  const t1 = window.setTimeout(() => ac.abort(), FIRST_BYTE_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) throw new BrowserLlmError('ERR_TIMEOUT_FIRSTBYTE', `端点 ${FIRST_BYTE_MS / 1000}s 无首包响应`);
    // 浏览器对 CORS 拦截/网络不可达统一抛 TypeError（不含状态细节）
    throw new BrowserLlmError('ERR_CORS_OR_NETWORK', `端点不可达或未放行浏览器跨域（CORS）：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    window.clearTimeout(t1);
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    throw new BrowserLlmError('ERR_AUTH_QUOTA', `HTTP ${res.status}：Key 无效/额度不足/通道不符（套餐端点 vs 标准计费端点）`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BrowserLlmError('ERR_HTTP', `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const t2 = window.setTimeout(() => ac.abort(), Math.max(1000, TOTAL_MS - FIRST_BYTE_MS));
  try {
    const json = await res.json();
    return { status: res.status, json: json as unknown };
  } catch (e) {
    if (ac.signal.aborted) throw new BrowserLlmError('ERR_TIMEOUT_TOTAL', `总超时 ${TOTAL_MS / 1000}s（正文读取中中止——推理模型长思考链场景）`);
    throw new BrowserLlmError('ERR_BAD_PAYLOAD', `响应非 JSON：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    window.clearTimeout(t2);
  }
}

/** OpenAI 兼容通道（决策轮非流式——半截 tool_calls JSON 不得穿透到拦截器） */
class OpenAICompatBrowser implements BrowserProvider {
  kind = 'openai' as const;
  private cfg: { baseUrl: string; apiKey: string; model: string };
  constructor(cfg: { baseUrl: string; apiKey: string; model: string }) { this.cfg = cfg; }

  async complete(messages: LlmMessage[], tools: Array<Record<string, unknown>>): Promise<LlmCompletion> {
    const { json } = await fetchJson(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        temperature: 0,
        ...(tools.length ? { tools } : {}),
      }),
    });
    const msg = (json as { choices?: Array<{ message?: { tool_calls?: Array<Record<string, unknown>>; content?: string } }> }).choices?.[0]?.message ?? {};
    return { toolCalls: msg.tool_calls ?? [], raw: msg.content ?? '' };
  }
}

/** Ollama 本地通道（/api/chat，tools 格式与 OpenAI 兼容） */
class OllamaBrowser implements BrowserProvider {
  kind = 'ollama' as const;
  private cfg: { baseUrl: string; model: string };
  constructor(cfg: { baseUrl: string; model: string }) { this.cfg = cfg; }

  async complete(messages: LlmMessage[], tools: Array<Record<string, unknown>>): Promise<LlmCompletion> {
    const { json } = await fetchJson(`${this.cfg.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        stream: false,
        options: { temperature: 0 },
        ...(tools.length ? { tools } : {}),
      }),
    });
    const msg = (json as { message?: { tool_calls?: Array<Record<string, unknown>>; content?: string } }).message ?? {};
    return { toolCalls: msg.tool_calls ?? [], raw: msg.content ?? '' };
  }
}

export function createBrowserProvider(cfg: AgentCfg, apiKey: string): BrowserProvider {
  if (cfg.kind === 'openai') {
    if (!apiKey) throw new BrowserLlmError('ERR_CORS_OR_NETWORK', 'OpenAI 兼容通道缺 API Key');
    return new OpenAICompatBrowser({
      baseUrl: cfg.baseUrl?.trim() || DEFAULT_ENDPOINTS.openai,
      apiKey,
      model: cfg.model?.trim() || DEFAULT_MODELS.openai,
    });
  }
  if (cfg.kind === 'ollama') return new OllamaBrowser({ baseUrl: cfg.baseUrl?.trim() || DEFAULT_ENDPOINTS.ollama, model: cfg.model?.trim() || DEFAULT_MODELS.ollama });
  throw new Error('rules 模式无 provider');
}

// ── 配置与 Key 存取（Key 纪律红线见文件头）─────────────────────────
export function loadAgentCfg(): AgentCfg {
  const fallback: AgentCfg = { kind: 'rules', rememberKey: false };
  try {
    const raw = localStorage.getItem(AGENT_CFG_STORAGE);
    if (!raw) return fallback;
    const c = JSON.parse(raw) as Partial<AgentCfg>;
    if (c.kind !== 'rules' && c.kind !== 'openai' && c.kind !== 'ollama') return fallback;
    return { kind: c.kind, baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : undefined, model: typeof c.model === 'string' ? c.model : undefined, rememberKey: c.rememberKey === true };
  } catch {
    return fallback;
  }
}

export function saveAgentCfg(cfg: AgentCfg): void {
  try { localStorage.setItem(AGENT_CFG_STORAGE, JSON.stringify(cfg)); } catch { /* 静默 */ }
}

export function getByoKey(): string {
  try {
    return sessionStorage.getItem(BYO_KEY_STORAGE) ?? localStorage.getItem(BYO_KEY_STORAGE) ?? '';
  } catch { return ''; }
}

export function setByoKey(key: string, remember: boolean): void {
  try {
    sessionStorage.setItem(BYO_KEY_STORAGE, key);
    if (remember) localStorage.setItem(BYO_KEY_STORAGE, key);
    else localStorage.removeItem(BYO_KEY_STORAGE);
  } catch { /* 静默 */ }
}
