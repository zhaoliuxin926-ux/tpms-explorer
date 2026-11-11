/**
 * llm-provider.mjs — M3 LLM 接入层：统一 Provider 抽象 + Ollama 本地实现
 *
 * 铁律（ROADMAP M3）：
 *   LLM 只产出 tools.schema.json 定义的参数槽位，一切数值由 CLI 确定性代码生成或校验；
 *   越界值 100% 被拒绝（validateValue 不钳制），无静默回退。
 *
 * 设计：
 *   - Provider 接口：complete(messages, tools) → { toolCalls, raw }
 *   - OllamaProvider：POST /api/chat（支持 tools/function-calling）
 *   - 输出拦截器：validateToolCalls() 逐槽位过 schema 校验（越界拒绝），非法值 → 结构化拒绝
 *
 * 2026-11-11 方向 A 抽离：validateToolCalls / schemaToOllamaTools 迁至 schema-core.mjs
 *（零 Node 依赖单源模块，浏览器端 Vite 打包同源），此处转出口保持既有 import 路径兼容。
 *
 * 用法：
 *   node llm-agent.mjs --provider ollama --model qwen2.5:7b "设计一个孔隙率 75% 的 Gyroid 骨支架"
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export { validateToolCalls, schemaToOllamaTools } from './schema-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Schema 加载 ──────────────────────────────────────────────────
export function loadToolsSchema() {
  return JSON.parse(readFileSync(join(HERE, 'tools.schema.json'), 'utf8'));
}

// ── Provider 抽象 ────────────────────────────────────────────────
export class LLMProvider {
  /** @returns {Promise<{toolCalls: Array, raw: string}>} */
  async complete(_messages, _tools) {
    throw new Error('LLMProvider.complete 未实现');
  }
}

// ── Ollama 本地 Provider ─────────────────────────────────────────
export class OllamaProvider extends LLMProvider {
  /**
   * @param {{ baseUrl?: string, model?: string, temperature?: number, timeoutMs?: number }} opts
   */
  constructor(opts = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = opts.model ?? 'qwen2.5:7b';
    this.temperature = opts.temperature ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 120_000; // 无超时=对不响应的服务端永久挂起（红队 A-2）
  }

