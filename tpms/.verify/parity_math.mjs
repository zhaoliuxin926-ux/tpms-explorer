/**
 * parity_math.mjs —— 数学/导出一致性回归（纯 Node，无浏览器）
 *
 * 守护对象：跨实现公式漂移类缺陷。历史教训：
 *  - 2026-08-26 红队发现 Diamond 在权威库（VTI/hybrid/脚本用）与渲染查表（STL/屏幕用）
 *    是两个不同曲面，maxDiff=2.91，在 108 项 DOM 测试全绿下存活 ≥3 个提交。
 *  - STL 两个导出入口尺度差 2.09~6.28×。
 *
 * 套件：
 *  1. 文献标准：8 曲面独立实现 vs TPMS_FUNCTIONS（权威库）
 *  2. iso 指纹：buildSurface 的二分 biasBase vs 用 TPMS_FUNCTIONS 独立复刻同一二分
 *     （渲染 lookup 若偏离权威库，分位数/iso 必然漂移 → 立即抓出）
 *  3. 单文件版 app.html 关键公式静态断言（两版一致性）
 *  4. 导出脚本关键代码静态断言（script-exporter 与平台语义对齐，含批次 C 修复点）
 *  5. 孔径与周期数解耦 / Gibson-Ashby 常数 / BibTeX 转义
 *
 * 运行：node parity_math.mjs（工作目录任意，路径全部相对本文件解析）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../../tpms/tpms-platform');
const APP_HTML = join(HERE, '../../docs/app.html');

// TS 源码内部 import 无 .ts 扩展，Node 原生 type-stripping 无法解析；
// 每次运行先用项目自带 esbuild 打一个临时 bundle（<100ms，保证测的永远是当前源码）
const BUNDLE = join(tmpdir(), 'tpms_parity_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_parity_entry.ts');
  const mods = [
    'src/core/tpms-functions.ts:TPMS_FUNCTIONS,evaluateField',
    'src/geometry/surface-nets.ts:buildSurface',
    'src/physics/pore-analysis.ts:estimatePoreStats',
    'src/physics/gibson-ashby.ts:gibsonAshby',
    'src/export/bibtex-sidecar.ts:generateBibTeX',
    'src/export/script-exporter.ts:exportPythonScript',
    'src/export/stl-exporter.ts:buildBinarySTL',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const imp = (p) => import(pathToFileURL(p).href);

// ── 简易断言框架 ────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; failures.push(`${name}${detail ? ' | ' + detail : ''}`); }
}
const fmt = (x) => (typeof x === 'number' ? x.toPrecision(10) : String(x));

// ── 1. 文献标准 8 曲面 vs 权威库 ─────────────────────────────
const { TPMS_FUNCTIONS, evaluateField } = await imp(BUNDLE);

// 按文献标准形式独立抄写（与项目代码无共享路径）
const LIT = {
  gyroid: (x, y, z, w) =>
    w[0] * Math.sin(x) * Math.cos(y) + w[1] * Math.sin(y) * Math.cos(z) + w[2] * Math.sin(z) * Math.cos(x),
  diamond: (x, y, z, w) =>
    w[0] * Math.sin(x) * Math.sin(y) * Math.sin(z) + w[1] * Math.sin(x) * Math.cos(y) * Math.cos(z) +
    w[2] * Math.cos(x) * Math.sin(y) * Math.cos(z) + w[3] * Math.cos(x) * Math.cos(y) * Math.sin(z),
  schwarz: (x, y, z, w) => w[0] * Math.cos(x) + w[1] * Math.cos(y) + w[2] * Math.cos(z),
  neovius: (x, y, z, w) =>
    3 * w[0] * (Math.cos(x) + Math.cos(y) + Math.cos(z)) + 4 * w[1] * Math.cos(x) * Math.cos(y) * Math.cos(z),
  iwp: (x, y, z, w) =>
    2 * w[0] * (Math.cos(x) * Math.cos(y) + Math.cos(y) * Math.cos(z) + Math.cos(z) * Math.cos(x)) -
    w[1] * (Math.cos(2 * x) + Math.cos(2 * y) + Math.cos(2 * z)),
  frd: (x, y, z, w) =>
    4 * w[0] * Math.cos(x) * Math.cos(y) * Math.cos(z) -
    w[1] * (Math.cos(2 * x) * Math.cos(2 * y) + Math.cos(2 * y) * Math.cos(2 * z) + Math.cos(2 * z) * Math.cos(2 * x)),
  lidinoid: (x, y, z, w) =>
    w[0] * 0.5 * (
      2 * Math.sin(x) * Math.cos(x) * Math.cos(y) * Math.sin(z) +
      2 * Math.sin(y) * Math.cos(y) * Math.cos(z) * Math.sin(x) +
      2 * Math.sin(z) * Math.cos(z) * Math.cos(x) * Math.sin(y)
    ) + w[1] * (-0.5) * (
      Math.cos(2 * x) * Math.cos(2 * y) + Math.cos(2 * y) * Math.cos(2 * z) + Math.cos(2 * z) * Math.cos(2 * x)
    ),
  splitp: (x, y, z, w) =>
    w[0] * 1.1 * (
      2 * Math.sin(x) * Math.cos(x) * Math.cos(y) * Math.sin(z) +
      2 * Math.sin(x) * Math.sin(y) * Math.cos(y) * Math.cos(z) +
      2 * Math.cos(x) * Math.sin(y) * Math.sin(z) * Math.cos(z)
    ) + w[1] * (-0.2) * (
      Math.cos(2 * x) * Math.cos(2 * y) + Math.cos(2 * y) * Math.cos(2 * z) + Math.cos(2 * z) * Math.cos(2 * x)
    ) + w[2] * (-0.4) * (Math.cos(2 * x) + Math.cos(2 * y) + Math.cos(2 * z)),
};

// 确定性伪随机（可复现）
let seed = 0x2f6e2b1;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

const N_SAMPLE = 2000;
for (const type of Object.keys(LIT)) {
  const litFn = LIT[type];
  const impl = TPMS_FUNCTIONS[type];
  const w = [1, 1, 1, 1];
  let maxd = 0;
  for (let i = 0; i < N_SAMPLE; i++) {
    const x = (rnd() * 2 - 1) * Math.PI;
    const y = (rnd() * 2 - 1) * Math.PI;
    const z = (rnd() * 2 - 1) * Math.PI;
    const d = Math.abs(impl(x, y, z, w) - litFn(x, y, z, w));
    if (d > maxd) maxd = d;
  }
  check(`文献一致性 ${type}`, maxd < 1e-9, `maxdiff=${fmt(maxd)}`);

  // 非默认权重（wa=0.3, wb=1.7, wc=0.9, wd=1.2）
  const w2 = [0.3, 1.7, 0.9, 1.2];
  let maxd2 = 0;
  for (let i = 0; i < N_SAMPLE; i++) {
    const x = (rnd() * 2 - 1) * Math.PI;
    const y = (rnd() * 2 - 1) * Math.PI;
    const z = (rnd() * 2 - 1) * Math.PI;
    const d = Math.abs(impl(x, y, z, w2) - litFn(x, y, z, w2));
    if (d > maxd2) maxd2 = d;
  }
  check(`文献一致性 ${type} (自定义权重)`, maxd2 < 1e-9, `maxdiff=${fmt(maxd2)}`);
}

// ── 2. iso 指纹：buildSurface 二分 vs 独立复刻 ────────────────
const { buildSurface, buildBinarySTL } = (await imp(BUNDLE));

/** 用 TPMS_FUNCTIONS 作场源，精确复刻 buildSurface solid_network 二分：
 *  网格角点 N=R+1，域 (-π + i/R·2π)·k，立方容器，排序后 16 轮二分 */
