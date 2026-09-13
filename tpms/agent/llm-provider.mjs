/**
 * llm-provider.mjs — M3 LLM 接入层：统一 Provider 抽象 + Ollama 本地实现
 *
 * 铁律（ROADMAP M3）：
 *   LLM 只产出 tools.schema.json 定义的参数槽位，一切数值由 CLI 确定性代码生成或校验；
 *   越界值 100% 被钳制或拒绝，无静默回退。
 *
 * 设计：
 *   - Provider 接口：complete(messages, tools) → { toolCalls, raw }
 *   - OllamaProvider：POST /api/chat（支持 tools/function-calling）
 *   - 输出拦截器：validateToolCalls() 逐槽位过 schema 钳制，非法值 → 结构化拒绝
 *
 * 用法：
 *   node llm-agent.mjs --provider ollama --model qwen2.5:7b "设计一个孔隙率 75% 的 Gyroid 骨支架"
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Schema 加载 ──────────────────────────────────────────────────
export function loadToolsSchema() {
  return JSON.parse(readFileSync(join(HERE, 'tools.schema.json'), 'utf8'));
}

// ── 输出拦截器：LLM 产出 → schema 钳制 ──────────────────────────
// 【红队 C C-1 修复】排除整串 ./..（首字符允许 . 曾放行 '..' 穿越——verify 端 EISDIR 崩溃被吞成结构化不可达）
const SAFE_PATH_RE = /^(?!.{1,2}$)[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/;

/** 递归校验单值：number/integer 严格类型，string 支持 enum/pattern（路径狱），object/array 递归子 schema */
function validateValue(toolName, key, spec, v, errors) {
  if (spec.type === 'number' || spec.type === 'integer') {
    if (typeof v !== 'number') { errors.push(`tool ${toolName}.${key}: 须为 JSON number（收到 ${v === null ? 'null' : typeof v}）`); return; }
    if (!Number.isFinite(v)) { errors.push(`tool ${toolName}.${key}: 非有限数字`); return; }
    if (spec.minimum !== undefined && v < spec.minimum) { errors.push(`tool ${toolName}.${key}: ${v} < minimum ${spec.minimum}`); return; }
    if (spec.maximum !== undefined && v > spec.maximum) { errors.push(`tool ${toolName}.${key}: ${v} > maximum ${spec.maximum}`); return; }
    if (spec.exclusiveMinimum !== undefined && v <= spec.exclusiveMinimum) { errors.push(`tool ${toolName}.${key}: ${v} ≤ exclusiveMinimum ${spec.exclusiveMinimum}`); return; }
    if (spec.exclusiveMaximum !== undefined && v >= spec.exclusiveMaximum) { errors.push(`tool ${toolName}.${key}: ${v} ≥ exclusiveMaximum ${spec.exclusiveMaximum}`); return; }
    if (spec.type === 'integer' && !Number.isInteger(v)) { errors.push(`tool ${toolName}.${key}: ${v} 非整数`); return; }
    return v;
  }
  if (spec.type === 'string') {
    if (typeof v !== 'string') { errors.push(`tool ${toolName}.${key}: 须为 string（收到 ${v === null ? 'null' : typeof v}）`); return; }
    if (spec.enum && !spec.enum.includes(v)) { errors.push(`tool ${toolName}.${key}: "${v}" 不在 enum [${spec.enum.join(',')}]`); return; }
    if (spec.pattern && !SAFE_PATH_RE.test(v)) { errors.push(`tool ${toolName}.${key}: 路径须为单段安全文件名（^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$，禁分隔符/..）`); return; }
    return v;
  }
  if (spec.type === 'boolean') {
    if (typeof v !== 'boolean') { errors.push(`tool ${toolName}.${key}: 须为 boolean（收到 ${v === null ? 'null' : typeof v}）`); return; }
    return v;
  }
  if (spec.type === 'array') {
    if (!Array.isArray(v)) { errors.push(`tool ${toolName}.${key}: 须为 array`); return; }
    if (spec.minItems !== undefined && v.length < spec.minItems) { errors.push(`tool ${toolName}.${key}: 元素数 ${v.length} < minItems ${spec.minItems}`); return; }
    if (spec.maxItems !== undefined && v.length > spec.maxItems) { errors.push(`tool ${toolName}.${key}: 元素数 ${v.length} > maxItems ${spec.maxItems}`); return; }
    return v.map((item, i) => validateValue(toolName, `${key}[${i}]`, spec.items ?? {}, item, errors));
  }
  if (spec.type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) { errors.push(`tool ${toolName}.${key}: 须为 object`); return; }
    const props = spec.properties ?? {};
    if (spec.additionalProperties === false) {
      for (const k of Object.keys(v)) {
        if (!Object.hasOwn(props, k)) errors.push(`tool ${toolName}.${key}: 未知属性 "${k}"`);
      }
    }
    const out = {};
    for (const [k, sub] of Object.entries(props)) {
      if (!Object.hasOwn(v, k)) continue;
      out[k] = validateValue(toolName, `${key}.${k}`, sub, v[k], errors);
    }
    return out;
  }
  return v; // 未声明类型的槽位：原样放行（schema 不应有此类槽位）
}

