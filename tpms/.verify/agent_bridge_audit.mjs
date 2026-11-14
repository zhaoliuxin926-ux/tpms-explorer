/**
 * agent_bridge_audit.mjs —— 门：方向 A CLI/Web 契约合流桥审计（2026-11-11）
 *
 * A. 同源锁：浏览器桥（src/core/agent-contract.ts 打包产物）的 TOOLS_SCHEMA 与
 *    tpms/agent/tools.schema.json 逐位深度相等；BROWSER_TOOL_NAMES ⊆ schema 注册面
 *    （scenario/pareto 的排除理由在 agent-contract.ts 文件头，本门只锁不扩散）。
 * B. 红队治理复刻（浏览器面零放宽）：E5 联合算力预算（Σ periods³>4096 拒/恰达 4096 过）、
 *    E11 写写冲突（同 out 重复者拒+首个保留语义、视口写同轮互斥、显式不同 out 放行）。
 * C. Key 零泄漏（结构级）：BYO key 存储键只出现在 llm-provider-browser.ts；
 *    分享/URL 序列化模块（url-params.ts）与 agent 循环模块零 Key 面引用。
 * D. 无 key 零回归路径钉：main.ts 规则路径（parseNL→applyNLIntent 同步链）在 Agent
 *    分支之前保持原样（行为级回归由 nl_agent_audit 45 断言 + run_all/card_smoke 流程覆盖）。
 *
 * 运行：node agent_bridge_audit.mjs
 */
import { writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const AGENT = join(HERE, '../agent');

const entry = join(tmpdir(), 'agbr_entry.ts');
writeFileSync(entry, [
  `export { TOOLS_SCHEMA, BROWSER_TOOL_NAMES, browserToolsSchema, validateToolCalls, checkViewportConflicts, VIEWPORT_OUT, REPAIR_TOOL, newSession, recordPareto, recordExecution, resolveReference, candidateToMeshArgs } from ${JSON.stringify(join(PLATFORM, 'src/core/agent-contract.ts'))};`,
  `export { runAgent } from ${JSON.stringify(join(PLATFORM, 'src/core/agent-run.ts'))};`,
  `export { agentParetoExec, agentEstimateExec, resolveScenarioPreset, agentScenarioFallbackExec } from ${JSON.stringify(join(PLATFORM, 'src/core/agent-tools-shared.ts'))};`,
  `export { fitExperimentalCurve } from ${JSON.stringify(join(PLATFORM, 'src/physics/experimental-fit.ts'))};`,
  `export { forchheimerTwoPoint } from ${JSON.stringify(join(PLATFORM, 'src/physics/forchheimer.ts'))};`,
  `export { simulateLPBF } from ${JSON.stringify(join(PLATFORM, 'src/physics/lpbf-thermo-mechanical.ts'))};`,
  `export { simulateTissueGrowth } from ${JSON.stringify(join(PLATFORM, 'src/physics/tissue-growth.ts'))};`,
  `export { evolveLevelSet, phiToVField } from ${JSON.stringify(join(PLATFORM, 'src/core/levelset-optimizer.ts'))};`,
  `export { solvePhononicBands } from ${JSON.stringify(join(PLATFORM, 'src/physics/phononic-bandgap.ts'))};`,
  `export { analyticFieldValue } from ${JSON.stringify(join(PLATFORM, 'src/physics/percolation-analysis.ts'))};`,
].join('\n'));
const BUNDLE = join(tmpdir(), 'agbr_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
const {
  TOOLS_SCHEMA, BROWSER_TOOL_NAMES, browserToolsSchema, validateToolCalls, checkViewportConflicts, VIEWPORT_OUT, REPAIR_TOOL,
  newSession, recordPareto, recordExecution, resolveReference, candidateToMeshArgs, runAgent,
  agentParetoExec, agentEstimateExec, resolveScenarioPreset, agentScenarioFallbackExec,
  fitExperimentalCurve, forchheimerTwoPoint,
  simulateLPBF, simulateTissueGrowth, evolveLevelSet, phiToVField, solvePhononicBands, analyticFieldValue,
} = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const mesh = (args) => ({ function: { name: 'tpms_mesh', arguments: JSON.stringify(args) } });

// ══ A. 同源锁 ══
console.log('\n[A] 契约单源同源锁');
{
  const disk = JSON.parse(readFileSync(join(AGENT, 'tools.schema.json'), 'utf8'));
  check('TOOLS_SCHEMA ≡ tpms/agent/tools.schema.json（深度相等）', JSON.stringify(TOOLS_SCHEMA) === JSON.stringify(disk));
  const names = disk.tools.map((t) => t.name);
  check('浏览器注册面 ⊆ schema 注册面', BROWSER_TOOL_NAMES.every((n) => names.includes(n)), BROWSER_TOOL_NAMES.join(','));
  check('浏览器面含 M3 核心四工具', ['tpms_list', 'tpms_estimate', 'tpms_mesh', 'tpms_design_verify'].every((n) => BROWSER_TOOL_NAMES.includes(n)));
}

// ══ B. 红队治理复刻 ══
console.log('\n[B] E5 预算 / E11 写冲突（浏览器面零放宽）');
{
  // E5：3×periods12 = 5184 > 4096 → 拒
  const over = validateToolCalls([mesh({ type: 'gyroid', porosity: 0.75, periods: 12 }), mesh({ type: 'diamond', porosity: 0.7, periods: 12 }), mesh({ type: 'schwarz', porosity: 0.7, periods: 12 })]);
  check('E5 联合预算超限拒绝（3×12³=5184>4096）', over.ok === false && over.errors.some((e) => e.includes('4096')), over.ok ? '意外放行' : over.errors.join('；').slice(0, 80));
  // E5 边界：8×8³ = 4096 恰达上限 → 过
  const edge = validateToolCalls(Array.from({ length: 8 }, (_, i) => mesh({ type: 'gyroid', porosity: 0.7, periods: 8, out: `ok${i}.stl` })));
  check('E5 边界 8×8³=4096 恰达上限放行', edge.ok === true, edge.ok ? '' : edge.errors.join('；').slice(0, 80));
  // E11 显式 out 重复：重复者拒（错误归属重复项，首个调用无错误）
  const dup = validateToolCalls([mesh({ type: 'gyroid', porosity: 0.75, out: 'shared.stl' }), mesh({ type: 'diamond', porosity: 0.7, out: 'shared.stl' })]);
  check('E11 同 out 写写冲突拒绝', dup.ok === false && dup.errors.some((e) => e.includes('写写冲突')), JSON.stringify(dup).slice(0, 100));
  // E11 视口层：两 mesh 无 out → 同轮互斥（首个保留/重复者拒语义=错误指向第二个）
  const vp = checkViewportConflicts([
    { name: 'tpms_mesh', arguments: { type: 'gyroid', porosity: 0.75 } },
    { name: 'tpms_mesh', arguments: { type: 'diamond', porosity: 0.7 } },
  ]);
  check('视口写同轮互斥（无 out 双 mesh 拒）', vp.ok === false && vp.errors.length === 1 && vp.errors[0].includes('视口'), JSON.stringify(vp));
  // 只读 + 单写 → 放行
  const ok1 = checkViewportConflicts([
    { name: 'tpms_estimate', arguments: { type: 'gyroid', porosity: 0.75 } },
    { name: 'tpms_mesh', arguments: { type: 'gyroid', porosity: 0.75 } },
  ]);
  check('只读+单视口写放行（不连坐）', ok1.ok === true);
  // 显式不同 out 双 mesh → 文件语义（schema E11 已查重），视口层放行
  const ok2 = checkViewportConflicts([
    { name: 'tpms_mesh', arguments: { type: 'gyroid', porosity: 0.75, out: 'a.stl' } },
    { name: 'tpms_mesh', arguments: { type: 'diamond', porosity: 0.7, out: 'b.stl' } },
  ]);
  check('显式不同 out 双 mesh 视口层放行', ok2.ok === true);
  check('VIEWPORT_OUT 虚拟槽位常量在位', VIEWPORT_OUT === '__active_viewport__');
}

// ══ C. Key 零泄漏（结构级）══
console.log('\n[C] BYO Key 零泄漏（结构级审计）');
{
  const SRC = join(PLATFORM, 'src');
  // 逐文件扫描（key 常量只应在 provider 模块出现）
  const scanFiles = ['main.ts', 'core/agent-contract.ts', 'core/agent-run.ts', 'core/nl-agent.ts', 'url-params.ts'];
  let leaked = false;
  for (const f of scanFiles) {
    const txt = readFileSync(join(SRC, f), 'utf8');
    if (txt.includes('tpms.byo.key')) leaked = true;
  }
  check('BYO key 存储键只存在于 llm-provider-browser.ts', leaked === false);
  const urlParams = readFileSync(join(SRC, 'url-params.ts'), 'utf8');
  check('分享/URL 序列化模块零 Key 面引用', !/byo|apiKey|api_key/i.test(urlParams));
  const agentRun = readFileSync(join(SRC, 'core/agent-run.ts'), 'utf8');
  check('Agent 循环模块无存储访问（localStorage/sessionStorage 零出现）', !/localStorage|sessionStorage/.test(agentRun));
  const providerSrc = readFileSync(join(SRC, 'core/llm-provider-browser.ts'), 'utf8');
  check('provider 模块 Key 只经 BYO_KEY_STORAGE 键存取（不落其他键）', (providerSrc.match(/tpms\.byo\.key/g) ?? []).length === 1);
}

// ══ D. 无 key 零回归路径钉（结构级）══
console.log('\n[D] 规则版同步路径钉（行为级由 nl_agent_audit/run_all 覆盖）');
{
  const mainSrc = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf8');
  check('规则同步链 parseNL→applyNLIntent 在位', mainSrc.includes('applyNLIntent(parseNL(text))'));
  check('Agent 分支前有 key 门（无 key 不进异步路径）', /if \(cfg\.kind === 'rules' \|\| \(needKey && !getByoKey\(\)\)\)/.test(mainSrc));
  // A3：导出水密门失败回流修复循环（对齐 CLI verify 含水密门语义）——结构级断言
  check('水密门回流接线（awaitNextRebuild/notifyRebuildDone/verifyFail 水密分支）',
    mainSrc.includes('awaitNextRebuild') && mainSrc.includes('notifyRebuildDone') && mainSrc.includes('导出被水密门拒绝——')
    && /verifyFail: true,\s*\/\/ 触发下一轮 apply_repair/.test(mainSrc));
}

// ══ E. M4 有界修复循环（脚本化 provider 跑真 agent-run 循环）══
console.log('\n[E] M4 修复循环（fail→repair→pass / unreachable / 越界菜单拒）');
{
  check('E0 REPAIR_TOOL 与 tpms-driver 同源（apply_repair 菜单）', REPAIR_TOOL?.name === 'apply_repair' && Array.isArray(REPAIR_TOOL?.parameters?.properties?.patches?.properties?.type?.enum));
  // E1：verify fail → 修复菜单注入 → patch_design(periods=2) → verify pass → final
  {
    let repaired = false;
    let sawRepairMenu = false;
    const rounds = [
      { toolCalls: [{ function: { name: 'tpms_design_verify', arguments: '{"type":"gyroid","porosity":0.75}' } }], raw: '' },
      { toolCalls: [{ function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 2 }, reason: '壁厚不足→降周期' }) } }], raw: '' },
      { toolCalls: [{ function: { name: 'tpms_design_verify', arguments: '{"type":"gyroid","porosity":0.75}' } }], raw: '' },
      { toolCalls: [], raw: '修复完成，壁厚已达标。' },
    ];
    let ri = 0;
    const events = [];
    await runAgent('验证壁厚', {
      complete: async (_m, tools) => {
        const names = tools.map((t) => (t.function ?? t).name);
        if (names.includes('apply_repair')) sawRepairMenu = true;
        return rounds[Math.min(ri++, rounds.length - 1)];
      },
      toolImpls: new Map([
        ['tpms_design_verify', { name: 'tpms_design_verify', write: false, exec: async () => (repaired
          ? { ok: true, verifyFail: false, summary: '{"verdict":"pass","minWallMm":0.51}' }
          : { ok: true, verifyFail: true, summary: '{"verdict":"fail","minWallMm":0.21}' }) }],
      ]),
      repairExec: async (patches) => { repaired = patches.periods === 2; return { ok: true, summary: `修复已应用：${JSON.stringify(patches)}` }; },
      onEvent: (e) => events.push(e),
    });
    const repairRound = events.find((e) => e.type === 'round' && e.repairMode);
    check('E1 失败后注入修复菜单（apply_repair offered）', repairRound != null && sawRepairMenu);
    check('E1 repair-applied 事件（periods=2 补丁）', events.some((e) => e.type === 'repair-applied' && e.patches?.periods === 2));
    const fin = events.find((e) => e.type === 'final');
    check('E1 闭环 fail→repair→pass→final', fin != null && fin.text.includes('修复完成'), fin ? '' : '未到 final');
    check('E1 预算跨轮累计（verify×512×2+repair 2³=1032）', fin?.budgetUsed === 1032, String(fin?.budgetUsed));
  }
  // E2：declare_unreachable → 结构化不可达 final
  {
    const rounds = [
      { toolCalls: [{ function: { name: 'tpms_design_verify', arguments: '{"type":"gyroid","porosity":0.75}' } }], raw: '' },
      { toolCalls: [{ function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'declare_unreachable', reason: 'cylinder+diamond 深水区' }) } }], raw: '' },
    ];
    let ri = 0;
    const events = [];
    await runAgent('验证', {
      complete: async () => rounds[Math.min(ri++, rounds.length - 1)],
      toolImpls: new Map([
        ['tpms_design_verify', { name: 'tpms_design_verify', write: false, exec: async () => ({ ok: true, verifyFail: true, summary: '{"verdict":"fail"}' }) }],
      ]),
      repairExec: async () => ({ ok: true, summary: 'noop' }),
      onEvent: (e) => events.push(e),
    });
    const fin = events.find((e) => e.type === 'final');
    check('E2 declare_unreachable→结构化不可达 final', fin != null && fin.text.includes('结构化不可达'), fin?.text.slice(0, 60) ?? '未到 final');
  }
  // E3：越界菜单（patches.periods=99 > max 12）→ 扩展面拦截拒绝
  {
    const rounds = [
      { toolCalls: [{ function: { name: 'tpms_design_verify', arguments: '{"type":"gyroid","porosity":0.75}' } }], raw: '' },
      { toolCalls: [{ function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { periods: 99 }, reason: '越界' }) } }], raw: '' },
    ];
    let ri = 0;
    const events = [];
    await runAgent('验证', {
      complete: async () => rounds[Math.min(ri++, rounds.length - 1)],
      toolImpls: new Map([
        ['tpms_design_verify', { name: 'tpms_design_verify', write: false, exec: async () => ({ ok: true, verifyFail: true, summary: '{"verdict":"fail"}' }) }],
      ]),
      repairExec: async () => ({ ok: true, summary: 'noop' }),
      onEvent: (e) => events.push(e),
    });
    const rej = events.find((e) => e.type === 'rejected');
    check('E3 越界修复补丁被扩展面拦截（periods 99>12）', rej != null && rej.errors.some((x) => x.includes('maximum')), rej ? '' : '未拒绝');
  }
}

