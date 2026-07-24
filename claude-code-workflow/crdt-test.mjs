import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';

const URL = 'ws://localhost:1234';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function mkClient(room) {
  const doc = new Y.Doc();
  const p = new WebsocketProvider(URL, room, doc, { WebSocketPolyfill: WebSocket });
  return { doc, p };
}
function waitSynced(p) { return new Promise(res => { if (p.synced) return res(); p.once('sync', () => res()); }); }

(async () => {
  // Test 1: 字段级 CRDT 合并（两个客户端并发改不同字段，都应保留）
  const a = mkClient('merge'), b = mkClient('merge');
  await Promise.all([waitSynced(a.p), waitSynced(b.p)]);
  a.doc.getMap('m').set('title', 'A修改');
  b.doc.getMap('m').set('body', 'B修改');
  await sleep(500);
  const aOK = a.doc.getMap('m').get('title') === 'A修改' && a.doc.getMap('m').get('body') === 'B修改';
  const bOK = b.doc.getMap('m').get('title') === 'A修改' && b.doc.getMap('m').get('body') === 'B修改';
  console.log('Test1 字段级合并(两处修改共存):', (aOK && bOK) ? 'PASS' : 'FAIL', JSON.stringify([...b.doc.getMap('m').entries()]));

  // Test 1b: 离线并发编辑后重连合并
  a.p.disconnect();
  a.doc.getMap('m').set('offlineA', '1');
  b.doc.getMap('m').set('offlineB', '1');
  await sleep(200);
  a.p.connect();
  await sleep(600);
  const offOK = a.doc.getMap('m').get('offlineA') === '1' && a.doc.getMap('m').get('offlineB') === '1'
    && b.doc.getMap('m').get('offlineA') === '1' && b.doc.getMap('m').get('offlineB') === '1';
  console.log('Test1b 离线并发编辑重连合并:', offOK ? 'PASS' : 'FAIL',
    'A看offlineB=' + a.doc.getMap('m').get('offlineB') + ' B看offlineA=' + b.doc.getMap('m').get('offlineA'));

  // Test 2: 应用 CONFIG 透传 + 离线重同步
  const c = mkClient('wf'), d = mkClient('wf');
  await Promise.all([waitSynced(c.p), waitSynced(d.p)]);
  c.doc.getMap('config').set('json', JSON.stringify({ v: 1 }));
  await sleep(400);
  const t2a = d.doc.getMap('config').get('json') === JSON.stringify({ v: 1 });
  console.log('Test2 CONFIG 广播:', t2a ? 'PASS' : 'FAIL');
  c.p.disconnect();
  c.doc.getMap('config').set('json', JSON.stringify({ v: 2 }));
  d.doc.getMap('config').set('json', JSON.stringify({ v: 3 }));
  await sleep(200);
  c.p.connect();
  await sleep(600);
  const cj = c.doc.getMap('config').get('json'), dj = d.doc.getMap('config').get('json');
  console.log('Test2 离线重同步(收敛):', (cj === dj) ? 'PASS' : 'FAIL', 'c=' + cj + ' d=' + dj);

  [a, b, c, d].forEach(x => x.p.destroy());
  process.exit(0);
})();
