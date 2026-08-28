/**
 * impact_modal_audit.mjs —— 门禁 20：动态冲击吸能（SEA）与振动模态审计（纯 Node）
 *
 * A. 物理区间：8 类曲面 × 相对密度 {0.15, 0.3, 0.45} 的 SEA ∈ [5, 60] J/g
 * B. 密实化应变：ε_d = 1 − 1.4ρ̄ 解析一致 + 单调递减 + 界内
 * C. 吸能效率：η(ε_d) ∈ (0, 1]；平台应力与 C2·σys·ρ̄^1.5 同源
 * D. 模态：前 6 阶升序、全正；正交对称（x/y 两向弯曲频率对相等）；f 随 ρ̄ 递增（√ρ̄ 标度）
 * E. 峰值应力：σ_peak = 1.2·σ_pl 一致性
 * F. 理论-仿真对比矩阵兼容：SEA 与对比模板字段口径（J/g 与 comparison_template 一致）
 *
 * 运行：node impact_modal_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_impact_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_impact_audit_entry.ts');
  writeFileSync(entry, [
    `export { computeCrush, computeModal, energyEfficiency, RHO_S_GCMM3, E0_GPA } from ${JSON.stringify(join(PLATFORM, 'src/physics/impact-energy.ts'))};`,
    `export { buildVerificationSuite } from ${JSON.stringify(join(PLATFORM, 'src/export/verification-suite.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { computeCrush, computeModal, energyEfficiency, buildVerificationSuite } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const DENSITIES = [0.15, 0.3, 0.45];

// ── A. SEA 物理区间 ──
console.log('\n[A] SEA ∈ [5, 60] J/g（8 类 × 3 密度）');
{
  let inRange = 0, total = 0;
  const oob = [];
  for (const type of TYPES) {
    for (const rho of DENSITIES) {
      const cr = computeCrush(rho, type);
      total++;
      if (cr.seaJPerG >= 5 && cr.seaJPerG <= 60) inRange++;
      else oob.push(`${type}@${rho}=${cr.seaJPerG.toFixed(1)}`);
    }
  }
  check(`SEA 合区间 ${inRange}/${total}`, inRange === total, oob.join(', '));
}

// ── B. 密实化应变 ──
console.log('\n[B] 密实化应变 ε_d = 1 − 1.4ρ̄');
{
  let ok = true;
  let prev = Infinity;
  for (const rho of DENSITIES) {
    const cr = computeCrush(rho, 'gyroid');
    const expect = Math.max(0.05, Math.min(0.85, 1 - 1.4 * rho));
    if (Math.abs(cr.epsilonD - expect) > 1e-12) ok = false;
    if (cr.epsilonD >= prev) ok = false;   // 随 ρ̄ 递减
    prev = cr.epsilonD;
  }
  check('解析一致 + 单调递减', ok);
}

// ── C. 效率与平台应力 ──
console.log('\n[C] 吸能效率与平台应力');
{
  const cr = computeCrush(0.3, 'gyroid');
  check(`η(ε_d) ∈ (0,1]（${cr.etaAtEpsilonD.toFixed(3)}）`, cr.etaAtEpsilonD > 0 && cr.etaAtEpsilonD <= 1);
  // 平台应力同源：σ_pl = 0.3·880·ρ̄^1.5（C2 与 gibson-ashby.ts 一致）
  const expect = 0.3 * 880 * Math.pow(0.3, 1.5);
  check(`σ_pl 同源（${cr.sigmaPl.toFixed(2)} vs ${expect.toFixed(2)} MPa）`, Math.abs(cr.sigmaPl - expect) < 1e-9);
  // 效率函数可用
  const eta = energyEfficiency(0.3, 0.3, 'gyroid');
  check(`η(0.3) 有限正值（${eta.toFixed(3)}）`, Number.isFinite(eta) && eta > 0);
}

// ── D. 模态 ──
console.log('\n[D] 前 6 阶模态 + 正交对称性');
{
  let allOk = true;
  for (const type of TYPES) {
    const md = computeModal(0.3, type, 30);
    if (md.frequenciesHz.length !== 6) allOk = false;
    if (md.frequenciesHz.some((f) => !(f > 0))) allOk = false;
    for (let i = 1; i < 6; i++) if (md.frequenciesHz[i] < md.frequenciesHz[i - 1]) allOk = false;
  }
  check('8 类曲面：6 阶升序全正', allOk);
  // 正交对称：x/y 两向弯曲频率精确相等（方形截面对称性）⇒ 频谱必含重根
  const md = computeModal(0.3, 'gyroid', 30);
  let dupPair = 0;
  {
    const seen = new Map();
    for (const f of md.frequenciesHz) {
      const key = f.toFixed(9);
      const c = (seen.get(key) ?? 0) + 1;
      seen.set(key, c);
      dupPair = Math.max(dupPair, c);
    }
  }
  check(`正交简并对（最大重根数 ${dupPair} ≥ 2）`, dupPair >= 2, md.frequenciesHz.map((f) => f.toFixed(1)).join(','));
  // f 随 ρ̄ 递增（f ∝ √(E*/ρ*) ∝ √ρ̄）
  const f1a = computeModal(0.15, 'gyroid', 30).f1;
  const f1b = computeModal(0.45, 'gyroid', 30).f1;
  check(`f1 随 ρ̄ 递增（${f1a.toFixed(0)} → ${f1b.toFixed(0)} Hz）`, f1b > f1a);
  // 标度：等效梁 E∝ρ̄² ⇒ f ∝ √(E/ρ) ∝ √ρ̄，比值 = √(0.45/0.15) = √3
  const scale = f1b / f1a;
  check(`√(E/ρ) 标度（比值 ${scale.toFixed(4)} ≈ √3 = 1.7321）`, Math.abs(scale - Math.sqrt(3)) < 0.01);
}

// ── E. 峰值一致性 ──
console.log('\n[E] 峰值压溃应力一致性');
{
  const cr = computeCrush(0.3, 'diamond');
  check(`σ_peak = 1.2·σ_pl（${cr.sigmaPeak.toFixed(1)} vs ${cr.sigmaPl.toFixed(1)}）`, Math.abs(cr.sigmaPeak - 1.2 * cr.sigmaPl) < 1e-9);
}

// ── F. 对比矩阵口径 ──
console.log('\n[F] 对比矩阵字段兼容');
{
  const tpl = buildVerificationSuite({ type: 'gyroid', solidCount: 1, voidCount: 1 })['comparison_template.csv'];
  check('模板含 sea 与 f1_Hz 字段（与本模块单位 J/g、Hz 一致）', tpl.includes('sea,J/g') && tpl.includes('f1_Hz,Hz'));
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