/**
 * 验证 LLM 返回的 toolCalls 是否只填了 schema 允许的槽位且数值在界内。
 * @returns {{ ok: true, calls: Array } | { ok: false, errors: string[] }}
 */
export function validateToolCalls(toolCalls, schema) {
  const errors = [];
  const toolsByName = Object.fromEntries(schema.tools.map((t) => [t.name, t]));
  const cleaned = [];

  for (const call of toolCalls ?? []) {
    const name = call.function?.name ?? call.name;
    let args;
    try {
      args = typeof call.function?.arguments === 'string'
        ? JSON.parse(call.function.arguments)
        : (call.function?.arguments ?? call.arguments ?? {});
    } catch (e) {
      errors.push(`tool ${name}: arguments 非法 JSON — ${e.message}`);
      continue;
    }
    // 标量/数组 arguments（畸形 LLM 产出）结构化拒绝，不得静默吞成空参数或裸崩
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      errors.push(`tool ${name}: arguments 须为 JSON object（收到 ${args === null ? 'null' : typeof args}）`);
      continue;
    }

    const tool = toolsByName[name];
    if (!tool) {
      errors.push(`tool ${name}: 不在 tools.schema.json 注册面`);
      continue;
    }

    const props = tool.parameters?.properties ?? {};
    const required = tool.parameters?.required ?? [];
    const additional = tool.parameters?.additionalProperties;
    const errBefore = errors.length;

    // 未知属性拒绝（Object.hasOwn 防原型链键名绕过）
    if (additional === false) {
      for (const k of Object.keys(args)) {
        if (!Object.hasOwn(props, k)) errors.push(`tool ${name}: 未知属性 "${k}"`);
      }
    }
    // 必填检查
    for (const k of required) {
      if (!Object.hasOwn(args, k)) errors.push(`tool ${name}: 缺必填 "${k}"`);
    }

    // 逐属性递归钳制
    const clamped = {};
    for (const [k, spec] of Object.entries(props)) {
      if (!Object.hasOwn(args, k)) continue;
      const v = validateValue(name, k, spec, args[k], errors);
      if (errors.length === errBefore) clamped[k] = v;
    }

    // 逐调用错误归属：本调用无新错误才放行执行
    if (errors.length === errBefore) cleaned.push({ name, arguments: clamped });
  }

  return errors.length ? { ok: false, errors } : { ok: true, calls: cleaned };
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
    // 触发 libuv win/async.c 断言崩溃（Windows 实测），退出码被污染
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      throw new Error(ac.signal.aborted
        ? `Ollama ${this.timeoutMs}ms 无响应（timeout）`
        : `Ollama 连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json.message ?? {};
    const toolCalls = msg.tool_calls ?? [];
    return { toolCalls, raw: msg.content ?? '' };
  }
}

// ── OpenAI 兼容 Provider（智谱/DeepSeek/LM Studio/任意 OpenAI 格式端点）──
export class OpenAICompatProvider extends LLMProvider {
  /**
   * @param {{ baseUrl?: string, apiKey?: string, model?: string, temperature?: number, timeoutMs?: number }} opts
   * baseUrl 须含版本段（如 https://open.bigmodel.cn/api/paas/v4）；key 走环境变量或 --api-key，不得入库
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
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, Connection: 'close' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      throw new Error(ac.signal.aborted
        ? `端点 ${this.timeoutMs}ms 无响应（timeout）`
        : `端点连接失败: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json.choices?.[0]?.message ?? {};
    return { toolCalls: msg.tool_calls ?? [], raw: msg.content ?? '' };
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
    return { toolCalls: this.preset.toolCalls ?? [], raw: this.preset.raw ?? '' };
  }
}

// ── tools.schema.json → OpenAI/Ollama tools 格式 ─────────────────
export function schemaToOllamaTools(schema) {
  return schema.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
