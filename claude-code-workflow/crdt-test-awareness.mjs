// 验证 Yjs awareness（在线协作者光标）经 crdt-server.mjs 的转发是否正确
// 用法：在 claude-code-workflow/ 下先 `npm i yjs y-websocket y-protocols lib0 ws`，再 `node crdt-server.mjs`（另一个终端），然后 `node crdt-test-awareness.mjs`
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';

const URL = 'ws://localhost:1234';
const ROOM = 'wf-awareness-test-' + Date.now();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function mk() {
  const doc = new Y.Doc();
  const p = new WebsocketProvider(URL, ROOM, doc, { WebSocketPolyfill: WebSocket });
  return { doc, p, aw: p.awareness };
}

const A = mk(), B = mk();

async function main() {
  await wait(900); // 等待两端连接
  // A 广播光标位置
  A.aw.setLocalState({ name: 'Alice', color: '#ef4444', cx: 120, cy: 80, has: true });
  await wait(600);
  let sawA = false;
  B.aw.getStates().forEach((st, cid) => { if (cid !== B.aw.clientID && st && st.name === 'Alice' && st.cx === 120 && st.cy === 80 && st.has) sawA = true; });

  // B 广播光标位置
  B.aw.setLocalState({ name: 'Bob', color: '#3b82f6', cx: 300, cy: 200, has: true });
  await wait(600);
  let sawB = false;
  A.aw.getStates().forEach((st, cid) => { if (cid !== A.aw.clientID && st && st.name === 'Bob' && st.cx === 300) sawB = true; });

  // 编辑高亮字段转发（光标旁“✎编辑中”依赖此字段）
  A.aw.setLocalStateField('editing', 'n1');
  await wait(400);
  let sawEdit = false;
  B.aw.getStates().forEach((st, cid) => { if (cid !== B.aw.clientID && st && st.editing === 'n1') sawEdit = true; });

  // 拖拽同步字段转发（光标旁“✥拖拽中”、节点虚线轮廓依赖此字段）
  A.aw.setLocalStateField('dragging', 'n2');
  await wait(400);
  let sawDrag = false;
  B.aw.getStates().forEach((st, cid) => { if (cid !== B.aw.clientID && st && st.dragging === 'n2') sawDrag = true; });

  // A 断开 -> B 应不再看到 A 的光标
  A.aw.setLocalState(null); // 显式清空本地状态（标签页关闭时浏览器也会触发 socket 关闭，服务端广播移除）
  await wait(500);
  A.p.destroy(); A.doc.destroy();
  await wait(1200);
  let aGone = true;
  B.aw.getStates().forEach((st, cid) => { if (cid !== B.aw.clientID && st && st.name === 'Alice') aGone = false; });

  console.log('A→B 光标转发 :', sawA ? 'PASS' : 'FAIL');
  console.log('B→A 光标转发 :', sawB ? 'PASS' : 'FAIL');
  console.log('编辑字段转发 :', sawEdit ? 'PASS' : 'FAIL');
  console.log('拖拽字段转发 :', sawDrag ? 'PASS' : 'FAIL');
  console.log('A 断开移除光标 :', aGone ? 'PASS' : 'FAIL');
  B.p.destroy(); B.doc.destroy();
  process.exit(sawA && sawB && sawEdit && sawDrag && aGone ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
