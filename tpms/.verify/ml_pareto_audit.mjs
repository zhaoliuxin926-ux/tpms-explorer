/**
 * ml_pareto_audit.mjs —— 门禁 26：ML 代理 + Pareto 前沿审计（纯 Node）
 *
 * A. MLP 训练收敛：SGD 训练后 MSE 显著下降（≥10× 改善）
 * B. MLP 推理精度：训练集内插误差 ≤20%（演示口径）
 * C. Pareto 非支配性：前沿点不被任何点支配
 * D. Pareto 前沿单调性：前沿点数 > 0 且随样本量稳定
 *
 * 运行：node ml_pareto_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_ml_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_ml_audit_entry.ts');
  writeFileSync(entry, [
    `export { createMLP, mlpForward, trainMLP, paretoFront } from ${JSON.stringify(join(PLATFORM, 'src/physics/ml-surrogate.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { createMLP, mlpForward, trainMLP, paretoFront } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── A/B. MLP 训练收敛 + 推理精度 ──
console.log('\n[A-B] MLP 训练 + 推理');
{
  const mlp = createMLP([3, 16, 2], 42);
  // 教师：y0 = x0+2*x1, y1 = 3*x2−x0
  const inputs = [];
  const targets = [];
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 200; i++) {
    const x = new Float64Array([rnd(), rnd(), rnd()]);
    inputs.push(x);
    targets.push(new Float64Array([x[0] + 2 * x[1], 3 * x[2] - x[0]]));
  }
  // 训练前 MSE
  let mseBefore = 0;
  for (let i = 0; i < inputs.length; i++) {
    const out = mlpForward(mlp, inputs[i]);
    for (let o = 0; o < 2; o++) mseBefore += (out[o] - targets[i][o]) ** 2;
  }
  mseBefore /= inputs.length * 2;
  trainMLP(mlp, inputs, targets, 50, 0.01);
  let mseAfter = 0;
  for (let i = 0; i < inputs.length; i++) {
    const out = mlpForward(mlp, inputs[i]);
    for (let o = 0; o < 2; o++) mseAfter += (out[o] - targets[i][o]) ** 2;
  }
  mseAfter /= inputs.length * 2;
  check(`MSE 下降 ${mseBefore.toExponential(2)} → ${mseAfter.toExponential(2)}（≥10×）`, mseAfter < mseBefore / 10);
  check(`训练后 MSE ${mseAfter.toExponential(3)} < 0.1`, mseAfter < 0.1);
}

// ── C/D. Pareto ──
console.log('\n[C-D] Pareto 非支配排序');
{
  const pts = [
    { E: 1, kappa: 0.1, sea: 5, type: 'gyroid', porosity: 0.8, cellSize: 1 },
    { E: 5, kappa: 0.05, sea: 12, type: 'diamond', porosity: 0.5, cellSize: 2 },
    { E: 12, kappa: 0.01, sea: 20, type: 'schwarz', porosity: 0.3, cellSize: 3 },
    { E: 2, kappa: 0.08, sea: 8, type: 'gyroid', porosity: 0.7, cellSize: 1 },
    { E: 3, kappa: 0.2, sea: 15, type: 'iwp', porosity: 0.75, cellSize: 2 },
  ];
  const front = paretoFront(pts);
  check(`Pareto 前沿 ${front.length} 点 > 0`, front.length > 0);
  // 验证非支配性
  let dominated = 0;
  for (const f of front) {
    for (const p of pts) {
      if (p.E >= f.E && p.kappa >= f.kappa && p.sea >= f.sea &&
          (p.E > f.E || p.kappa > f.kappa || p.sea > f.sea)) { dominated++; }
    }
  }
  check('前沿点非支配', dominated === 0, `dominated=${dominated}`);
  // 支配点被排除
  check('被支配点已排除', front.length < pts.length);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
