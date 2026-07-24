// collab-server.js
// ----------------------------------------------------------------------------
// 轻量 WebSocket 协作后端，新增：落盘持久化 + 单一事实源（last-write-wins）合并。
//
// 能力：
//   1) 持久化：把最新 CONFIG 落盘到同目录 workflow.json（防抖写入），重启不丢。
//   2) 单事实源：服务端持有权威状态；新客户端接入即收到当前权威 CONFIG，自动补齐。
//   3) 广播：任一客户端的变更转发给其余连接（不含自己）。
//   4) 冲突合并：采用 last-write-wins（服务端最后收到的为准），适合低风险协作场景。
//      —— 若需离线编辑 / 高并发并发写，可升级为 CRDT（Yjs）或 OT，见文件末说明。
//
// 用法：
//   1) 安装依赖： npm i ws
//   2) 启动服务： node collab-server.js
//   3) 前端接入： 把 claude-code-workflow.html 里的
//                 const COLLAB_WS = null;
//                 改为 const COLLAB_WS = 'ws://localhost:8787';  // 或跨机 IP
//
// 协议（文本 JSON）：
//   客户端 -> 服务端： { "t": "cfg", "cfg": <CONFIG 对象> }
//   服务端 -> 客户端： { "t": "cfg", "cfg": <CONFIG 对象> }
// ----------------------------------------------------------------------------

const PORT = process.env.PORT || 8787;
const path = require('path');
const fs = require('fs');
const FILE = path.join(__dirname, 'workflow.json');

let WebSocketServer;
try {
  ({ WebSocketServer } = require('ws'));
} catch (e) {
  console.error('[collab] 缺少依赖 ws，请先运行： npm i ws');
  process.exit(1);
}

// 启动时尝试恢复落盘状态
let currentCfg = null;
try {
  if (fs.existsSync(FILE)) currentCfg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (e) {
  console.warn('[collab] workflow.json 读取失败，以空状态启动：', e.message);
}

// 落盘（防抖 250ms，避免高频写入）
let saveTimer = null;
function persist(cfg) {
  currentCfg = cfg;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(FILE, JSON.stringify(cfg, null, 2), (err) => {
      if (err) console.error('[collab] 写入失败：', err.message);
    });
  }, 250);
}

const wss = new WebSocketServer({ port: PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[collab] 客户端接入，当前连接数：${clients.size}`);
  // 新客户端接入即推送服务端当前权威状态（落盘或内存最新），实现自动同步
  if (currentCfg) ws.send(JSON.stringify({ t: 'cfg', cfg: currentCfg }));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || msg.t !== 'cfg' || !msg.cfg) return;
    persist(msg.cfg);                       // 落盘 + 更新权威状态（last-write-wins）
    for (const c of clients) {              // 转发给其余客户端
      if (c !== ws && c.readyState === 1) c.send(raw.toString());
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[collab] 客户端断开，当前连接数：${clients.size}`);
  });
  ws.on('error', () => { /* 忽略单连接错误，避免进程崩溃 */ });
});

console.log(`[collab] WebSocket 协作服务已启动： ws://localhost:${PORT}`);
console.log(`[collab] 持久化文件： ${FILE}`);

// ----------------------------------------------------------------------------
// 升级到 CRDT/OT 的参考路径（如未来需要真正的并发合并）：
//   - CRDT：引入 Yjs（y-websocket），把 CONFIG 映射为 Y.Doc，server 只转发 Y 更新，
//           冲突由 CRDT 算法自动合并，天然支持离线编辑。
//   - OT：引入 sharedb/ot.js，server 按操作变换顺序合并，适合中心化强一致场景。
//   当前 last-write-wins 足以覆盖“演示 / 小团队实时协作”需求，且零额外依赖。
// ----------------------------------------------------------------------------