// ══ F. 双壳 iframe 桥（方向 B1：同源/嵌入校验/重活 cap/双壳单源执行体）══
console.log('\n[F] 双壳 iframe 桥接线（结构级）');
{
  const bridgeSrc = readFileSync(join(PLATFORM, 'src/core/iframe-bridge.ts'), 'utf8');
  check('F1 桥服务端同源+嵌入双校验', bridgeSrc.includes('e.origin !== location.origin') && bridgeSrc.includes('window.parent === window'));
  check('F2 重活滑动窗 cap（Σ≤4096/60s，apply=periods³·verify=512）', bridgeSrc.includes('CAP_BUDGET: 4096') && bridgeSrc.includes('CAP_WINDOW_MS: 60_000') && bridgeSrc.includes('? 512 :'));
  const mainSrc2 = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf8');
  check('F3 工程壳被嵌入时开桥且复用同源执行体', mainSrc2.includes('wireHarnessBridge') && mainSrc2.includes('serveBridge({') && mainSrc2.includes('apply: agentMeshExec') && mainSrc2.includes('verify: agentVerifyExec'));
  const harnessSrc = readFileSync(join(PLATFORM, 'src/harness-main.ts'), 'utf8');
  check('F4 驾驶舱壳经桥驱动+规则兜底经桥应用', harnessSrc.includes('bridge.attach()') && harnessSrc.includes("bridge.request('apply'") && harnessSrc.includes("bridge.request('verify'") && harnessSrc.includes('parseNL'));
  const viteSrc = readFileSync(join(PLATFORM, 'vite.config.ts'), 'utf8');
  check('F5 双入口构建（index+harness）', viteSrc.includes('harness: resolve('));
}

