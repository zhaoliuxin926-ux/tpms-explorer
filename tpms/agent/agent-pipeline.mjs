#!/usr/bin/env node
/**
 * agent-pipeline.mjs — 有界多步任务：推荐→选取→构建→水密验收→可打印性报告（批次 5 T1/T3/T4）
 *
 * 设计（复用现有 CLI/driver，零新增数值内核）：
 *  1. tpms_pareto（CLI）→ 候选集          【代理推荐：Gibson-Ashby×KC 解析近似，非 FE】
 *  2. 候选选取：top-pick 起，水密门失败（exit3）按修复预算顺延下一候选
 *  3. tpms_mesh（CLI，R96）→ STL           【网格验收：水密三硬指标+孔隙率网格实测】
 *  4. tpms.mjs overhang（CLI）→ 支撑面报告 【可打印性：α<critical 判需支撑】
 *  5. 报告：JSON（stdout）+ 每步输入/输出/产物/预算用量；三层口径分开标注（T4）
 *
 * 预算（T3）：--max-steps（默认 10）/ --max-tool-calls（12）/ --max-wall-ms（默认 30 分钟）/
 * --subprocess-timeout-ms（600s，与 llm-agent 对齐）/ --max-repairs（候选顺延 3）。
 * 耗尽→报告含已完成步骤+最后诊断+未完成原因，exit 4（driver 轮数耗尽先例）；
 * 全候选拒产→exit 3（不可达结构化宣告）；成功→exit 0。
 * --session 可选：推荐与执行按批次 4 会话格式落盘（跨进程指代可接续）。
 *
 * 用法：node agent-pipeline.mjs --target-e 2 --target-k 5 [--top 3] [--pick 1]
 *       [--out 输出目录] [--session s.json] [--budget-* ...] [--json]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPMS = join(HERE, 'tpms.mjs');

const a = { _: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const s = argv[i];
  if (s === '--target-e') a.targetE = Number(argv[++i]);
  else if (s === '--target-k') a.targetK = Number(argv[++i]);
  else if (s === '--top') a.top = Number(argv[++i]);
  else if (s === '--pick') a.pick = Number(argv[++i]);
  else if (s === '--out') a.out = argv[++i];
  else if (s === '--session') a.session = argv[++i];
  else if (s === '--max-steps') a.maxSteps = Number(argv[++i]);
  else if (s === '--max-tool-calls') a.maxToolCalls = Number(argv[++i]);
  else if (s === '--max-wall-ms') a.maxWallMs = Number(argv[++i]);
  else if (s === '--subprocess-timeout-ms') a.subTimeout = Number(argv[++i]);
  else if (s === '--max-repairs') a.maxRepairs = Number(argv[++i]);
  else if (s === '--json') a.json = true;
  else if (s.startsWith('--')) { console.error(`未知选项 ${s}`); process.exit(2); }
  else a._.push(s);
}

const usage = '用法: node agent-pipeline.mjs --target-e <GPa> --target-k <×10⁻⁹ m²> [--top 3] [--pick 1] [--out 目录] [--session s.json] [--json]';
// 红队 2026-10-11 参数卫生：NaN/负数预算曾致裸崩（NaN 预算恒 false 走 finish 引用未定义；
// 负 subprocess timeout 直击 spawnSync RangeError）——非法一律结构化 exit2
const intOpt = (v, name, lo, hi) => {
  if (v === undefined) return undefined;
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < lo || v > hi) { console.error(`${name} 需为 ${lo}~${hi} 整数`); process.exit(2); }
  return v;
};
intOpt(a.maxSteps, '--max-steps', 1, 100);
intOpt(a.maxToolCalls, '--max-tool-calls', 1, 200);
intOpt(a.maxRepairs, '--max-repairs', 0, 50);
if (a.maxWallMs !== undefined && (!Number.isFinite(a.maxWallMs) || a.maxWallMs < 1000)) { console.error('--max-wall-ms 需为 ≥1000 的有限数字'); process.exit(2); }
if (a.subTimeout !== undefined && (!Number.isFinite(a.subTimeout) || a.subTimeout < 1000 || a.subTimeout > 3_600_000)) { console.error('--subprocess-timeout-ms 需为 1000~3600000'); process.exit(2); }
if (!Number.isFinite(a.targetE) || a.targetE <= 0) { console.error('--target-e 需为正数（GPa）\n' + usage); process.exit(2); }
if (!Number.isFinite(a.targetK) || a.targetK <= 0) { console.error('--target-k 需为正数（×10⁻⁹ m²）\n' + usage); process.exit(2); }

// ── 预算账本（T3）：每步每调用记账，超限即停并如实报告 ──
const budget = {
  maxSteps: a.maxSteps ?? 10,
  maxToolCalls: a.maxToolCalls ?? 12,
  maxWallMs: a.maxWallMs ?? 30 * 60_000,
  subTimeout: a.subTimeout ?? 600_000,
  maxRepairs: a.maxRepairs ?? 3,
};
const t0 = Date.now();
let stepsUsed = 0, toolCallsUsed = 0;
const report = {
  command: 'pipeline', target: { eGPa: a.targetE, kappaNm2: a.targetK },
  startedAt: new Date().toISOString(),
  steps: [],        // 每步：{step, tool, input, output, artifacts?, accepted?}
  layers: {         // T4 三层口径分开（代理推荐/网格验收/物理可打印性）
    proxyRecommendation: null, meshAcceptance: null, printability: null,
  },
  budget: { ...budget },
};
const exhausted = (why) => ({
  reason: why, completedSteps: stepsUsed, toolCallsUsed,
  wallMs: Date.now() - t0,
  lastDiagnosis: report.steps[report.steps.length - 1]?.output ?? null,
});
const budgetLeft = () => stepsUsed < budget.maxSteps && toolCallsUsed < budget.maxToolCalls && (Date.now() - t0) < budget.maxWallMs;

function runCli(args, stepName, meta) {
  if (!budgetLeft()) {
    report.status = 'budget-exhausted';
    report.exhaustion = exhausted('预算耗尽（steps/toolCalls/wall 之一触顶）');
    report.exitCode = 4;
    return null;
  }
  stepsUsed++; toolCallsUsed++;
  const r = spawnSync(process.execPath, [TPMS, ...args, '--json'], {
    encoding: 'utf8', timeout: budget.subTimeout, maxBuffer: 64 * 1024 * 1024,
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout ?? ''); } catch { /* 非 JSON */ }
  report.steps.push({ step: stepName, tool: `tpms ${args[0]}`, input: meta, output: parsed ?? { exit: r.status, stderrTail: (r.stderr || '').slice(-200) }, exit: r.status ?? 1, ms: Date.now() - t0 });
  return { status: r.status ?? 1, parsed, stderr: r.stderr || '' };
}

