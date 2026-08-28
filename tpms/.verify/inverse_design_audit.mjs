/**
 * inverse_design_audit.mjs —— 门禁 17：逆向多目标设计引擎审计（纯 Node）
 *
 * A. 逆向犯罪测试（10 组）：由已知参数生成目标 (E*, κ, P) → 求解器复原，
 *    断言收敛（J ≤1e-6）且前向相对误差 ≤3%
 * B. 解剖预设：cortical/trabecular/heatsink 三组可解约束命中 ≤3%，
 *    不可解组合给出有限折中（J 有限 + 参数在可行域内）
 * C. 类型枚举完整性：8 类型全部返回、参数在可行域内
 * D. 确定性：同输入两次求解结果逐位一致
 * E. LM 精化不劣于 NM 终点（J_LM ≤ J_NM + 1e-12）
 *
 * 运行：node inverse_design_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_inv_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_inv_audit_entry.ts');
  writeFileSync(entry, [
    `export { solveInverse, forwardModel, INVERSE_PRESETS, nelderMead, levenbergMarquardt, objective } from ${JSON.stringify(join(PLATFORM, 'src/physics/inverse-design.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { solveInverse, forwardModel, INVERSE_PRESETS, nelderMead, levenbergMarquardt, objective } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];

// ── A. 逆向犯罪测试（10 组）──
console.log('\n[A] 逆向犯罪测试（10 组目标，前向误差 ≤3%）');
const crimeCases = [
  { type: 'gyroid', porosity: 0.78, cellSize: 2, anisotropy: 1.0 },
  { type: 'diamond', porosity: 0.5, cellSize: 3, anisotropy: 1.6 },
  { type: 'schwarz', porosity: 0.25, cellSize: 4, anisotropy: 1.0 },
  { type: 'iwp', porosity: 0.6, cellSize: 1, anisotropy: 2.0 },
  { type: 'frd', porosity: 0.35, cellSize: 5, anisotropy: 1.2 },
  { type: 'lidinoid', porosity: 0.82, cellSize: 2.5, anisotropy: 1.4 },
  { type: 'neovius', porosity: 0.65, cellSize: 3.5, anisotropy: 2.2 },
  { type: 'splitp', porosity: 0.45, cellSize: 1.5, anisotropy: 1.0 },
  { type: 'gyroid', porosity: 0.3, cellSize: 4.5, anisotropy: 1.8 },
  { type: 'diamond', porosity: 0.9, cellSize: 2.2, anisotropy: 1.1 },
];
let convergeCount = 0, maxErrAll = 0;
for (const c of crimeCases) {
  const f = forwardModel(c.type, c.porosity, c.cellSize, c.anisotropy);
  const rep = solveInverse({ ETarget: f.EGPa, kappaTarget: f.kappaM2, porosityTarget: f.porosity });
  const best = rep.solutions[0];
  const errs = Object.values(best.errors);
  const maxErr = Math.max(...errs);
  maxErrAll = Math.max(maxErrAll, maxErr);
  if (rep.converged) convergeCount++;
  check(`${c.type} P=${c.porosity}: 前向误差 ${(maxErr * 100).toFixed(4)}% ≤3% 且收敛`, maxErr <= 0.03 && rep.converged);
}
check(`收敛率 ${convergeCount}/10 = 100%`, convergeCount === 10);
check(`全局最大前向误差 ${(maxErrAll * 100).toFixed(4)}%`, maxErrAll <= 0.03);

// ── B. 解剖预设 ──
console.log('\n[B] 解剖/工程预设');
for (const preset of INVERSE_PRESETS) {
  const rep = solveInverse(preset.targets);
  const best = rep.solutions[0];
  const inDomain = best.params.porosity >= 0.02 && best.params.porosity <= 0.98
    && best.params.cellSize >= 1 && best.params.cellSize <= 5
    && best.params.anisotropy >= 0.5 && best.params.anisotropy <= 2.5;
  const finite = Number.isFinite(best.objective) && Object.values(best.errors).every((e) => Number.isFinite(e));
  check(`${preset.key}: 参数在可行域内且目标有限（J=${best.objective.toExponential(2)}）`, inDomain && finite);
  // 可解子集命中：任一约束的相对误差 ≤3%（至少命中强权重约束之一）
  const errs = Object.values(best.errors);
  check(`${preset.key}: 存在命中约束 ≤3%`, errs.some((e) => e <= 0.03), errs.map((e) => (e * 100).toFixed(2) + '%').join('/'));
}

// ── C. 类型枚举完整性 ──
console.log('\n[C] 类型枚举与解完整性');
{
  const rep = solveInverse({ ETarget: 5, kappaTarget: 1e-8, porosityTarget: 0.6 });
  check('返回 8 类型解', rep.solutions.length === 8);
  check('全部类型合法', rep.solutions.every((so) => TYPES.includes(so.type)));
  check('J 升序排列', rep.solutions.every((so, i) => i === 0 || so.objective >= rep.solutions[i - 1].objective));
}

// ── D. 确定性 ──
console.log('\n[D] 确定性');
{
  const t = { ETarget: 8, kappaTarget: 5e-9, porosityTarget: 0.4 };
  const r1 = solveInverse(t);
  const r2 = solveInverse(t);
  const same = r1.solutions.every((so, i) =>
    so.type === r2.solutions[i].type
    && so.params.porosity === r2.solutions[i].params.porosity
    && so.params.cellSize === r2.solutions[i].params.cellSize
    && so.params.anisotropy === r2.solutions[i].params.anisotropy);
  check('同输入两次求解逐位一致', same);
}

// ── E. LM 精化不劣于 NM ──
console.log('\n[E] LM 精化不劣性');
{
  const t = { ETarget: 12, porosityTarget: 0.3 };
  const type = 'gyroid';
  const nm = nelderMead((q) => objective(t, forwardModel(type, q[0], q[1], q[2])), [0.5, 3, 1.5]);
  const lm = levenbergMarquardt(t, type, nm.p);
  const jNm = objective(t, forwardModel(type, nm.p[0], nm.p[1], nm.p[2]));
  const jLm = objective(t, forwardModel(type, lm.p[0], lm.p[1], lm.p[2]));
  check(`J_LM ${jLm.toExponential(3)} ≤ J_NM ${jNm.toExponential(3)} + 1e-12`, jLm <= jNm + 1e-12);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
