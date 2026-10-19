#!/usr/bin/env node
/**
 * llm_driver_selftest.mjs —— M4 闭环驱动器验收（离线 Mock 决策 + 真实 verify 执行）
 *
 * 验收口径（ROADMAP M4）：注入带故意缺陷的初始方案，Agent 在有限轮内凭门禁反馈收敛 PASS，
 * 或结构化宣告不可达；修复决策由 Mock 队列确定性给出（真实 LLM 抽测另行）。
 *
 * 覆盖：
 *  1. 参数层缺陷（porosity 1.5）→ patch 修正 → PASS
 *  2. 梯外修复（fcks R96 薄壁自触）→ 升 resolution 120 → PASS（verify 梯内无此修复）
 *  3. 降周期数修复（gprime k6 R96 薄壁自触）→ periods 2 → PASS
 *  4. 不可达宣告（cylinder+diamond 深水区）→ 结构化 unreachable（exit 3）
 *  5. 非法修复决策（type='warpdrive'）→ 拦截器拒绝（exit 2）
 *  6. 轮数耗尽（无效 patch 反复）→ max_rounds（exit 4）+ 原始设计文件全程未被改写
 *
 * 2026-10-19 批次 A5（Codex 审计）：错误路径改可控故障注入——经 TPMS_AGENT_TPMS_BIN
 * 注入确定性夹具子进程（pareto 罐头推荐 / mesh 按 cand 序号脚本化退出 / 慢子进程 /
 * overhang 可控失败），不再依赖"某几何族恰好不可产"承载错误路径覆盖：
 *  11. --top 非法=stdout JSON+exit2（曾 TDZ 裸崩）  12. 推荐失败=failed/exit1
 *  13. 拒产顺延（exit3→下一候选）  14. 全拒产=unreachable/exit3（候选用尽）
 *  15. wall 预算钳制慢子进程（budget-exhausted/exit4，秒回不穿透）
 *  16. 末步悬垂失败=failed/exit1（STL 保留）  17. --pick 越界=JSON+exit2
 *  18. --max-wall-ms 浮点=JSON+exit2（整数契约，曾 ERR_OUT_OF_RANGE 裸崩）
 *  19. 子进程输出超限=failed/exit1 不冒充预算耗尽（跨 Node：ENOBUFS/静默截断两实现）
 *
 * 运行：node llm_driver_selftest.mjs   （真实构建约 3~6 分钟）
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, 'tpms-driver.mjs');
const work = mkdtempSync(join(tmpdir(), 'm4selftest-'));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' — ' + detail}`); };

function drive(designObj, decisions, maxRounds = 6) {
  const designFile = join(work, `d${pass + fail + 1}.json`);
  const original = JSON.stringify(designObj, null, 2);
  writeFileSync(designFile, original);
  const env = { ...process.env, TPMS_DRIVER_MOCK_DECISIONS: JSON.stringify(decisions) };
  const r = spawnSync(process.execPath, [DRIVER, '--design', designFile, '--provider', 'mock', '--max-rounds', String(maxRounds), '--json'], {
    encoding: 'utf8', timeout: 420_000, maxBuffer: 32 * 1024 * 1024, env,
  });
  let report = null;
  try { report = JSON.parse(r.stdout ?? ''); } catch { /* 非 JSON（crash/拒绝路径） */ }
  const untouched = readFileSync(designFile, 'utf8') === original;
  return { exit: r.status, report, stderr: r.stderr ?? '', untouched, designFile };
}

// 1. 参数层缺陷 → patch 修正 → PASS
{
  const r = drive({ type: 'gyroid', porosity: 1.5, resolution: 64 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { porosity: 0.65 }, reason: 'paramErrors: porosity 越界' }) } },
  ]);
  ok('1 参数层修正收敛（PASS）', r.exit === 0 && r.report?.verdict === 'pass' && r.report?.rounds === 2 && r.untouched,
    `exit=${r.exit} verdict=${r.report?.verdict} rounds=${r.report?.rounds}`);
}

// 2. 梯外修复：fcks R96 薄壁自触 → resolution 120（verify 梯内上限 96 修不了）
{
  const r = drive({ type: 'fcks', porosity: 0.6, resolution: 96 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { resolution: 120 }, reason: 'fcks 薄壁自触，R96 拒产，R120 实测可产' }) } },
  ], 3);
  ok('2 梯外分辨率修复（R120 PASS）', r.exit === 0 && r.report?.verdict === 'pass' && r.report?.resolutionUsed === 120,
    `exit=${r.exit} verdict=${r.report?.verdict} res=${r.report?.resolutionUsed}`);
}