// ── Step 1: 推荐（代理层）──
const r1 = runCli(['pareto', '--target-e', String(a.targetE), '--target-k', String(a.targetK), '--top', String(a.top ?? 3)], 'recommend', { targetE: a.targetE, targetK: a.targetK, top: a.top ?? 3 });
if (!r1) { finish(); }
if (r1.status !== 0 || !r1.parsed?.recommendations?.length) {
  report.status = 'failed'; report.failure = { step: 'recommend', exit: r1.status, stderrTail: r1.stderr.slice(-200) }; report.exitCode = r1.status === 3 ? 3 : 1; finish();
}
report.layers.proxyRecommendation = {
  layer: '代理推荐（Gibson-Ashby×Kozeny-Carman 解析近似，非 FE）',
  reachable: r1.parsed.reachable !== false,
  candidates: r1.parsed.recommendations,
};

// ── 会话记录（可选，批次 4 接续）──
let session = null;
if (a.session) {
  const { loadOrCreateSession, recordPareto, saveSession } = await import('./agent-session.mjs');
  try { session = loadOrCreateSession(a.session); } catch (e) {
    console.error(`✗ 会话加载失败：${e.message}`); process.exit(2);
  }
  recordPareto(session, { target_e_gpa: a.targetE, target_k_nm2: a.targetK }, r1.parsed);
  saveSession(a.session, session);
}

