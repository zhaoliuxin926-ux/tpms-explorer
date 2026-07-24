// crdt-test-groups.mjs —— 验证「分组（groups）的 CRDT 增量增删与 round-trip」：
// CONFIG.groups = [{id,name,color,nodeIds:[]}] 经 modelFromConfig / configFromModel 在 Y.Doc 中编码/解码，
// 运行时增删走 addGroupToDoc / removeGroupFromDoc（按 id 定位的 Y.Array 增量 push / delete(i,1)），
// 重点验证「两人同时各加一个分组」也能完美合并（各自 push 独立 Y.Map，互不整段覆盖）。
// 风格对齐 crdt-test-field.mjs：两客户端连真实 crdt-server.mjs，字段级/离线断言。
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WS from 'ws';

const URL = 'ws://localhost:1234';
const ROOM = 'wf-groups-' + Date.now();

// --- 复刻前端 modelFromConfig / configFromModel（含 groups 整段编码，用于初始化）---
function objToYMap(o) { const m = new Y.Map(); for (const k in o) { if (o[k] !== undefined && o[k] !== null) m.set(k, o[k]); } return m; }
function objsToYArray(arr) { const a = new Y.Array(); a.insert(0, (arr || []).map(objToYMap)); return a; }
function modelFromConfig(doc, cfg) {
  const meta = doc.getMap('meta'); meta.set('title', cfg.title); meta.set('subtitle', cfg.subtitle);
  const yPhases = doc.getArray('phases'); yPhases.delete(0, yPhases.length);
  cfg.phases.forEach(ph => { const pm = new Y.Map(); pm.set('badge', ph.badge); pm.set('accent', ph.accent); pm.set('layout', ph.layout); pm.set('title', ph.title); if (ph.nodes) pm.set('nodes', objsToYArray(ph.nodes)); yPhases.push([pm]); });
  const ySide = doc.getMap('sidebar'); ySide.set('title', cfg.sidebar.title); ySide.set('nodes', objsToYArray(cfg.sidebar.nodes));
  const yEdges = doc.getArray('edges'); yEdges.delete(0, yEdges.length); (cfg.edges || []).forEach(e => yEdges.push([objToYMap(e)]));
  const yG = doc.getArray('groups'); yG.delete(0, yG.length); (cfg.groups || []).forEach(g => { const m = new Y.Map(); m.set('id', g.id); m.set('name', g.name); m.set('color', g.color); m.set('nodeIds', g.nodeIds ? g.nodeIds.slice() : []); yG.push([m]); });
}
function configFromModel(doc) {
  const meta = doc.getMap('meta');
  const cfg = { title: meta.get('title'), subtitle: meta.get('subtitle'), edges: [], phases: [], sidebar: {}, groups: [] };
  cfg.phases = doc.getArray('phases').toArray().map(pm => ({ badge: pm.get('badge'), accent: pm.get('accent'), layout: pm.get('layout'), title: pm.get('title'), nodes: pm.get('nodes') ? pm.get('nodes').toArray().map(m => m.toJSON()) : [] }));
  cfg.sidebar = { title: doc.getMap('sidebar').get('title'), nodes: doc.getMap('sidebar').get('nodes').toArray().map(m => m.toJSON()) };
  cfg.edges = doc.getArray('edges').toArray().map(m => m.toJSON());
  cfg.groups = doc.getArray('groups').toArray().map(m => ({ id: m.get('id'), name: m.get('name'), color: m.get('color'), nodeIds: (m.get('nodeIds') || []) }));
  return cfg;
}
// 复刻前端增量增删（按 id 定位，不再整段替换）
function addGroupToDoc(doc, g) {
  const yG = doc.getArray('groups');
  for (let i = 0; i < yG.length; i++) if (yG.get(i).get('id') === g.id) return; // 同 id 不重复添加
  doc.transact(() => { const m = new Y.Map(); m.set('id', g.id); m.set('name', g.name); m.set('color', g.color); m.set('nodeIds', g.nodeIds ? g.nodeIds.slice() : []); yG.push([m]); });
}
function removeGroupFromDoc(doc, id) {
  const yG = doc.getArray('groups');
  for (let i = 0; i < yG.length; i++) { if (yG.get(i).get('id') === id) { doc.transact(() => yG.delete(i, 1)); return; } } // 按 id 定位索引后 delete(i,1)
}
function groupById(doc, id) { const yG = doc.getArray('groups'); for (let i = 0; i < yG.length; i++) if (yG.get(i).get('id') === id) return yG.get(i); return null; }
function groupsOf(doc) { return configFromModel(doc).groups; }
function idsOf(groups) { return groups.map(g => g.id).sort().join(','); }
function hasId(groups, id) { return groups.some(g => g.id === id); }
function arrEq(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]); }

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
    { id: 'n2', title: 'N2', desc: 'd2', icon: 'i' }
  ] }],
  sidebar: { title: 'SB', nodes: [{ id: 'n3', title: 'N3', desc: 'd3', icon: 'i' }] },
  edges: [],
  groups: [{ id: 'g0', name: 'G0', color: '#ef4444', nodeIds: ['n1', 'n2', 'n3'] }]
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

  // 1) Round-trip 保真：groups 经 modelFromConfig -> configFromModel 后 id/name/color/nodeIds 完整保留（顺序一致）
  const ga = groupsOf(A.doc);
  const okRound = ga.length === 1 && ga[0].id === 'g0' && ga[0].name === 'G0' && ga[0].color === '#ef4444' && arrEq(ga[0].nodeIds, ['n1', 'n2', 'n3']);
  check('Round-trip 保真（g0 编码/解码一致，含 nodeIds 顺序）', okRound);
  // B 同步收到初始分组
  check('初始分组跨端同步到 B', hasId(groupsOf(B.doc), 'g0') && arrEq(groupsOf(B.doc).find(g => g.id === 'g0').nodeIds, ['n1', 'n2', 'n3']));

  // 2) A 增量新增 g1（addGroupToDoc）-> B 收到
  addGroupToDoc(A.doc, { id: 'g1', name: 'G1', color: '#3b82f6', nodeIds: ['n1'] });
  await sleep(300);
  check('A 增量新增 g1 -> B 收到（g0,g1）', idsOf(groupsOf(B.doc)) === 'g0,g1' && arrEq(groupsOf(B.doc).find(g => g.id === 'g1').nodeIds, ['n1']));

  // 3) B 增量新增 g2 -> A 收到（双向）
  addGroupToDoc(B.doc, { id: 'g2', name: 'G2', color: '#10b981', nodeIds: ['n2', 'n3'] });
  await sleep(300);
  check('B 增量新增 g2 -> A 收到（g0,g1,g2）', idsOf(groupsOf(A.doc)) === 'g0,g1,g2' && arrEq(groupsOf(A.doc).find(g => g.id === 'g2').nodeIds, ['n2', 'n3']));

  // 4) ★ 核心：两人同时各加一个分组（并发增量 push）-> 完美合并，两边都在，互不整段覆盖
  await sleep(150); // 先确保 g0,g1,g2 在两端已一致
  const baseCount = groupsOf(A.doc).length; // 应为 3
  addGroupToDoc(A.doc, { id: 'gc-a', name: 'GA', color: '#8b5cf6', nodeIds: ['n1'] }); // A 加 gc-a
  addGroupToDoc(B.doc, { id: 'gc-b', name: 'GB', color: '#14b8a6', nodeIds: ['n2'] }); // B 加 gc-b（与 A 几乎同时，中间不等待同步）
  await sleep(400);
  const aIds = groupsOf(A.doc).map(g => g.id), bIds = groupsOf(B.doc).map(g => g.id);
  check('并发各加一个分组 -> 两端都含 gc-a 与 gc-b（无互相覆盖）', hasId(groupsOf(A.doc), 'gc-a') && hasId(groupsOf(A.doc), 'gc-b') && hasId(groupsOf(B.doc), 'gc-a') && hasId(groupsOf(B.doc), 'gc-b'));
  check('并发增删后总数正确（3 + 2 = 5）', groupsOf(A.doc).length === baseCount + 2 && groupsOf(B.doc).length === baseCount + 2);

  // 5) 增量删除（removeGroupFromDoc 按 id 定位）：A 删 g0 -> B 同步移除
  removeGroupFromDoc(A.doc, 'g0');
  await sleep(300);
  check('A 增量删除 g0 -> B 同步移除', !hasId(groupsOf(B.doc), 'g0') && idsOf(groupsOf(A.doc)) === idsOf(groupsOf(B.doc)));

  // 6) 离线编辑后重连合并：A 断线增量新增 g3，B 离线期看不到；重连后 B 收到
  A.provider.disconnect();
  await sleep(50);
  addGroupToDoc(A.doc, { id: 'g3', name: 'G3', color: '#f59e0b', nodeIds: ['n1', 'n2'] });
  await sleep(250);
  check('离线期间 B 未收到 A 新增的 g3', !hasId(groupsOf(B.doc), 'g3'));
  A.provider.connect();
  await synced(A.provider);
  await sleep(350);
  check('重连后 g3 增量合并（A 有 g3 且 B 也收到）', hasId(groupsOf(A.doc), 'g3') && hasId(groupsOf(B.doc), 'g3') && arrEq(groupsOf(B.doc).find(g => g.id === 'g3').nodeIds, ['n1', 'n2']));

  // 7) 分组 Y.Map 自身字段级合并能力（与节点同理）：不同分组并发改不同字段 -> 双向合并
  const gxA = new Y.Map(); gxA.set('id', 'gx'); gxA.set('name', 'X'); gxA.set('color', '#f59e0b'); gxA.set('nodeIds', ['n1']); A.doc.getArray('groups').push([gxA]);
  const gyB = new Y.Map(); gyB.set('id', 'gy'); gyB.set('name', 'Y'); gyB.set('color', '#14b8a6'); gyB.set('nodeIds', ['n2']); B.doc.getArray('groups').push([gyB]);
  await sleep(300);
  const bothPresent = hasId(groupsOf(A.doc), 'gx') && hasId(groupsOf(A.doc), 'gy') && hasId(groupsOf(B.doc), 'gx') && hasId(groupsOf(B.doc), 'gy');
  groupById(A.doc, 'gx').set('name', 'X-A编辑');
  groupById(B.doc, 'gy').set('nodeIds', ['n2', 'n3']);
  await sleep(300);
  const gxOnB = groupsOf(B.doc).find(g => g.id === 'gx'); const gyOnA = groupsOf(A.doc).find(g => g.id === 'gy');
  check('分组 Y.Map 字段级合并（并发改不同分组字段 -> 双向）', bothPresent && gxOnB && gxOnB.name === 'X-A编辑' && gyOnA && arrEq(gyOnA.nodeIds, ['n2', 'n3']));

  A.provider.destroy(); B.provider.destroy();
  console.log(`\n分组 CRDT 增量增删测试：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
