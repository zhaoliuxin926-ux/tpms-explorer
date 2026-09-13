// _verify_mode.mjs — 众数斜率验收：S3 攻击曲线 + 门禁标定曲线双跑（一次性）
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const PLATFORM = 'D:/GITHUB/tpms/tpms/tpms-platform';
const BUNDLE = join(tmpdir(), 'tpms_mode_verify.mjs');
{
  const entry = join(tmpdir(), 'tpms_mode_verify_entry.ts');
  writeFileSync(entry, ['export { fitExperimentalCurve, compensateToe, extractIso13314, parseCurve } from ' + JSON.stringify(join(PLATFORM, 'src/physics/experimental-fit.ts')) + ';'].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown fail'); process.exit(1); }
}
const { fitExperimentalCurve, parseCurve, compensateToe, extractIso13314 } = await import('file:///' + BUNDLE.replace(/\\/g, '/'));

// S3 攻击曲线（与补位攻防同构造：超长 Toe + 30σ 正弦毛刺，E* 真值 1200）
{
  const pts = [];
  for (let i = 0; i <= 600; i++) {
    const e = i * 0.001;
    let s;
    if (e < 0.15) s = 300 * e * e;
    else if (e < 0.19) s = 300 * 0.0225 + 1200 * (e - 0.15) + 15 * Math.sin((e - 0.15) * 200);
    else if (e < 0.5) s = 66 + 8 * (e - 0.19);
    else s = 66 + 8 * 0.31 + 20 * (Math.exp(16 * (e - 0.5)) - 1);
    pts.push([e, Math.max(0.2, s)]);
  }
  const r = fitExperimentalCurve({ text: pts.map(([x, y]) => x.toFixed(6) + ',' + y.toFixed(6)).join('\n') });
  console.log('S3 众数验收: E*=' + r.metrics.elasticModulusE.toFixed(1) + '（真值 1200，±5% 带 [1140,1260]）', Math.abs(r.metrics.elasticModulusE - 1200) / 1200 <= 0.05 ? '✓ PASS' : '✗ FAIL');
}
// 门禁标定曲线（无毛刺，E0=1200——众数不应扰动主链基线）
{
  const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const rng = mulberry32(20260913);
  const gauss = () => { const u = Math.max(1e-12, rng()), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const E0 = 1200, TOE_K = 60000;
  const sig = (e) => {
    if (e <= 0.01) return TOE_K * e * e;
    if (e <= 0.035) return TOE_K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * 30 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 1.2 * Math.sin(2 * Math.PI * 0.37 / 0.075) * Math.exp(-0.37 / 0.25) + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = [];
  for (let k = 0; k <= 500; k++) { const e = +(k * 0.001).toFixed(9); lines.push(e + ',' + (sig(e) + gauss() * 0.5)); }
  const p = parseCurve({ text: lines.join('\n') });
  const c = compensateToe(p.strain, p.stress);
  const M = extractIso13314(c.strain, c.stress, c.elasticModulus);
  console.log('主链基线: E*=' + c.elasticModulus.toFixed(1) + '（基线 1204.5，容差 ±1.5%）', Math.abs(c.elasticModulus - 1204.5) / 1204.5 <= 0.015 ? '✓ PASS' : '✗ DRIFT ' + c.elasticModulus.toFixed(1));
}
