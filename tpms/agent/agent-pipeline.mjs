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
 * 全候选拒产→exit 3（不可达结构化宣告）；成功→exit 0；
 * 末步（悬垂审计）失败→failed/exit 1（已交付 STL 保留）；参数非法→exit 2（stdout JSON）。
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
// 测试接缝（2026-10-19 A5，学生裁决"可替换执行器"）：selftest 经 TPMS_AGENT_TPMS_BIN 注入
// 确定性夹具子进程，覆盖推荐失败/拒产顺延/慢子进程预算钳制/末步失败等错误路径；缺省恒为真实入口。
const TPMS = process.env.TPMS_AGENT_TPMS_BIN ?? join(HERE, 'tpms.mjs');

// 2026-10-19 A2（Codex 审计）：非法参数补 stdout JSON（机器可读契约），exit2
const fail2 = (msg) => {
  console.error(msg);
  console.log(JSON.stringify({ command: 'pipeline', ok: false, status: 'invalid-argument', error: msg }, null, 2));
  process.exit(2);
};

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
  else if (s.startsWith('--')) { fail2(`未知选项 ${s}`); }
  else a._.push(s);
}

const usage = '用法: node agent-pipeline.mjs --target-e <GPa> --target-k <×10⁻⁹ m²> [--top 3] [--pick 1] [--out 目录] [--session s.json] [--json]';
// 红队 2026-10-11 参数卫生：NaN/负数预算曾致裸崩（NaN 预算恒 false 走 finish 引用未定义；
// 负 subprocess timeout 直击 spawnSync RangeError）——非法一律结构化 exit2。
// 2026-10-19 A2（Codex 审计）：top/pick 补校验（--top abc 曾穿到 pareto 失败后 finish() 撞 TDZ 裸崩）
const intOpt = (v, name, lo, hi) => {
  if (v === undefined) return undefined;
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < lo || v > hi) fail2(`${name} 需为 ${lo}~${hi} 整数`);
  return v;
};
intOpt(a.maxSteps, '--max-steps', 1, 100);
intOpt(a.maxToolCalls, '--max-tool-calls', 1, 200);
intOpt(a.maxRepairs, '--max-repairs', 0, 50);
intOpt(a.top, '--top', 1, 10);    // 与 pareto 自身域对齐（tpms.mjs --top 1..10）
intOpt(a.pick, '--pick', 1, 10);
// 2026-10-19 推送前复核：wall/sub 期限统一整数契约——1000.5 曾穿校验后直击 spawnSync
// ERR_OUT_OF_RANGE 裸崩（stdout 空、无 JSON）
if (a.maxWallMs !== undefined && (!Number.isInteger(a.maxWallMs) || a.maxWallMs < 1000)) fail2('--max-wall-ms 需为 ≥1000 的整数');
if (a.subTimeout !== undefined && (!Number.isInteger(a.subTimeout) || a.subTimeout < 1000 || a.subTimeout > 3_600_000)) fail2('--subprocess-timeout-ms 需为 1000~3600000 整数');
if (!Number.isFinite(a.targetE) || a.targetE <= 0) fail2('--target-e 需为正数（GPa）\n' + usage);
if (!Number.isFinite(a.targetK) || a.targetK <= 0) fail2('--target-k 需为正数（×10⁻⁹ m²）\n' + usage);

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

// 2026-10-19 A2（Codex 审计）：报告所需状态全部前置——早退 finish() 曾撞 outDir/repairsUsed
// 的 TDZ ReferenceError 裸崩（--top abc：pareto 失败→finish()→读未初始化 repairsUsed）
const outDir = a.out ? resolve(a.out) : process.cwd();
mkdirSync(outDir, { recursive: true });
const pick = Math.max(1, a.pick ?? 1);
let built = null, repairsUsed = 0;

function runCli(args, stepName, meta) {
  if (!budgetLeft()) {
    report.status = 'budget-exhausted';
    report.exhaustion = exhausted('预算耗尽（steps/toolCalls/wall 之一触顶）');
    report.exitCode = 4;
    return null;
  }
  stepsUsed++; toolCallsUsed++;
  // 2026-10-19 A3（Codex 审计）：子进程超时钳到剩余总预算——曾给完整 subTimeout（600s），
  // 1s 总预算实测穿透到 30.8s 才返回；因预算被杀归 budget-exhausted（exit4）而非 failed。
  // 推送前复核 A3v2：取整防浮点；只有超时击杀且约束边是剩余 wall 预算才归预算耗尽——
  // ENOBUFS（maxBuffer 溢出）等进程错误按 failed/exit1 保留错误码，不冒充预算耗尽。
  const subMs = Math.max(1, Math.min(budget.subTimeout, Math.floor(budget.maxWallMs - (Date.now() - t0))));
  const wallBound = subMs < budget.subTimeout;
  const r = spawnSync(process.execPath, [TPMS, ...args, '--json'], {
    encoding: 'utf8', timeout: subMs, maxBuffer: 64 * 1024 * 1024,
  });
  const errCode = r.error?.code ?? null;
  if (r.status === null && errCode !== 'ENOBUFS' && wallBound && (errCode === 'ETIMEDOUT' || !errCode)) {
    report.steps.push({ step: stepName, tool: `tpms ${args[0]}`, input: meta, output: { killed: 'wall-budget', note: `子进程在剩余总预算（${subMs}ms）处被终止` }, exit: 4, ms: Date.now() - t0 });
    report.status = 'budget-exhausted';
    report.exhaustion = exhausted(`总时长预算在子进程执行中触顶（${stepName} 被终止，未等其自然结束）`);
    report.exitCode = 4;
    return null;
  }
  if (r.error) {
    const errText = errCode ?? String(r.error.message).slice(0, 120);
    report.steps.push({ step: stepName, tool: `tpms ${args[0]}`, input: meta, output: { error: errText }, exit: r.status ?? 1, ms: Date.now() - t0 });
    return { status: r.status ?? 1, parsed: null, stderr: `子进程错误 ${errText}` };
  }
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
    // 2026-10-19 发布前补漏：与参数非法同一结构化出口（曾只写 stderr，stdout 空=机器可读断头）
    fail2(`会话加载失败：${e.message}`);
  }
  recordPareto(session, { target_e_gpa: a.targetE, target_k_nm2: a.targetK }, r1.parsed);
  saveSession(a.session, session);
}

