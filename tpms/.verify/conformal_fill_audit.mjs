/**
 * conformal_fill_audit.mjs —— 门禁 44：C5 任意解剖流形 STL 保形填充
 *
 * 「独立参考真值」纪律：
 *   - torus / 斜切管（股骨段：外壳圆柱+髓腔+斜切端面）由解析式定义并程序化生成封闭网格，
 *     SDF 参考真值用同一解析式在无离散域上计算——与 mesh-container 的 BVH/扫描线实现不同源；
 *   - 水密三硬指标、壁面贴合度（填充网格顶点解析 SDF ≤ 容差）、Smooth-Max 倒角 A/B 全链断言。
 *
 * 运行：node conformal_fill_audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_conformal_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_conformal_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/geometry/mesh-container.ts:computeMeshSDF,checkMesh,parseSTL',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool, computeMeshSDF, checkMesh, parseSTL } = await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d ? '— ' + d : ''); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ── 网格生成器（封闭流形，mm 域）──
/** 圆环面：主半径 R、管半径 r；环向 nu × 管向 nv */
function makeTorus(Rm, rm, nu, nv) {
  const pos = [], idx = [];
  for (let i = 0; i < nu; i++) {
    const u = (i / nu) * 2 * Math.PI, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < nv; j++) {
      const v = (j / nv) * 2 * Math.PI;
      const rr = Rm + rm * Math.cos(v);
      pos.push(rr * cu, rr * su, rm * Math.sin(v));
    }
  }
  const id = (i, j) => (i % nu) * nv + (j % nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    idx.push(a, b, c, a, c, d);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** 斜切管（股骨段）：外圆柱 R、壁厚 t、髓腔 r_m、轴向半高 h、两端斜切角 α（度） */
function makeCutTube(Rm, t, rm, h, alphaDeg, nth) {
  const alpha = (alphaDeg * Math.PI) / 180;
  const pos = [], idx = [];
  const zCut = (rad, dir, th) => dir * h - Math.tan(alpha) * rad * Math.cos(th);
  const ring = (rad, dir, th) => [rad * Math.cos(th), rad * Math.sin(th), zCut(rad, dir, th)];
  // 外侧面（θ, s）：z 从下斜切到上斜切
  const outerBase = pos.length / 3;
  for (let i = 0; i < nth; i++) {
    const th = (i / nth) * 2 * Math.PI;
    const zLo = zCut(Rm, -1, th), zHi = zCut(Rm, 1, th);
    for (let j = 0; j <= 2; j++) pos.push(Rm * Math.cos(th), Rm * Math.sin(th), zLo + (j / 2) * (zHi - zLo));
  }
  const outerIdx = (i, j) => (i % nth) * 3 + j;
  for (let i = 0; i < nth; i++) {
    for (let j = 0; j < 2; j++) {
      const a = outerIdx(i, j), b = outerIdx(i + 1, j), c = outerIdx(i + 1, j + 1), d = outerIdx(i, j + 1);
      idx.push(a, b, c, a, c, d);
    }
  }
  // 内侧面（髓腔面）
  const innerBase = pos.length / 3;
  for (let i = 0; i < nth; i++) {
    const th = (i / nth) * 2 * Math.PI;
    const zLo = zCut(rm, -1, th), zHi = zCut(rm, 1, th);
    for (let j = 0; j <= 2; j++) pos.push(rm * Math.cos(th), rm * Math.sin(th), zLo + (j / 2) * (zHi - zLo));
  }
  const innerIdx = (i, j) => innerBase + (i % nth) * 3 + j;
  for (let i = 0; i < nth; i++) {
    for (let j = 0; j < 2; j++) {
      const a = innerIdx(i, j), b = innerIdx(i + 1, j), c = innerIdx(i + 1, j + 1), d = innerIdx(i, j + 1);
      idx.push(a, c, b, a, d, c); // 内面反向
    }
  }
  // 端面环带（上：dir=+1；下：dir=−1）：外椭圆点与内圆点按 θ 扇形配对
  const ringBase = pos.length / 3;
  for (const dir of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < nth; i++) {
      const th = (i / nth) * 2 * Math.PI;
      const o = ring(Rm, dir, th), inn = ring(rm, dir, th);
      pos.push(o[0], o[1], o[2]);
      pos.push(inn[0], inn[1], inn[2]);
    }
    for (let i = 0; i < nth; i++) {
      const o0 = base + (i % nth) * 2, o1 = base + ((i + 1) % nth) * 2;
      const i0 = o0 + 1, i1 = o1 + 1;
      if (dir === 1) idx.push(o0, o1, i1, o0, i1, i0);
      else idx.push(o0, i1, o1, o0, i0, i1);
    }
  }
  void ringBase;
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** positions/indices → binary STL ArrayBuffer（computeMeshSDF 入口格式） */
function toBinarySTL(positions, indices) {
  const triCount = indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    const ax = positions[i1] - positions[i0], ay = positions[i1 + 1] - positions[i0 + 1], az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0], by = positions[i2 + 1] - positions[i0 + 1], bz = positions[i2 + 2] - positions[i0 + 2];
    let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const clen = Math.hypot(cx, cy, cz) || 1;
    dv.setFloat32(off, cx / clen, true); dv.setFloat32(off + 4, cy / clen, true); dv.setFloat32(off + 8, cz / clen, true); off += 12;
    for (const i of [i0, i1, i2]) {
      dv.setFloat32(off, positions[i], true); dv.setFloat32(off + 4, positions[i + 1], true); dv.setFloat32(off + 8, positions[i + 2], true); off += 12;
    }
    off += 2;
  }
  return buf;
}

