// _diag_cpt.mjs — closestPtTriangle 已知几何单元测试（一次性）
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const PLATFORM = 'D:/GITHUB/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'tpms_conformal_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_conformal_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/geometry/mesh-container.ts:computeMeshSDF,checkMesh,parseSTL,closestPtTriangle',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown fail', r.stderr?.slice(-300)); process.exit(1); }
}
const { closestPtTriangle, computeMeshSDF, checkMesh } = await import('file:///' + BUNDLE.replace(/\\/g, '/'));

const out = new Float64Array(3);
let pass = 0, fail = 0;
const t = (name, px, py, pz, tri, ex, ey, ez) => {
  closestPtTriangle(px, py, pz, ...tri, out);
  const d = Math.hypot(out[0] - ex, out[1] - ey, out[2] - ez);
  if (d < 1e-9) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, 'got', out[0].toFixed(4), out[1].toFixed(4), out[2].toFixed(4), 'exp', ex, ey, ez); }
};
// 三角形 A(0,0,1) B(1,0,1) C(0,1,1)
const T = [0, 0, 1, 1, 0, 1, 0, 1, 1];
t('T1 面内上方', 0.5, 0.5, 2, T, 0.5, 0.5, 1);
t('T2 顶点 A 外', -1, -1, -1, T, 0, 0, 1);
t('T3 边 AB 外', 0.5, -1, 1, T, 0.5, 0, 1);
t('T4 边 AC 外', -1, 0.5, 1, T, 0, 0.5, 1);
t('T5 顶点 B 外', 2, -0.5, 0, T, 1, 0, 1);
t('T6 面内正下', 0.2, 0.3, 0, T, 0.2, 0.3, 1);
// 钝角长条三角 A(0,0,0) B(10,0,0) C(11,0,0 共线退化——跳过；用钝角 A(0,0,0) B(10,0,0) C(9,1,0)
const T2 = [0, 0, 0, 10, 0, 0, 9, 1, 0];
t('T7 钝角三角 B 顶点外', 12, 0.5, 0, T2, 10, 0, 0);
t('T8 钝角三角下方', 5, -3, 0, T2, 5, 0, 0);
// 大坐标 mm 域
t('T9 大坐标面', 20000, 20000, 40000, [14000, 0, 0, 20000, 0, 0, 14000, 20000, 0], 17000, 17000, 0);
console.log(`CPT: ${pass} PASS / ${fail} FAIL`);

// ── 同点对质：桶 distTo（远壁点）路径诊断 ──
// 复刻门禁 torus → 直接对 (-0.781,-0.794,0.910) 跑 computeMeshSDF 后验证
const Rm = 14, rm = 6, nu = 128, nv = 48;
const pos = [], idx = [];
const id = (i, j) => (i % nu) * nv + (j % nv);
for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
  const u = (i / nu) * 2 * Math.PI, v = (j / nv) * 2 * Math.PI;
  const rr = Rm + rm * Math.cos(v);
  pos.push(rr * Math.cos(u), rr * Math.sin(u), rm * Math.sin(v));
}
for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
  const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
  idx.push(a, b, c, a, c, d);
}
const P = Float32Array.from(pos), I = Uint32Array.from(idx);
const triCount = I.length / 3;
const buf = new ArrayBuffer(84 + triCount * 50);
const dv = new DataView(buf);
dv.setUint32(80, triCount, true);
let off = 84;
for (let t = 0; t < triCount; t++) {
  off += 12;
  for (let v = 0; v < 3; v++) {
    const p3 = I[t * 3 + v] * 3;
    dv.setFloat32(off, P[p3], true); dv.setFloat32(off + 4, P[p3 + 1], true); dv.setFloat32(off + 8, P[p3 + 2], true); off += 12;
  }
  off += 2;
}
const r = computeMeshSDF(buf, 49);
const scale = 20 / 0.95;
const target = [-0.781, -0.794, 0.91];
const gi = Math.round(((target[0] + 1) / 2) * 48), gj = Math.round(((target[1] + 1) / 2) * 48), gk = Math.round(((target[2] + 1) / 2) * 48);
const sv = r.sdf[gk * 49 * 49 + gj * 49 + gi];
// 暴力顶点级
let best = Infinity;
for (let i = 0; i < P.length; i += 3) {
  const dx = P[i] / scale - target[0], dy = P[i + 1] / scale - target[1], dz = P[i + 2] / scale - target[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < best) best = d;
}
console.log('远壁点: sdf=', sv.toFixed(4), '暴力顶点级=', best.toFixed(4), '解析=', ((Math.hypot(Math.hypot(target[0] * scale, target[1] * scale) - Rm, target[2] * scale) - rm) / scale).toFixed(4));
console.log('dx check: phys 域网格 z 范围 ±', (6 / scale).toFixed(4));
process.exit(fail ? 1 : 0);