// ── Step 2+3: 候选选取→构建（水密门=验收；失败按修复预算顺延）──
const recs = r1.parsed.recommendations;
if (pick > recs.length) fail2(`--pick ${pick} 越界：本次推荐只有 ${recs.length} 个候选`);
for (let idx = pick - 1; idx < recs.length; idx++) {
  // 修复预算=首个失败后允许顺延的次数（0=只试首选）
  if (idx > pick - 1) {
    if (repairsUsed >= budget.maxRepairs) break;
    repairsUsed++;
  }
  if (!budgetLeft()) { report.status = 'budget-exhausted'; report.exhaustion = exhausted('候选构建中预算耗尽'); report.exitCode = 4; finish(); }
  const c = recs[idx];
  // 尺寸契约（2026-10-24 审查 #2 评审定案）：候选 cellSize=单胞 mm，显式 periods=3 +
  // 总宽=3×单胞（旧错绑 periods=c.cellSize 已弃；k=3 在官方标定域 k≤5 内、不依赖
  // 已登记非标定域的全局默认 6）
  const stl = join(outDir, `pipeline-cand${idx + 1}-${c.type}-p${Math.round(c.porosity * 100)}.stl`);
  const rm = runCli(['mesh', '--type', c.type, '--porosity', String(c.porosity), '--periods', '3', '--specimen-size', String(3 * c.cellSize), '--resolution', '96', '--out', stl], `build-candidate-${idx + 1}`, { type: c.type, porosity: c.porosity, periods: 3, specimenSizeMm: 3 * c.cellSize, resolution: 96, out: stl });
  if (!rm) { finish(); }
  if (rm.status === 0 && rm.parsed?.watertight) {
    built = { candidateIndex: idx, candidate: c, stl, mesh: rm.parsed };
    report.layers.meshAcceptance = {
      layer: '网格验收（水密三硬指标+孔隙率网格实测口径）',
      candidateIndex: idx, type: c.type, porosity: c.porosity,
      cellSizeMm: c.cellSize, periods: 3, specimenSizeMm: 3 * c.cellSize,
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
    // 【批十八 P2-03】执行记录对齐实际构建参数（runCli 实传 periods=3+总宽 3×单胞）——
    // 旧记录把单胞 mm 写进 periods 且漏总宽，审计/溯源失真（评估夹具实证）
    args: { type: built.candidate.type, porosity: built.candidate.porosity, periods: 3, specimenSizeMm: 3 * built.candidate.cellSize, resolution: 96, out: built.stl },
    exit: 0, artifacts: [built.stl],
    resultDigest: { porosityEstimate: built.mesh.porosityEstimate, watertight: built.mesh.watertight, fileBytes: built.mesh.fileBytes },
    source: 'agent-pipeline 候选顺延构建',
  });
  saveSession(a.session, session);
}

// ── Step 4: 可打印性（物理层：悬垂面审计）──
const ro = runCli(['overhang', '--input', built.stl], 'printability-overhang', { input: built.stl, critical: 45 });
if (!ro) { finish(); }
// 2026-10-19 A4（Codex 审计，学生裁决沿用 failed/exit1）：末步失败不再伪装整体成功——
// 保留已交付 STL、明确失败步骤；总预算耗尽仍走 exit4 语义，不新增状态码。
if (ro.status !== 0 || !ro.parsed) {
  report.layers.printability = { layer: '物理可打印性', note: `overhang exit=${ro.status}（可打印性步骤失败，不回滚已交付 STL）`, failed: true };
  report.status = 'failed';
  report.failure = { step: 'printability-overhang', exit: ro.status, stderrTail: (ro.stderr || '').slice(-200), note: 'STL 已交付，悬垂审计未完成' };
  report.exitCode = 1;
} else {
  report.layers.printability = {
    layer: '物理可打印性（悬垂面 α<45° 判需支撑，工程阈值——实际 30~60°）',
    criticalAreaRatio: ro.parsed.criticalAreaRatio ?? null, tris: ro.parsed.tris ?? null, criticalDeg: ro.parsed.criticalDeg ?? null,
  };
  report.status = 'completed';
  report.exitCode = 0;
}

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