// ── Step 2+3: 候选选取→构建（水密门=验收；失败按修复预算顺延）──
const outDir = a.out ? resolve(a.out) : process.cwd();
mkdirSync(outDir, { recursive: true });
const recs = r1.parsed.recommendations;
const pick = Math.max(1, a.pick ?? 1);
let built = null, repairsUsed = 0;
for (let idx = pick - 1; idx < recs.length; idx++) {
  // 修复预算=首个失败后允许顺延的次数（0=只试首选）
  if (idx > pick - 1) {
    if (repairsUsed >= budget.maxRepairs) break;
    repairsUsed++;
  }
  if (!budgetLeft()) { report.status = 'budget-exhausted'; report.exhaustion = exhausted('候选构建中预算耗尽'); report.exitCode = 4; finish(); }
  const c = recs[idx];
  const stl = join(outDir, `pipeline-cand${idx + 1}-${c.type}-p${Math.round(c.porosity * 100)}.stl`);
  const rm = runCli(['mesh', '--type', c.type, '--porosity', String(c.porosity), '--periods', String(c.cellSize), '--resolution', '96', '--out', stl], `build-candidate-${idx + 1}`, { type: c.type, porosity: c.porosity, periods: c.cellSize, resolution: 96, out: stl });
  if (!rm) { finish(); }
  if (rm.status === 0 && rm.parsed?.watertight) {
    built = { candidateIndex: idx, candidate: c, stl, mesh: rm.parsed };
    report.layers.meshAcceptance = {
      layer: '网格验收（水密三硬指标+孔隙率网格实测口径）',
      candidateIndex: idx, type: c.type, porosity: c.porosity, periods: c.cellSize,
      watertight: rm.parsed.watertight, porosityEstimate: rm.parsed.porosityEstimate,
      deviationPP: Math.abs(rm.parsed.porosityEstimate - c.porosity) * 100, fileBytes: rm.parsed.fileBytes, file: stl,
    };
    break;
  }
  // exit3=诚实拒产 → 顺延（修复预算）；其他失败 → 终止报告
  if (rm.status !== 3) {
    report.status = 'failed'; report.failure = { step: `build-candidate-${idx + 1}`, exit: rm.status, stderrTail: rm.stderr.slice(-200) }; report.exitCode = rm.status || 1; finish();
  }
}
if (!built && !report.status) {
  report.status = 'unreachable';
  const tried = report.steps.filter((s) => s.step.startsWith('build-candidate')).length;
  report.failure = { step: 'build', reason: `已试 ${tried}/${recs.length} 个候选均被水密门拒收（fail-closed，无 STL 交付；${tried < recs.length ? `修复预算 ${budget.maxRepairs} 耗尽` : '候选用尽'}）`, repairsUsed };
  report.exitCode = 3; finish();
}

// ── 会话执行记录 ──
if (session && built) {
  const { recordExecution, saveSession } = await import('./agent-session.mjs');
  recordExecution(session, {
    fromRecommendation: `pipeline@${new Date().toISOString()}`, candidateIndex: built.candidateIndex, tool: 'tpms_mesh',
    args: { type: built.candidate.type, porosity: built.candidate.porosity, periods: built.candidate.cellSize, resolution: 96, out: built.stl },
    exit: 0, artifacts: [built.stl],
    resultDigest: { porosityEstimate: built.mesh.porosityEstimate, watertight: built.mesh.watertight, fileBytes: built.mesh.fileBytes },
    source: 'agent-pipeline 候选顺延构建',
  });
  saveSession(a.session, session);
}

// ── Step 4: 可打印性（物理层：悬垂面审计）──
const ro = runCli(['overhang', '--input', built.stl], 'printability-overhang', { input: built.stl, critical: 45 });
if (!ro) { finish(); }
report.layers.printability = ro.status === 0 && ro.parsed ? {
  layer: '物理可打印性（悬垂面 α<45° 判需支撑，工程阈值——实际 30~60°）',
  criticalAreaRatio: ro.parsed.criticalAreaRatio ?? null, tris: ro.parsed.tris ?? null, criticalDeg: ro.parsed.criticalDeg ?? null,
} : { layer: '物理可打印性', note: `overhang exit=${ro.status}（可打印性步骤失败，不回滚已交付 STL）`, failed: true };

report.status = 'completed';
report.exitCode = 0;

function finish() {
  report.finishedAt = new Date().toISOString();
  report.budget.used = { steps: stepsUsed, toolCalls: toolCallsUsed, wallMs: Date.now() - t0, repairs: repairsUsed ?? 0 };
  const reportPath = join(outDir, 'pipeline-report.json');
  report.artifacts = [...(report.artifacts ?? []), reportPath];
  const out = JSON.stringify(report, null, 2);
  try { writeFileSync(reportPath, out, 'utf8'); } catch { /* 报告落盘失败不掩盖主结果 */ }
  console.log(out);   // 管线报告恒为 stdout JSON（机器可读交付物）
  process.exit(report.exitCode ?? 0);
}
finish();
