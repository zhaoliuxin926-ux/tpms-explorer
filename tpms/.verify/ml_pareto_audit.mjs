/**
 * ml_pareto_audit.mjs —— 门禁 26：ML 代理 + Pareto 前沿审计（纯 Node）
 *
 * A. MLP 训练收敛：SGD 训练后 MSE 显著下降（≥10× 改善）
 * B. MLP 推理精度：训练后 MSE 相对训练前下降 ≥10×（演示口径；内插误差绝对
 *    口径未实现，2026-09-05 头注对齐实现）
 * C. Pareto 非支配性：前沿点不被任何点支配
 * D. Pareto 前沿单调性：前沿点数 > 0 且非支配性成立（样本量稳定性未实现，
 *    2026-09-05 头注对齐实现）
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
    `export { createMLP, mlpForward, trainMLP, paretoFront, nearestFrontCandidates } from ${JSON.stringify(join(PLATFORM, 'src/physics/ml-surrogate.ts'))};`,
    `export { forwardModel, forwardModelHybrid } from ${JSON.stringify(join(PLATFORM, 'src/physics/inverse-design.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { createMLP, mlpForward, trainMLP, paretoFront, nearestFrontCandidates, forwardModel, forwardModelHybrid } = await import(pathToFileURL(BUNDLE));

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

// ── E. hybrid 混合律代理退化锚（2026-10-04 Pareto hybrid 扫描钉）──
console.log('\n[E] forwardModelHybrid 退化锚');
{
  const fA = forwardModel('gyroid', 0.7, 3, 1);
  const fB = forwardModel('iwp', 0.7, 3, 1);
  const h0 = forwardModelHybrid('gyroid', 'iwp', 0, 0.7, 3);
  const h1 = forwardModelHybrid('gyroid', 'iwp', 1, 0.7, 3);
  const hMid = forwardModelHybrid('gyroid', 'iwp', 0.5, 0.7, 3);
  check('b=0 严格退化 ≡ 族 A（E/Sv/κ 逐位）', h0.EGPa === fA.EGPa && h0.svRatio === fA.svRatio && h0.kappaM2 === fA.kappaM2);
  check('b=1 严格退化 ≡ 族 B（E/Sv/κ 逐位）', h1.EGPa === fB.EGPa && h1.svRatio === fB.svRatio && h1.kappaM2 === fB.kappaM2);
  const svMid = (fA.svRatio + fB.svRatio) / 2;
  const kcMid = Math.pow(0.7, 3) / (5 * svMid * svMid) * 1e-6;
  check('κ 以混合 Sv 经 Kozeny-Carman 重算（中点自洽）', Math.abs(hMid.kappaM2 - kcMid) < 1e-18, `${hMid.kappaM2.toExponential(3)} vs ${kcMid.toExponential(3)}`);
  check('E 线性凸组合（中点=均值）', Math.abs(hMid.EGPa - (fA.EGPa + fB.EGPa) / 2) < 1e-12);
}

// ── F. 逆设计推荐 nearestFrontCandidates（2026-10-05 Pareto 逆设计入口钉）──
console.log('\n[F] nearestFrontCandidates 逆设计推荐');
{
  const pts = [
    { E: 1, kappa: 5e-9, sea: 10, type: 'gyroid', porosity: 0.85, cellSize: 2 },
    { E: 2, kappa: 2e-9, sea: 12, type: 'diamond', porosity: 0.8, cellSize: 2 },
    { E: 4, kappa: 8e-10, sea: 15, type: 'iwp', porosity: 0.75, cellSize: 2 },
    { E: 3, kappa: 0.2, sea: 15, type: 'iwp', porosity: 0.75, cellSize: 3 },
  ];
  const front = paretoFront(pts);
  check('fixture 前沿非空', front.length > 0);
  // 退化锚：目标=某前沿点坐标 → 第一推荐=该点且 dist≈0
  const anchor = front[0];
  const r0 = nearestFrontCandidates(front, anchor.E, anchor.kappa, 3);
  check('退化锚：目标=前沿点自身 → 第一推荐=该点（dist≈0）',
    r0.length > 0 && r0[0].point === anchor && Math.abs(r0[0].dist) < 1e-12);
  // 距离公式手算对拍：目标(10, 1e-8) 对 anchor 的 log10 欧氏距离
  const r1 = nearestFrontCandidates(front, 10, 1e-8, 3);
  const expect = Math.hypot(Math.log10(anchor.E) - 1, Math.log10(anchor.kappa) - (-8));
  const hit = r1.find((t) => t.point === anchor);
  check('距离=log10 双目标欧氏（手算对拍）', !!hit && Math.abs(hit.dist - expect) < 1e-12,
    `${hit ? hit.dist.toExponential(3) : '未命中'} vs ${expect.toExponential(3)}`);
  // 距离序单调非降 + k 截断
  const mono = r1.every((t, i) => i === 0 || r1[i - 1].dist <= t.dist + 1e-12);
  check('返回按距离单调非降', r1.length > 1 && mono);
  check('k=3 截断（≤3 且 ≤front 数）', r1.length <= 3 && r1.length <= front.length);
  check('k=1 返回单候选', nearestFrontCandidates(front, 10, 1e-8, 1).length === 1);
  // fail-closed：非法目标（NaN/0/负/Infinity）→ 空数组
  check('非法目标 fail-closed：NaN/0/负/∞ → []',
    nearestFrontCandidates(front, NaN, 1e-9).length === 0 &&
    nearestFrontCandidates(front, 0, 1e-9).length === 0 &&
    nearestFrontCandidates(front, 2, -1e-9).length === 0 &&
    nearestFrontCandidates(front, Infinity, 1e-9).length === 0);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
  if (passCount < 16) { console.error('GUARD FAIL: 断言执行数 ' + passCount + ' < 基线 16（恒真/集体跳过防护；2026-10-04 +4 hybrid 退化锚；2026-10-05 +7 逆设计推荐）'); process.exit(1); }
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
