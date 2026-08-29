/**
 * levelset_optimizer_audit.mjs —— 门禁 36：水平集主动拓扑优化审计（纯 Node）
 *
 * A. 刚度目标：单位载荷柔度（1/reaction，位移控制口径折算）沿演化单调不增
 *    + 体积 Lagrange 约束有效（固相分数守住初始值 ±10%）
 * B. 流阻目标：演化后 FD-Darcy 渗透率提升（κ_final/κ_0 > 1.05）
 *    + 固相分数在保护带内
 * C. 水密提取：演化终态经 phiToVField → buildSurface(gpuVField) 注入管线
 *    ⇒ 开放边 = 0（等值面拓扑水密）
 * D. 再初始化质量：终态界面 |∇Φ| 均值 ∈ [0.85, 1.3]（符号距离性质）
 * E. 确定性：同输入两次演化柔度序列逐位一致
 *
 * 运行：node levelset_optimizer_audit.mjs
 */
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_ls_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_ls_audit_entry.ts');
  writeFileSync(entry, [
    `export { evolveLevelSet, phiToVField } from ${JSON.stringify(join(PLATFORM, 'src/core/levelset-optimizer.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { solveDarcyPermeability } from ${JSON.stringify(join(PLATFORM, 'src/physics/lbm-permeability.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const LS = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// gyroid 初始 Φ（R=14，solid = V < 0，双层 ±0.05 薄界面由再初始化归位）
const R = 14;
const phi0 = new Float64Array(R * R * R);
for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
  const x = ((ix + 0.5) / R) * 2 * Math.PI, y = ((iy + 0.5) / R) * 2 * Math.PI, z = ((iz + 0.5) / R) * 2 * Math.PI;
  const v = Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
  phi0[ix + iy * R + iz * R * R] = v < 0 ? 0.05 : -0.05;
}

console.log('\n[A] 刚度驱动：柔度单调 + 体积约束');
const resStiff = LS.evolveLevelSet({ R, phi0, steps: 8, wStiff: 1, wFlow: 0, reinitEvery: 8 });
{
  // 诚实口径：体素级敏感度的离散噪声带来 ≤0.5% 的局部回弹（实测 0.1%），
  // 断言容差 0.5%/步 + 总体下降非平凡。
  let mono = true;
  for (let i = 1; i < resStiff.compliance.length; i++) {
    if (resStiff.compliance[i] > resStiff.compliance[i - 1] * (1 + 0.005)) mono = false;
  }
  check(`柔度单调不增（0.5%/步容差：${resStiff.compliance.map((c) => c.toExponential(2)).join(' → ')}）`, mono);
  const sf = resStiff.solidFraction[resStiff.solidFraction.length - 1];
  const sf0 = resStiff.solidFraction[0];
  check(`体积约束：固相 ${sf0.toFixed(3)} → ${sf.toFixed(3)}（偏差 ${Math.abs(sf - sf0).toFixed(3)} ≤ 0.1）`,
    Math.abs(sf - sf0) <= 0.1);
  const drop = (1 - resStiff.compliance[resStiff.compliance.length - 1] / resStiff.compliance[0]) * 100;
  check(`柔度降幅 ${drop.toFixed(2)}% > 0.5%（非平凡优化）`, drop > 0.5);
}

console.log('\n[B] 流阻驱动：渗透率提升');
{
  const mask0 = new Uint8Array(R * R * R);
  for (let i = 0; i < mask0.length; i++) mask0[i] = phi0[i] > 0 ? 1 : 0;
  const kap0 = LS.solveDarcyPermeability({ R, solid: mask0, maxIter: 2000 });
  const mask1 = new Uint8Array(R * R * R);
  for (let i = 0; i < mask1.length; i++) mask1[i] = resStiff.phi[i] > 0 ? 1 : 0;
  void mask1;
  const resFlow = LS.evolveLevelSet({ R, phi0, steps: 8, wStiff: 0, wFlow: 1, reinitEvery: 8 });
  const mask2 = new Uint8Array(R * R * R);
  for (let i = 0; i < mask2.length; i++) mask2[i] = resFlow.phi[i] > 0 ? 1 : 0;
  const kap1 = LS.solveDarcyPermeability({ R, solid: mask2, maxIter: 2000 });
  const gain = kap1.kappaLU / kap0.kappaLU;
  check(`渗透率增益 κ ×${gain.toFixed(3)} > 1.05`, gain > 1.05);
  const sf = resFlow.solidFraction[resFlow.solidFraction.length - 1];
  check(`固相分数 ${sf.toFixed(3)} ∈ 保护带 [0.05, 0.95]`, sf >= 0.05 && sf <= 0.95);
}

console.log('\n[C] 水密提取（gpuVField 注入）');
{
  const vField = LS.phiToVField(resStiff.phi, R, 0);
  const res = LS.buildSurface({
    type: 'gyroid', iso: 0, periods: 2, resolution: R, targetPorosity: undefined,
    weights: [1, 1, 1, 0], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false,
    gpuVField: vField,
  });
  const open = new Map();
  const key = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
  const indices = res.indices ?? new Uint32Array(0);
  for (let i = 0; i < indices.length; i += 3) {
    const t = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const kk = key(t[e], t[(e + 1) % 3]);
      open.set(kk, (open.get(kk) ?? 0) + 1);
    }
  }
  let openCount = 0;
  for (const c of open.values()) if (c === 1) openCount++;
  check(`演化终态网格水密 open=${openCount}=0（顶点 ${res.vertCount}）`, openCount === 0 && res.vertCount > 0);
}

console.log('\n[D] 再初始化质量');
{
  check(`终态界面 |∇Φ| 均值 ${resStiff.gradNormMean.toFixed(3)} ∈ [0.85, 1.3]`,
    resStiff.gradNormMean >= 0.85 && resStiff.gradNormMean <= 1.3);
}

console.log('\n[E] 确定性');
{
  const res2 = LS.evolveLevelSet({ R, phi0, steps: 8, wStiff: 1, wFlow: 0, reinitEvery: 8 });
  let identical = true;
  for (let i = 0; i < resStiff.compliance.length; i++) {
    if (resStiff.compliance[i] !== res2.compliance[i]) identical = false;
  }
  check('同输入两次演化柔度序列逐位一致', identical);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
