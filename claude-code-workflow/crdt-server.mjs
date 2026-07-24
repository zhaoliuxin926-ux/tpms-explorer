// crdt-server.mjs
// ----------------------------------------------------------------------------
// Yjs CRDT 协作服务（基于 y-protocols + lib0 + ws 的官方 y-websocket 协议实现）。
// 相比 collab-server.js 的 last-write-wins，本服务用 CRDT 合并并发/离线编辑：
//   - 每个客户端持有一份 Y.Doc，编辑先在本地生效（离线可用），再增量同步；
//   - 断线期间的修改在重连后自动合并，不会丢失；
//   - 不同客户端修改不同部分时，CRDT 自动合并（字段级），而非整文档覆盖。
// 另以二进制落盘（crdt-data/<room>.bin），重启可恢复。
//
// 用法：
//   1) 安装依赖： npm i yjs y-protocols lib0 ws
//   2) 启动：     node crdt-server.mjs
//   3) 前端接入： 把 claude-code-workflow.html 里的
//                 const COLLAB_YJS = null;
//                 改为 const COLLAB_YJS = 'ws://localhost:1234';
//                 （首次加载会从 CDN 拉取 yjs / y-websocket，需联网）
// ----------------------------------------------------------------------------

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 1234;
const PERSIST_DIR = path.join(__dirname, 'crdt-data');
const pingTimeout = 30000;
const messageSync = 0;
const messageAwareness = 1;
const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const docs = new Map();
const getYDoc = (docname) => {
  let doc = docs.get(docname);
  if (doc === undefined) {
    doc = new WSSharedDoc(docname);
    docs.set(docname, doc);
    loadDoc(doc);
  }
  return doc;
};

function loadDoc(doc) {
  const f = path.join(PERSIST_DIR, doc.name + '.bin');
  try { if (fs.existsSync(f)) Y.applyUpdate(doc, fs.readFileSync(f)); }
  catch (e) { console.warn('[crdt] 载入失败', doc.name, e.message); }
}
function persistDoc(doc) {
  try {
    if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
    fs.writeFile(path.join(PERSIST_DIR, doc.name + '.bin'), Y.encodeStateAsUpdate(doc), () => {});
  } catch (e) { console.warn('[crdt] 写入失败', e.message); }
}

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this._pt = null;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on('update', ({ added, updated, removed }, conn) => {
      const changed = added.concat(updated, removed);
      if (conn !== null) {
        const ids = this.conns.get(conn);
        if (ids !== undefined) { added.forEach((id) => ids.add(id)); removed.forEach((id) => ids.delete(id)); }
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageAwareness);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      const buf = encoding.toUint8Array(enc);
      this.conns.forEach((_, c) => send(this, c, buf));
    });
    this.on('update', (update, _origin, doc) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageSync);
      syncProtocol.writeUpdate(enc, update);
      const buf = encoding.toUint8Array(enc);
      doc.conns.forEach((_, c) => send(doc, c, buf));
      clearTimeout(doc._pt);
      doc._pt = setTimeout(() => persistDoc(doc), 300);
    });
  }
}

const messageListener = (conn, doc, message) => {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  const type = decoding.readVarUint(decoder);
  switch (type) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
      if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder));
      break;
    case messageAwareness:
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
      break;
  }
};

const send = (doc, conn, m) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) { closeConn(doc, conn); return; }
  try { conn.send(m, (err) => { if (err != null) closeConn(doc, conn); }); }
  catch (e) { closeConn(doc, conn); }
};
const closeConn = (doc, conn) => {
  if (doc.conns.has(conn)) {
    const ids = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(ids), null);
  }
  try { conn.close(); } catch (e) {}
};

const setupWSConnection = (conn, req) => {
  conn.binaryType = 'arraybuffer';
  const docName = (req.url || '').slice(1).split('?')[0] || 'wf';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());
  conn.on('message', (message) => messageListener(conn, doc, new Uint8Array(message)));
  let pong = true;
  const ping = setInterval(() => {
    if (!pong) { if (doc.conns.has(conn)) closeConn(doc, conn); clearInterval(ping); }
    else if (doc.conns.has(conn)) { pong = false; try { conn.ping(); } catch (e) { closeConn(doc, conn); clearInterval(ping); } }
  }, pingTimeout);
  conn.on('close', () => { closeConn(doc, conn); clearInterval(ping); });
  conn.on('pong', () => { pong = true; });
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, messageSync);
  syncProtocol.writeSyncStep1(enc, doc);
  send(doc, conn, encoding.toUint8Array(enc));
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const aenc = encoding.createEncoder();
    encoding.writeVarUint(aenc, messageAwareness);
    encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())));
    send(doc, conn, encoding.toUint8Array(aenc));
  }
};

const server = http.createServer((_, res) => { res.writeHead(200); res.end('Yjs CRDT server is running\n'); });
const wss = new WebSocketServer({ server });
wss.on('connection', setupWSConnection);
server.listen(PORT, () => console.log(`[crdt] Yjs CRDT 协作服务已启动： ws://localhost:${PORT}（房间数据落盘于 ${PERSIST_DIR}）`));
