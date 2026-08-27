/**
 * homogenization_audit.mjs —— RVE 均质化与方向模量审计（第十道 CI 门，阶段 II）
 *
 * 守护对象：physics/homogenization.ts（解析路线：Voigt–Reuss 精确界 + 方向模量
 * E(n) = 1/(nᵢnⱼnₖnℓSᵢⱼₖₗ) + 球面采样）与 gibson-ashby.estimateAnisotropicStiffness
 * （迂曲度调制方向刚度，UI 的 E(n) 数据源）的一致性。
 *
 * 交付形态说明：体素 FE 数值均质化经开发期实测判定研究受阻（均值漂移泊松污染
 * −18%、高对比 CG 舍入崩溃 1e+120、均值钉扎 φ·C0 盲区——机理归档 bugs.md），
 * 按宪章自愈协议切换解析路线。本门禁断言解析量全部可精确验证的属性。
 *
 * 运行：node homogenization_audit.mjs
 */

import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_homo_audit_bundle.mjs');
{
  const entry = join(tmpdir(), `tpms_homo_audit_entry_${process.pid}.ts`);
  writeFileSync(entry, [
    `export { vrhBounds, directionalModulus, sampleDirectionalGrid, baseCompliance, orthotropicCompliance, baseStiffness } from ${JSON.stringify(join(PLATFORM, 'src/physics/homogenization.ts'))};`,
    `export { estimateAnisotropicStiffness } from ${JSON.stringify(join(PLATFORM, 'src/physics/gibson-ashby.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
}
const { vrhBounds, directionalModulus, sampleDirectionalGrid, baseCompliance, orthotropicCompliance, baseStiffness, estimateAnisotropicStiffness } = await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (name, detail = '') => { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); };

const C0_11 = baseStiffness(0.3)[0];
const C0_44 = baseStiffness(0.3)[21];

// ────────────────────────────── A. Voigt–Reuss 精确界 ──────────────────────────────
console.log('\n[A] Voigt–Reuss 解析界（E0=1、ν=0.3）');
{
  // 基体常数：λ = 0.5769231、μ = 0.3846154、k0 = λ+2μ/3 = 0.8333333
  const k0 = 0.3 / (1.3 * 0.4) + 2 / (3 * 2.6);
  const mu0 = 1 / 2.6;
  const b1 = vrhBounds(1, 0.3);   // 全实：C_V = C0
  Math.abs(b1.cV11 - C0_11) < 1e-12 && Math.abs(b1.cV44 - C0_44) < 1e-12
    ? ok('φ=1 Voigt = C0 精确', `cV11=${b1.cV11.toFixed(9)}`)
    : bad('φ=1 Voigt', `${b1.cV11}`);
  Math.abs(b1.kv - k0) < 1e-12 && Math.abs(b1.gv - mu0) < 1e-12
    ? ok('φ=1 k_V=k0、g_V=μ0 精确', `kv=${b1.kv.toFixed(9)}`)
    : bad('φ=1 kv/gv', `${b1.kv} ${b1.gv}`);
  const b05 = vrhBounds(0.5, 0.3);
  Math.abs(b05.cV11 - 0.5 * C0_11) < 1e-12 && b05.kR === 0 && b05.gR === 0
    ? ok('φ=0.5 Voigt 线性标度 + 真孔隙 Reuss=0')
    : bad('φ=0.5 VRH', JSON.stringify(b05));
  const b0 = vrhBounds(0, 0.3);
  b0.cV11 === 0 && b0.kv === 0
    ? ok('φ=0 Voigt = 0（边界退化）')
    : bad('φ=0 VRH');
  // φ 扫描线性性
  let linOk = true;
  for (const phi of [0.1, 0.25, 0.4, 0.7, 0.9]) {
    const b = vrhBounds(phi, 0.3);
    if (Math.abs(b.cV11 - phi * C0_11) > 1e-12) linOk = false;
  }
  linOk ? ok('Voigt 随 φ 严格线性（5 点）') : bad('Voigt 线性性');
}


// ────────────────────────────── B. 方向模量 ──────────────────────────────
console.log('\n[B] 方向模量 E(n)');
{
  // 各向同性：基体柔度下 E(n) ≡ E0（任意方向）
  const S0 = baseCompliance(0.3);
  let worst = 0;
  for (const [x, y, z] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 1, 1], [1, 2, 3], [-1, 0.5, 2]]) {
    const n = Math.hypot(x, y, z);
    const e = directionalModulus(S0, x / n, y / n, z / n);
    worst = Math.max(worst, Math.abs(e - 1));
  }
  worst < 1e-12
    ? ok('各向同性基体 E(n) ≡ E0（7 方向精确）', `maxΔ=${worst.toExponential(1)}`)
    : bad('各向同性 E(n)', `maxΔ=${worst}`);
  // 正交各向异性：E(100)=E1、E(010)=E2、E(001)=E3 精确
  const S = orthotropicCompliance(1.0, 1.2, 0.9, 0.3);
  const e1 = directionalModulus(S, 1, 0, 0);
  const e2 = directionalModulus(S, 0, 1, 0);
  const e3 = directionalModulus(S, 0, 0, 1);
  Math.abs(e1 - 1) < 1e-12 && Math.abs(e2 - 1.2) < 1e-12 && Math.abs(e3 - 0.9) < 1e-12
    ? ok('正交各向异性主轴 E 精确（1.0/1.2/0.9）')
    : bad('正交主轴 E', `${e1} ${e2} ${e3}`);
  // 立方等价方向一致
  const Sc = orthotropicCompliance(1, 1, 1, 0.3);
  const c1 = directionalModulus(Sc, 1, 0, 0), c2 = directionalModulus(Sc, 0, 1, 0), c3 = directionalModulus(Sc, 0, 0, 1);
  Math.abs(c1 - c2) < 1e-12 && Math.abs(c2 - c3) < 1e-12
    ? ok('立方等价方向 E 一致')
    : bad('立方方向一致');
}

// ────────────────────────────── C. 球面采样 ──────────────────────────────
console.log('\n[C] E(n) 球面采样');
{
  const S = orthotropicCompliance(1.0, 1.2, 0.9, 0.3);
  const grid = sampleDirectionalGrid(S, 24, 48);
  grid.E.length === 25 * 48 && grid.emax >= grid.emin && grid.emin > 0 && Number.isFinite(grid.emax)
    ? ok('采样器尺寸与值域', `E∈[${grid.emin.toFixed(3)}, ${grid.emax.toFixed(3)}]`)
    : bad('采样器', `${grid.E.length}`);
  // 各向同性采样：极值应相等（E 恒定）
  const gridIso = sampleDirectionalGrid(baseCompliance(0.3), 12, 24);
  Math.abs(gridIso.emax - gridIso.emin) < 1e-12
    ? ok('各向同性采样极值恒定')
    : bad('各向同性采样极值', `${gridIso.emin} ${gridIso.emax}`);
  // 正交各向异性：极值应达到主轴值（采样网格含极角 0/π → (001) 方向）
  Math.abs(gridIso.emax - gridIso.emin) < 1e-12;
  const hasE1 = grid.E.some((v) => Math.abs(v - 1.0) < 1e-5);   // Float32 精度容差
  const hasE3 = grid.E.some((v) => Math.abs(v - 0.9) < 1e-5);
  hasE1 && hasE3 ? ok('采样网格覆盖主轴值（E1、E3 极点）') : bad('主轴值覆盖');
}

// ────────────────────────────── D. 与 UI 数据源一致性 ──────────────────────────────
console.log('\n[D] UI 数据源一致性（estimateAnisotropicStiffness → E(n)）');
{
  // τ 各向同性时：E_x=E_y=E_z → E(n) 恒定 = E 值
  const st = estimateAnisotropicStiffness(0.25, 'gyroid');
  const S = orthotropicCompliance(st.E[0], st.E[1], st.E[2], 0.3);
  const e100 = directionalModulus(S, 1, 0, 0);
  const e010 = directionalModulus(S, 0, 1, 0);
  const e001 = directionalModulus(S, 0, 0, 1);
  Math.abs(e100 - st.E[0]) < 1e-9 && Math.abs(e010 - st.E[1]) < 1e-9 && Math.abs(e001 - st.E[2]) < 1e-9
    ? ok('UI 张量→E(n) 主轴一致', `E=${st.E.map((v) => v.toFixed(3)).join('/')}`)
    : bad('UI E(n) 主轴', `${e100} ${e010} ${e001}`);
  // 物理量级：0.25 相对密度 gyroid E*/E0 在 Gibson-Ashby 合理带 (0.005, 0.2)
  st.E[0] > 0.005 && st.E[0] < 0.2
    ? ok('gyroid ρ=0.25 E* 量级合理（Gibson-Ashby 带）', `E*=${st.E[0].toFixed(4)}`)
    : bad('E* 量级', `${st.E[0]}`);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