// 3. 降周期数修复：gprime k6 R96 薄壁自触 → periods 2
{
  const r = drive({ type: 'gprime', porosity: 0.6, resolution: 96 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 2 }, reason: 'gprime k6 R96 nm 19080，降周期数可避' }) } },
  ], 3);
  ok('3 降周期数修复（k2 PASS）', r.exit === 0 && r.report?.verdict === 'pass', `exit=${r.exit} verdict=${r.report?.verdict}`);
}

// 4. 不可达宣告：cylinder+diamond 深水区（结构化诚实输出，exit 3）
{
  const r = drive({ type: 'diamond', porosity: 0.6, container: 'cylinder', resolution: 96 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'declare_unreachable', reason: 'cylinder+diamond 深水区：R48-R128 全拒产非单调，修复无意义' }) } },
  ], 2);
  ok('4 不可达结构化宣告（exit 3）', r.exit === 3 && r.report?.verdict === 'unreachable' && /深水区/.test(r.report?.reason ?? ''), `exit=${r.exit}`);
}

// 5. 非法修复决策 → M3 同源拦截器拒绝（exit 2）
{
  const r = drive({ type: 'gyroid', porosity: 1.5, resolution: 64 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { type: 'warpdrive' }, reason: '越权类型' }) } },
  ]);
  ok('5 非法修复决策被拦截器拒绝（exit 2）', r.exit === 2 && /拦截器|越权|enum|不在/.test(r.stderr), `exit=${r.exit} stderr=${r.stderr.slice(-120)}`);
}

// 6. 轮数耗尽 → max_rounds（exit 4）+ 原始设计文件全程未被改写
{
  const r = drive({ type: 'gyroid', porosity: 1.5, resolution: 64 }, [
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 1 }, reason: '无效修补（反复）' }) } },
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 1 }, reason: '无效修补（反复）' }) } },
    { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 1 }, reason: '无效修补（反复）' }) } },
  ], 3);
  ok('6 轮数耗尽结构化报告（exit 4）', r.exit === 4 && r.report?.verdict === 'max_rounds' && r.untouched, `exit=${r.exit} verdict=${r.report?.verdict}`);
}

// 批次 5 T1/T3/T4：agent-pipeline 有界多步任务（推荐->选取->构建->验收->可打印性）
{
  const pipeDir = join(work, 'pipe');
  mkdirSync(pipeDir, { recursive: true });
  const PIPE = join(HERE, 'agent-pipeline.mjs');
  const parse = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch { return null; } };
  const rp = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--top', '3', '--pick', '2', '--out', pipeDir], { encoding: 'utf8', timeout: 600_000 });
  const pr = parse(rp.stdout ?? '');
  ok('7 管线成功链：推荐-构建(水密)-悬垂报告 exit0（三层口径分开）', rp.status === 0 && pr?.status === 'completed'
    && pr?.layers?.proxyRecommendation?.candidates?.length >= 2 && pr?.layers?.meshAcceptance?.watertight === true
    && pr?.layers?.printability?.criticalAreaRatio !== undefined,
    'exit=' + rp.status + ' steps=' + (pr?.steps?.map((s) => s.step).join(',') ?? '?'));
  ok('8 管线报告含预算用量与产物', pr?.budget?.used?.steps >= 3 && Array.isArray(pr?.artifacts) && pr.artifacts.some((f) => /pipeline-report[.]json$/.test(f)));
  const rf = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--max-repairs', '0', '--out', pipeDir], { encoding: 'utf8', timeout: 600_000 });
  const fr = parse(rf.stdout ?? '');
  ok('9 管线零修复直通：S8 焊接解锁后首候选 octet 直接水密（repairs=0）', rf.status === 0 && fr?.status === 'completed' && fr?.budget?.used?.repairs === 0 && fr?.layers?.meshAcceptance?.watertight === true, 'exit=' + rf.status + ' repairs=' + fr?.budget?.used?.repairs);
  const rb = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--pick', '2', '--max-steps', '2', '--out', pipeDir], { encoding: 'utf8', timeout: 600_000 });
  const br = parse(rb.stdout ?? '');
  ok('10 管线预算耗尽链：exit4+已完成步骤+最后诊断', rb.status === 4 && br?.status === 'budget-exhausted' && br?.exhaustion?.completedSteps === 2 && br?.exhaustion?.lastDiagnosis !== null, 'exit=' + rb.status);
}

