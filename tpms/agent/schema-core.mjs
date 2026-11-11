/**
 * schema-core.mjs — 契约校验核（单源模块，CLI 与 Web 共用）
 *
 * 2026-11-11 方向 A（Web NL 合流）第一批抽离：validateToolCalls / schemaToOllamaTools
 * 从 llm-provider.mjs、REPAIR_TOOL 修复菜单从 tpms-driver.mjs 迁入本文件。
 * 铁律：本文件零 Node API 依赖（无 fs/child_process/http）——CLI 经 llm-provider.mjs
 * 转出口引用，浏览器端（Vite）直接打包同源字节，保证 43 条回归 / selftest 101 /
 * 红队探针 17 案的校验语义跨端逐位一致（Gemini Q1 单源策略，collab/gemini/
 * 2026-11-11-agent-platform-gemini-verdict.md）。
 *
 * 预算与冲突语义定案（同日第三轮）：
 *   - E5 联合算力预算 Σ periods³ ≤ 4096：CLI 以单次进程为窗口；Web 端窗口=
 *     Per-Prompt Autonomous Run（一次发送驱动的 1..maxRounds 跨轮累计不重置，
 *     Run 结束交还人类后下次发送重置）——本模块只做单批次校验，窗口计数归执行器。
 *   - E11 写写冲突：重复者拒、首个保留（8d1bddb 语义，非整批连坐）。
 */

