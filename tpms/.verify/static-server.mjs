// static-server.mjs —— UI 门禁专用零依赖静态服务器（node static-server.mjs <port> <dir>）
// 2026-09-06 CI 终审引入：python http.server 的跨平台 spawn 差异（win32 python 命令、
// macos 无 python、解释器漂移）已连续制造三层 CI 假红——Node 是门禁既有运行时，
// 直接用它做静态服务，三平台行为完全一致。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve as pathResolve, sep as pathSep } from 'node:path';
import * as path from 'node:path';

const port = Number(process.argv[2]);
const root = process.argv[3];
if (!port || !root) { console.error('用法: node static-server.mjs <port> <dir>'); process.exit(2); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json', '.glb': 'model/gltf-binary',
  '.stl': 'application/octet-stream', '.vti': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

const absRoot = path.resolve(root);

createServer(async (req, res) => {
  try {
    // 不用 new URL(req.url, base)：'//app.html' 会被当协议相对 URL 解析（app.html 变 host、
    // pathname 变 '/'）——恰是 run_all BASE 尾斜杠拼出的形状。手工取 path 并折叠多斜杠。
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    rel = rel.replace(/\/{2,}/g, '/');
    // '.'+rel 防止 win32 上以 / 或 // 开头的路径重置盘符/UNC；随后大小写不敏感前缀守卫
    const file = path.resolve(absRoot, '.' + rel);
    const f = file.toLowerCase(), r = absRoot.toLowerCase();
    if (!f.startsWith(r + pathSep) && f !== r) { res.writeHead(403); res.end(); return; }
    let s = await stat(file).catch(() => null);
    if (s && s.isDirectory()) { file = join(file, 'index.html'); s = await stat(file).catch(() => null); }
    if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(500); res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`[static-server] 127.0.0.1:${port} <- ${absRoot}`));