/** 解析 torus SDF（mm 域） */
function sdTorus(Rm, rm, x, y, z) {
  const q = Math.hypot(Math.hypot(x, y) - Rm, z) - rm;
  return q;
}
/** 解析斜切管 SDF（mm 域） */
function sdCutTube(Rm, t, rm, h, alphaDeg, x, y, z) {
  // 与生成器 makeCutTube 同几何：环体 rr ∈ [rm, Rm]，两端斜切平面 z + tanα·x = ±h
  const alpha = (alphaDeg * Math.PI) / 180;
  const rr = Math.hypot(x, y);
  const shellCyl = Math.max(rr - Rm, rm - rr); // 环域内负
  const norm = Math.sqrt(1 + Math.tan(alpha) ** 2);
  const planeHi = (z + Math.tan(alpha) * x - h) / norm;
  const planeLo = (-z - Math.tan(alpha) * x - h) / norm;
  return Math.max(shellCyl, planeHi, planeLo);
}

// ── Case 1: torus 网格 + SDF 解析对照 ──// 三线性插值采样（审计口径：格点随机偏差不进入误差统计）
function trilinearSample(sdf, N, x, y, z) {
  const gx = Math.min(N - 1 - 1e-6, Math.max(0, ((x + 1) / 2) * (N - 1)));
  const gy = Math.min(N - 1 - 1e-6, Math.max(0, ((y + 1) / 2) * (N - 1)));
  const gz = Math.min(N - 1 - 1e-6, Math.max(0, ((z + 1) / 2) * (N - 1)));
  const i0 = Math.floor(gx), j0 = Math.floor(gy), k0 = Math.floor(gz);
  const fx = gx - i0, fy = gy - j0, fz = gz - k0;
  const i1 = Math.min(i0 + 1, N - 1), j1 = Math.min(j0 + 1, N - 1), k1 = Math.min(k0 + 1, N - 1);
  const c00 = sdf[k0 * N * N + j0 * N + i0] * (1 - fx) + sdf[k0 * N * N + j0 * N + i1] * fx;
  const c01 = sdf[k0 * N * N + j1 * N + i0] * (1 - fx) + sdf[k0 * N * N + j1 * N + i1] * fx;
  const c10 = sdf[k1 * N * N + j0 * N + i0] * (1 - fx) + sdf[k1 * N * N + j0 * N + i1] * fx;
  const c11 = sdf[k1 * N * N + j1 * N + i0] * (1 - fx) + sdf[k1 * N * N + j1 * N + i1] * fx;
  return (c00 * (1 - fy) + c01 * fy) * (1 - fz) + (c10 * (1 - fy) + c11 * fy) * fz;
}