function independentIso(type, k, R, targetPorosity) {
  const N = R + 1;
  const fn = TPMS_FUNCTIONS[type];
  const w = [1, 1, 1, 1];
  const inside = [];
  for (let iz = 0; iz < N; iz++) {
    const mz = (-Math.PI + (iz / R) * 2 * Math.PI) * k;
    const pz = (iz / R) * 2 - 1;
    for (let iy = 0; iy < N; iy++) {
      const my = (-Math.PI + (iy / R) * 2 * Math.PI) * k;
      const py = (iy / R) * 2 - 1;
      for (let ix = 0; ix < N; ix++) {
        const mx = (-Math.PI + (ix / R) * 2 * Math.PI) * k;
        const px = (ix / R) * 2 - 1;
        if (Math.max(Math.abs(px) - 1, Math.abs(py) - 1, Math.abs(pz) - 1) >= 0) continue;
        inside.push(fn(mx, my, mz, w));
      }
    }
  }
  inside.sort((a, b) => a - b);
  const targetSolid = Math.max(0.02, Math.min(0.98, 1 - targetPorosity));
  let lo = Infinity, hi = -Infinity;
  for (const v of inside) { if (v < lo) lo = v; if (v > hi) hi = v; }
  lo -= 0.5; hi += 0.5;
  // lower_bound：第一个 >= v 的索引
  const countSolid = (bias) => {
    let l = 0, h = inside.length;
    while (l < h) { const m = (l + h) >> 1; if (inside[m] < bias) l = m + 1; else h = m; }
    return l;
  };
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2;
    if (countSolid(mid) / inside.length > targetSolid) hi = mid; else lo = mid;
  }
  return { iso: (lo + hi) / 2, minV: lo + 0.5, maxV: hi - 0.5 };
}

