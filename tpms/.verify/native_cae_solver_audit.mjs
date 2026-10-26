/**
 * native_cae_solver_audit.mjs —— 门禁 22：浏览器端原生 CAE 求解器审计（纯 Node）
 *
 * A. Micro-FEA 实体块 patch test：全实心体素 ν=0.2 → C11=λ+2μ、C12=λ、
 *    C44=μ 解析精确；对称度 ≤1e-12；Zener=1
 * B. Micro-FEA gyroid：立方对称（C11=C22=C33 相对差 ≤1e-6）；收敛；正定
 *    （对角 > 0）；孔洞非贯通结构显式抛错（连通性守卫）
 * C. 口径声明：剪切波动场未激活（b_shear=0 结构性，见 bugs.md v5.0 条目），
 *    C44-C66 为真均质化值（批十六修复后；≤Voigt 上界 φμ——KUBC 热力学关系）
 * D. FD-Darcy：单管解析锚点（κ = A_tube·L/(A_total·L) = A_tube/(R²·1) 精确）；
 *    双管加倍；空域抛错
 * E. 管径线性标度 + 孔隙率单调性：管截面 4× → κ 4×（比值偏差 ≤5%）；
 *    通道加宽 κ 严格增大。
 * F. Kozeny-Carman 对拍（2026-09-10 补齐）：gyroid 三孔隙率 FD-Darcy vs 平台
 *    estimatePermeability（bulk Sv 口径，同轮量纲修正）比值 ∈ [0.3, 3]
 *
 * 运行：node native_cae_solver_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_ncs_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_ncs_audit_entry.ts');
  writeFileSync(entry, [
    `export { solveMicroFEA, buildElementKe } from ${JSON.stringify(join(PLATFORM, 'src/physics/micro-fea-solver.ts'))};`,
    `export { solveDarcyPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`,
    `export { estimatePermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/permeability.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { solveMicroFEA, buildElementKe, solveDarcyPermeability, estimatePermeability } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function voxelGyroid(R, iso) {
  // 体素化 gyroid：v = sinxcosy+sinycosz+sinzcosx（节点采样）
  // solid = {v < iso}（保证贯通的迷宫相）
  const solid = new Uint8Array(R ** 3);
  const N1 = R + 1;
  const vals = new Float64Array(N1 ** 3);
  for (let iz = 0; iz <= R; iz++) for (let iy = 0; iy <= R; iy++) for (let ix = 0; ix <= R; ix++) {
    const x = (ix / R) * 2 * Math.PI - Math.PI;
    const y = (iy / R) * 2 * Math.PI - Math.PI;
    const z = (iz / R) * 2 * Math.PI - Math.PI;
    vals[ix + iy * N1 + iz * N1 * N1] = Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
  }
  // 体素中心采样（与求解器体素语义一致）
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    // 体素中心值 = 解析式在体素中心直接采样（简单可靠）
    const x = ((ix + 0.5) / R) * 2 * Math.PI - Math.PI;
    const y = ((iy + 0.5) / R) * 2 * Math.PI - Math.PI;
    const z = ((iz + 0.5) / R) * 2 * Math.PI - Math.PI;
    const avg = Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
    if (avg < iso) solid[ix + iy * R + iz * R * R] = 1;
  }
  return solid;
}

// ── A. 实体块 patch test ──
console.log('\n[A] Micro-FEA 全实心块 patch test（ν=0.2）');
{
  const R = 8;
  const solid = new Uint8Array(R ** 3).fill(1);
  const res = solveMicroFEA({ R, solid, nu: 0.2, tol: 1e-9, maxIter: 800 });
  const nu = 0.2;
  const lam = nu / ((1 + nu) * (1 - 2 * nu));
  const mu = 1 / (2 * (1 + nu));
  check(`C11 = λ+2μ（${res.C[0][0].toFixed(6)} vs ${(lam + 2 * mu).toFixed(6)}）`, Math.abs(res.C[0][0] - (lam + 2 * mu)) < 1e-9);
  check(`C12 = λ（${res.C[0][1].toFixed(6)} vs ${lam.toFixed(6)}）`, Math.abs(res.C[0][1] - lam) < 1e-9);
  check(`C44 = μ（${res.C[3][3].toFixed(6)} vs ${mu.toFixed(6)}）`, Math.abs(res.C[3][3] - mu) < 1e-9);
  check(`对称度 ${res.symmetryErr.toExponential(2)} ≤1e-12`, res.symmetryErr <= 1e-12);
  check(`Zener = 1（${res.zenerRatio.toFixed(6)}）`, Math.abs(res.zenerRatio - 1) < 1e-9);
}

// ── K. 单元刚度解析锚（批十六 P1-05：旧 B 矩阵混合二阶导+2× 系数错误的防回归钉）──
console.log('\n[K] buildElementKe 仿射场解析锚（E=1, ν=0.2, 单位立方）');
{
  const KE = buildElementKe(0.2);
  const nu = 0.2;
  const lam = nu / ((1 + nu) * (1 - 2 * nu));
  const mu = 1 / (2 * (1 + nu));
  const NODE_XI_REF = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  // NODE_XI 顺序的物理坐标（[0,1]³：(ξ+1)/2 等）
  const coord = (a) => [(NODE_XI_REF[a][0] + 1) / 2, (NODE_XI_REF[a][1] + 1) / 2, (NODE_XI_REF[a][2] + 1) / 2];
  const ukv = (fx, fy, fz) => { const u = new Float64Array(24); for (let a = 0; a < 8; a++) { const [x, y, z] = coord(a); u[a*3] = fx(x,y,z); u[a*3+1] = fy(x,y,z); u[a*3+2] = fz(x,y,z); } return u; };
  const quad = (u) => { let e = 0; for (let i = 0; i < 24; i++) { let s0 = 0; for (let j = 0; j < 24; j++) s0 += KE[i*24+j] * u[j]; e += u[i] * s0; } return e; };
  // uₓ=y：ε_xy=1/2 ⇒ uᵀKu = μ·V = μ（V=1）——旧实现返回 0
  const eShear = quad(ukv((x, y) => y, () => 0, () => 0));
  check(`KE 仿射 uₓ=y → uᵀKeu = μ（${eShear.toFixed(6)} vs ${mu.toFixed(6)}，旧坏值 0）`, Math.abs(eShear - mu) < 1e-9);
  // uₓ=x：ε_xx=1 ⇒ uᵀKu = λ+2μ（V=1）——旧实现返回 35.5556
  const eNorm = quad(ukv((x) => x, () => 0, () => 0));
  check(`KE 仿射 uₓ=x → uᵀKeu = λ+2μ（${eNorm.toFixed(6)} vs ${(lam + 2*mu).toFixed(6)}，旧坏值 35.5556）`, Math.abs(eNorm - (lam + 2 * mu)) < 1e-9);
  // 刚体平移/旋转零能（K 的核）
  check('KE 刚体平移零能', Math.abs(quad(ukv(() => 1, () => 1, () => 1))) < 1e-9);
  check('KE 刚体旋转 u=(−y,x,0) 零能', Math.abs(quad(ukv((x, y) => -y, (x, y) => x, () => 0))) < 1e-9);
}

// ── B. gyroid 立方对称 + 收敛 + 守卫 ──
console.log('\n[B] Micro-FEA gyroid（KUBC 法向模量口径）');
{
  const R = 12;   // 批十六：真 PCG 求解后控时长（旧 0 迭代假解时 R=20 也瞬时）
  const solid = voxelGyroid(R, -0.1);   // {avg < -0.1}：迷宫固相（贯通）
  let n = 0;
  for (let i = 0; i < R ** 3; i++) n += solid[i];
  const phi = n / R ** 3;
  const res = solveMicroFEA({ R, solid, nu: 0.2, tol: 1e-6, maxIter: 1500 });
  // 【批十六 P1-05】非平凡工况必须真收敛：旧断言 iters≥0 在残差未初始化（0 迭代假退）
  // 的坏求解器上恒过——评估实证残差=1/converged=false 仍绿。现要求全部工况迭代>0 且
  // 收敛（gyroid 剪切/法向波动场均非仿射平衡，b≠0）。
  check(`全部工况真收敛（iters ${res.iters.join(',')}；converged=${res.converged}）`,
    res.converged === true && res.iters.every((it) => it > 0) && res.iters.length === 6);
  check(`残差全部 <tol（${res.residuals.map((r2) => r2.toExponential(1)).join(',')}）`,
    res.residuals.every((r2) => r2 < 1e-6));
  check(`立方对称 C11=C22=C33（${res.C[0][0].toFixed(6)}/${res.C[1][1].toFixed(6)}/${res.C[2][2].toFixed(6)}）`,
    Math.abs(res.C[0][0] - res.C[1][1]) <= 1e-6 * res.C[0][0] && Math.abs(res.C[1][1] - res.C[2][2]) <= 1e-6 * res.C[2][2]);
  check(`正定（对角全正）`, [0, 1, 2, 3, 4, 5].every((k) => res.C[k][k] > 0));
  // 批十六：对称度阈值对齐 PCG tol（真解后 C 的反对称残差 ~tol 量级；旧 1e-9 是
  // 0 迭代假解的机器精度假象）
  check(`对称度 ${res.symmetryErr.toExponential(2)} ≤1e-6（对齐求解容差）`, res.symmetryErr <= 1e-6);
  // 【批十六 P1-05】真解后 C44 = φμ − 波动能修正（KUBC≤Voigt 上界）——旧断言
  // 「C44=φμ ≤15%」是在 x≡0 坏解（恰=Voigt 值）上校准的。改为热力学上界+物理下界：
  const mu = 1 / (2 * 1.2);
  const lam2 = () => 0.2 / (1.2 * 0.6);
  const voigtShear = phi * mu;
  check(`C44 ≤ Voigt 上界 φμ（${res.C[3][3].toFixed(4)} ≤ ${voigtShear.toFixed(4)}）`,
    res.C[3][3] <= voigtShear * (1 + 1e-6));
  check(`C44 有物理下限（≥0.25·φμ：${res.C[3][3].toFixed(4)}）`, res.C[3][3] >= 0.25 * voigtShear);
  const voigtC11 = phi * (lam2() + 2 * mu);
  check(`C11 ≤ Voigt 上界 φ(λ+2μ)（${res.C[0][0].toFixed(4)} ≤ ${voigtC11.toFixed(4)}）`,
    res.C[0][0] <= voigtC11 * (1 + 1e-6));
  // 非贯通抛错：悬浮球幻影（Ri=12 内偏移球，全为孤岛）
  const Ri = 12;
  const island = new Uint8Array(Ri ** 3);
  for (let iz = 0; iz < Ri; iz++) for (let iy = 0; iy < Ri; iy++) for (let ix = 0; ix < Ri; ix++) {
    const dx = ix - 6, dy = iy - 6, dz = iz - 3;
    if (dx * dx + dy * dy + dz * dz < 4) island[ix + iy * Ri + iz * Ri * Ri] = 1;
  }
  let threw = false;
  try { solveMicroFEA({ R: Ri, solid: island, nu: 0.2 }); } catch { threw = true; }
  check('非贯通固相（悬浮球）显式抛错', threw);
}

// ── D. FD-Darcy 解析锚点 ──
console.log('\n[D] FD-Darcy 单管解析锚点');
{
  const R = 12;
  const solid = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R; iz++) solid[6 + 6 * R + iz * R * R] = 0;   // 单直管
  const res = solveDarcyPermeability({ R, solid, tol: 1e-10, maxIter: 20000 });
  const expect = 1 / (R * R);   // κ = Q·L/(A·Δp) = (1/11)·11/144 = 1/144
  check(`单管 κ = 1/R²（${res.kappaLU.toFixed(6)} vs ${expect.toFixed(6)}）`, Math.abs(res.kappaLU - expect) / expect < 1e-6);
  check(`收敛 ${res.iters} iters`, res.converged);
  // 双管加倍
  const solid2 = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R; iz++) { solid2[6 + 6 * R + iz * R * R] = 0; solid2[3 + 3 * R + iz * R * R] = 0; }
  const res2 = solveDarcyPermeability({ R, solid: solid2, tol: 1e-10, maxIter: 20000 });
  check(`双管 κ 加倍（${res2.kappaLU.toFixed(6)} = 2×）`, Math.abs(res2.kappaLU / res.kappaLU - 2) < 1e-6);
  // 空域抛错
  let threw = false;
  try { solveDarcyPermeability({ R, solid: new Uint8Array(R ** 3).fill(1) }); } catch { threw = true; }
  check('空流体域显式抛错', threw);
  // 【N2 2026-10-11】封堵守卫：流量积分只认真实流体出口邻接——封死出口/中段 κ≈0
  //（旧版把被封堵节点的侧向回压当流量计入=封堵反而抬高渗透率）
  const sSealOut = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R - 1; iz++) sSealOut[6 + 6 * R + iz * R * R] = 0;   // 单管但出口面封死
  const kSealOut = solveDarcyPermeability({ R, solid: sSealOut, tol: 1e-10, maxIter: 20000 }).kappaLU;
  check(`出口封死 → κ≈0（实测 ${kSealOut.toExponential(2)}，旧版计入回压≈正常量级）`, kSealOut === 0);
  const sSealMid = new Uint8Array(R ** 3).fill(1);
  for (const iz of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]) sSealMid[6 + 6 * R + iz * R * R] = 0;  // 中段封死
  const kSealMid = solveDarcyPermeability({ R, solid: sSealMid, tol: 1e-10, maxIter: 20000 }).kappaLU;
  check(`中段封死 → κ≈0（实测 ${kSealMid.toExponential(2)}，开放管 ${res.kappaLU.toExponential(2)} 的百万分之一以下）`,
    kSealMid < res.kappaLU * 1e-6);
}

// ── E. 管径线性标度 + 孔隙率单调性（精确锚点）──
{
  const R = 12;
  const s1 = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R; iz++) s1[6 + 6 * R + iz * R * R] = 0;
  const k1 = solveDarcyPermeability({ R, solid: s1, tol: 1e-10, maxIter: 20000 }).kappaLU;
  const s4 = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R; iz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    s4[(6 + dx) + (6 + dy) * R + iz * R * R] = 0;
  }
  const k4 = solveDarcyPermeability({ R, solid: s4, tol: 1e-10, maxIter: 20000 }).kappaLU;
  const ratio = k4 / k1;
  check(`管截面 4× → κ 4×（${k1.toFixed(5)} → ${k4.toFixed(5)}，比值 ${ratio.toFixed(3)}）`, Math.abs(ratio - 4) < 0.05);
  const sA = new Uint8Array(R ** 3).fill(1);
  const sB = new Uint8Array(R ** 3).fill(1);
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    if (ix >= 1 && ix <= 2) sA[ix + iy * R + iz * R * R] = 0;
    if (ix >= 1 && ix <= 3) sB[ix + iy * R + iz * R * R] = 0;
  }
  const kA = solveDarcyPermeability({ R, solid: sA, tol: 1e-10, maxIter: 20000 }).kappaLU;
  const kB = solveDarcyPermeability({ R, solid: sB, tol: 1e-10, maxIter: 20000 }).kappaLU;
  check(`通道加宽 κ 增大（${kA.toFixed(4)} → ${kB.toFixed(4)}）`, kB > kA);
}

// ── F. Kozeny-Carman 对拍（FD-Darcy vs 平台 K-C 经验式，bulk Sv 口径）──
//【2026-09-10 补齐】原头注宣称的 K-C 区间对拍此前不存在；同轮修复 estimatePermeability
// 的量纲混用（(1−ε)² 因子属每固相 S_s 约定，误用于 bulk Sv 入参 → 低估 κ 达 (1−ε)² 倍）。
// 实测（本文件 F 节配置）：φ=0.44/0.50/0.54 → 比 1.385/1.284/1.218，钉入 [0.3,3]（双侧 ≥2× 余量）
console.log('\n[F] FD-Darcy vs Kozeny-Carman 物理区间');
{
  const R = 16;
  for (const iso of [-0.15, 0, 0.2]) {
    const solid = voxelGyroid(R, iso);
    let solidCnt = 0;
    for (let i = 0; i < R ** 3; i++) solidCnt += solid[i];
    const phi = 1 - solidCnt / R ** 3;
    // 界面面积：固-空相邻面计数 / bulk 体积（a=1 → Sv 单位 1/a）
    const idx = (x, y, z) => x + y * R + z * R * R;
    let faces = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const s = solid[idx(x, y, z)];
      if (x + 1 < R && solid[idx(x + 1, y, z)] !== s) faces++;
      if (y + 1 < R && solid[idx(x, y + 1, z)] !== s) faces++;
      if (z + 1 < R && solid[idx(x, y, z + 1)] !== s) faces++;
    }
    const sv = faces / R ** 3;
    const kFD = solveDarcyPermeability({ R, solid, tol: 1e-9, maxIter: 30000 }).kappaLU;
    const kKC = estimatePermeability(phi * 100, sv);
    const ratio = kFD / kKC;
    check(`φ=${phi.toFixed(2)} FD/K-C 比 ${ratio.toFixed(3)} ∈ [0.3, 3]`, ratio >= 0.3 && ratio <= 3, `kFD=${kFD.toExponential(3)} kKC=${kKC.toExponential(3)} Sv=${sv.toFixed(3)}`);
  }
}



console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
  if (passCount < 20) { console.error('GUARD FAIL: 断言执行数 ' + passCount + ' < 基线 20（恒真/集体跳过防护，2026-09-04 审查纳管）'); process.exit(1); }
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