  async complete(messages, tools) {
    // Ollama /api/chat 的 tools 格式与 OpenAI 兼容
    const body = {
      model: this.model,
      messages,
      stream: false,
      options: { temperature: this.temperature },
      ...(tools?.length ? { tools } : {}),
    };
    // 手写 AbortController+clearTimeout：AbortSignal.timeout 的句柄在 process.exit 时
    // 触发 libuv win/async.c 断言崩溃（Windows 实测），退出码被污染。
    // 计时器须覆盖到正文读取结束：只罩到响应头=服务器发完头后挂起正文仍永久卡死
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
        err.own = true; // 已按 HTTP 状态包装，外层原样透传（除非期间发生中止）
        throw err;
      }
      const json = await res.json();
      const msg = json.message ?? {};
      return { toolCalls: msg.tool_calls ?? [], raw: msg.content ?? '' };
    } catch (e) {
      // 中止态一律超时语义：res.text 的 .catch(()=> '') 会吞 AbortError，只能以 signal 状态为准
      if (ac.signal.aborted) throw new Error(`Ollama ${this.timeoutMs}ms 无响应（timeout）`);
      if (e?.own) throw e;
      throw new Error(`Ollama 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── OpenAI 兼容 Provider（智谱/DeepSeek/LM Studio/任意 OpenAI 格式端点）──
export class OpenAICompatProvider extends LLMProvider {
  /**
   * @param {{ baseUrl?: string, apiKey?: string, model?: string, temperature?: number, timeoutMs?: number }} opts
   * baseUrl 须含版本段（如 https://open.bigmodel.cn/api/paas/v4 或 https://api.deepseek.com）；key 走环境变量或 --api-key，不得入库
   */
  constructor(opts = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    if (!opts.apiKey) throw new Error('OpenAICompatProvider 缺 apiKey（设 TPMS_LLM_API_KEY 或 --api-key）');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'gpt-4o-mini';
    this.temperature = opts.temperature ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 120_000; // 无超时=对不响应的服务端永久挂起（红队 A-2 同源）
  }

  async complete(messages, tools) {
    const body = {
      model: this.model,
      messages,
      temperature: this.temperature,
      ...(tools?.length ? { tools } : {}),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, Connection: 'close' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        err.own = true;
        throw err;
      }
      const json = await res.json();
      const msg = json.choices?.[0]?.message ?? {};
      return { toolCalls: msg.tool_calls ?? [], raw: msg.content ?? '' };
    } catch (e) {
      if (ac.signal.aborted) throw new Error(`端点 ${this.timeoutMs}ms 无响应（timeout）`);
      if (e?.own) throw e;
      throw new Error(`端点连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Anthropic 兼容 Provider（智谱 Coding Plan 通道等 /v1/messages 协议端点）──
// 背景（2026-10-01 实测）：GLM Coding Plan 订阅额度绑定 Anthropic 兼容通道
//（open.bigmodel.cn/api/anthropic，Claude Code 类工具的接入路径），不抵扣开放平台
// paas/v4 按量通道——同 key 在 paas/v4 调 glm-5.3 得 429/1113，在 anthropic 通道成功。
// 本类让订阅用户零额外成本跑满血模型回归。
// 注意（2026-11-11 CORS 实测）：open.bigmodel.cn 网关 CORS 为自域白名单（第三方 Origin
// preflight 无 ACA 头），浏览器直连不可达——本通道仅限 CLI/服务端使用。
export class AnthropicCompatProvider extends LLMProvider {
  /**
   * @param {{ baseUrl?: string, apiKey?: string, model?: string, temperature?: number, timeoutMs?: number, maxTokens?: number }} opts
   * baseUrl 如 https://open.bigmodel.cn/api/anthropic（自动拼 /v1/messages）
   */
  constructor(opts = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'https://open.bigmodel.cn/api/anthropic').replace(/\/$/, '');
    if (!opts.apiKey) throw new Error('AnthropicCompatProvider 缺 apiKey（设 TPMS_LLM_API_KEY 或 --api-key）');
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'glm-5.3';
    this.temperature = opts.temperature ?? 0;
    this.maxTokens = opts.maxTokens ?? 4096; // anthropic 协议 max_tokens 必填
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(messages, tools) {
    // OpenAI messages → anthropic：system 抽顶层；assistant.tool_calls → tool_use 块；
    // tool 角色（结果回填）→ user tool_result 块（tool_call_id 关联保留——批次 5 T2
    // 工具历史兼容：多轮编排时结果按 ID 回到对应调用）
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const msgs = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id ?? m.toolCallId ?? '', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }] });
      } else if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const content = [];
        if (m.content) content.push({ type: 'text', text: String(m.content) });
        for (const tc of m.tool_calls) {
          let input = {};
          try { input = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments ?? {}); } catch { /* 畸形 JSON 由拦截器结构化拒绝 */ }
          content.push({ type: 'tool_use', id: tc.id ?? '', name: tc.function?.name ?? '', input });
        }
        msgs.push({ role: 'assistant', content });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }
    const body = {
      model: this.model,
      max_tokens: this.maxTokens,
      ...(system ? { system } : {}),
      messages: msgs,
      ...(this.temperature != null ? { temperature: this.temperature } : {}),
      // OpenAI tools → anthropic：{type:'function',function:{...}} → {name,description,input_schema}
      ...(tools?.length ? {
        tools: tools.map((t) => ({
          name: t.function?.name ?? t.name,
          description: t.function?.description ?? t.description,
          input_schema: t.function?.parameters ?? t.parameters,
        })),
      } : {}),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          Connection: 'close',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        err.own = true;
        throw err;
      }
      const json = await res.json();
      // anthropic content 块：text 拼接为 raw；tool_use 转回 OpenAI 形（validateToolCalls 双形兼容，
      // 统一为 function 形让下游单一口径）；thinking 等块忽略
      const rawParts = [];
      const toolCalls = [];
      for (const blk of json.content ?? []) {
        if (blk.type === 'text') rawParts.push(blk.text);
        else if (blk.type === 'tool_use') {
          toolCalls.push({
            id: blk.id,
            type: 'function',
            function: { name: blk.name, arguments: JSON.stringify(blk.input ?? {}) },
          });
        }
      }
      return { toolCalls, raw: rawParts.join('\n') };
    } catch (e) {
      if (ac.signal.aborted) throw new Error(`端点 ${this.timeoutMs}ms 无响应（timeout）`);
      if (e?.own) throw e;
      throw new Error(`端点连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Mock Provider（离线回归测试用，不依赖 Ollama 进程）──────────
export class MockProvider extends LLMProvider {
  /** @param {{toolCalls?: Array, raw?: string}} preset */
  constructor(preset = {}) {
    super();
    this.preset = preset;
  }
  async complete() {
    // 轮次预设（批次 5 T2 离线编排回归）：preset.rounds=[{toolCalls,raw},...] 按调用序消耗，
    // 末轮后恒返回末项（空 toolCalls=终轮）——供 --max-rounds 循环的确定性测试
    if (Array.isArray(this.preset.rounds)) {
      const r = this.preset.rounds[Math.min(this._round ?? 0, this.preset.rounds.length - 1)];
      this._round = (this._round ?? 0) + 1;
      return { toolCalls: r.toolCalls ?? [], raw: r.raw ?? '' };
    }
    return { toolCalls: this.preset.toolCalls ?? [], raw: this.preset.raw ?? '' };
  }
}