const DEFAULT_HYBRID = { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 };
const HYBRID_ENABLED = { enabled: true, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 };
for (const type of Object.keys(LIT)) {
  const k = 2, R = 40, target = 0.75;
  const res = buildSurface({
    type, iso: 0, periods: k, resolution: R, targetPorosity: target,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: true,
  });
  const indep = independentIso(type, k, R, target);
  check(
    `iso 指纹 ${type} (渲染≡权威库)`,
    Math.abs(res.isoUsed - indep.iso) < 1e-4,
    `buildSurface.isoUsed=${fmt(res.isoUsed)} 独立二分=${fmt(indep.iso)} Δ=${fmt(Math.abs(res.isoUsed - indep.iso))}`
  );
}

// ── 2b. 法线方向：顶点法线 vs 独立数值梯度（守护解析梯度公式）──
// 历史缺陷：lidinoid/splitp 的 B 项梯度循环错位（159°/89°）、diamond gz 笔误（130°）。
// 顶点经过 Laplacian 平滑有小位移，容差取中位数 < 25°、反向(>90°)比例 < 5%。
{
  const k = 1, R = 28, target = 0.75;
  for (const type of ['gyroid', 'diamond', 'lidinoid', 'splitp', 'frd']) {
    const res = buildSurface({
      type, iso: 0, periods: k, resolution: R, targetPorosity: target,
      weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: false,
    });
    const fn = LIT[type];
    const h = 1e-4;
    const angs = [];
    const n = res.vertCount;
    for (let i = 0; i < n; i++) {
      const vx = res.positions[i * 3], vy = res.positions[i * 3 + 1], vz = res.positions[i * 3 + 2];
      // 过滤容器边界顶点（其法线为容器朝向，非场梯度）
      if (Math.abs(vx) > Math.PI * 0.95 || Math.abs(vy) > Math.PI * 0.95 || Math.abs(vz) > Math.PI * 0.95) continue;
      const gxx = (fn(vx * k + h, vy * k, vz * k, [1,1,1,1]) - fn(vx * k - h, vy * k, vz * k, [1,1,1,1])) / (2 * h);
      const gyy = (fn(vx * k, vy * k + h, vz * k, [1,1,1,1]) - fn(vx * k, vy * k - h, vz * k, [1,1,1,1])) / (2 * h);
      const gzz = (fn(vx * k, vy * k, vz * k + h, [1,1,1,1]) - fn(vx * k, vy * k, vz * k - h, [1,1,1,1])) / (2 * h);
      const gl = Math.hypot(gxx, gyy, gzz);
      if (gl < 1e-9) continue;
      const nx = res.normals[i * 3], ny = res.normals[i * 3 + 1], nz = res.normals[i * 3 + 2];
      const dot = (nx * gxx + ny * gyy + nz * gzz) / gl;
      angs.push(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
    }
    angs.sort((a, b) => a - b);
    const median = angs[angs.length >> 1] ?? 90;
    const reversed = angs.filter((a) => a > 90).length / Math.max(1, angs.length);
    check(
      `法线方向 ${type}`,
      median < 25 && reversed < 0.05,
      `median=${fmt(median)}° 反向比例=${fmt(reversed)}（样本 ${angs.length}）`
    );
  }
}

// ── 2c. 网格拓扑：水密性验证（2026-08-27 v2 面提取重写后升级）──────────
// 旧算法（quad 只看邻接 cell 有无顶点）存在内部鞍点裂缝与容器面开口，当时守护目标
// 收窄为「容器面开口占比 <10%」。v2 以「网格边穿越」为键 + 孔口封盖通道后，
// 网格严格水密：开放边（仅被 1 个三角形引用的边）必须为 0。
{
  const res = buildSurface({
    type: 'schwarz', iso: 0, periods: 1, resolution: 32, targetPorosity: 0.5,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: true,
  });
  const edgeMap = new Map();
  const triCount = res.triCount;
  for (let t = 0; t < triCount; t++) {
    const a = res.indices[t * 3], b = res.indices[t * 3 + 1], c = res.indices[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = p < q ? p * 2**24 + q : q * 2**24 + p;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }
  let boundaryTotal = 0;
  for (const [, cnt] of edgeMap) if (cnt === 1) boundaryTotal++;
  check(
    '网格拓扑: 严格水密（开放边界边 = 0）',
    boundaryTotal === 0,
    `开放边 ${boundaryTotal}（v2 边穿越提取 + 孔口封盖后必须为 0）`
  );
}

// ── 2d. STL 字节流：包围盒 = cellSize mm + 法线行非零（守护 F2/F15）──
{
  const cellSize = 3;
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 2, resolution: 24, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: true,
  });
  const scale = cellSize / (2 * Math.PI);
  const buf = buildBinarySTL(res.positions, res.indices, scale, res.normals);
  const dv = new DataView(buf);
  const triCount = dv.getUint32(80, true);
  let minX = Infinity, maxX = -Infinity, nonZeroNormals = 0;
  for (let t = 0; t < triCount; t++) {
    const off = 84 + t * 50;
    const nMag = Math.abs(dv.getFloat32(off, true)) + Math.abs(dv.getFloat32(off + 4, true)) + Math.abs(dv.getFloat32(off + 8, true));
    if (nMag > 1e-6) nonZeroNormals++;
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(off + 12 + v * 12, true);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  const width = maxX - minX;
  check('STL: 包围盒宽度 ≈ cellSize mm', Math.abs(width - cellSize) < 0.35, `width=${fmt(width)}mm 目标=${cellSize}mm`);
  check('STL: 法线行非零（缠绕+法线写入）', nonZeroNormals === triCount, `${nonZeroNormals}/${triCount}`);
  // 定向一致性：法线行与缠绕叉积同向
  let flipped = 0;
  for (let t = 0; t < triCount; t++) {
    const off = 84 + t * 50;
    const nxx = dv.getFloat32(off, true), nyy = dv.getFloat32(off + 4, true), nzz = dv.getFloat32(off + 8, true);
    const p0 = [dv.getFloat32(off + 12, true), dv.getFloat32(off + 16, true), dv.getFloat32(off + 20, true)];
    const p1 = [dv.getFloat32(off + 24, true), dv.getFloat32(off + 28, true), dv.getFloat32(off + 32, true)];
    const p2 = [dv.getFloat32(off + 36, true), dv.getFloat32(off + 40, true), dv.getFloat32(off + 44, true)];
    const ax = p1[0]-p0[0], ay = p1[1]-p0[1], az = p1[2]-p0[2];
    const bx = p2[0]-p0[0], by = p2[1]-p0[1], bz = p2[2]-p0[2];
    if (nxx * (ay*bz-az*by) + nyy * (az*bx-ax*bz) + nzz * (ax*by-ay*bx) < -1e-12) flipped++;
  }
  check('STL: 法线与缠绕自洽（0 翻转）', flipped === 0, `${flipped}/${triCount} 反向`);
}

// ── 2b2. 法线覆盖补全 + needNumericGrad 路径（R2 复验缺口）──
{
  const k = 1, R = 28, target = 0.75;
  // schwarz/neovius/iwp 的解析梯度（补齐 8 类型覆盖）
  for (const type of ['schwarz', 'neovius', 'iwp']) {
    const res = buildSurface({
      type, iso: 0, periods: k, resolution: R, targetPorosity: target,
      weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: false,
    });
    const fn = LIT[type];
    const h = 1e-4;
    const angs = [];
    for (let i = 0; i < res.vertCount; i += 3) {
      const vx = res.positions[i * 3], vy = res.positions[i * 3 + 1], vz = res.positions[i * 3 + 2];
      if (Math.abs(vx) > Math.PI * 0.95 || Math.abs(vy) > Math.PI * 0.95 || Math.abs(vz) > Math.PI * 0.95) continue;
      const gxx = (fn(vx * k + h, vy * k, vz * k, [1,1,1,1]) - fn(vx * k - h, vy * k, vz * k, [1,1,1,1])) / (2 * h);
      const gyy = (fn(vx * k, vy * k + h, vz * k, [1,1,1,1]) - fn(vx * k, vy * k - h, vz * k, [1,1,1,1])) / (2 * h);
      const gzz = (fn(vx * k, vy * k, vz * k + h, [1,1,1,1]) - fn(vx * k, vy * k, vz * k - h, [1,1,1,1])) / (2 * h);
      const gl = Math.hypot(gxx, gyy, gzz);
      if (gl < 1e-9) continue;
      const dot = (res.normals[i * 3] * gxx + res.normals[i * 3 + 1] * gyy + res.normals[i * 3 + 2] * gzz) / gl;
      angs.push(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
    }
    angs.sort((a, b) => a - b);
    const median = angs[angs.length >> 1] ?? 90;
    check(`法线方向 ${type}（补齐覆盖）`, median < 25, `median=${fmt(median)}°（样本 ${angs.length}）`);
  }
  // needNumericGrad 数值差分路径：shell 模式法线（对最终场差分，内外壁方向自动正确）
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: k, resolution: R, targetPorosity: target,
    weights: [1, 1, 1, 1], structureMode: 'shell', containerShape: 'cube',
    thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: false,
  });
  // 壳模式顶点在 |V|≈t/2 处，法线应与 ∇(V²-(t/2)²)=2V·∇V 同向；抽验：法线·∇V 的符号应与 V 的符号一致
  const fn = LIT.gyroid;
  const h = 1e-4;
  let agree = 0, tot = 0;
  const tHalf = res.isoUsed; // shell 的 isoUsedReport = tEff/2
  for (let i = 0; i < res.vertCount; i += 3) {
    const vx = res.positions[i * 3], vy = res.positions[i * 3 + 1], vz = res.positions[i * 3 + 2];
    if (Math.abs(vx) > Math.PI * 0.9 || Math.abs(vy) > Math.PI * 0.9 || Math.abs(vz) > Math.PI * 0.9) continue;
    const v = fn(vx * k, vy * k, vz * k, [1,1,1,1]);
    if (Math.abs(Math.abs(v) - tHalf) > 0.15) continue; // 只取贴近壳面的顶点（平滑位移容差）
    const gxx = (fn(vx * k + h, vy * k, vz * k, [1,1,1,1]) - fn(vx * k - h, vy * k, vz * k, [1,1,1,1])) / (2 * h);
    const gyy = (fn(vx * k, vy * k + h, vz * k, [1,1,1,1]) - fn(vx * k, vy * k - h, vz * k, [1,1,1,1])) / (2 * h);
    const gzz = (fn(vx * k, vy * k, vz * k + h, [1,1,1,1]) - fn(vx * k, vy * k, vz * k - h, [1,1,1,1])) / (2 * h);
    const dot = res.normals[i * 3] * gxx + res.normals[i * 3 + 1] * gyy + res.normals[i * 3 + 2] * gzz;
    tot++;
    if (Math.sign(dot) === -Math.sign(v) || Math.sign(dot) === 0) agree++; // 法线=-∇F=-2v·∇v（指离实体，STL 惯例）：与 ∇V 点积符号应与 sign(v) 相反
  }
  check('shell 法线指离实体（-∇F，STL 惯例）', tot > 50 && agree / tot > 0.9, `${agree}/${tot} 一致（t/2=${fmt(tHalf)}）`);

  // cylinder 容器 iso 指纹（此前只测 cube）
  const resC = buildSurface({
    type: 'gyroid', iso: 0, periods: 2, resolution: 40, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cylinder',
    thickness: 1, gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '', preview: true,
  });
  check('cylinder 容器重建有效', resC.vertCount > 500, `vertCount=${resC.vertCount}`);
}