// ══ G. 浏览器逆设计 + R48 校准 + 会话确定性绑定（2026-11-13 全量融合）══
console.log('\n[G] 逆设计工具面 + 会话确定性指代 + R48 校准 + 历史窗口');
{
  check('G1 浏览器面含 tpms_pareto（5 工具同源解锁）',
    BROWSER_TOOL_NAMES.includes('tpms_pareto') && browserToolsSchema().tools.some((t) => t.name === 'tpms_pareto'));

  const pRes = await agentParetoExec({ target_e_gpa: 3, target_k_nm2: 2, top: 3 });
  const pJson = pRes.ok ? JSON.parse(pRes.summary) : null;
  check('G2 agentParetoExec 832 点扫描返回 Top-3 排序候选',
    pRes.ok && pJson?.command === 'pareto' && pJson?.scanned === 832
    && Array.isArray(pJson?.recommendations) && pJson.recommendations.length === 3
    && pJson.recommendations[0].dist_log10 <= pJson.recommendations[1].dist_log10,
    JSON.stringify(pJson)?.slice(0, 120));

  const sess = newSession();
  const recorded = recordPareto(sess, { target_e_gpa: 3, target_k_nm2: 2, top: 3 }, pJson);
  const resOk = resolveReference(sess, '把第一个构建出来');
  const meshArgs = resOk.status === 'resolved' ? candidateToMeshArgs(resOk.candidate) : null;
  if (meshArgs) recordExecution(sess, { recId: resOk.recId, ordinal: resOk.ordinal, args: meshArgs });
  check('G3 会话确定性绑定 v2（periods=3 + specimen_size_mm=3×cellSize）',
    recorded && resOk.status === 'resolved' && resOk.ordinal === 1
    && meshArgs?.periods === 3
    && meshArgs?.specimen_size_mm === Number((3 * resOk.candidate.cellSize).toFixed(4))
    && sess.executions.length === 1);

  const rejNeg = resolveReference(sess, '不要构建第一个');
  const rejFmt = resolveReference(sess, '用第二个生成3MF');
  check('G4 否定/混参指代白名单确定性拒绝', rejNeg.status === 'reject' && rejFmt.status === 'reject');

  const estRes = await agentEstimateExec({ type: 'gyroid', porosity: 0.7 });
  const estJson = estRes.ok ? JSON.parse(estRes.summary) : null;
  const expectedR48 = 0.46123269585707205 * Math.pow(0.7, 3.1663);
  check('G5 agentEstimateExec gyroid 含 Sv/KC 与 OpenFOAM R48 校准对比',
    estRes.ok && estJson?.sv_per_mm > 0 && estJson?.kappa_kc_mm2 > 0
    && Math.abs((estJson?.kappa_cfd_r48_mm2 ?? 0) - expectedR48) < 1e-4 && estJson?.kc_ratio > 1,
    JSON.stringify(estJson));

  let seenHistoryRole = false;
  const eventsG = [];
  let gRound = 0;
  await runAgent('按上面建议给出结论', {
    history: [
      { role: 'user', content: '之前推荐过 gyroid' },
      { role: 'assistant', content: '推荐候选 #1 为 gyroid。' },
    ],
    complete: async (msgs) => {
      if (msgs.some((m) => m.role === 'assistant' && String(m.content).includes('gyroid'))) seenHistoryRole = true;
      gRound++;
      if (gRound === 1) return { toolCalls: [{ function: { name: 'tpms_pareto', arguments: '{"target_e_gpa":3,"target_k_nm2":2,"top":2}' } }], raw: '' };
      return { toolCalls: [], raw: '已沿用历史上下文完成推荐。' };
    },
    toolImpls: new Map([['tpms_pareto', { name: 'tpms_pareto', write: false, exec: agentParetoExec }]]),
    onEvent: (e) => eventsG.push(e),
  });
  const finG = eventsG.find((e) => e.type === 'final');
  check('G6 runAgent 转发 history + 核算 PARETO_COST=64',
    seenHistoryRole && finG?.budgetUsed === 64,
    `seen=${seenHistoryRole} budget=${finG?.budgetUsed}`);
}

// ══ H. Phase 2 平台闭环：tpms_scenario 6/6 全对齐 + 后处理引擎 + 在线仿真/导出桥接 ══
console.log('\n[H] Phase 2 闭环：6/6 Schema 工具 + 后处理反演 + 在线仿真/CAE 桥');
{
  const schemaNames = TOOLS_SCHEMA.tools.map((t) => t.name);
  check('H1 浏览器工具面与 schema 6/6 全对齐（含 tpms_scenario）',
    BROWSER_TOOL_NAMES.length === 6
    && schemaNames.every((n) => BROWSER_TOOL_NAMES.includes(n))
    && browserToolsSchema().tools.some((t) => t.name === 'tpms_scenario'),
    BROWSER_TOOL_NAMES.join(','));

  const okPreset = resolveScenarioPreset('bone_scaffold.json');
  const badPath = resolveScenarioPreset('../etc/passwd.json');
  const scFallback = await agentScenarioFallbackExec({ design: 'gyroid_implant.json' });
  const scFallbackJson = scFallback.ok ? JSON.parse(scFallback.summary) : null;
  const scConflict = checkViewportConflicts([
    { name: 'tpms_scenario', arguments: { design: 'bone_scaffold.json' } },
    { name: 'tpms_mesh', arguments: { type: 'diamond', porosity: 0.65 } },
  ]);
  check('H2 tpms_scenario 白名单解析 + 路径穿越拦截 + 同轮写互斥',
    okPreset.ok && okPreset.preset.type === 'gyroid'
    && !badPath.ok
    && scFallback.ok && scFallbackJson?.command === 'scenario' && scFallbackJson?.design === 'gyroid_implant.json'
    && scConflict.ok === false,
    JSON.stringify({ okPreset: okPreset.ok, badPath: badPath.ok, scOk: scFallback.ok, scConflict: scConflict.ok }));

  const eventsH = [];
  let hRound = 0;
  await runAgent('运行骨支架场景', {
    complete: async () => {
      hRound++;
      if (hRound === 1) return { toolCalls: [{ function: { name: 'tpms_scenario', arguments: '{"design":"bone_scaffold.json"}' } }], raw: '' };
      return { toolCalls: [], raw: '场景运行完成。' };
    },
    toolImpls: new Map([['tpms_scenario', { name: 'tpms_scenario', write: true, exec: agentScenarioFallbackExec }]]),
    onEvent: (e) => eventsH.push(e),
  });
  const finH = eventsH.find((e) => e.type === 'final');
  check('H3 runAgent 支持 tpms_scenario 并按 SCENARIO_COST=216 扣账',
    finH?.budgetUsed === 216,
    `budget=${finH?.budgetUsed}`);

  // H4 fixture 自包含（2026-11-14 CI 修复）：原读 sim/out/csv_expl/gyroid_k2_p60_expl.csv——gitignored 本机产物，
  // macos CI ENOENT 崩溃（exit 1 / 0.4s）。内嵌确定性 fixture：原文提取自 abaqus-explicit-sim ODB（gyroid k2 p60，11-01 批）。
  const gyCsv = `# source=abaqus-explicit-sim
# porosity=0.60
# type=gyroid
# lengthMm=12.5664
# widthMm=12.5664
# thicknessMm=12.5664
displacement_mm,force_N
0.000000,0.0000
0.006558,28.0751
0.048420,171.6165
0.150599,510.5893
0.327648,908.2839
0.585440,1161.9918
0.922238,1297.7471
1.330260,1368.5054
1.795386,1417.7974
2.300877,1456.2043
2.827780,1492.9060
3.354315,1526.8538
3.859972,1566.5367
4.325031,1628.6154
4.732716,1701.4566
5.069633,1778.3096
5.327415,1878.5058
5.504381,1950.6284
5.606498,2002.3067
5.648318,2026.4793
5.654860,2022.4044`;
  const isoRes = fitExperimentalCurve({
    text: gyCsv,
    inputType: 'displacement-force',
    specimenDimensions: { lengthMm: 12.5664, widthMm: 12.5664, thicknessMm: 12.5664 },
  });
  const fcRes = forchheimerTwoPoint({
    q1: 1e-7,
    dp1: 50,
    q2: 1e-6,
    dp2: 650,
    length: 0.01,
    area: 1e-4,
  });
  check('H4 ABAQUS Gyroid p60 EXPL ISO 13314 反演 + Forchheimer 双点分离实跑通过',
    isoRes.metrics.elasticModulusE > 0 && isoRes.metrics.proofStressRp02 > 0
    && isoRes.metrics.plateauStress > 0 && isoRes.metrics.energyAbsorptionW > 0
    && fcRes.kInt > 0 && fcRes.inertialFraction[1] > fcRes.inertialFraction[0],
    `E=${isoRes.metrics.elasticModulusE.toFixed(1)} pl=${isoRes.metrics.plateauStress.toFixed(2)} kInt=${fcRes.kInt.toExponential(2)}`);

  const bridgeSrc2 = readFileSync(join(PLATFORM, 'src/core/iframe-bridge.ts'), 'utf8');
  const mainSrc3 = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf8');
  const harnessSrc2 = readFileSync(join(PLATFORM, 'src/harness-main.ts'), 'utf8');
  const harnessHtml2 = readFileSync(join(PLATFORM, 'harness.html'), 'utf8');
  check('H5 iframe-bridge + main + harness 在线仿真/后处理/CAE 交付同源接线',
    bridgeSrc2.includes("'scenario'") && bridgeSrc2.includes("'simulate'") && bridgeSrc2.includes("'export-cae'")
    && mainSrc3.includes('agentScenarioExec') && mainSrc3.includes('agentSimulateExec') && mainSrc3.includes('agentExportCaeExec')
    && mainSrc3.includes('mat.vertexColors = true')
    && harnessSrc2.includes('runIso13314PostProc') && harnessSrc2.includes('runForchheimerPanel')
    && harnessHtml2.includes('sim-live-section') && harnessHtml2.includes('postproc-panel') && harnessHtml2.includes('cae-export-panel'));
}

