// P0 双修验证探针（2026-11-06）：STL 顶点量化聚类（修 1）与场钳位（修 2）的病灶根除断言。
// 病灶指纹（Q1 判读）：p50 类双节点对（206/23775 Δz≈1e-6）——同 1e-5 格内 float32 分裂值。
// 用法：node probe_p0_vertex_merge.mjs [type=diamond] [P=0.5] [R=48] [k=2]
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const TYPE = process.argv[2] ?? 'diamond';
const P = Number(process.argv[3] ?? 0.5);
const R = Number(process.argv[4] ?? 48);
const K = Number(process.argv[5] ?? 2);

const entry = join(process.env.TEMP ?? '/tmp', 'p0v_entry.ts');
writeFileSync(entry, `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};
export { buildBinarySTL as stlExport } from ${JSON.stringify(join(PLATFORM, 'src/export/stl-exporter.ts'))};`);
const out = join(process.env.TEMP ?? '/tmp', 'p0v_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 失败:', r.stdout, r.stderr); process.exit(1); }
const mod = await import('file:///' + out.split('\\').join('/'));

const { DEFAULT_HYBRID } = await import(pathToFileURL(join(PLATFORM, 'src/core/types.ts')).href).catch(() => ({ DEFAULT_HYBRID: { enable: false } }));
const res = mod.buildSurface({
  type: TYPE, iso: 0, periods: K, resolution: R, targetPorosity: P,
  weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
  thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: true,
});
const scale = K / (2 * Math.PI);   // wc→mm：总宽=k 个 cellSize（1mm/周期约定与 CLI mesh 一致）
const buf = mod.stlExport(res.positions, res.indices, scale, res.normals);
const dv = new DataView(buf);
const triCount = dv.getUint32(80, true);

// 病灶指纹扫描：逐坐标分量的 1e-5 量化格 → 格内不同 float32 值计数（分裂对）
// 注：分量级聚类与顶点级等价（分裂病灶即分量差 ~1 ULP）
const GRID = 1e5;
const cells = new Map();   // key "x格,y格,z格,分量" → Set(float32 字节串)
let splitTotal = 0;
const readF32 = (off) => dv.getFloat32(off, true);
for (let t = 0; t < triCount; t++) {
  const base = 84 + t * 50 + 12;
  for (let v = 0; v < 3; v++) {
    for (let c = 0; c < 3; c++) {
      const val = readF32(base + v * 12 + c * 4);
      const gk = Math.round(val * GRID);
      const key = `${gk}:${c}`;
      let s = cells.get(key);
      if (!s) { s = new Set(); cells.set(key, s); }
      s.add(val);
    }
  }
}
for (const s of cells.values()) if (s.size > 1) splitTotal += s.size - 1;

// 近重合顶点对采样（<1e-5 mm 的不同写值对——修后必为 0，因同格同值）
let nearDup = 0;
{
  const vset = new Map(); // 顶点字符串 → count
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const k3 = `${readF32(base + v * 12)},${readF32(base + v * 12 + 4)},${readF32(base + v * 12 + 8)}`;
      vset.set(k3, (vset.get(k3) ?? 0) + 1);
    }
  }
  // 量化格级顶点对：不同写值但全部分量同格
  const gset = new Map();
  for (const k3 of vset.keys()) {
    const [x, y, z] = k3.split(',').map(Number);
    const gk = `${Math.round(x * GRID)},${Math.round(y * GRID)},${Math.round(z * GRID)}`;
    gset.set(gk, (gset.get(gk) ?? 0) + 1);
  }
  for (const [gk, n] of gset) if (n > 1) nearDup += n - 1; // 同格顶点数>写值种类=分裂
}

console.log(`${TYPE} p${Math.round(P * 100)} k${K} R${R}: tris=${triCount} verts=${triCount * 3}`);
// 修前基线（对照）：未量化 positions 的同格分裂指纹（旧 exporter 直写 float32 的行为）
let splitBase = 0;
{
  const bm = new Map();
  const pos = res.positions;
  for (let i = 0; i < pos.length; i++) {
    const gk = Math.round(pos[i] * scale * GRID);
    const key = `${gk}:${i % 3}`;
    let s = bm.get(key);
    if (!s) { s = new Set(); bm.set(key, s); }
    s.add(pos[i] * scale);
  }
  for (const s of bm.values()) if (s.size > 1) splitBase += s.size - 1;
}
console.log(`[基线] 未量化 positions 同格分裂值：${splitBase}（修前病灶指纹）`);
console.log(`[修1] 分量级同格分裂值：${splitTotal}（应=0：1e-5 量化聚类后同格必同值）`);
console.log(`[修1] 顶点级同格多写值：${nearDup}（p50 病灶指纹——修前实measured >0，修后应=0）`);
// 修 2 侧证据：顶点距格线最小距离（钳位后插值点距格点 ≥ ~eps_snap/场梯度×格距）
let minEdge = Infinity;
for (let t = 0; t < triCount; t++) {
  const base = 84 + t * 50 + 12;
  for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) {
    const val = readF32(base + v * 12 + c * 4);
    const d = Math.abs(val * GRID - Math.round(val * GRID)) / GRID;
    if (d > 0 && d < minEdge) minEdge = d;
  }
}
console.log(`[修2] 坐标距 1e-5 格线最小距离：${minEdge.toExponential(2)} mm（>0 即插值点未贴格点）`);
const ok = splitTotal === 0;
console.log(ok ? 'PROBE PASS' : 'PROBE FAIL');
process.exit(ok ? 0 : 1);
