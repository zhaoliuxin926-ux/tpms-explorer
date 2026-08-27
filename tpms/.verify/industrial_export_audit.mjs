/**
 * industrial_export_audit.mjs —— 工业交换格式专项审计（第八道门）
 *
 * 断言（GLB + 3MF 双格式）：
 *   GLB（二进制 glTF 2.0）
 *     · Magic 0x46546C67 ('glTF')、version=2、总长守恒
 *     · JSON chunk 可解析：POSITION/NORMAL/COLOR_0 accessor 齐备
 *     · COLOR_0 数值全部 ∈ [0,1]；无色导出不写 COLOR_0
 *     · 顶点/面数守恒；asset.extras 声明毫米尺度
 *   3MF（OPC ZIP 包，STORED）
 *     · ZIP 可解包（PK 签名遍历、method=0），三成员齐全
 *     · 3dmodel.model：unit="millimeter"、端板元数据（开启时）
 *     · <vertex>/<triangle> 计数与内部网格严格守恒
 *
 * 运行：node industrial_export_audit.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_industrial_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_industrial_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/export/glb-exporter.ts:buildGLB',
    'src/export/3mf-exporter.ts:build3MF',
    'src/core/units.ts:wcToMmFactor',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, buildGLB, build3MF, wcToMmFactor } =
  await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d ? '— ' + d : ''); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };

function build(type, ep, colors = false) {
  globalBufferPool.reset();
  return buildSurface({
    type, iso: 0, periods: 3, resolution: 61, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', preview: false,
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', endplateMm: ep,
    coloring: colors ? 'elevation' : undefined,
  }, globalBufferPool);
}

// ── GLB（带色）────────────────────────────────────────────────
{
  const res = build('gyroid', 1.0, true);
  const mm = wcToMmFactor(3);
  const buf = new Uint8Array(buildGLB({
    positions: res.positions, normals: res.normals, indices: res.indices,
    colors: res.colors ?? null, scale: mm,
    meta: { type: 'gyroid', porosityPct: 75 },
  }));
  const dv = new DataView(buf.buffer);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  const total = dv.getUint32(8, true);
  magic === 0x46546c67 && version === 2 && total === buf.length
    ? ok('GLB magic/version/长度', `magic=0x${magic.toString(16)} v=${version}`)
    : bad('GLB 容器头', `magic=${magic.toString(16)} v=${version} total=${total}/${buf.length}`);

  const jsonLen = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  const jsonText = new TextDecoder().decode(buf.slice(20, 20 + jsonLen));
  let gltf = null;
  try { gltf = JSON.parse(jsonText); } catch { /* JSON chunk 解析失败 */ }
  jsonType === 0x4e4f534a && !!gltf ? ok('JSON chunk 解析') : bad('JSON chunk', `type=0x${jsonType.toString(16)}`);

  const prim = gltf?.meshes?.[0]?.primitives?.[0];
  const attr = prim?.attributes ?? {};
  const hasAll = attr.POSITION !== undefined && attr.NORMAL !== undefined && attr.COLOR_0 !== undefined;
  hasAll ? ok('POSITION/NORMAL/COLOR_0 齐备') : bad('GLB attributes', JSON.stringify(attr));

  const colorAcc = gltf.accessors[attr.COLOR_0];
  const cv = gltf.bufferViews[colorAcc.bufferView];
  const binOff = 20 + jsonLen + 8;
  const cBytes = new Float32Array(buf.buffer.slice(binOff + cv.byteOffset, binOff + cv.byteOffset + cv.byteLength));
  let inRange = true;
  for (let i = 0; i < cBytes.length; i++) if (!(cBytes[i] >= 0 && cBytes[i] <= 1)) { inRange = false; break; }
  inRange && colorAcc.count === res.vertCount
    ? ok('COLOR_0 值域 [0,1]', `${colorAcc.count} 顶点 ×3`)
    : bad('COLOR_0 值域', `count=${colorAcc.count} vs verts=${res.vertCount}`);

  const posAcc = gltf.accessors[attr.POSITION];
  const idxAcc = gltf.accessors[prim.indices];
  posAcc.count === res.vertCount && idxAcc.count === res.indices.length
    ? ok('GLB 顶点/面数守恒', `${posAcc.count}v / ${idxAcc.count}t`)
    : bad('GLB 守恒', `${posAcc.count}v/${idxAcc.count}t vs ${res.vertCount}v/${res.indices.length / 3}t`);
  gltf.asset?.extras?.units === 'millimeter' ? ok('mm 尺度声明（asset.extras）') : bad('mm 尺度声明');

  const res0 = build('gyroid', 0, false);
  const buf0 = new Uint8Array(buildGLB({ positions: res0.positions, normals: res0.normals, indices: res0.indices, colors: null, scale: mm }));
  const j0 = JSON.parse(new TextDecoder().decode(buf0.slice(20, 20 + new DataView(buf0.buffer).getUint32(12, true))));
  !j0.meshes[0].primitives[0].attributes.COLOR_0 ? ok('无色导出不写 COLOR_0') : bad('无色导出含 COLOR_0');
}

// ── 3MF（无端板 + 端板两 case）────────────────────────────────
for (const [type, ep] of [['gyroid', 0], ['gyroid', 1.2]]) {
  const res = build(type, ep, false);
  const mm = wcToMmFactor(3);
  const buf = new Uint8Array(build3MF(res.positions, res.indices, mm, {
    configName: `${type}-solid75-k3`, porosity: 75, endplateMm: ep, structureMode: 'solid_network',
  }));
  const dv = new DataView(buf.buffer);
  let off = 0;
  const members = {};
  let zipOk = true;
  while (dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const csize = dv.getUint32(off + 18, true);
    const nlen = dv.getUint16(off + 26, true);
    const elen = dv.getUint16(off + 28, true);
    const name = new TextDecoder().decode(buf.slice(off + 30, off + 30 + nlen));
    if (method !== 0) zipOk = false;   // 必须 STORED（本实现不写 deflate）
    members[name] = new TextDecoder().decode(buf.slice(off + 30 + nlen + elen, off + 30 + nlen + elen + csize));
    off = off + 30 + nlen + elen + csize;
  }
  // EOCD 位于 central directory 之后：central 记录各 46+nameLen 字节
  let centralSize = 0;
  for (const name of Object.keys(members)) centralSize += 46 + name.length;
  const eocdOk = dv.getUint32(off + centralSize, true) === 0x06054b50;
  const three = members['3D/3dmodel.model'];
  const structureOk = !!members['[Content_Types].xml'] && !!members['_rels/.rels'] && !!three && zipOk && eocdOk;
  structureOk ? ok(`${type} ep${ep} · ZIP 三成员齐全（STORED）`) : bad(`${type} · ZIP 结构`, JSON.stringify(Object.keys(members)));

  if (three) {
    const unitOk = three.includes('unit="millimeter"');
    const vCount = (three.match(/<vertex /g) || []).length;
    const tCount = (three.match(/<triangle /g) || []).length;
    const conserved = vCount === res.vertCount && tCount === res.triCount;
    unitOk && conserved
      ? ok(`${type} ep${ep} · XML 守恒`, `${vCount}v/${tCount}t · millimeter`)
      : bad(`${type} · XML 守恒`, `${vCount}/${tCount} vs ${res.vertCount}/${res.triCount}`);
    if (ep > 0) {
      const epMeta = three.includes('TPMS:EndplateMm') && three.includes(`>${ep}<`);
      epMeta ? ok('端板元数据标记') : bad('端板元数据缺失');
    }
  }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