{
  const g = makeTorus(14, 6, 128, 48);
  const chk = checkMesh(g.indices);
  chk.watertight ? ok('C1 torus 网格水密自检（open=nm=0）', `tris=${chk.tris}`) : bad('C1 torus 水密', JSON.stringify(chk));
  const buf = toBinarySTL(g.positions, g.indices);
  const N = 49;
  const r = computeMeshSDF(buf, N);
  // 参考真值：同一归一化变换下的解析式
  let maxErr = 0, medErr = 0, signOk = 0, signN = 0;
  const rng = mulberry32(44);
  let dbg = 0;
  const errs = [];
  for (let i = 0; i < 2000; i++) {
    const x = (rng() * 2 - 1) * 0.95, y = (rng() * 2 - 1) * 0.95, z = (rng() * 2 - 1) * 0.95;
    const gi = Math.round(((x + 1) / 2) * (N - 1)), gj = Math.round(((y + 1) / 2) * (N - 1)), gk = Math.round(((z + 1) / 2) * (N - 1));
    const sampled = trilinearSample(r.sdf, N, x, y, z);
    const mmx = x * r.domain.scale, mmy = y * r.domain.scale, mmz = z * r.domain.scale;
    const ref = sdTorus(14, 6, mmx, mmy, mmz) / r.domain.scale;
    const e = Math.abs(sampled - ref);
    errs.push(e);
    maxErr = Math.max(maxErr, e);
    if (e > 0.3 && dbg < 8) { dbg++; console.log('  top-err pt', x.toFixed(3), y.toFixed(3), z.toFixed(3), 'sampled=', sampled.toFixed(4), 'ref=', ref.toFixed(4), 'mm=', mmx.toFixed(2), mmy.toFixed(2), mmz.toFixed(2), 'ref_mm=', sdTorus(14, 6, mmx, mmy, mmz).toFixed(4)); }
    if (Math.abs(ref) > 2 / (N - 1)) { signN++; if (Math.sign(sampled) === Math.sign(ref)) signOk++; }
  }
  errs.sort((a, b) => a - b);
  medErr = errs[Math.floor(errs.length / 2)];
  const halfVoxel = 1 / (N - 1);
  medErr <= halfVoxel ? ok('C1 SDF 中位误差 ≤半格', `med=${medErr.toFixed(4)} half=${halfVoxel.toFixed(4)}`) : bad('C1 SDF 中位误差', `med=${medErr.toFixed(4)}`);
  maxErr <= halfVoxel * 3 ? ok('C1 SDF 最大误差 ≤3 半格（壁角离散）', `max=${maxErr.toFixed(4)}`) : bad('C1 SDF 最大误差', `max=${maxErr.toFixed(4)}`);
  signN > 0 && signOk / signN >= 0.98 ? ok('C1 符号一致率 ≥98%（|ref|>1 格域）', `${((signOk / signN) * 100).toFixed(2)}%`) : bad('C1 符号一致率', `${signOk}/${signN}`);
  // 非水密 fail-closed
  const hole = { positions: g.positions.slice(), indices: g.indices.slice(3) };
  const chkHole = checkMesh(hole.indices);
  let threw = false;
  try { computeMeshSDF(toBinarySTL(hole.positions, hole.indices), 33); } catch (e) { threw = /非水密/.test(e.message); }
  threw && !chkHole.watertight ? ok('C1 非水密输入 fail-closed（结构化拒绝）') : bad('C1 非水密 fail-closed');
}

// ── Case 2: 斜切管（股骨段）SDF 解析对照 ──
{
  const g = makeCutTube(14, 5, 4, 18, 25, 160);
  const gW = parseSTL(toBinarySTL(g.positions, g.indices)); // parseSTL 往返 = 顶点焊接（面汤 → 共享索引）
  const chk = checkMesh(gW.indices);
  const buf = toBinarySTL(gW.positions, gW.indices);
  const N = 49;
  const r = computeMeshSDF(buf, N);
  let maxErr = 0, medErr = 0;
  const rng = mulberry32(45);
  let dbg2 = 0;
  const errs = [];
  for (let i = 0; i < 2000; i++) {
    const x = (rng() * 2 - 1) * 0.95, y = (rng() * 2 - 1) * 0.95, z = (rng() * 2 - 1) * 0.95;
    const gi = Math.round(((x + 1) / 2) * (N - 1)), gj = Math.round(((y + 1) / 2) * (N - 1)), gk = Math.round(((z + 1) / 2) * (N - 1));
    const sampled = trilinearSample(r.sdf, N, x, y, z);
    const ref = sdCutTube(14, 5, 4, 18, 25, x * r.domain.scale, y * r.domain.scale, z * r.domain.scale) / r.domain.scale;
    if (Math.abs(sampled - ref) > 0.2 && dbg2 < 5) { dbg2++; console.log('  C2 top-err', x.toFixed(3), y.toFixed(3), z.toFixed(3), 'sampled=', sampled.toFixed(4), 'ref=', ref.toFixed(4), 'mm=', (x * r.domain.scale).toFixed(1), (y * r.domain.scale).toFixed(1), (z * r.domain.scale).toFixed(1)); }
    errs.push(Math.abs(sampled - ref));
    maxErr = Math.max(maxErr, Math.abs(sampled - ref));
  }
  errs.sort((a, b) => a - b);
  medErr = errs[Math.floor(errs.length / 2)];
  const halfVoxel = 1 / (N - 1);
  medErr <= halfVoxel ? ok('C2 SDF 中位误差 ≤半格', `med=${medErr.toFixed(4)}`) : bad('C2 SDF 中位误差', `med=${medErr.toFixed(4)}`);
  maxErr <= halfVoxel * 3 ? ok('C2 SDF 最大误差 ≤3 半格', `max=${maxErr.toFixed(4)}`) : bad('C2 SDF 最大误差', `max=${maxErr.toFixed(4)}`);
}