// 2026-10-19 批次 A5（Codex 审计）：可替换执行器夹具——错误路径确定性注入，不依赖真实几何族
{
  const pipeDir = join(work, 'pipe-fix');
  mkdirSync(pipeDir, { recursive: true });
  const PIPE = join(HERE, 'agent-pipeline.mjs');
  const parse = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch { return null; } };
  // 夹具子进程：行为=（mode, args）的纯函数，无跨调用状态；cand 序号从 --out 文件名提取
  const FIXTURE = join(pipeDir, 'fixture-tpms.mjs');
  writeFileSync(FIXTURE, `import { writeFileSync } from 'node:fs';
const mode = process.env.TPMS_FIXTURE_MODE ?? 'ok';
const args = process.argv.slice(2);
const cmd = args[0];
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const PARETO = { command: 'pareto', reachable: true, recommendations: [
  { rank: 1, type: 'gyroid', porosity: 0.6, cellSize: 3, E_GPa: 2.1, kappa_m2: 5e-9, dist_log10: 0.1, meetsTarget: true },
  { rank: 2, type: 'diamond', porosity: 0.65, cellSize: 4, E_GPa: 2.0, kappa_m2: 5.2e-9, dist_log10: 0.2, meetsTarget: true },
  { rank: 3, type: 'iwp', porosity: 0.5, cellSize: 3, E_GPa: 1.9, kappa_m2: 5.5e-9, dist_log10: 0.3, meetsTarget: false },
] };
const meshOK = () => {
  if (out) writeFileSync(out, 'solid fixture\\nendsolid fixture\\n');
  console.log(JSON.stringify({ command: 'mesh', watertight: true, porosityEstimate: 0.6, fileBytes: 1024 }));
  process.exit(0);
};
if (cmd === 'pareto') {
  if (mode === 'pareto-fail') { console.error('fixture: pareto 模拟失败'); process.exit(1); }
  if (mode === 'two-candidates') { console.log(JSON.stringify({ ...PARETO, recommendations: PARETO.recommendations.slice(0, 2) })); process.exit(0); }
  console.log(JSON.stringify(PARETO)); process.exit(0);
}
if (cmd === 'mesh') {
  if (mode === 'reject-all') { console.error('fixture: mesh 模拟拒产（exit3）'); process.exit(3); }
  if (mode === 'reject-then-pass' && /cand1[.-]/.test(out ?? '')) { console.error('fixture: cand1 模拟拒产（exit3）'); process.exit(3); }
  if (mode === 'slow-mesh') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);  // 同步睡眠 60s，会被 wall 预算杀
  if (mode === 'flood') { const chunk = 'x'.repeat(1024 * 1024); for (let i = 0; i < 80; i++) process.stdout.write(chunk + '\\n'); process.exit(0); }  // 80MB stdout → maxBuffer ENOBUFS
  meshOK();
}
if (cmd === 'overhang') {
  if (mode === 'overhang-fail') { console.error('fixture: overhang 模拟失败'); process.exit(1); }
  console.log(JSON.stringify({ command: 'overhang', criticalAreaRatio: 0.12, tris: 24, criticalDeg: 45 })); process.exit(0);
}
console.error('fixture: 未知子命令 ' + cmd); process.exit(2);
`);
  const run = (mode, extra) => {
    const t = Date.now();
    const r = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--out', pipeDir, ...extra], {
      encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, TPMS_AGENT_TPMS_BIN: FIXTURE, TPMS_FIXTURE_MODE: mode },
    });
    return { r, pr: parse(r.stdout ?? ''), ms: Date.now() - t };
  };
  // 11 --top 非法：曾穿到 pareto 失败后 finish() 撞 TDZ 裸崩（无 JSON）
  const rTop = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--top', 'abc'], { encoding: 'utf8', timeout: 30_000 });
  const pTop = parse(rTop.stdout ?? '');
  ok('11 管线 --top 非法=stdout JSON+exit2（曾 TDZ 裸崩无报告）', rTop.status === 2 && pTop?.status === 'invalid-argument' && /top/.test(pTop?.error ?? ''), `exit=${rTop.status}`);
  // 12 推荐失败：结构化 failed + exit1（不裸崩）
  const { r: r12, pr: p12 } = run('pareto-fail', []);
  ok('12 推荐失败链=failed/exit1+JSON 报告', r12.status === 1 && p12?.status === 'failed' && p12?.failure?.step === 'recommend' && Array.isArray(p12?.steps), `exit=${r12.status} status=${p12?.status}`);
  // 13 拒产顺延：cand1 exit3 → 顺延 cand2 成功（repairs=1）
  const { r: r13, pr: p13 } = run('reject-then-pass', []);
  ok('13 拒产顺延链：cand1 拒产→cand2 水密（repairs=1）', r13.status === 0 && p13?.status === 'completed' && p13?.budget?.used?.repairs === 1 && p13?.layers?.meshAcceptance?.candidateIndex === 1, `exit=${r13.status} repairs=${p13?.budget?.used?.repairs}`);
  // 14 全拒产：unreachable/exit3（候试用尽，不再依赖 octet 真实拒产）
  const { r: r14, pr: p14 } = run('reject-all', []);
  ok('14 全拒产链=unreachable/exit3（候选用尽，故障注入版）', r14.status === 3 && p14?.status === 'unreachable' && /候选用尽/.test(p14?.failure?.reason ?? '') && p14?.failure?.repairsUsed === 2, `exit=${r14.status}`);
  // 15 wall 预算钳制：1s 预算+60s 慢子进程 → 秒回 budget-exhausted/exit4（曾穿透 30.8s）
  const { r: r15, pr: p15, ms: ms15 } = run('slow-mesh', ['--max-wall-ms', '1000']);
  ok('15 wall 预算钳制慢子进程：budget-exhausted/exit4 且秒回（曾穿透到 30.8s）', r15.status === 4 && p15?.status === 'budget-exhausted' && p15?.steps?.some((s) => s.output?.killed === 'wall-budget') && ms15 < 10_000, `exit=${r15.status} ms=${ms15}`);
  // 16 末步失败：overhang exit1 → failed/exit1，已交付 STL 保留（曾无条件 completed/exit0）
  const { r: r16, pr: p16 } = run('overhang-fail', []);
  const stl16 = p16?.layers?.meshAcceptance?.file;
  ok('16 末步悬垂失败=failed/exit1+STL 保留', r16.status === 1 && p16?.status === 'failed' && p16?.failure?.step === 'printability-overhang' && p16?.layers?.meshAcceptance?.watertight === true && stl16 && existsSync(stl16), `exit=${r16.status} step=${p16?.failure?.step}`);
  // 17 --pick 越界：推荐返回后校验，JSON+exit2
  const { r: r17, pr: p17 } = run('two-candidates', ['--pick', '5']);
  ok('17 管线 --pick 越界=stdout JSON+exit2', r17.status === 2 && p17?.status === 'invalid-argument' && /越界/.test(p17?.error ?? ''), `exit=${r17.status}`);
  // 18 浮点预算整数契约（推送前复核：1000.5 曾穿校验直击 spawnSync ERR_OUT_OF_RANGE 裸崩）
  const r18 = spawnSync(process.execPath, [PIPE, '--target-e', '2', '--target-k', '5', '--max-wall-ms', '1000.5'], { encoding: 'utf8', timeout: 30_000 });
  const p18 = parse(r18.stdout ?? '');
  ok('18 --max-wall-ms 浮点=stdout JSON+exit2（曾 ERR_OUT_OF_RANGE 裸崩 stdout 空）', r18.status === 2 && p18?.status === 'invalid-argument' && /整数/.test(p18?.error ?? '') && (r18.stdout ?? '').trim().startsWith('{'), `exit=${r18.status} stdout=${(r18.stdout || '').slice(0, 40)}`);
  // 19 输出超限归因（推送前复核：曾被误报 budget-exhausted/exit4）。跨 Node 版本契约：
  // 旧 Node spawnSync 超限→error ENOBUFS（管线保留错误码）；新 Node→stdout 静默截断、
  // exit0 无 JSON→水密验收失败——两机制殊途同归 failed/exit1，断言只钉语义不钉错误码实现。
  const { r: r19, pr: p19 } = run('flood', []);
  ok('19 子进程输出超限=failed/exit1 不冒充预算耗尽（Node 版本差异：ENOBUFS 保留错误码 / 静默截断致验收失败）', r19.status === 1 && p19?.status === 'failed' && p19?.status !== 'budget-exhausted', `exit=${r19.status} status=${p19?.status} err=${/ENOBUFS/.test(JSON.stringify(p19)) ? 'ENOBUFS' : 'truncated-or-other'}`);
}

rmSync(work, { recursive: true, force: true });
console.log(`\n== M4 DRIVER SELFTEST: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
