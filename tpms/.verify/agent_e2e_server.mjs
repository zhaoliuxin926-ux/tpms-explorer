/**
 * agent_e2e_server.mjs — 浏览器 Agent 端到端联调一体服务（2026-11-11）
 *
 * 同源一体：静态托管 docs/platform（/）+ OpenAI 兼容 mock（POST /v1/chat/completions）
 * ——规避 MCP 托管 Chrome 拦跨源子资源的环境限制（实测：同源 POST 200/跨源 GET 即炸，
 * 见 progress 2026-11-11 联调段）。同源零 CORS 面；跨源 provider 行为由 preflight curl
 * 与真实端点另行验证（DeepSeek/OpenRouter 已 GO）。
 *
 * 用法：node agent_e2e_server.mjs [port=8788] [dir=../../docs/platform]
 * 剧本同 agent_mock_backend.mjs（mesh→verify→fail 则 repair→final）。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
function dirname(p) { return p.replace(/[\\/][^\\/]*$/, ''); }

const PORT = Number(process.argv[2]) || 8788;
const DIR = process.argv[3] ? normalize(process.argv[3]) : join(HERE, '..', '..', 'docs', 'platform');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.webm': 'video/webm', '.ico': 'image/x-icon' };

const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function decide(messages) {
  const toolResults = messages.filter((m) => m.role === 'tool');
  const n = toolResults.length;
  const last = toolResults[n - 1]?.content ?? '';
  if (n === 0) return { tool_calls: [toolCall('c1', 'tpms_mesh', { type: 'gyroid', porosity: 88, periods: 3 })], content: '' };
  if (n === 1) return { tool_calls: [toolCall('c2', 'tpms_design_verify', { type: 'gyroid', porosity: 0.88, resolution: 48 })], content: '' };
  if (n === 2 && String(last).includes('"verdict":"fail"')) {
    return { tool_calls: [toolCall('c3', 'apply_repair', { action: 'patch_design', patches: { porosity: 0.72 }, reason: '高孔隙薄壁致最小壁厚不足——降孔隙率加厚杆壁' })], content: '' };
  }
  return { tool_calls: [], content: '任务完成：设计已构建并经制造审计（含自动修复）。当前视口即最终参数，可继续追问导出或仿真。' };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'POST' && url.pathname.includes('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* */ }
      const decision = decide(body.messages ?? []);
      console.log(`[e2e-mock] ${new Date().toISOString().slice(11, 19)} tool结果数=${(body.messages ?? []).filter((m) => m.role === 'tool').length} → ${decision.tool_calls.map((t) => t.function.name).join(',') || '(final)'}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-e2e', object: 'chat.completion', created: Date.now() / 1000 | 0, model: body.model ?? 'e2e',
        choices: [{ index: 0, message: { role: 'assistant', content: decision.content ?? '', tool_calls: decision.tool_calls }, finish_reason: decision.tool_calls.length ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = join(DIR, rel);
  if (!file.startsWith(DIR) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
});
// 坑注记：node 默认 keepAliveTimeout=5s 会造成连接复用竞态（详见 agent_mock_backend.mjs）
server.keepAliveTimeout = 300_000;
server.headersTimeout = 305_000;
server.listen(PORT, '127.0.0.1', () => console.log(`[e2e] 一体联调服务 http://127.0.0.1:${PORT}/（静态=${DIR}；mock=/v1/chat/completions）`));
