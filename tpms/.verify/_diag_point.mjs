// _diag_point.mjs — 单点暴力最近距离 vs BVH SDF 对质（一次性）
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const PLATFORM = 'D:/GITHUB/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'tpms_conformal_bundle.mjs');
{ const entry = join(tmpdir(), 'tpms_conformal_entry.ts');
  const mods = ['src/geometry/surface-nets.ts:buildSurface', 'src/geometry/buffer-pool.ts:globalBufferPool', 'src/geometry/mesh-container.ts:computeMeshSDF,checkMesh,parseSTL,closestPtTriangle'];
  writeFileSync(entry, mods.map((m) => { const [f, names] = m.split(':'); return ; }).join('
'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync("\"" + rolldown + "\" " + entry + ' --format esm --file "' + BUNDLE + '"', { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown fail'); process.exit(1); }
}
import { computeMeshSDF } from 'file:///C:/Users/qi/AppData/Local/Temp/tpms_conformal_bundle.mjs';
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
const N = 49;
const r = computeMeshSDF(buf, N);
// 归一化参数（复刻：bbox 中心 0（torus 对称）、halfMax=20、scale=20/0.95）
const scale = 21.0526;
const target = [-0.781, -0.794, 0.910];
// 暴力最近距离（phys 域坐标 = target，网格顶点 phys = mm/scale）
let best = Infinity;
for (let t = 0; t < I.length; t += 3) {
  for (let v = 0; v < 3; v++) {
    const p3 = I[t * 3 + v] * 3;
    const dx = P[p3] / scale - target[0], dy = P[p3 + 1] / scale - target[1], dz = P[p3 + 2] / scale - target[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) best = d;
  }
}
// 顶点到三角形面的更近可能：顶点采样已足够（弦差级），比较数量级即可
const gi = Math.round(((target[0] + 1) / 2) * (N - 1)), gj = Math.round(((target[1] + 1) / 2) * (N - 1)), gk = Math.round(((target[2] + 1) / 2) * (N - 1));
const sv = r.sdf[gk * N * N + gj * N + gi];
console.log('暴力最近(顶点级) =', best.toFixed(4), '| sdf 数组值 =', sv.toFixed(4), '| diff =', (sv - best).toFixed(4));
console.log('解析 ref =', ((Math.hypot(Math.hypot(target[0] * scale, target[1] * scale) - Rm, target[2] * scale) - rm) / scale).toFixed(4));
