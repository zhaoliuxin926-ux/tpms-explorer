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
 * 运行：node llm_driver_selftest.mjs   （真实构建约 3~6 分钟）
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
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

rmSync(work, { recursive: true, force: true });
console.log(`\n== M4 DRIVER SELFTEST: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