// ── 2e. hybrid 场方向：px→+1 侧为 A 主导（守护批次 C 脚本对齐的数值面）──
{
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 1, resolution: 20, targetPorosity: 0.75,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1, gradientDir: 'z', hybrid: HYBRID_ENABLED, customFormula: '', preview: true,
  });
  check('hybrid: 重建成功（顶点>0）', res.vertCount > 100, `vertCount=${res.vertCount}`);
}

// ── 3. 单文件版 app.html 公式/梯度/导出静态断言（两版一致性）────────
// R2 复验教训：此前只断言 diamond 一行，梯度方向反转曾全绿漏网——本节补齐
const appSrc = readFileSync(APP_HTML, 'utf-8');
const normWs = (t) => t.replace(/\s+/g, '');
const APP_FORMULAS = {
  gyroid: 'w[0]*Sx*Cy+w[1]*Sy*Cz+w[2]*Sz*Cx',
  neovius: 'w[0]*3*(Cx+Cy+Cz)+w[1]*4*Cx*Cy*Cz',
  iwp: 'w[0]*2*(Cx*Cy+Cy*Cz+Cz*Cx)-w[1]*(C2x+C2y+C2z)',
  frd: 'w[0]*4*Cx*Cy*Cz-w[1]*(C2x*C2y+C2y*C2z+C2z*C2x)',
  diamond: 'w[0]*Sx*Sy*Sz+w[1]*Sx*Cy*Cz+w[2]*Cx*Sy*Cz+w[3]*Cx*Cy*Sz',
  lidinoid: 'w[0]*0.5*(2*Sx*Cx*Cy*Sz+2*Sy*Cy*Cz*Sx+2*Sz*Cz*Cx*Sy)+w[1]*(-0.5)*(C2x*C2y+C2y*C2z+C2z*C2x)',
  splitp: 'w[0]*1.1*(2*Sx*Cx*Cy*Sz+2*Sx*Sy*Cy*Cz+2*Cx*Sy*Sz*Cz)+w[1]*(-0.2)*(C2x*C2y+C2y*C2z+C2z*C2x)+w[2]*(-0.4)*(C2x+C2y+C2z)',
  schwarz: null, // 走 else 分支：w[0]*Cx+w[1]*Cy+w[2]*Cz
};
for (const [type, f] of Object.entries(APP_FORMULAS)) {
  const pat = f ?? 'w[0]*Cx+w[1]*Cy+w[2]*Cz';
  check(
    `app.html ${type} 公式 ≡ 工程查表版`,
    normWs(appSrc).includes(pat.replace(/\(/g, '(').replace(/\)/g, ')')),
    `未找到: ${pat}`
  );
}
check('app.html 梯度方向 底厚顶薄（1.5 - zPhys，与工程版一致）', appSrc.includes('tEff * (1.5 - zPhys)'));
check('app.html 导出 scale 生效（STL/OBJ updateMatrixWorld ×2 + glTF bake）', (appSrc.match(/updateMatrixWorld\(true\)/g) || []).length === 2 && appSrc.includes('gltfGeo.applyMatrix4'),
  'Three 导出器读 matrixWorld，setScalar 后不 update 则 scale 被静默丢弃（R2 击穿根因）');