// ══ I. Phase 3 自治多步流水线 + V6/V7 高阶多物理场 + 工程验收报告 ══
console.log('\n[I] Phase 3 闭环：LPBF/骨长入/水平集/声子能带 + isoGrad/hybrid 槽位 + 报告导出');
{
  const lpbfRes = simulateLPBF({ N: 32, dx: 25e-6, power: 200, speed: 1.0, totalTime: 1.2e-3 });
  check('I1 simulateLPBF N=32 热-力耦合求解通过且能量守恒稳定',
    lpbfRes.stability.ok && lpbfRes.peakTemperature > 353 && lpbfRes.meltPoolVoxels > 0 && lpbfRes.residualStress > 0,
    `Tmax=${lpbfRes.peakTemperature.toFixed(0)}K stress=${(lpbfRes.residualStress / 1e6).toFixed(1)}MPa win=${lpbfRes.window}`);

  const buildGyroidMask = (R) => {
    const V = new Float64Array(R * R * R);
    for (let iz = 0; iz < R; iz++) {
      const wz = -Math.PI + (2 * Math.PI * (iz + 0.5)) / R;
      for (let iy = 0; iy < R; iy++) {
        const wy = -Math.PI + (2 * Math.PI * (iy + 0.5)) / R;
        for (let ix = 0; ix < R; ix++) {
          const wx = -Math.PI + (2 * Math.PI * (ix + 0.5)) / R;
          V[ix + iy * R + iz * R * R] = analyticFieldValue('gyroid', wx, wy, wz, [1, 1, 1, 1]);
        }
      }
    }
    const sorted = Float64Array.from(V).sort();
    const iso = sorted[Math.round(0.30 * sorted.length)];
    const m = new Uint8Array(R * R * R);
    for (let i = 0; i < m.length; i++) m[i] = V[i] < iso ? 1 : 0;
    return m;
  };

  const tMask = buildGyroidMask(16);
  const tisRes = simulateTissueGrowth({ R: 16, solid: tMask, days: 28 });
  const tLast = tisRes.stats[tisRes.stats.length - 1];
  check('I2 simulateTissueGrowth 0-28 天骨组织生长动力学与 3D 氧场产出有效',
    tisRes.o2Frames.length > 0 && tLast.viability > 0 && tLast.mineralPct > 0 && Number.isFinite(tisRes.meanO2Core),
    `viab=${(tLast.viability * 100).toFixed(1)}% mineral=${tLast.mineralPct.toFixed(1)}%`);

  const phi0 = new Float64Array(tMask.length);
  for (let i = 0; i < phi0.length; i++) phi0[i] = tMask[i] ? 1 : -1;
  const lsRes = evolveLevelSet({ R: 16, phi0, steps: 6, wStiff: 1, wFlow: 0.25 });
  const vField = phiToVField(lsRes.phi, 16, 0);
  check('I3 evolveLevelSet 演化与 phiToVField (R+1)^3 契约满足',
    lsRes.compliance.length > 0 && vField.length === 17 * 17 * 17 && vField instanceof Float32Array,
    `len=${vField.length} grad=${lsRes.gradNormMean.toFixed(3)}`);

  const phMask = buildGyroidMask(7);
  const phRes = solvePhononicBands({ N: 7, solid: phMask, rhoS: 4430, matrixEPa: 110e9, cellSizeM: 1e-3, numBands: 8, kPointsPerSeg: 4, maxIter: 100 });
  check('I4 solvePhononicBands N=7 Bloch-Floquet Γ 零模态=3 与 8 支色散有效',
    phRes.zeroModesAtGamma >= 3 && phRes.bands.length === 8 && phRes.cTargetMs > 0 && phRes.cMeasuredMs > 0,
    `zero=${phRes.zeroModesAtGamma} cRatio=${(phRes.cMeasuredMs / phRes.cTargetMs).toFixed(3)} gaps=${phRes.bandgaps.length}`);

  const bridgeSrc3 = readFileSync(join(PLATFORM, 'src/core/iframe-bridge.ts'), 'utf8');
  const mainSrc4 = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf8');
  const harnessSrc3 = readFileSync(join(PLATFORM, 'src/harness-main.ts'), 'utf8');
  const harnessHtml3 = readFileSync(join(PLATFORM, 'harness.html'), 'utf8');
  check('I5 Phase 3 桥接协议/槽位透传/自治流水线与工程报告静态接线完整',
    bridgeSrc3.includes("'lpbf'") && bridgeSrc3.includes("'tissue'") && bridgeSrc3.includes("'levelset'") && bridgeSrc3.includes("'phononic'")
    && bridgeSrc3.includes("'gcode'") && bridgeSrc3.includes("'py'") && bridgeSrc3.includes("'design'")
    && mainSrc4.includes('parseAgentHybridSpec') && mainSrc4.includes('args.isoGrad') && mainSrc4.includes('exportedFile = `${base}.bib`')
    && harnessSrc3.includes('runAutonomousPipeline') && harnessSrc3.includes('exportHarnessReport')
    && harnessSrc3.includes('drawTissueCanvas') && harnessSrc3.includes('drawPhononicCanvas')
    && harnessHtml3.includes('sim-btn-pipeline') && harnessHtml3.includes('exp-btn-report-md') && harnessHtml3.includes('exp-btn-report-json'));
}

