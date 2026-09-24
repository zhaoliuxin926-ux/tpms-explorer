#!/usr/bin/env node
// virtual-calibration.mjs — synthetic prediction-vs-fit closed loop (NOT physical test)
// Purpose: prove the report pipeline works end-to-end until lab CSV exists.
// Usage: node tpms/agent/virtual-calibration.mjs [--porosity 0.6] [--defect 0.72]

const args = process.argv.slice(2);
const num = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const porosity = Math.min(0.98, Math.max(0.02, num('--porosity', 0.6)));
const defect = Math.min(1, Math.max(0.3, num('--defect', 0.72)));
const rho = 1 - porosity;

const C1 = 0.38, C2 = 0.3;
const Es = 110e3, Ss = 880;
const E_analytic = C1 * rho ** 2 * Es;
const S_analytic = C2 * rho ** 1.5 * Ss;
const E_print = E_analytic * defect;

function synthCurve() {
  const strain = [], stress = [];
  for (let i = 0; i <= 400; i++) {
    const s = i * 0.0005;
    strain.push(s);
    const toe = 0.002;
    const e = Math.max(0, s - toe);
    let sig;
    if (e < 0.012) sig = E_print * e;
    else if (e < 0.35) sig = E_print * 0.01 + S_analytic * defect * 0.15 * (e - 0.01);
    else sig = E_print * 0.01 + S_analytic * defect * 0.15 * 0.34 + E_print * 0.05 * (e - 0.35) ** 1.5;
    stress.push(Math.max(0, sig));
  }
  return { strain, stress };
}

const { strain, stress } = synthCurve();
// 线性段斜率（0.4%–1.0% 应变），不过原点以免 toe 污染
let eFit = 0;
for (let i = 1; i < strain.length; i++) {
  if (strain[i] >= 0.004 && strain[i] <= 0.01 && i > 0) {
    const de = strain[i] - strain[i - 1];
    const ds = stress[i] - stress[i - 1];
    if (de > 0) eFit = Math.max(eFit, ds / de);
  }
}
const plateau = stress.slice(200, 300).reduce((a, b) => a + b, 0) / 100;
const rec = eFit / E_print;

const md = [
  '# 虚拟标定闭环（SYNTHETIC · 非实机）',
  '',
  '> 合成曲线，验证「GA 预测 → 曲线 → 提取 → 标定比」报告链。**不是**物理试验。',
  '> 真机回填：`docs/YOUR_10_MIN.md` §2。',
  '',
  `porosity=${porosity}  defect=${defect}  rho=${rho.toFixed(3)}`,
  '',
  '| 量 | 解析 GA | 合成打印 | 提取 |',
  '|---|---|---|---|',
  `| E (MPa) | ${E_analytic.toFixed(1)} | ${E_print.toFixed(1)} | ${eFit.toFixed(1)} |`,
  `| σpl≈ (MPa) | ${S_analytic.toFixed(1)} | ${(S_analytic * defect).toFixed(1)} | ${plateau.toFixed(1)} |`,
  '',
  `缺陷恢复比 print/extract = **${rec.toFixed(3)}**（期望≈1，链路自洽）`,
  '',
].join('\n');

import { writeFileSync } from 'node:fs';
writeFileSync('docs/VIRTUAL_CALIBRATION.md', md, 'utf8');
console.log('WROTE docs/VIRTUAL_CALIBRATION.md');
console.log('recovery', rec.toFixed(3));
process.exit(Math.abs(rec - 1) < 0.15 ? 0 : 1);