// ── Case 3/4/5: torus 保形填充（水密/贴合/倒角 A/B）──
function fillTorus(blend) {
  const g = makeTorus(14, 6, 128, 48);
  const buf = toBinarySTL(g.positions, g.indices);
  const N = 65;
  const mr = computeMeshSDF(buf, N);
  globalBufferPool.reset();
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 6, resolution: 64, targetPorosity: 0.65,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', preview: false,
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', endplateMm: 0,
    containerMeshSdf: mr.sdf, containerBlend: blend,
  }, globalBufferPool);
  return { res, mr };
}
{
  const hard = fillTorus(0);
  const audit = hard.res;
  const idx = audit.indices;
  let maxV = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxV) maxV = idx[i];
  // 水密：开洞边统计（复用简单口径）
  const KM = maxV + 1;
  const em = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? a * KM + b : b * KM + a;
      const rec = em.get(key) ?? [0, 0];
      if (a < b) rec[0]++; else rec[1]++;
      em.set(key, rec);
    }
  }
  let open = 0, nmE = 0;
  for (const [, [f, b]] of em) { if (f + b === 1) open++; else if (!(f === 1 && b === 1)) nmE++; }
  open === 0 && nmE === 0 ? ok('C3 torus 保形填充水密（open=nm=0，hard 裁剪）', `tris=${idx.length / 3}`) : bad('C3 保形填充水密', `open=${open} nm=${nmE}`);
  // 贴合度：顶点重算解析 SDF（torus），穿出壁面（sdf>容差）计 0
  const g = makeTorus(14, 6, 128, 48);
  const buf = toBinarySTL(g.positions, g.indices);
  const mrRef = computeMeshSDF(buf, 65);
  const p = audit.positions;
  let worst = -Infinity, penetrate = 0;
  for (let vi = 0; vi < audit.vertCount; vi++) {
    const x = p[vi * 3], y = p[vi * 3 + 1], z = p[vi * 3 + 2];
    const kPi = 6 * Math.PI; // periods=6 的 wc→phys 因子（fillTorus 固定 periods=6）
    const mmx = (x / kPi) * mrRef.domain.scale, mmy = (y / kPi) * mrRef.domain.scale, mmz = (z / kPi) * mrRef.domain.scale;
    const sd = sdTorus(14, 6, mmx, mmy, mmz) / mrRef.domain.scale;
    if (sd > worst) worst = sd;
    if (sd > 0.02) { penetrate++; if (penetrate < 4) console.log('  C4 pt', x.toFixed(3), y.toFixed(3), z.toFixed(3), 'sd_mm=', (sd * mrRef.domain.scale).toFixed(2)); }
  }
  penetrate === 0 && worst <= 0.02
    ? ok('C4 贴合度：填充网格零穿出壁面（max sdf ≤0.02）', `max=${worst.toFixed(4)}`)
    : bad('C4 贴合度（壁面穿出）', `worst=${worst.toFixed(4)} penetrate=${penetrate}`);
  // 倒角 A/B：blend 提升近壁让步（表面到壁最小距离分布上移）
  const soft = fillTorus(0.35);
  const pS = soft.res.positions;
  const nearWall = (positions) => {
    let cnt = 0;
    for (let vi = 0; vi < positions.length / 3; vi++) {
      const sd = sdTorus(14, 6, (positions[vi * 3] / (6 * Math.PI)) * mrRef.domain.scale, (positions[vi * 3 + 1] / (6 * Math.PI)) * mrRef.domain.scale, (positions[vi * 3 + 2] / (6 * Math.PI)) * mrRef.domain.scale) / mrRef.domain.scale;
      if (Math.abs(sd) < 0.1) cnt++;
    }
    return cnt;
  };
  const nHard = nearWall(p), nSoft = nearWall(pS);
  nSoft < nHard ? ok('C5 Smooth-Max 倒角 A/B（近壁顶点让步）', `hard=${nHard} soft=${nSoft}`) : bad('C5 倒角 A/B 无差', `hard=${nHard} soft=${nSoft}`);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 11) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 11（恒真/集体跳过防护）`); process.exit(1); }
process.exit(fail ? 1 : 0);