// ════════ [J] Phase 4 闭环：DSH 控制台 + 三轨 BL 前处理 + COMSOL Java + CAE 守护进程 ════════
{
  console.log('\n[J] Phase 4 闭环：DSH 控制台 + 三轨 BL 前处理 + COMSOL Java + CAE 守护进程');
  const os = await import('node:os');
  const fsSync = await import('node:fs');
  const pathMod = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { isAllowedOrigin, resolveSafeOutPath, createCaeServer } = await import('../agent/cae-daemon.mjs');

  const srv = createCaeServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  let httpOk = false;
  try {
    const rEnv = await fetch(`${baseUrl}/api/cae/env`);
    const jEnv = await rEnv.json();
    const rTrav = await fetch(`${baseUrl}/api/cae/file?name=../../secret.txt`);
    const rBadJob = await fetch(`${baseUrl}/api/cae/job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'rm_rf', params: {} }),
    });
    httpOk = rEnv.status === 200 && jEnv.ok === true && Boolean(jEnv.engines?.python)
      && rTrav.status === 404 && rBadJob.status === 400;
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
  check('J1 cae-daemon 原产地校验 / 路径穿越封堵 / 白名单与 /api/cae/env 通过',
    isAllowedOrigin('http://127.0.0.1:4825')
    && !isAllowedOrigin('https://evil.example.com')
    && resolveSafeOutPath('../../secret') === null
    && resolveSafeOutPath('test_bl.bdf') !== null
    && httpOk);

  // 【2026-11-14 CI 修复】J2/J3 实跑依赖本机 CAE python 环境（trimesh/skimage/gmsh）——CI 仅装 numpy。
  // 环境条件断言（webgpu_parity "真GPU环境+2" 同款先例）：满配档跑真网格链；无环境档=JSON 契约静态钉（降级披露）。
  const pyCaeProbeJ = spawnSync('python', ['-c', 'import trimesh, skimage, gmsh'], { encoding: 'utf8', timeout: 30000 });
  const pyCaeReadyJ = pyCaeProbeJ.status === 0;
  if (pyCaeReadyJ) {
    const tmpDir = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), 'tpms_p4_audit_'));
    try {
      const repoRoot = pathMod.resolve(PLATFORM, '..', '..');
      const p1Res = spawnSync('python', [
        pathMod.join(repoRoot, 'sim', 'p1_bl_mesh.py'),
        '--backend', 'gmsh-bl', '--type', 'diamond', '--k', '1', '--R', '16',
        '--por', '0.65', '--cell-size', '4.0', '--bl-layers', '2',
        '--out-dir', tmpDir, '--json',
      ], { encoding: 'utf8', timeout: 60000 });
      const p1Json = JSON.parse((p1Res.stdout || '').trim().split(/\r?\n/).pop() || '{}');
      check('J2 p1_bl_mesh 三轨 BL（nTop 契约 + Gmsh 多物理组 .bdf/.msh/.inp）通过',
        p1Res.status === 0
        && p1Json.ok === true
        && p1Json.gmsh?.tets > 500
        && p1Json.gmsh?.surfaceGroups?.inlet > 0
        && p1Json.gmsh?.surfaceGroups?.outlet > 0
        && p1Json.gmsh?.surfaceGroups?.scaffoldWall > 0
        && fsSync.existsSync(p1Json.gmsh?.bdfPath || '')
        && fsSync.existsSync(p1Json.ntop?.ntopInputJson || ''),
        `tets=${p1Json.gmsh?.tets} minSICN=${p1Json.gmsh?.minSICN}`);

      const comsolOutDir = pathMod.join(tmpDir, 'comsol');
      const p4Res = spawnSync('python', [
        pathMod.join(repoRoot, 'sim', 'p4_comsol_setup.py'),
        '--type', 'diamond', '--k', '1', '--R', '16', '--por', '0.65',
        '--cell-size', '4.0', '--mesh', p1Json.gmsh.bdfPath,
        '--out-dir', comsolOutDir, '--json',
      ], { encoding: 'utf8', timeout: 30000 });
      const p4Json = JSON.parse((p4Res.stdout || '').trim().split(/\r?\n/).pop() || '{}');
      const javaSrc = p4Json.javaPath && fsSync.existsSync(p4Json.javaPath)
        ? fsSync.readFileSync(p4Json.javaPath, 'utf8')
        : '';
      check('J3 p4_comsol_setup 生成合规 COMSOL 6.2 Model Java 模板（LaminarFlow + AvSurface）',
        p4Res.status === 0
        && javaSrc.includes('ModelUtil.create("Model")')
        && javaSrc.includes('"LaminarFlow"')
        && javaSrc.includes('"AvSurface"')
        && javaSrc.includes('"sel_inlet"')
        && javaSrc.includes('"sel_wall"'));
    } finally {
      fsSync.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    const repoRootJ = pathMod.resolve(PLATFORM, '..', '..');
    const p1Src = readFileSync(join(repoRootJ, 'sim', 'p1_bl_mesh.py'), 'utf8');
    const p4Src = readFileSync(join(repoRootJ, 'sim', 'p4_comsol_setup.py'), 'utf8');
    check('J2* 无 CAE python 环境档（CI 仅 numpy）：p1_bl_mesh/p4_comsol JSON 契约静态钉——满配档=本机全量套件真网格链',
      p1Src.includes("'--json'")
      && p1Src.includes('rveSpeedupFactor')
      && p1Src.includes('meshDoctor')
      && p1Src.includes('surfaceGroups')
      && p1Src.includes('ntopInputJson')
      && p1Src.includes('bdfPath')
      && p4Src.includes('javaPath')
      && p4Src.includes('LaminarFlow')
      && p4Src.includes('AvSurface'));
  }

  const hHtml4 = readFileSync(join(PLATFORM, 'harness.html'), 'utf8');
  const dshSrc = readFileSync(join(PLATFORM, 'src/harness-cae-dsh.ts'), 'utf8');
  const hMain4 = readFileSync(join(PLATFORM, 'src/harness-main.ts'), 'utf8');
  const chipMatches = hHtml4.match(/class="chip"/g) || [];
  const tabMatches = hHtml4.match(/class="tab(?:\s|")/g) || [];
  check('J4 DSH 三栏工作台 / Split Dock / 斜杠菜单 / 静默 CI 守护隔离接线完整',
    hHtml4.includes('id="dsh-sidebar"')
    && hHtml4.includes('id="dock-split-btn"')
    && hHtml4.includes('id="dsh-slash-menu"')
    && hHtml4.includes('id="cae-btn-comsol"')
    && chipMatches.length === 4
    && tabMatches.length === 3
    && dshSrc.includes("window.location.port === '4830'")
    && dshSrc.includes('/api/cae/job')
    && hMain4.includes('./harness-cae-dsh'));
}

// ════════ [K] Phase 5 闭环：nTopCL 容器合成 / RVE Mesh Doctor / 双流速 CFD + WSS / 产物 3D 预览 ════════
{
  console.log('\n[K] Phase 5 闭环：nTopCL 容器合成 / RVE Mesh Doctor / 双流速 CFD + WSS / 对标 UI');
  const os = await import('node:os');
  const fsSync = await import('node:fs');
  const pathMod = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { createCaeServer, resolveArtifactRawPath } = await import('../agent/cae-daemon.mjs');
  const repoRoot = pathMod.resolve(PLATFORM, '..', '..');

  // K1: ntop_builder.py + sim/ntop/tpms_bl_cfd.ntop 容器签名验证
  // 【2026-11-14 CI 修复】macos 镜像无裸 `python` 命令（python3 only）——spawn 失败(status null)时回退 python3。
  const ntopVerifyArgs = ['--verify', pathMod.join(repoRoot, 'sim', 'ntop', 'tpms_bl_cfd.ntop'), '--json'];
  const ntopVerRes0 = spawnSync('python', [pathMod.join(repoRoot, 'sim', 'ntop_builder.py'), ...ntopVerifyArgs], { encoding: 'utf8', timeout: 20000 });
  const ntopVerRes = ntopVerRes0.status !== null ? ntopVerRes0
    : spawnSync('python3', [pathMod.join(repoRoot, 'sim', 'ntop_builder.py'), ...ntopVerifyArgs], { encoding: 'utf8', timeout: 20000 });
  const ntopPath = pathMod.join(repoRoot, 'sim', 'ntop', 'tpms_bl_cfd.ntop');
  const ntopVerJson = JSON.parse((ntopVerRes.stdout || '{}').trim());
  const funcs = ntopVerJson.verified?.funcs || [];
  check('K1 nTopCL 容器合成器与 sim/ntop/tpms_bl_cfd.ntop (MAGIC%$1 + boundary_layer_mesh) 合法',
    ntopVerRes.status === 0
    && fsSync.existsSync(ntopPath)
    && ntopVerJson.verified?.valid === true
    && funcs.some((f) => String(f).includes('boundary_layer_mesh'))
    && funcs.some((f) => String(f).includes('export_fe_mesh')));

  // K2: p1_bl_mesh --cfd-periods 1 (RVE 27x speedup + meshDoctor) + p3_openfoam_solve 双流速+WSS
  // 【2026-11-14 CI 修复】同 J2/J3 环境条件断言：p1_bl_mesh 需 trimesh/skimage/gmsh——CI 仅装 numpy。
  const pyCaeProbeK = spawnSync('python', ['-c', 'import trimesh, skimage, gmsh'], { encoding: 'utf8', timeout: 30000 });
  const pyCaeReadyK = pyCaeProbeK.status === 0;
  if (pyCaeReadyK) {
    const tmpDirK = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), 'tpms_p5_audit_'));
    try {
      const p1Rve = spawnSync('python', [
        pathMod.join(repoRoot, 'sim', 'p1_bl_mesh.py'),
        '--backend', 'gmsh-bl', '--type', 'gyroid', '--k', '3', '--cfd-periods', '1',
        '--R', '16', '--por', '0.70', '--cell-size', '4.0', '--bl-layers', '3',
        '--out-dir', tmpDirK, '--json',
      ], { encoding: 'utf8', timeout: 60000 });
      const p1RveJson = JSON.parse((p1Rve.stdout || '').trim().split(/\r?\n/).pop() || '{}');

      const p3Res = spawnSync('python', [
        pathMod.join(repoRoot, 'sim', 'p3_openfoam_solve.py'),
        '--type', 'gyroid', '--k', '3', '--cfd-periods', '1', '--por', '0.70',
        '--cell-size', '4.0', '--grid-n', '18', '--out-dir', tmpDirK, '--json',
      ], { encoding: 'utf8', timeout: 60000 });
      const p3Json = JSON.parse((p3Res.stdout || '').trim().split(/\r?\n/).pop() || '{}');

      check('K2 RVE k=3→k_cfd=1 (27x) + Mesh Doctor + p3_openfoam_solve 双流速 Forchheimer/WSS 求解通过',
        p1Rve.status === 0
        && p1RveJson.rveSpeedupFactor === 27
        && p1RveJson.fullSpecimenLengthScale === 3
        && p1RveJson.meshDoctor != null
        && typeof p1RveJson.meshDoctor.healed === 'boolean'
        && p3Res.status === 0
        && p3Json.ok === true
        && p3Json.dp1_Pa > 0
        && p3Json.dp2_Pa > p3Json.dp1_Pa
        && p3Json.K_m2 > 0
        && p3Json.beta_m1 > 0
        && p3Json.Fo_v2 > 0
        && Array.isArray(p3Json.residuals)
        && p3Json.residuals.length >= 6
        && typeof p3Json.wssOsteogenicWindowRatio === 'number'
        && fsSync.existsSync(pathMod.join(tmpDirK, 'cfd_dp.csv')),
        `K=${p3Json.K_m2} wssPct=${p3Json.wssOsteogenicWindowPct}%`);
    } finally {
      fsSync.rmSync(tmpDirK, { recursive: true, force: true });
    }
  } else {
    const p1SrcK = readFileSync(join(repoRoot, 'sim', 'p1_bl_mesh.py'), 'utf8');
    const p3SrcK = readFileSync(join(repoRoot, 'sim', 'p3_openfoam_solve.py'), 'utf8');
    check('K2* 无 CAE python 环境档（CI 仅 numpy）：p1 RVE/Mesh Doctor + p3 双流速 JSON 契约静态钉——满配档=本机全量套件真网格链',
      p1SrcK.includes('rveSpeedupFactor')
      && p1SrcK.includes('meshDoctor')
      && p1SrcK.includes('--cfd-periods')
      && p3SrcK.includes('--v1')
      && p3SrcK.includes('--v2')
      && p3SrcK.includes('dp1_Pa')
      && p3SrcK.includes('dp2_Pa')
      && p3SrcK.includes('K_m2')
      && p3SrcK.includes('beta_m1')
      && p3SrcK.includes('Fo_v2')
      && p3SrcK.includes('residuals')
      && p3SrcK.includes('wssOsteogenicWindowRatio')
      && p3SrcK.includes('cfd_dp.csv'));
  }

  // K3: cae-daemon /api/cae/artifact-raw 路径穿越拦截(400) + /api/cae/pipeline 路由校验
  const srvK = createCaeServer();
  await new Promise((resolve) => srvK.listen(0, '127.0.0.1', resolve));
  const addrK = srvK.address();
  const urlK = `http://127.0.0.1:${addrK.port}`;
  let k3HttpOk = false;
  try {
    const rBadTrav = await fetch(`${urlK}/api/cae/artifact-raw?name=../../etc/passwd`);
    const rBadExt = await fetch(`${urlK}/api/cae/artifact-raw?name=evil.exe`);
    const rMissing = await fetch(`${urlK}/api/cae/artifact-raw?name=nonexistent_rve_probe.stl`);
    k3HttpOk = rBadTrav.status === 400 && rBadExt.status === 400 && rMissing.status === 404;
  } finally {
    await new Promise((resolve) => srvK.close(resolve));
  }
  const selfRes = spawnSync('node', [pathMod.join(repoRoot, 'tpms', 'agent', 'cae-daemon.mjs'), '--self-test'], {
    encoding: 'utf8',
    timeout: 25000,
  });
  check('K3 cae-daemon /api/cae/artifact-raw 路径穿越阻断 (400) 与 --self-test 门禁通过',
    k3HttpOk
    && resolveArtifactRawPath('../../etc/passwd') === null
    && resolveArtifactRawPath('sim/out/sample.stl') !== null
    && selfRes.status === 0);

  // K4: Phase 5 前端监控 SVG / 四级保真度矩阵 / 3D STL 叠加接线完整
  const hHtml5 = readFileSync(join(PLATFORM, 'harness.html'), 'utf8');
  const dshSrc5 = readFileSync(join(PLATFORM, 'src/harness-cae-dsh.ts'), 'utf8');
  const brSrc5 = readFileSync(join(PLATFORM, 'src/core/iframe-bridge.ts'), 'utf8');
  const mainSrc5 = readFileSync(join(PLATFORM, 'src/main.ts'), 'utf8');
  check('K4 Phase 5 前端残差/WSS SVG 监控 + 四级对标矩阵 + overlay-stl 3D 视口接线完整',
    hHtml5.includes('id="cae-residual-svg"')
    && hHtml5.includes('id="cae-wss-svg"')
    && hHtml5.includes('id="cae-parity-matrix"')
    && hHtml5.includes('id="cae-mesh-doctor-badge"')
    && hHtml5.includes('id="cae-cfd-periods"')
    && hHtml5.includes('id="cae-btn-pipeline"')
    && dshSrc5.includes('/api/cae/artifact-raw')
    && brSrc5.includes("'overlay-stl'")
    && mainSrc5.includes('agentOverlayStlExec'));
}

console.log(`\n== AGENT-BRIDGE: ${passCount} PASS / ${failCount} FAIL ==`);
if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exitCode = 1; }
try { rmSync(BUNDLE); rmSync(entry); } catch { /* 临时文件清理尽力 */ }
