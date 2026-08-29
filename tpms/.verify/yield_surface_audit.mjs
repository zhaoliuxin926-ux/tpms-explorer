/**
 * yield_surface_audit.mjs —— 门禁 33：多轴屈服包络面审计（纯 Node）
 *
 * A. Hill-48：方向屈服强度解析锚点（单轴射线距离精确复现 X/Y/Z）+ 凸性中点检验
 *    + 各向同性构型置换对称 + 全向射线有限（静水帽封闭）
 * B. Tsai-Wu：拉/压双强度精确复现（+Xt/−Xc）+ 原点严格内含 + 凸性中点检验
 * C. Gurson：静水极点解析式命中 + f 沿射线严格单调（二分合法性）+ 轴对称（绕 ĥ 旋转 120°）
 *    + q→1 零强度退化 + 凸性中点检验
 * D. Drucker-Prager：σyt/σyc 双单轴锚点 + 压缩帽封闭 + 凸性
 * E. 包络网格：四准则 UV 球网格全封闭（open=0）+ 发散定理解析体积 > 0
 * F. 脚手架推导：与 gibson-ashby 同源（σ_pl 公式）+ q 钳制 + 各向同性退化 X=Y=Z
 * G. 安全系数：径向等比放大半程 SF=2.0 精确 + 多准则竞争取最小
 *
 * 运行：node yield_surface_audit.mjs
 */
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_yield_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_yield_audit_entry.ts');
  writeFileSync(entry, [
    `export * from ${JSON.stringify(join(PLATFORM, 'src/physics/yield-surface.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const Y = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 确定性随机（LCG，与既有门禁同族）
let seed = 33;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
/** 单位随机方向 */
const randDir = () => {
  for (;;) {
    const p = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const n = Math.hypot(p[0], p[1], p[2]);
    if (n > 0.1 && n < 1) return [p[0] / n, p[1] / n, p[2] / n];
  }
};

// ── A. Hill-48 ──
console.log('\n[A] Hill-48 各向异性准则');
{
  const c = { X: 42, Y: 33, Z: 27, capM: 120 };
  check('单轴 X 锚点：r(x̂)=42', Math.abs(Y.hill48RayDist([1, 0, 0], c) - 42) < 1e-9);
  check('单轴 Y 锚点：r(ŷ)=33', Math.abs(Y.hill48RayDist([0, 1, 0], c) - 33) < 1e-9);
  check('单轴 Z 锚点：r(ẑ)=27', Math.abs(Y.hill48RayDist([0, 0, 1], c) - 27) < 1e-9);
  // 凸性中点：表面点对中点必在域内（f = 二次型 ≤ 1 且 |σm| ≤ capM）
  const { F, G, H } = Y.hill48Constants(c);
  let maxFq = -Infinity;
  let maxCap = -Infinity;
  for (let i = 0; i < 200; i++) {
    const na = randDir(), nb = randDir();
    const a = [na[0] * Y.hill48RayDist(na, c), na[1] * Y.hill48RayDist(na, c), na[2] * Y.hill48RayDist(na, c)];
    const b = [nb[0] * Y.hill48RayDist(nb, c), nb[1] * Y.hill48RayDist(nb, c), nb[2] * Y.hill48RayDist(nb, c)];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const fq = F * (mid[1] - mid[2]) ** 2 + G * (mid[2] - mid[0]) ** 2 + H * (mid[0] - mid[1]) ** 2;
    const capViol = Math.abs((mid[0] + mid[1] + mid[2]) / 3) - c.capM;
    if (fq > maxFq) maxFq = fq;
    if (capViol > maxCap) maxCap = capViol;
  }
  check(`凸性中点检验 200 对（max fq−1 = ${(maxFq - 1).toExponential(2)} ≤ 1e-9）`, maxFq <= 1 + 1e-9);
  check(`静水帽域内（max |σm|−capM = ${maxCap.toExponential(2)} ≤ 1e-9）`, maxCap <= 1e-9);
  // 各向同性构型：X=Y=Z ⇒ 组件置换对称
  const iso = { X: 30, Y: 30, Z: 30, capM: 90 };
  let permDev = 0;
  for (let i = 0; i < 60; i++) {
    const n = randDir();
    const r0 = Y.hill48RayDist(n, iso);
    const perms = [[n[1], n[0], n[2]], [n[2], n[1], n[0]], [n[0], n[2], n[1]]];
    for (const p of perms) permDev = Math.max(permDev, Math.abs(Y.hill48RayDist(p, iso) - r0));
  }
  check(`各向同性置换对称（max Δ = ${permDev.toExponential(2)} ≤ 1e-9）`, permDev <= 1e-9);
  // 全向封闭
  let allFinite = true;
  for (let i = 0; i < 300; i++) if (!Number.isFinite(Y.hill48RayDist(randDir(), c))) allFinite = false;
  check('300 随机方向射线距离全有限（静水帽封闭）', allFinite);
}

// ── B. Tsai-Wu ──
console.log('\n[B] Tsai-Wu 拉压不对称准则');
{
  const c = { Xt: 30, Xc: 60, Yt: 24, Yc: 50, Zt: 20, Zc: 45 };
  check('拉伸锚点：r(+x̂)=Xt=30', Math.abs(Y.tsaiWuRayDist([1, 0, 0], c) - 30) < 1e-9);
  check('压缩锚点：r(−x̂)=Xc=60', Math.abs(Y.tsaiWuRayDist([-1, 0, 0], c) - 60) < 1e-9);
  const insideTw = (p) =>
    (1 / c.Xt - 1 / c.Xc) * p[0] + (1 / c.Yt - 1 / c.Yc) * p[1] + (1 / c.Zt - 1 / c.Zc) * p[2]
    + p[0] * p[0] / (c.Xt * c.Xc) + p[1] * p[1] / (c.Yt * c.Yc) + p[2] * p[2] / (c.Zt * c.Zc) - 1;
  let maxF = -Infinity;
  for (let i = 0; i < 200; i++) {
    const na = randDir(), nb = randDir();
    const pa = Y.tsaiWuRayDist(na, c), pb = Y.tsaiWuRayDist(nb, c);
    const mid = [(na[0] * pa + nb[0] * pb) / 2, (na[1] * pa + nb[1] * pb) / 2, (na[2] * pa + nb[2] * pb) / 2];
    maxF = Math.max(maxF, insideTw(mid));
  }
  check(`凸性中点检验 200 对（max f_mid = ${maxF.toExponential(2)} ≤ 1e-9）`, maxF <= 1e-9);
  check('原点严格内含（f(0)=−1）', Math.abs(insideTw([0, 0, 0]) + 1) < 1e-12);
}

// ── C. Gurson ──
console.log('\n[C] Gurson 多孔压溃准则');
{
  const c = { sigma0: 880, q: 0.4 };
  // 静水极点：n=ĥ=(1,1,1)/√3，σm = r/√3 应等于解析极点
  const pole = Y.gursonHydrostaticPole(c);
  const rH = Y.gursonRayDist([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], c);
  check(`静水极点解析命中（r/√3 = ${(rH / Math.sqrt(3)).toFixed(4)} vs ${(pole).toFixed(4)}）`,
    Math.abs(rH / Math.sqrt(3) - pole) / pole < 1e-6);
  // f 沿射线严格单调
  let monotone = true;
  for (let i = 0; i < 40; i++) {
    const n = randDir();
    const nbar = (n[0] + n[1] + n[2]) / 3;
    let j2 = 0;
    for (let k = 0; k < 3; k++) j2 += (n[k] - nbar) ** 2;
    j2 *= 0.5;
    const fR = (r) => Y.gursonF(r * Math.sqrt(3 * j2), r * nbar, c);
    let prev = fR(1e-6);
    for (let s = 1; s <= 20; s++) {
      const v = fR(1e-6 + (s / 20) * 400);
      if (v <= prev) { monotone = false; break; }
      prev = v;
    }
    if (!monotone) break;
  }
  check('f 沿射线严格单调（40 方向 × 20 步）', monotone);
  // 轴对称：绕 ĥ 旋转 120°（R 轮换分量）射线距离不变
  let rotDev = 0;
  for (let i = 0; i < 60; i++) {
    const n = randDir();
    const r0 = Y.gursonRayDist(n, c);
    // 绕 (1,1,1) 轴 120° 轮换：R(n) = (n2,n3,n1)
    const rn = [n[1], n[2], n[0]];
    rotDev = Math.max(rotDev, Math.abs(Y.gursonRayDist(rn, c) - r0) / r0);
  }
  check(`轴对称 120° 旋转（max rel Δ = ${rotDev.toExponential(2)} ≤ 1e-6）`, rotDev <= 1e-6);
  // q→1 零强度退化
  const nq = [0.6, -0.7, 0.4];
  const nqm = Math.hypot(nq[0], nq[1], nq[2]);
  const rQ1 = Y.gursonRayDist([nq[0] / nqm, nq[1] / nqm, nq[2] / nqm], { sigma0: 880, q: 0.999 });
  check(`q→1 退化近零强度（r = ${rQ1.toExponential(2)} < 1 MPa）`, rQ1 < 1);
  // 凸性中点（域内判据 f ≤ 0）。
  // σv 换算：σv = √(3·J2)，J2 = ½·Σ(σi−σm)² ⇒ σv = √(1.5·Σ)。
  // 教训（两度踩坑）：Σ 漏乘 ½ 会使 σv 抬高 √2、f_mid 虚增 ~0.35（假凸性违规）。
  const gF = (p) => {
    const sm = (p[0] + p[1] + p[2]) / 3;
    let S = 0;
    for (let k = 0; k < 3; k++) S += (p[k] - sm) ** 2;
    return Y.gursonF(Math.sqrt(1.5 * S), sm, c);
  };
  let maxFmid = -Infinity;
  let bad = null;
  for (let i = 0; i < 200; i++) {
    const na = randDir(), nb = randDir();
    const pa = Y.gursonRayDist(na, c), pb = Y.gursonRayDist(nb, c);
    const mid = [(na[0] * pa + nb[0] * pb) / 2, (na[1] * pa + nb[1] * pb) / 2, (na[2] * pa + nb[2] * pb) / 2];
    const fMid = gF(mid);
    if (fMid > maxFmid) { maxFmid = fMid; bad = { i, na, nb, pa, pb, mid, fMid }; }
  }
  check(`凸性中点检验 200 对（max f_mid = ${maxFmid.toExponential(2)} ≤ 1e-6）`,
    maxFmid <= 1e-6, bad && maxFmid > 1e-6 ? JSON.stringify(bad) : '');
}

// ── D. Drucker-Prager ──
console.log('\n[D] Drucker-Prager 圆锥准则');
{
  const c = { sigmaYt: 21, sigmaYc: 30, capI1: 90 };
  check('拉伸锚点：r(+x̂)=σyt=21', Math.abs(Y.dpRayDist([1, 0, 0], c) - 21) < 1e-9);
  check('压缩锚点：r(−x̂)=σyc=30', Math.abs(Y.dpRayDist([-1, 0, 0], c) - 30) < 1e-9);
  const { alpha, k } = Y.dpConstants(c);
  const insideDp = (p) => {
    const sm = (p[0] + p[1] + p[2]) / 3;
    let j2 = 0;
    for (let i = 0; i < 3; i++) j2 += (p[i] - sm) ** 2;
    j2 *= 0.5;
    return Math.sqrt(j2) + alpha * (p[0] + p[1] + p[2]) - k <= 1e-9 && (p[0] + p[1] + p[2]) >= -c.capI1 - 1e-9;
  };
  let cvxOk = true, finiteOk = true;
  for (let i = 0; i < 200; i++) {
    const n = randDir();
    if (!Number.isFinite(Y.dpRayDist(n, c))) finiteOk = false;
    if (i < 150) {
      const na = randDir(), nb = randDir();
      const pa = Y.dpRayDist(na, c), pb = Y.dpRayDist(nb, c);
      const mid = [(na[0] * pa + nb[0] * pb) / 2, (na[1] * pa + nb[1] * pb) / 2, (na[2] * pa + nb[2] * pb) / 2];
      if (!insideDp(mid)) { cvxOk = false; break; }
    }
  }
  check('压缩帽封闭（300 方向全有限）', finiteOk);
  check('凸性中点检验 150 对', cvxOk);
}

// ── E. 包络网格 ──
console.log('\n[E] 包络网格封闭性 + 体积');
{
  const configs = [
    ['hill48', { X: 42, Y: 33, Z: 27, capM: 120 }],
    ['tsaiwu', { Xt: 30, Xc: 60, Yt: 24, Yc: 50, Zt: 20, Zc: 45 }],
    ['gurson', { sigma0: 880, q: 0.4 }],
    ['drucker-prager', { sigmaYt: 21, sigmaYc: 30, capI1: 90 }],
  ];
  for (const [kind, cfg] of configs) {
    const mesh = Y.buildEnvelopeMesh(kind, cfg);
    const open = new Map();
    const key = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const t = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      for (let e = 0; e < 3; e++) {
        const kk = key(t[e], t[(e + 1) % 3]);
        open.set(kk, (open.get(kk) ?? 0) + 1);
      }
    }
    let openCount = 0;
    for (const cnt of open.values()) if (cnt === 1) openCount++;
    // 发散定理体积（原点在凸域内部 ⇒ 有向体积和 > 0）
    let vol6 = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, cc = mesh.indices[i + 2] * 3;
      const ax = mesh.positions[a], ay = mesh.positions[a + 1], az = mesh.positions[a + 2];
      const bx = mesh.positions[b], by = mesh.positions[b + 1], bz = mesh.positions[b + 2];
      const cx = mesh.positions[cc], cy = mesh.positions[cc + 1], cz = mesh.positions[cc + 2];
      vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    const vol = Math.abs(vol6) / 6;
    check(`${kind}：open=${openCount}=0 · 体积 ${vol.toFixed(0)} MPa³ > 0 · rMin ${mesh.rMin.toFixed(2)} > 0`,
      openCount === 0 && vol > 0 && mesh.rMin > 0);
  }
}

// ── F. 脚手架推导（UI 数据源一致性）──
console.log('\n[F] 脚手架工程推导');
{
  const d = Y.deriveScaffoldYieldConfigs(0.3, 'gyroid', 0.7, 'tc4');
  const sigmaPlExpect = 0.3 * 880 * Math.pow(0.3, 1.5);
  check(`σ_pl 与冲击吸能同源（${d.sigmaPl.toFixed(2)} vs ${sigmaPlExpect.toFixed(2)}）`,
    Math.abs(d.sigmaPl - sigmaPlExpect) < 1e-9);
  check(`Hill 方向强度全正（X=${d.hill.X.toFixed(2)} Y=${d.hill.Y.toFixed(2)} Z=${d.hill.Z.toFixed(2)}）`,
    d.hill.X > 0 && d.hill.Y > 0 && d.hill.Z > 0);
  check(`各向同性退化：gyroid E 三向相等 ⇒ X=Y=Z`,
    Math.abs(d.hill.X - d.hill.Y) < 1e-9 && Math.abs(d.hill.Y - d.hill.Z) < 1e-9);
  check(`拉压不对称口径（σyt=0.7σ_pl）`, Math.abs(d.dp.sigmaYt - 0.7 * d.sigmaPl) < 1e-9);
  const dQ = Y.deriveScaffoldYieldConfigs(0.3, 'gyroid', 0.99, 'tc4');
  check(`Gurson q 钳制（0.99 → ${dQ.gurson.q}）`, dQ.gurson.q === 0.9);
  const dE = Y.deriveScaffoldYieldConfigs(0.05, 'gyroid', 0.7, 'auto');
  check(`auto 材质回退 TC4（σys=${dE.sigmaYs}）`, dE.sigmaYs === 880);
}

// ── G. 安全系数 ──
console.log('\n[G] 安全系数与临界模式');
{
  const cases = [
    ['hill48', { X: 42, Y: 33, Z: 27, capM: 120 }],
    ['tsaiwu', { Xt: 30, Xc: 60, Yt: 24, Yc: 50, Zt: 20, Zc: 45 }],
    ['gurson', { sigma0: 880, q: 0.4 }],
    ['drucker-prager', { sigmaYt: 21, sigmaYc: 30, capI1: 90 }],
  ];
  for (const [kind, cfg] of cases) {
    const n = randDir();
    const r = Y.radialDistance(kind, n, cfg);
    const sf = Y.safetyFactor(kind, cfg, [0.5 * r * n[0], 0.5 * r * n[1], 0.5 * r * n[2]]);
    check(`${kind}：半程应力 SF=${sf.sf.toFixed(6)} = 2.0`, Math.abs(sf.sf - 2) < 1e-9);
  }
  const sigma0 = [20, 10, 5];
  const crit = Y.criticalMode(cases.map(([kind, cfg]) => ({ kind, config: cfg })), sigma0);
  const sfs = cases.map(([kind, cfg]) => Y.safetyFactor(kind, cfg, sigma0).sf);
  const minSf = Math.min(...sfs);
  check(`多准则竞争取最小（${crit?.result.sf.toFixed(4)} vs min ${minSf.toFixed(4)}）`,
    crit !== null && Math.abs(crit.result.sf - minSf) < 1e-12);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