/** 递归校验单值：number/integer 严格类型，string 支持 enum/pattern（路径狱），object/array 递归子 schema */
function validateValue(toolName, key, spec, v, errors) {
  if (spec.type === 'number' || spec.type === 'integer') {
    if (typeof v !== 'number') { errors.push(`tool ${toolName}.${key}: 须为 JSON number（收到 ${v === null ? 'null' : typeof v}）`); return; }
    if (!Number.isFinite(v)) { errors.push(`tool ${toolName}.${key}: 非有限数字`); return; }
    if (spec.minimum !== undefined && v < spec.minimum) { errors.push(`tool ${toolName}.${key}: ${v} < minimum ${spec.minimum}`); return; }
    if (spec.maximum !== undefined && v > spec.maximum) { errors.push(`tool ${toolName}.${key}: ${v} > maximum ${spec.maximum}`); return; }
    if (spec.exclusiveMinimum !== undefined && v <= spec.exclusiveMinimum) { errors.push(`tool ${toolName}.${key}: ${v} ≤ exclusiveMinimum ${spec.exclusiveMinimum}`); return; }
    if (spec.exclusiveMaximum !== undefined && v >= spec.exclusiveMaximum) { errors.push(`tool ${toolName}.${key}: ${v} ≥ exclusiveMaximum ${spec.exclusiveMaximum}`); return; }
    if (spec.type === 'integer' && !Number.isInteger(v)) { errors.push(`tool ${toolName}.${key}: 非整数`); return; }
    return v;
  }
  if (spec.type === 'string') {
    if (typeof v !== 'string') { errors.push(`tool ${toolName}.${key}: 须为 string（收到 ${v === null ? 'null' : typeof v}）`); return; }
    if (spec.enum && !spec.enum.includes(v)) { errors.push(`tool ${toolName}.${key}: "${v}" 不在 enum [${spec.enum.join(',')}]`); return; }
    if (spec.pattern && !new RegExp(spec.pattern).test(v)) {
      errors.push(`tool ${toolName}.${key}: 不满足 schema pattern ${spec.pattern}（out 类槽位：单段安全文件名 + 强制 .stl 后缀 + 拒 Win 设备名；design 读路径：单段禁分隔符/..）`);
      return;
    }
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
    // 嵌套必填：required 只在顶层查过曾放过 isoGrad 缺 values（拦截器通过后 runCli.values.join 裸崩）——
    // 任何层深的 object schema 都必须自查 required
    for (const r of spec.required ?? []) {
      if (!Object.hasOwn(v, r)) errors.push(`tool ${toolName}.${key}: 缺必填 "${r}"`);
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
  // 注册面用 Map：普通对象会被 __proto__/constructor/hasOwnProperty 等原型链键
  // 穿透「不在注册面」truthy 检查（红队 D H-1 实证 ACCEPTED），Map.get 无此面
  const toolsByName = new Map(schema.tools.map((t) => [t.name, t]));
  const cleaned = [];

  // 2026-10-02 复审 M-1：顶层非数组（网络面 tool_calls:"abc" 形态）此前裸崩 exit 1——
  // 与元素级守卫同型收口，结构化拒绝保契约 exit 2
  if (toolCalls !== undefined && toolCalls !== null && !Array.isArray(toolCalls)) {
    errors.push(`toolCalls 须为数组（收到 ${typeof toolCalls}）`);
    return { ok: false, errors };
  }
  const calls = toolCalls ?? [];
  // E11 批次写写冲突（2026-11-07 红队定案）：同批次同 out 路径双调用=串行执行后者静默覆盖前者
  const outPaths = new Map();
  // E5 联合算力预算（2026-11-08 落地）：跨调用组合爆炸防护——Σ periods³ ≤ 4096
  // （=单调用 schema 上限 12³ 的 2.4 倍；64×periods5=8000 被拒、8×periods8=4096 恰达上限；阈值随性能数据可调）
  let heavyBudget = 0;
  if (calls.length > 64) {
    errors.push(`toolCalls 数量 ${calls.length} 超上限 64（防批量 spawn DoS，红队 D L-3）`);
    return { ok: false, errors };
  }
  for (const [i, call] of calls.entries()) {
    // 2026-10-02 审查 M-1：数组含 null/非对象元素此前裸崩 exit 1（openai/ollama 网络面
    // tool_calls:[null] 实证可达）——循环首行守卫，结构化拒绝保契约 exit 2
    if (call === null || typeof call !== 'object') {
      errors.push(`tool call #${i}: 须为 object（收到 ${call === null ? 'null' : typeof call}）`);
      continue;
    }
    const name = call.function?.name ?? call.name;
    // 工具名形状校验：注册面全是 snake_case，畸形/原型链键名直接结构化拒绝
    if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name)) {
      errors.push(`tool ${name}: 非法工具名形状（须 snake_case）`);
      continue;
    }
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

    const tool = toolsByName.get(name);
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

    // 逐属性递归校验
    const validated = {};
    for (const [k, spec] of Object.entries(props)) {
      if (!Object.hasOwn(args, k)) continue;
      const v = validateValue(name, k, spec, args[k], errors);
      if (errors.length === errBefore) validated[k] = v;
    }

    if (errors.length === errBefore && typeof validated.periods === 'number' && ['tpms_mesh', 'tpms_scenario', 'tpms_pareto'].includes(name)) {
      heavyBudget += validated.periods ** 3;
    }

    // 批次内 out 路径冲突检测（重复者拒、首个保留——保守语义）
    if (errors.length === errBefore) {
      for (const [k, v] of Object.entries(validated)) {
        if (k === 'out' && typeof v === 'string') {
          const prev = outPaths.get(v);
          if (prev !== undefined) errors.push(`tool ${name}: 输出路径 "${v}" 与本批次调用 #${prev} 重复（写写冲突拒绝，红队 E11）`);
          else outPaths.set(v, i);
        }
      }
    }

    // 逐调用错误归属：本调用无新错误才放行执行
    if (errors.length === errBefore) cleaned.push({ name, arguments: validated });
  }

  if (heavyBudget > 4096) errors.push(`批次算力预算超限（Σ periods³=${heavyBudget} > 4096，E5 联合预算——合法顶格组合也会耗尽宿主资源）`);
  return errors.length ? { ok: false, errors } : { ok: true, calls: cleaned };
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

// ── M4 修复动作 schema（有界策略菜单；validateToolCalls 同源校验）──────────────
// （自 tpms-driver.mjs 迁入单源——Web 端 M4 闭环复用同一菜单）
export const REPAIR_TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd', 'slotp', 'fs', 'qstar', 'ws', 'strutbcc', 'strutoctet'];

export const REPAIR_TOOL = {
  name: 'apply_repair',
  description: '根据 verify 失败诊断选择下一轮修复。规则：水密/非流形失败（薄壁自触族）优先降 periods 或换曲面族；分辨率不足优先提 resolution（≤128）；参数层错误按 paramErrors 逐项修正；确定不可达（如 cylinder+diamond 深水区）才 declare_unreachable。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'reason'],
    properties: {
      action: { type: 'string', enum: ['patch_design', 'declare_unreachable'] },
      patches: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: REPAIR_TYPES },
          porosity: { type: 'number', minimum: 0.05, maximum: 0.99, description: '目标孔隙率，0-1 小数口径（diag 的 designNormalized.porosity 同口径；勿用百分数）' },
          periods: { type: 'integer', minimum: 1, maximum: 12 },
          resolution: { type: 'integer', minimum: 48, maximum: 128 },
          container: { type: 'string', enum: ['cube', 'cylinder'] },
          mode: { type: 'string', enum: ['solid_network', 'shell', 'gradient_shell'] },
          material: { type: 'string', enum: ['tc4', 'polymer', 'thermal'] },
        },
      },
      reason: { type: 'string' },
    },
  },
};
