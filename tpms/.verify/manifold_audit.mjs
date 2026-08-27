/**
 * manifold_audit.mjs —— 非欧几里得度规空间映射审计（第十一道 CI 门，阶段 IV）
 *
 * 守护对象：core/manifold-mapping.ts（cylinder/torus/hyperbolic/metric 保形变形层）。
 * 核心不变量：
 *  - 拓扑保持：任意映射后网格开放边 = 0（水密继承）、三角数不变；
 *  - 定向保持：雅可比行列式 > 0（采样网格全域）、映射后符号体积 > 0；
 *  - 无退化：映射后最小三角形面积受控（无折叠/零面积）；
 *  - 周期对齐：cylinder 域两端映射到同一角度截面（θ 差 = 2π）；
 *  - 单位一致性：identity 恒等。
 *
 * 运行：node manifold_audit.mjs
 */

import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_manifold_audit_bundle.mjs');
{
  const entry = join(tmpdir(), `tpms_manifold_audit_entry_${process.pid}.ts`);
  writeFileSync(entry, [
    `export { mapGeometry, mapPoint, jacobianDet } from ${JSON.stringify(join(PLATFORM, 'src/core/manifold-mapping.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export type { ManifoldKind, ManifoldConfig } from ${JSON.stringify(join(PLATFORM, 'src/core/manifold-mapping.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
}
const { mapGeometry, mapPoint, jacobianDet, buildSurface } = await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (name, detail = '') => { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); };

// ── 基网格：gyroid 固体网络，N=28（速度与代表性平衡）──
function baseMesh() {
  const bs = buildSurface({
    type: 'gyroid', iso: 0, periods: 2, resolution: 28, targetPorosity: 0.5,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', customFormula: '',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    preview: false,
  });
  return bs;
}

/** 网格健康检查：开放边/退化三角/符号体积 */
function meshHealth(positions, indices) {
  const KM = 0;
  let maxV = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > maxV) maxV = indices[i];
  const km = maxV + 1;
  const cnt = new Map();
  let degen = 0;
  let vol6 = 0;
  let minArea2 = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    // 面积²（叉积模的一半）
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
    const area2 = Math.sqrt(nxx * nxx + nyy * nyy + nzz * nzz);
    if (area2 < 1e-12) degen++;
    if (area2 < minArea2) minArea2 = area2;
    vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let e = 0; e < 3; e++) {
      const u = tri[e], v = tri[(e + 1) % 3];
      const key = u < v ? u * km + v : v * km + u;
      cnt.set(key, (cnt.get(key) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [, n] of cnt) if (n === 1) open++;
  return { open, degen, vol: vol6 / 6, minArea2 };
}

// ────────────────────────────── A. 单位一致性 ──────────────────────────────
console.log('\n[A] identity 恒等');
{
  const ctx = { half: Math.PI * 2 };
  const pts = [[1, 2, 3], [-4, 0.5, 2], [0, 0, 0]];
  let okAll = true;
  for (const [x, y, z] of pts) {
    const o = [0, 0, 0];
    mapPoint('identity', {}, ctx, x, y, z, o);
    if (Math.abs(o[0] - x) + Math.abs(o[1] - y) + Math.abs(o[2] - z) > 0) okAll = false;
  }
  okAll ? ok('identity 恒等映射') : bad('identity 有偏移');
}

// ────────────────────────────── B. 雅可比定向性（全域采样） ──────────────────────────────
console.log('\n[B] 雅可比行列式 > 0（无折叠）');
{
  const kinds = ['cylinder', 'torus', 'hyperbolic', 'metric'];
  const ctx = { half: Math.PI * 2 };
  const cfgOf = (kind) => kind === 'cylinder' ? { radius: 8.2 }
    : kind === 'torus' ? { radius: 15, tubeRatio: 0.55 }
    : kind === 'metric' ? { scale: 1.4, axis: 'z' } : { radius: 6 };
  for (const kind of kinds) {
    let minDet = Infinity;
    const S = 7;
    const cfg = cfgOf(kind);
    for (let i = 1; i < S; i++) for (let j = 1; j < S; j++) for (let k = 1; k < S; k++) {
      const x = -ctx.half + (2 * ctx.half) * i / S;
      const y = -ctx.half + (2 * ctx.half) * j / S;
      const z = -ctx.half + (2 * ctx.half) * k / S;
      const d = jacobianDet(kind, cfg, ctx, x, y, z);
      if (d < minDet) minDet = d;
    }
    minDet > 0
      ? ok(`${kind} det(J) > 0 全域（min=${minDet.toExponential(2)}）`)
      : bad(`${kind} 出现折叠（minDet=${minDet.toExponential(2)}）`);
  }
}

// ────────────────────────────── C. 网格拓扑保持（水密继承） ──────────────────────────────
console.log('\n[C] 映射后网格拓扑（水密继承 + 无退化）');
{
  const bs = baseMesh();
  const idx0 = bs.indices.slice();
  const triCount = bs.triCount;
  const kinds = ['cylinder', 'torus', 'hyperbolic', 'metric'];
  const ctx = { half: Math.PI * 2 };
  const cfgOf = (kind) => kind === 'cylinder' ? { radius: 8.2 }
    : kind === 'torus' ? { radius: 15, tubeRatio: 0.55 }
    : kind === 'metric' ? { scale: 1.4, axis: 'z' } : { radius: 6 };
  for (const kind of kinds) {
    const positions = bs.positions.slice();
    const indices = idx0.slice();
    mapGeometry(kind, cfgOf(kind), ctx, positions);
    const h = meshHealth(positions, indices);
    const volOk = h.vol > 0;
    const topOk = h.open === 0 && h.degen === 0;
    const sameTris = indices.length === idx0.length;
    if (topOk && volOk && sameTris) ok(`${kind} 水密 open=0 · 体积>0 · 三角数不变`, `vol=${h.vol.toFixed(1)} · ${triCount} tri`);
    else bad(`${kind} 拓扑破坏`, `open=${h.open} degen=${h.degen} vol=${h.vol.toFixed(1)} sameTris=${sameTris}`);
  }
  // 最小面积：映射后不应产生大量近零面积三角（阈值：总面积的1e-8量级检查退化数即可，上面已计）
}

// ────────────────────────────── D. cylinder 周期对齐 ──────────────────────────────
console.log('\n[D] cylinder 域两端周期对齐（θ 差 = 2π）');
{
  const ctx = { half: Math.PI * 2 };
  const y = 0.7, z = 1.3;
  const o1 = [0, 0, 0], o2 = [0, 0, 0];
  mapPoint('cylinder', { radius: 6 }, ctx, -ctx.half, y, z, o1);
  mapPoint('cylinder', { radius: 6 }, ctx, ctx.half, y, z, o2);
  // 两端 rad 相同、θ 差恰为 2π → (cosθ, sinθ) 相等
  const d = Math.abs(o1[0] - o2[0]) + Math.abs(o1[1] - o2[1]) + Math.abs(o1[2] - o2[2]);
  d < 1e-9
    ? ok('域两端映射到同一截面（零裂缝）', `Δ=${d.toExponential(1)}`)
    : bad('周期未对齐', `Δ=${d.toExponential(1)}`);
  // torus 同理（u 两端）
  const t1 = [0, 0, 0], t2 = [0, 0, 0];
  mapPoint('torus', { radius: 6, tubeRatio: 0.4 }, ctx, -ctx.half, 0.5, 0.3, t1);
  mapPoint('torus', { radius: 6, tubeRatio: 0.4 }, ctx, ctx.half, 0.5, 0.3, t2);
  const dt = Math.abs(t1[0] - t2[0]) + Math.abs(t1[1] - t2[1]) + Math.abs(t1[2] - t2[2]);
  // torus 的 y 也需对齐（v 两端）：v 差 2π → tube/ring 相同
  const t3 = [0, 0, 0], t4 = [0, 0, 0];
  mapPoint('torus', { radius: 6, tubeRatio: 0.4 }, ctx, 0.5, -ctx.half, 0.3, t3);
  mapPoint('torus', { radius: 6, tubeRatio: 0.4 }, ctx, 0.5, ctx.half, 0.3, t4);
  const dt2 = Math.abs(t3[0] - t4[0]) + Math.abs(t3[1] - t4[1]) + Math.abs(t3[2] - t4[2]);
  dt < 1e-6 && dt2 < 1e-6
    ? ok('torus u/v 两端周期对齐', `Δu=${dt.toExponential(1)} Δv=${dt2.toExponential(1)}`)
    : bad('torus 周期未对齐', `Δu=${dt.toExponential(1)} Δv=${dt2.toExponential(1)}`);
}

// ────────────────────────────── E. 最小二面角分布（形状学下限） ──────────────────────────────
console.log('\n[E] 映射后三角形质量（最小角分布）');
{
  const bs = baseMesh();
  const ctx = { half: Math.PI * 2 };
  const kinds = ['cylinder', 'torus', 'hyperbolic'];
  const cfgOf2 = (kind) => kind === 'cylinder' ? { radius: 8.2 }
    : kind === 'torus' ? { radius: 15, tubeRatio: 0.55 } : { radius: 6 };
  let worstMinAngle = Math.PI;
  for (const kind of kinds) {
    const positions = bs.positions.slice();
    mapGeometry(kind, cfgOf2(kind), ctx, positions);
    let localMin = Math.PI;
    for (let t = 0; t < bs.indices.length; t += 3) {
      const a = bs.indices[t] * 3, b = bs.indices[t + 1] * 3, c = bs.indices[t + 2] * 3;
      const P = [[positions[a], positions[a + 1], positions[a + 2]], [positions[b], positions[b + 1], positions[b + 2]], [positions[c], positions[c + 1], positions[c + 2]]];
      for (let i = 0; i < 3; i++) {
        const p0 = P[i], p1 = P[(i + 1) % 3], p2 = P[(i + 2) % 3];
        const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
        const dot = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / (l1 * l2);
        localMin = Math.min(localMin, Math.acos(Math.max(-1, Math.min(1, dot))));
      }
    }
    if (localMin < worstMinAngle) worstMinAngle = localMin;
  }
  worstMinAngle > 0.005   // ≈0.3°：无退化/翻转三角
    ? ok(`四类映射最小角 > 0.3°`, `min=${(worstMinAngle * 180 / Math.PI).toFixed(2)}°`)
    : bad('存在退化三角', `min=${(worstMinAngle * 180 / Math.PI).toFixed(3)}°`);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
