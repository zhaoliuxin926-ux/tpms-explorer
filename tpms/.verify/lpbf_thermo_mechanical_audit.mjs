/**
 * lpbf_thermo_mechanical_audit.mjs —— 门禁 30：LPBF 热-力耦合预测（v6.0 阶段 IV）
 *
 * A. 显式瞬态热传导能量守恒 ≤0.5%（绝热边界 + Jacobi 双缓冲守恒口径）
 * B. 熔化达成与熔池体积（peakT ≥ Tm）
 * C. 冷却参数落文献带：R ∈ [1e6, 1e9] K/s；G×R ∈ [1e14, 1e17] K²/s
 * D. 残余应力公式精确核对（α·E·ΔT·C 屈服封顶）+ 翘曲工程区间
 * E. 工艺窗口三态（能量不足/键合良好/过高）
 * F. CFL 稳定性守卫
 *
 * 运行：node lpbf_thermo_mechanical_audit.mjs
 */

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

function bundle(exportLines, name) {
  const entry = join(tmpdir(), `lpbf30_${name}_entry.ts`);
  writeFileSync(entry, exportLines.join('\n'));
  const out = join(tmpdir(), `lpbf30_${name}_bundle.mjs`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
  return out;
}

const m = await import(pathToFileURL(bundle([
  `export { simulateLPBF, assessProcessWindow, TI64 } from ${JSON.stringify(join(PLATFORM, 'src/physics/lpbf-thermo-mechanical.ts'))};`,
], 'lpbf')));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ══ A+B. 能量守恒 + 熔化 ══
console.log('\n[A+B] 能量守恒与熔化（200W · 0.8m/s · N=32）');
const res = m.simulateLPBF({ N: 32, dx: 25e-6, power: 200, speed: 0.8, totalTime: 1.2e-3 });
{
  check(`能量台账平衡 ≤0.5%（实测 ${(res.energyBalance * 100).toFixed(4)}%）`, res.energyBalance <= 0.005);
  check(`峰值温度达熔点以上（${res.peakTemperature.toFixed(0)}K ≥ 1933K）`, res.peakTemperature >= m.TI64.Tm);
  check(`熔池非空（${res.meltPoolVoxels} 体素）`, res.meltPoolVoxels > 0);
  check(`沸点封顶生效（${res.peakTemperature.toFixed(0)}K ≤ 3600K）`, res.peakTemperature <= 3600.0001);
  check('CFL 稳定', res.stability.ok, `cfl=${res.stability.cfl.toFixed(4)}`);
}

// ══ C. 冷却参数文献带 ══
console.log('\n[C] 冷却参数文献带');
{
  check(`冷却速率 R ∈ [1e6, 1e9] K/s（实测 ${res.coolingRate.toExponential(2)}）`,
    res.coolingRate >= 1e6 && res.coolingRate <= 1e9);
  check(`G×R ∈ [1e14, 1e17] K²/s（实测 ${res.gR.toExponential(2)}）`,
    res.gR >= 1e14 && res.gR <= 1e17);
  check('热梯度为正', res.thermalGradient > 0);
}

// ══ D. 残余应力与翘曲 ══
console.log('\n[D] 残余应力与翘曲');
{
  check(`残余应力 ≤ σy（${(res.residualStress / 1e6).toFixed(0)} ≤ 880 MPa）`, res.residualStress <= m.TI64.sigmaY + 1);
  check('残余应力非负', res.residualStress >= 0);
  // 公式核对：σ = min(α·E·ΔT_eff·C, σy)
  const dTeff = Math.min(res.peakTemperature, m.TI64.Tm) - 353;
  const expect = Math.min(m.TI64.alpha * m.TI64.E * dTeff * 0.6, m.TI64.sigmaY);
  check('残余应力公式精确核对', Math.abs(res.residualStress - expect) < 1e-6, `${res.residualStress} vs ${expect}`);
  check(`翘曲在工程区间 [0.01µm, 0.5mm]（实测 ${(res.distortion * 1e6).toFixed(2)}µm）`,
    res.distortion >= 1e-8 && res.distortion <= 5e-4);
}

// ══ E. 工艺窗口三态 ══
console.log('\n[E] 工艺窗口评估');
{
  check('200W → 键合良好', m.assessProcessWindow(200, 0.8, 30e-6) === '键合良好');
  check('60W → 能量不足', m.assessProcessWindow(60, 0.8, 30e-6) === '能量不足（未熔合风险）');
  check('500W/0.3 → 能量过高', m.assessProcessWindow(500, 0.3, 30e-6) === '能量过高（球化/气孔风险）');
  check('结果内窗口与参数自洽', res.window === m.assessProcessWindow(200, 0.8, 30e-6));
}

// ══ F. 网格无关性（守恒不随 N 漂移）══
console.log('\n[F] 网格无关性');
{
  const r20 = m.simulateLPBF({ N: 20, dx: 25e-6, power: 200, speed: 0.8, totalTime: 1.2e-3 });
  check(`N=20 能量平衡同样 ≤0.5%（实测 ${(r20.energyBalance * 100).toFixed(4)}%）`, r20.energyBalance <= 0.005);
  const peakDiff = Math.abs(r20.peakTemperature - res.peakTemperature);
  check(`沸点封顶跨网格稳定（ΔT=${peakDiff.toFixed(1)}K）`, peakDiff <= 1);
}

console.log(`\n== RESULT: ${passCount} PASS / ${failCount} FAIL ==`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
