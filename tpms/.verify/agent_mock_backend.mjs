/**
 * agent_mock_backend.mjs — 浏览器 Agent 本地联调后端（OpenAI 兼容 mock，2026-11-11）
 *
 * 用途：零外部 key 的浏览器端到端联调——真页面 + 真 fetch/CORS + 真工具执行 + 真 M4
 * 修复循环，LLM 决策由确定性脚本替代（与 agent_bridge_audit E 段同款剧本）。
 * 手动工具（非 CI 门禁）：node agent_mock_backend.mjs [port=8787]
 *
 * 剧本（按对话内 tool 结果数推进）：
 *   0 → tpms_mesh{gyroid, p88, k3}（视口写，无 out）
 *   1 → tpms_design_verify{gyroid, p0.88}（制造审计；高孔隙薄壁预期 verdict=fail）
 *   2 → 若上一结果含 '"verdict":"fail"' → apply_repair{patch_design, porosity 0.72}
 *       否则 → 收尾文本
 *   ≥3 → 收尾文本
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2]) || 8787;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const toolCall = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const completion = (body) => ({
  id: 'chatcmpl-mock-' + Math.random().toString(36).slice(2, 8),
  object: 'chat.completion',
  created: Date.now() / 1000 | 0,
  model: body.model ?? 'mock',
  choices: [{
    index: 0,
    message: body._mockMessage,
    finish_reason: body._mockMessage.tool_calls?.length ? 'tool_calls' : 'stop',
  }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function decide(messages) {
  const toolResults = messages.filter((m) => m.role === 'tool');
  const n = toolResults.length;
  const last = toolResults[n - 1]?.content ?? '';
  if (n === 0) return { tool_calls: [toolCall('c1', 'tpms_mesh', { type: 'gyroid', porosity: 88, periods: 3 })], content: '' };
  if (n === 1) return { tool_calls: [toolCall('c2', 'tpms_design_verify', { type: 'gyroid', porosity: 0.88, resolution: 48 })], content: '' };
  if (n === 2 && String(last).includes('"verdict":"fail"')) {
    return { tool_calls: [toolCall('c3', 'apply_repair', { action: 'patch_design', patches: { porosity: 0.72 }, reason: '高孔隙薄壁致最小壁厚不足——降孔隙率加厚杆壁' })], content: '' };
  }
  return { tool_calls: [], content: '已完成：设计已更新并通过制造审计修复（如触发）。当前参数见视口状态，可继续追问导出或仿真。' };
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404, CORS, { 'Content-Type': 'application/json' }); res.end('{"error":"mock 只实现 POST */chat/completions"}'); return;
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* */ }
    const decision = decide(body.messages ?? []);
    console.log(`[mock] ${new Date().toISOString().slice(11, 19)} tool结果数=${(body.messages ?? []).filter((m) => m.role === 'tool').length} → ${decision.tool_calls.map((t) => t.function.name).join(',') || '(final)'}`);
    const payload = completion({ ...body, _mockMessage: { role: 'assistant', content: decision.content ?? '', tool_calls: decision.tool_calls } });
    const out = JSON.stringify(payload);
    res.writeHead(200, CORS, { 'Content-Type': 'application/json' });
    res.end(out);
  });
});

// 联调坑（2026-11-11 实测）：node 默认 keepAliveTimeout=5s——浏览器复用刚被关闭的连接时
// POST 不重试直接 TypeError: Failed to fetch（第 1 轮成功第 2 轮必炸的假 CORS 故障）。
server.listen(PORT, '127.0.0.1', () => console.log(`[mock] OpenAI 兼容联调后端 http://127.0.0.1:${PORT}/v1/chat/completions（ACAO *）`));
server.keepAliveTimeout = 300_000;
server.headersTimeout = 305_000;
