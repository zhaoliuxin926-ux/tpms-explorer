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

    const tool = toolsByName[name];
    if (!tool) {
      errors.push(`tool ${name}: 不在 tools.schema.json 注册面`);
      continue;
    }

    const props = tool.parameters?.properties ?? {};
    const required = tool.parameters?.required ?? [];
    const additional = tool.parameters?.additionalProperties;

    // 未知属性拒绝
    if (additional === false) {
      for (const k of Object.keys(args)) {
        if (!(k in props)) errors.push(`tool ${name}: 未知属性 "${k}"`);
      }
    }
    // 必填检查
    for (const k of required) {
      if (!(k in args)) errors.push(`tool ${name}: 缺必填 "${k}"`);
    }

    // 逐属性类型/范围钳制
    const clamped = {};
    for (const [k, spec] of Object.entries(props)) {
      if (!(k in args)) continue;
      let v = args[k];
      if (spec.type === 'number' || spec.type === 'integer') {
        v = Number(v);
        if (!Number.isFinite(v)) { errors.push(`tool ${name}.${k}: 非有限数字`); continue; }
        if (spec.minimum !== undefined && v < spec.minimum) {
          errors.push(`tool ${name}.${k}: ${v} < minimum ${spec.minimum}`);
          continue;
        }
        if (spec.maximum !== undefined && v > spec.maximum) {
          errors.push(`tool ${name}.${k}: ${v} > maximum ${spec.maximum}`);
          continue;
        }
        if (spec.exclusiveMinimum !== undefined && v <= spec.exclusiveMinimum) {
          errors.push(`tool ${name}.${k}: ${v} ≤ exclusiveMinimum ${spec.exclusiveMinimum}`);
          continue;
        }
        if (spec.exclusiveMaximum !== undefined && v >= spec.exclusiveMaximum) {
          errors.push(`tool ${name}.${k}: ${v} ≥ exclusiveMaximum ${spec.exclusiveMaximum}`);
          continue;
        }
        if (spec.type === 'integer' && !Number.isInteger(v)) {
          errors.push(`tool ${name}.${k}: ${v} 非整数`);
          continue;
        }
      } else if (spec.type === 'string' && spec.enum) {
        if (!spec.enum.includes(v)) {
          errors.push(`tool ${name}.${k}: "${v}" 不在 enum [${spec.enum.join(',')}]`);
          continue;
        }
      } else if (spec.type === 'boolean') {
        v = !!v;
      }
      clamped[k] = v;
    }

    if (errors.length === 0 || Object.keys(clamped).length > 0) {
      cleaned.push({ name, arguments: clamped });
    }
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
   * @param {{ baseUrl?: string, model?: string, temperature?: number }} opts
   */
  constructor(opts = {}) {
    super();
    this.baseUrl = (opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = opts.model ?? 'qwen2.5:7b';
    this.temperature = opts.temperature ?? 0;
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
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
