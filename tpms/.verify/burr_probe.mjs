/**
 * burr_probe.mjs —— STL 表面毛刺量化诊断探针（Task 1）
 *
 * 四组指标（诊断报告 §四 的实现）：
 *   ① 二面角谱      流形边相邻面夹角 P50/P95/P99/max 与 θ>15° 边占比
 *   ② Sliver 形状学 最小内角 <10° 或 最长/最短边 >50 的三角形占比（audit 只有
 *                   degenTris=零面积，此指标填空白）
 *   ③ 法向残差谱    r = |F(x)|/(|∇F|·h_mm)；solid 口径 F=isoUsed−V(x)、
 *                   shell 口径 F=v²−t²（t = res.isoUsed = tEffBase/2）。
 *                   区分投影校正与否的判决性指标（R2）
 *   ④ 端面带分层    phys 0.96 判界（与平滑守卫 SN:666/735 同口径），
 *                   内部 vs 边界带的 RMS 与二面角 P99 分开输出（指认 R4）
 *
 * 运行：node burr_probe.mjs [--json out.json]
 * 用法约定：先在优化前 HEAD 跑一次存 burr_baseline.json 作为对照基线。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_burr_probe_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_burr_probe_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/core/tpms-functions.ts:getTpmsFunction',
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
const { buildSurface, globalBufferPool, getTpmsFunction, wcToMmFactor } =
  await import(pathToFileURL(BUNDLE));

// ── 案例集 ──────────────────────────────────────────────────
// R 显式给出（pre/post 对照必须同 R 才公平）；frd k3 条目展示 A2「触顶让渡截距」的效果差：
// 旧公式 min(96,19+84)=96，新公式 ceil(3*28)=84 —— 密度恢复设计值且重建提速 ~40%
const CASES = [
  { name: 'gyroid solid75 k3', type: 'gyroid', mode: 'solid_network', p: .75, k: 3, R: 61 },
  { name: 'diamond solid75 k3', type: 'diamond', mode: 'solid_network', p: .75, k: 3, R: 61 },
  { name: 'schwarz solid50 k3', type: 'schwarz', mode: 'solid_network', p: .5, k: 3, R: 61 },
  { name: 'neovius solid75 k3', type: 'neovius', mode: 'solid_network', p: .75, k: 3, R: 96 },
  { name: 'iwp solid75 k3', type: 'iwp', mode: 'solid_network', p: .75, k: 3, R: 96 },
  { name: 'frd solid75 k3[旧96→新84]', type: 'frd', mode: 'solid_network', p: .75, k: 3, R: 84 },
  { name: 'lidinoid solid75 k2', type: 'lidinoid', mode: 'solid_network', p: .75, k: 2, R: 47 },
  { name: 'splitp solid75 k2', type: 'splitp', mode: 'solid_network', p: .75, k: 2, R: 47 },
  { name: 'gyroid shell70 k3', type: 'gyroid', mode: 'shell', p: .70, k: 3, R: 61 },
  { name: 'gyroid gradient-z shell70 k3', type: 'gyroid', mode: 'gradient_shell', p: .70, k: 3, R: 61, gradientDir: 'z' },
  { name: 'gyroid solid75 k5[R密度衰减观测]', type: 'gyroid', mode: 'solid_network', p: .75, k: 5, R: 89 },
];

// ── 几何分析工具 ────────────────────────────────────────────
function faceNormal(p, i0, i1, i2) {
  const ax = p[i1] - p[i0], ay = p[i1 + 1] - p[i0 + 1], az = p[i1 + 2] - p[i0 + 2];
  const bx = p[i2] - p[i0], by = p[i2 + 1] - p[i0 + 1], bz = p[i2 + 2] - p[i0 + 2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (l === 0) return null;
  return [nx / l, ny / l, nz / l];
}

function triangleShape(p, ia, ib, ic) {
  const d = (u, v) => Math.hypot(p[u] - p[v], p[u + 1] - p[v + 1], p[u + 2] - p[v + 2]);
  const e0 = d(ia, ib), e1 = d(ib, ic), e2 = d(ic, ia);
  const longest = Math.max(e0, e1, e2), shortest = Math.min(e0, e1, e2);
  // 最小内角：小角度近端点对边的余弦定理
  const cosOpposite = (opp, s1, s2) => (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2);
  const cMin = Math.min(
    Math.abs(cosOpposite(e0, e1, e2)), Math.abs(cosOpposite(e1, e0, e2)), Math.abs(cosOpposite(e2, e0, e1)),
  );
  const minAngleDeg = Math.acos(Math.min(1, cMin)) * 180 / Math.PI;
  const ratio = shortest > 0 ? longest / shortest : Infinity;
  return { minAngleDeg, ratio };
}

function percentile(sortedArr, q) {
  if (sortedArr.length === 0) return NaN;
  const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * q));
  return sortedArr[idx];
}

// 法向残差采样器（镜像 surface-nets 投影段 rawAt 的语义约定）
function makeResidualSampler(tc, isoUsed) {
  const fn = getTpmsFunction(tc.type === 'custom' ? 'custom' : tc.type, tc.customFormula ?? '');
  const w = tc.weights ?? [1, 1, 1, 1];
  const k = tc.k;
  const PI = Math.PI;
  const V = (px, py, pz) => fn(px * PI * k, py * PI * k, pz * PI * k, w);
  const hh = 1e-4;
  if (tc.mode === 'solid_network') {
    const bias = isoUsed;   // F = bias − v
    return (x, y, z) => {
      const mx = x * k, my = y * k, mz = z * k;
      const f = bias - V(mx / PI, my / PI, mz / PI);
      const gx = (V((mx + hh) / PI, my / PI, mz / PI) - V((mx - hh) / PI, my / PI, mz / PI)) / (2 * hh);
      const gy = (V(mx / PI, (my + hh) / PI, mz / PI) - V(mx / PI, (my - hh) / PI, mz / PI)) / (2 * hh);
      const gz = (V(mx / PI, my / PI, (mz + hh) / PI) - V(mx / PI, my / PI, (mz - hh) / PI)) / (2 * hh);
      const g = Math.hypot(gx, gy, gz) || 1e-30;
      return [Math.abs(f) / g, g];
    };
  }
  // shell / gradient_shell：F = v² − t²（z 向梯度壳忽略 tScale 空间变化对 ∇F 的
  // 二阶影响——残差只作壳间横向比较，不跨模式断言绝对阈值）
  const t = isoUsed;
  return (x, y, z) => {
    const mx = x * k, my = y * k, mz = z * k;
    const px = mx / PI, py = my / PI, pz = mz / PI;
    const v = V(px, py, pz);
    const f = Math.abs(v * v - t * t);
    const gRaw = Math.abs(2 * v) || 1e-6;
    const gx = (V((mx + hh) / PI, py, pz) - V((mx - hh) / PI, py, pz)) / (2 * hh);
    const gy = (V(px, (my + hh) / PI, pz) - V(px, (my - hh) / PI, pz)) / (2 * hh);
    const gz = (V(px, py, (mz + hh) / PI) - V(px, py, (mz - hh) / PI)) / (2 * hh);
    const g = Math.max(gRaw * Math.hypot(gx, gy, gz), 1e-30);
    return [f / g, g];
  };
}

const jsonOut = process.argv.includes('--json');
const jsonPath = jsonOut ? process.argv[process.argv.indexOf('--json') + 1] : null;
const results = [];

for (const tc of CASES) {
  globalBufferPool.reset();
  const res = buildSurface({
    type: tc.type, iso: 0, periods: tc.k, resolution: tc.R, targetPorosity: tc.p,
    weights: [1, 1, 1, 1], structureMode: tc.mode, containerShape: 'cube',
    thickness: 1.0, gradientDir: tc.gradientDir ?? 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  }, globalBufferPool);

  const pos = res.positions, idx = res.indices;
  const triCount = idx.length / 3;
  const nVert = res.vertCount;

  // ── ①二面角 ②sliver ④端面带的面级统计 ──
  const KEY = nVert + 1;
  const edgeFaces = new Map();
  for (let t = 0; t < triCount; t++) {
    for (const [a, b] of [[idx[t * 3], idx[t * 3 + 1]], [idx[t * 3 + 1], idx[t * 3 + 2]], [idx[t * 3 + 2], idx[t * 3]]]) {
      const key = a < b ? a * KEY + b : b * KEY + a;
      let arr = edgeFaces.get(key);
      if (!arr) edgeFaces.set(key, arr = []);
      arr.push(t);
    }
  }
  const FN = new Array(triCount);
  const sliverFlags = new Uint8Array(triCount);
  const triCentroidPhysZ = new Float32Array(triCount);
  let sliverCount = 0;
  const ratiosAll = [];
  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
    FN[t] = faceNormal(pos, i0, i1, i2);
    const shape = triangleShape(pos, i0, i1, i2);
    ratiosAll.push(shape.ratio);
    if (shape.minAngleDeg < 10 || shape.ratio > 50) { sliverFlags[t] = 1; sliverCount++; }
    triCentroidPhysZ[t] = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3 / Math.PI;
  }
  ratiosAll.sort((a, b) => a - b);
  const sliverRatioP95 = percentile(ratiosAll, .95);

  const dihedrals = [];
  let manifoldEdges = 0;
  for (const [, fs] of edgeFaces) {
    if (fs.length !== 2) continue;
    manifoldEdges++;
    const n1 = FN[fs[0]], n2 = FN[fs[1]];
    if (!n1 || !n2) continue;
    const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
    dihedrals.push(Math.acos(dot) * 180 / Math.PI);
  }
  dihedrals.sort((a, b) => a - b);

  const sharpRatio = dihedrals.length ? dihedrals.filter(a => a > 15).length / dihedrals.length : NaN;

  // ── ④带归属：与 dihedrals 相同的 Map 遍历序做游标同步（dihedrals 就是按此序 push 的）
  const bandStats = { inner: [], rim: [] };
  {
    let oi = 0;
    for (const [, fs] of edgeFaces) {
      if (fs.length !== 2) continue;
      const ang = dihedrals[oi++];
      // 该边两个三角形质心 z 均值判带（0.955 与平滑守卫 0.96 同族、略收紧）
      const zAvg = (triCentroidPhysZ[fs[0]] + triCentroidPhysZ[fs[1]]) / 2;
      (Math.abs(zAvg) > 0.955 ? bandStats.rim : bandStats.inner).push(ang);
    }
  }
  bandStats.inner.sort((a, b) => a - b);
  bandStats.rim.sort((a, b) => a - b);

  // ── ③法向残差（稳健 + 内部/端面分治版）──
  // 三条方法论教训（首跑实测后修订）：
  //   a. 量纲：|f|/g 为 wc 域长度，归一化除 wc 格距 2π/R（此前误除 mm 格距）
  //   b. ∇F→0 临界点单点可爆 RMS 至 7e4 —— 50h 截尾 + outlier 计数
  //   c. 封盖/环顶点天然不在隐函数零面上（实测端面点 |F|~O(bias)），把帽区
  //      混入统计会让指标反映封盖几何而非曲面质量 ⇒ 核心指标只收内部带
  const sampler = makeResidualSampler(tc, res.isoUsed);
  const hWC = 2 * Math.PI / tc.R;
  let sumSqIn = 0, cntIn = 0, outliers = 0;
  let sumSqAll = 0;
  const residInner = [];
  for (let vi = 0; vi < nVert; vi++) {
    const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
    const [distWC] = sampler(x, y, z);
    let r = distWC / hWC;                 // 无量纲：格距倍数
    if (r > 50) { outliers++; r = 50; }
    sumSqAll += r * r;
    const onRim = Math.abs(x / Math.PI) > 0.96 || Math.abs(y / Math.PI) > 0.96 || Math.abs(z / Math.PI) > 0.96;
    if (!onRim) {
      residInner.push(r);
      sumSqIn += r * r;
      cntIn++;
    }
  }
  residInner.sort((a, b) => a - b);
  const rmsInner = cntIn ? Math.sqrt(sumSqIn / cntIn) : NaN;
  const rmsAllRef = nVert ? Math.sqrt(sumSqAll / nVert) : NaN;

  const row = {
    name: tc.name, type: tc.type, mode: tc.mode, k: tc.k, R: tc.R, h_mm: +(hWC * wcToMmFactor(tc.k)).toFixed(4),
    verts: nVert, tris: triCount,
    dihedral_P50: +percentile(dihedrals, .5).toFixed(2),
    dihedral_P95: +percentile(dihedrals, .95).toFixed(2),
    dihedral_P99: +percentile(dihedrals, .99).toFixed(2),
    sharp_gt15_pct: +(sharpRatio * 100).toFixed(2),
    sliver_pct: +(sliverCount / triCount * 100).toFixed(3),
    sliver_ratio_p95: +sliverRatioP95.toFixed(1),
    residualOutliers: outliers,
    /** 核心：内部（非端面带）顶点的零面残差，单位=格距 */
    innerResidualRMS_h: +rmsInner.toFixed(4),
    innerResidualP95_h: +percentile(residInner, .95).toFixed(4),
    allResidualRMS_h_ref: +rmsAllRef.toFixed(4),
    rim_dihedralP99: bandStats.rim.length ? +percentile(bandStats.rim, .99).toFixed(2) : null,
    inner_dihedralP99: bandStats.inner.length ? +percentile(bandStats.inner, .99).toFixed(2) : null,
  };
  results.push(row);
  console.log(
    `${tc.name.padEnd(26)} h=${row.h_mm}mm | 二面角P50/P95/P99=${row.dihedral_P50}/${row.dihedral_P95}/${row.dihedral_P99}° >15°:${row.sharp_gt15_pct}% | sliver=${row.sliver_pct}%(ratioP95 ${row.sliver_ratio_p95}) | 内部残差RMS/P95=${row.innerResidualRMS_h}/${row.innerResidualP95_h}h(离群${row.residualOutliers}) | 端/内二面角P99=${row.rim_dihedralP99}/${row.inner_dihedralP99}`
  );
}

console.log(`\n== RESULT: ${results.length} cases analyzed ==`);
if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 1));
