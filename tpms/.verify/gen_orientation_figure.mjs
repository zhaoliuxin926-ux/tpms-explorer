/**
 * gen_orientation_figure.mjs —— 论文图二数据生成：构造性定向传播 vs 历史逐三角投票
 *
 * 口径：同一几何输入（当前 Surface Nets v2 构造性定向网格，misoriented=0 by construction）
 * 分别施加两种写出器方案，统计「方向不一致边」（有向边配对失衡数）：
 *   A. 构造性全局定向（现行）——边穿越键提取时已定向，写出器不再翻转 → 期望 0
 *   B. 历史逐三角投票（78d248d~1 旧写出器逐字复刻：几何法线与顶点解析法线和点积<0 即交换 v1/v2）
 *      → 在解析法线场不可靠区（高曲率交汇/法线符号翻转区）破碎缠绕
 * 输出：docs/paper/figures/fig_orientation_data.json（misoriented 边中点云 + 一致边稀疏样本）
 * 渲染：docs/paper/figures/render_orientation_figure.py（matplotlib → PDF）
 *
 * 运行：node tpms/.verify/gen_orientation_figure.mjs   （一次性论文取证脚本，不入 CI）
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const FIGDIR = join(HERE, '../../docs/paper/figures');
mkdirSync(FIGDIR, { recursive: true });

// ── 1. 打包当前核心 ──
const BUNDLE = join(tmpdir(), 'tpms_orient_bundle.mjs');
const entry = join(tmpdir(), 'tpms_orient_entry.ts');
writeFileSync(entry, [
  `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
  `export { globalBufferPool } from ${JSON.stringify(join(PLATFORM, 'src/geometry/buffer-pool.ts'))};`,
].join('\n'));
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 失败:', r.stderr?.slice(-300)); process.exit(1); }
const { buildSurface, globalBufferPool } = await import(pathToFileURL(BUNDLE));

// ── 2. 构建 frd R96 p0.6 k6（benchmark 水密可产锚点）──
globalBufferPool.reset();
const res = buildSurface({
  type: 'frd', iso: 0, periods: 6, resolution: 96, targetPorosity: 0.6,
  weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
  thickness: 1.0, gradientDir: 'z', preview: false,
  hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
  customFormula: '', endplateMm: 0,
}, globalBufferPool);
const { positions, indices, normals } = res;
console.log(`mesh: frd R96 k6 p0.6 — ${res.vertCount} verts / ${res.triCount} tris, measured p=${(res.porosityEstimate * 100).toFixed(2)}%`);

// ── 3. 方向一致性审计（无向边归一化：一致 ⇔ 正反向各恰一次；与 hybrid_audit.openEdges 同口径）──
function countMisoriented(idx) {
  let maxV = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxV) maxV = idx[i];
  maxV++;
  const em = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? a * maxV + b : b * maxV + a;
      const rec = em.get(key) ?? [0, 0];
      if (a < b) rec[0]++; else rec[1]++;
      em.set(key, rec);
    }
  }
  let mis = 0;
  const mids = [];
  for (const [key, [f, b]] of em) {
    if (f === 1 && b === 1) continue;
    mis++;
    if (mids.length < 40000) {
      const u = Math.floor(key / maxV), v = key % maxV;
      mids.push([(positions[u * 3] + positions[v * 3]) / 2, (positions[u * 3 + 1] + positions[v * 3 + 1]) / 2, (positions[u * 3 + 2] + positions[v * 3 + 2]) / 2]);
    }
  }
  return { misoriented: mis, midpoints: mids };
}

// ── 4. 三态 A/B：raw 提取输出 / 历史逐三角投票写出器 / 现行构造性传播写出器 ──
const raw = countMisoriented(indices);

const flipped = indices.slice();
for (let t = 0; t < flipped.length; t += 3) {
  const i0 = flipped[t] * 3, i1 = flipped[t + 1] * 3, i2 = flipped[t + 2] * 3;
  const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
  const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const nx = normals[i0] + normals[i1] + normals[i2];
  const ny = normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1];
  const nz = normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2];
  if (nx * cx + ny * cy + nz * cz < 0) {
    flipped[t + 1] = indices[t + 2]; flipped[t + 2] = indices[t + 1];
  }
}
const voting = countMisoriented(flipped);

// 现行 orientConsistently（stl-exporter.ts L122-188 逐字复刻，私有函数故内联；
// 算法：无向边登记 → 邻接 BFS 二着色（同向邻接异色）→ 着色翻转 → 发散体积统一外向）
function orientConsistently(indicesIn) {
  const triCount = indicesIn.length / 3;
  const out = indicesIn.slice();
  if (triCount === 0) return out;
  const vertCount = positions.length / 3;
  const edgeMap = new Map();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = indicesIn[t * 3 + e], b = indicesIn[t * 3 + (e + 1) % 3];
      if (a === b) continue;
      const rev = a > b;
      const key = rev ? b * vertCount + a : a * vertCount + b;
      let rec = edgeMap.get(key);
      if (!rec) { rec = []; edgeMap.set(key, rec); }
      if (rec.length < 2) rec.push({ t, rev });
    }
  }
  const color = new Int8Array(triCount).fill(-1);
  const queue = new Int32Array(triCount);
  for (let seed = 0; seed < triCount; seed++) {
    if (color[seed] !== -1) continue;
    color[seed] = 0;
    let head = 0, tail = 0;
    queue[tail++] = seed;
    while (head < tail) {
      const t = queue[head++];
      for (let e = 0; e < 3; e++) {
        const a = indicesIn[t * 3 + e], b = indicesIn[t * 3 + (e + 1) % 3];
        if (a === b) continue;
        const key = a > b ? b * vertCount + a : a * vertCount + b;
        const rec = edgeMap.get(key);
        if (!rec || rec.length !== 2) continue;
        const other = rec[0].t === t ? rec[1] : rec[0];
        if (color[other.t] !== -1) continue;
        color[other.t] = (other.rev === (a > b)) ? color[t] ^ 1 : color[t];
        queue[tail++] = other.t;
      }
    }
  }
  for (let t = 0; t < triCount; t++) {
    if (color[t] === 1) {
      const tmp = out[t * 3 + 1]; out[t * 3 + 1] = out[t * 3 + 2]; out[t * 3 + 2] = tmp;
    }
  }
  let vol6 = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = out[t * 3] * 3, i1 = out[t * 3 + 1] * 3, i2 = out[t * 3 + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  if (vol6 < 0) {
    for (let t = 0; t < triCount; t++) {
      const tmp = out[t * 3 + 1]; out[t * 3 + 1] = out[t * 3 + 2]; out[t * 3 + 2] = tmp;
    }
  }
  return out;
}
const constructive = countMisoriented(orientConsistently(indices));

console.log(`raw extractor:      misoriented=${raw.misoriented}`);
console.log(`voting writer:      misoriented=${voting.misoriented}（采样 ${voting.midpoints.length} 边中点）`);
console.log(`constructive writer: misoriented=${constructive.misoriented}`);

// ── 5. 落盘 ──
writeFileSync(join(FIGDIR, 'fig_orientation_data.json'), JSON.stringify({
  meta: { mesh: 'frd', resolution: 96, periods: 6, targetPorosity: 0.6, measuredPorosity: +res.porosityEstimate.toFixed(4), triCount: res.triCount, generated: new Date().toISOString() },
  rawExtractor: { misoriented: raw.misoriented, edgeMidpoints: raw.midpoints },
  votingWriter: { misoriented: voting.misoriented, edgeMidpoints: voting.midpoints },
  constructiveWriter: { misoriented: constructive.misoriented },
}, null, 1));
console.log(`written: ${join(FIGDIR, 'fig_orientation_data.json')}`);
