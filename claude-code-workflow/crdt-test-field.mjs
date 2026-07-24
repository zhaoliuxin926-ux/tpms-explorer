// crdt-test-field.mjs —— 验证「字段级实体 CRDT」：节点/连线为 Y.Map，并发与离线编辑按字段合并而非整文档覆盖。
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WS from 'ws';

const URL = 'ws://localhost:1234';
const ROOM = 'wf-field-' + Date.now();

// --- 复刻前端 modelFromConfig / yNodeById ---
function objToYMap(o) { const m = new Y.Map(); for (const k in o) { if (o[k] !== undefined && o[k] !== null) m.set(k, o[k]); } return m; }
function objsToYArray(arr) { const a = new Y.Array(); a.insert(0, (arr || []).map(objToYMap)); return a; }
function modelFromConfig(doc, cfg) {
  const meta = doc.getMap('meta'); meta.set('title', cfg.title); meta.set('subtitle', cfg.subtitle);
  const yPhases = doc.getArray('phases'); yPhases.delete(0, yPhases.length);
  cfg.phases.forEach(ph => { const pm = new Y.Map(); pm.set('badge', ph.badge); pm.set('accent', ph.accent); pm.set('layout', ph.layout); pm.set('title', ph.title); if (ph.nodes) pm.set('nodes', objsToYArray(ph.nodes)); yPhases.push([pm]); });
  const ySide = doc.getMap('sidebar'); ySide.set('title', cfg.sidebar.title); ySide.set('nodes', objsToYArray(cfg.sidebar.nodes));
  const yEdges = doc.getArray('edges'); yEdges.delete(0, yEdges.length); (cfg.edges || []).forEach(e => yEdges.push([objToYMap(e)]));
}
function yNodeById(doc, id) {
  const yPhases = doc.getArray('phases');
  for (const pm of yPhases) { const arr = pm.get('nodes'); if (arr) for (let i = 0; i < arr.length; i++) if (arr.get(i).get('id') === id) return arr.get(i); }
  const sarr = doc.getMap('sidebar').get('nodes'); if (sarr) for (let i = 0; i < sarr.length; i++) if (sarr.get(i).get('id') === id) return sarr.get(i);
  return null;
}
function nodeTitle(doc, id) { const m = yNodeById(doc, id); return m ? m.get('title') : undefined; }
function nodeDesc(doc, id) { const m = yNodeById(doc, id); return m ? m.get('desc') : undefined; }

function makeDoc() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(URL, ROOM, doc, { WebSocketPolyfill: WS });
  return { doc, provider };
}
const synced = (p) => new Promise(r => { if (p.synced) return r(); p.once('sync', () => r()); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const sampleCfg = {
  title: 'T', subtitle: 'S',
  phases: [{ badge: '1', accent: 'blue', layout: 'grid', title: 'P1', nodes: [
    { id: 'n1', title: 'N1', desc: 'd1', icon: 'i' },
    { id: 'n2', title: 'N2', desc: 'd2', icon: 'i' },
    { id: 'n4', title: 'N4', desc: 'd4', icon: 'i' }
  ] }],
  sidebar: { title: 'SB', nodes: [{ id: 'n3', title: 'N3', desc: 'd3', icon: 'i' }] },
  edges: []
};

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } }

async function main() {
  const A = makeDoc(), B = makeDoc();
  await Promise.all([synced(A.provider), synced(B.provider)]);
  await sleep(150);

  // 初始化：仅当 A 为空（避免双端都初始化产生重复）
  if (A.doc.getArray('phases').length === 0) modelFromConfig(A.doc, sampleCfg);
  await sleep(250);
  await Promise.all([synced(A.provider), synced(B.provider)]);

  // 1) 不同节点并发改标题（字段级合并，互不覆盖）
  yNodeById(A.doc, 'n1').set('title', 'A-改N1');
  yNodeById(B.doc, 'n2').set('title', 'B-改N2');
  await sleep(300);
  check('并发改不同节点标题 -> 双向合并', nodeTitle(A.doc, 'n2') === 'B-改N2' && nodeTitle(B.doc, 'n1') === 'A-改N1');

  // 2) 同一节点不同字段并发编辑（title vs desc 合并）
  yNodeById(A.doc, 'n3').set('title', 'A-改N3标题');
  yNodeById(B.doc, 'n3').set('desc', 'B-改N3描述');
  await sleep(300);
  check('同一节点不同字段 -> 合并', nodeTitle(A.doc, 'n3') === 'A-改N3标题' && nodeDesc(A.doc, 'n3') === 'B-改N3描述' && nodeTitle(B.doc, 'n3') === 'A-改N3标题' && nodeDesc(B.doc, 'n3') === 'B-改N3描述');

  // 3) 离线编辑后重连合并
  A.provider.disconnect();
  await sleep(50);
  yNodeById(A.doc, 'n4').set('title', 'A离线改N4');
  yNodeById(B.doc, 'n4').set('desc', 'B改N4描述');
  await sleep(250);
  // 离线期间 B 看不到 A 的修改
  check('离线期间 B 未收到 A 修改', nodeTitle(B.doc, 'n4') === 'N4');
  A.provider.connect();
  await synced(A.provider);
  await sleep(350);
  check('重连后双向字段合并', nodeTitle(A.doc, 'n4') === 'A离线改N4' && nodeDesc(A.doc, 'n4') === 'B改N4描述' && nodeTitle(B.doc, 'n4') === 'A离线改N4' && nodeDesc(B.doc, 'n4') === 'B改N4描述');

  // 4) 连线（Y.Map）增量编辑
  const yEdges = A.doc.getArray('edges');
  const em = new Y.Map(); em.set('id', 'e-test'); em.set('from', 'n1'); em.set('to', 'n2'); em.set('style', 'curve'); em.set('arrow', 'single'); em.set('label', '');
  yEdges.push([em]);
  await sleep(300);
  const be = B.doc.getArray('edges').toArray().find(x => x.get('id') === 'e-test');
  check('连线 Y.Map 跨端同步', !!be && be.get('from') === 'n1' && be.get('to') === 'n2');

  A.provider.destroy(); B.provider.destroy();
  console.log(`\n字段级 CRDT 测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