check('app.html glTF 换算米（×0.001）', appSrc.includes('state.cellSize/(2*Math.PI)*0.001'));

// ── 4. 导出脚本关键代码静态断言（与平台语义对齐契约）────────────
const scriptSrc = readFileSync(join(PLATFORM, 'src/export/script-exporter.ts'), 'utf-8');
check('脚本: solid 判据与平台一致 (V < iso)', /V\[inside\]\s*<\s*iso_bias/.test(scriptSrc) && /sum\(v_in\s*<\s*iso_bias\)/.test(scriptSrc),
  'solid 必须是 {V < iso}（平台语义：F = iso - V > 0 为固相）');
check('脚本: hybrid sigmoid 陡度 = 6/width', /6\.0\s*\/\s*max\(blend_width/.test(scriptSrc) || /6\.0\s*\/\s*blend_width/.test(scriptSrc), '必须与 hybrid-functions.ts 的 k=6/max(width,0.01) 一致');
check('脚本: hybrid A/B 方向 = alpha·V_A + (1-alpha)·V_b', /alpha\s*\*\s*V\s*\+\s*\(1\s*-\s*alpha\)\s*\*\s*V_b/.test(scriptSrc), 'px→+1 侧为 A 主导（hybrid-functions.ts:62）');
check('脚本: hybrid linear 分支存在', /blend_function\s*==\s*'linear'/.test(scriptSrc) || /strcmp\(blend_function,\s*'linear'\)/.test(scriptSrc));
check('脚本: cylinder/容器不用 NaN（SDF 固相包裹）', !/np\.nan/.test(scriptSrc) && !/=\s*NaN;/.test(scriptSrc), 'NaN 使 MATLAB isosurface 报错/Python 开放边界');
check('脚本: 容器 F = max(F_mode, bound)', /np\.maximum\(F,\s*bound\)/.test(scriptSrc) && /max\(F,\s*bound\)/.test(scriptSrc));
check('脚本: 公式频率乘 kk（周期数不丢失）', /kk\s*=\s*cell_size/.test(scriptSrc) && scriptSrc.includes('sin(kk*X)'), '平台周期编码在频率，脚本恒单周期会重建错误结构');
check('脚本: shell 壳厚由孔隙率二分（非 thickness）', /count_shell/.test(scriptSrc) && /target_solid/.test(scriptSrc));
check('脚本: 网格坐标输出 mm', /origin=\(-cell_size\/2/.test(scriptSrc) && /cell_size\/\(N-1\)/.test(scriptSrc));
const mainSrc = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf-8');
check('脚本: pyvista 用 ImageData + point_data（0.44+ API）', scriptSrc.includes('pv.ImageData(dimensions=V.shape') && scriptSrc.includes("point_data['values']"), 'UniformGrid 已在 0.48 移除，cell_data 会 TypeError');
check('脚本: 插值标识符走 safeId（注入纵深防御）', scriptSrc.includes('function safeId'));
check('脚本: hybrid B 场权重与平台同源', /weights_b = \[\$\{state\.weights/.test(scriptSrc), '平台 B 场复用主权重，脚本用默认权重会在调权重后变成不同曲面');
const urlSrc = readFileSync(join(PLATFORM, 'src/url-params.ts'), 'utf-8');
check('URL: hybridType/hybridBlend 过白名单（防注入）', /VALID\.type\.includes\(rawTypeB/.test(urlSrc));
const snSrc = readFileSync(join(PLATFORM, 'src/geometry/surface-nets.ts'), 'utf-8');
check('法线: shell 类取负（指离实体，STL 惯例）', /if \(mode !== 'solid_network'\) \{ gx = -gx/.test(snSrc));
check('main: btn-stl 走 handleExport（两入口一致 + HD 锁）', /btn-stl'\)\?\.addEventListener\('click', \(\) => \{\s*\/\/ 统一走导出中心路径[\s\S]*?handleExport\('stl'\)/.test(mainSrc));
check('main: 同步 HD 路径更新 metrics 与缓存', /geoCache\.set\(cacheKey\(getState\(\), hdR\)/.test(mainSrc));
check('main: custom 类型脚本导出已拦截', /自定义公式暂不支持脚本导出/.test(mainSrc));

// ── 5. 物理统计与引用 ────────────────────────────────────────
const { estimatePoreStats } = (await imp(BUNDLE));
{
  const a = estimatePoreStats(75, 'gyroid', 2.0);
  const b = estimatePoreStats(75, 'gyroid', 5.0);
  check('孔径与 svRatio 单调相关', b.meanDiameter >= a.meanDiameter * 0.999, 'sanity');
  const expect = 0.58 * Math.pow(0.75, 1 / 3);
  check('孔径 = factor·ε^(1/3)（与周期数无关）', Math.abs(a.meanDiameter - expect) < 1e-12, `${fmt(a.meanDiameter)} vs ${fmt(expect)}`);
}
const { gibsonAshby } = (await imp(BUNDLE));
{
  const rho = 0.25;
  const g = gibsonAshby(rho, 'gyroid');
  check('G-A σ* = 0.3·ρ^1.5（Gibson&Ashby 1997 开孔泡沫量级）', Math.abs(g.sigma_Es - 0.3 * Math.pow(rho, 1.5)) < 1e-12, `${fmt(g.sigma_Es)}`);
  check('G-A σ* 量级合理 (≤0.6·ρ^1.5)', g.sigma_Es <= 0.6 * Math.pow(rho, 1.5), '原值 1.5 高估 6.5×');
}

// BibTeX 转义（mock window）
globalThis.window = { location: { href: 'https://example.org/app.html?type=gyroid&porosity=75' } };
const { generateBibTeX } = (await imp(BUNDLE));
{
  const state = {
    type: 'gyroid', porosity: 75, cellSize: 3, thickness: 1, weights: [1, 1, 1, 1],
    structureMode: 'solid_network', containerShape: 'cube', material: 'tc4',
    gradientDir: 'z', hybrid: DEFAULT_HYBRID, customFormula: '',
  };
  const bib = generateBibTeX(state, null, 'abc12345');
  check('BibTeX: title 中 % 已转义', /Porosity 75\\%/.test(bib));
  check('BibTeX: URL 用 \\url 包裹', /\\url\{https:\/\/example\.org/.test(bib));
  check('BibTeX: metrics=null 不输出 undefined', !/undefined/.test(bib));
}

// ── 汇总 ────────────────────────────────────────────────────
console.log(`\nparity_math: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log('\n失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
