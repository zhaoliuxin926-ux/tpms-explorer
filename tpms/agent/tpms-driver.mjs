/**
 * tpms-driver.mjs — M4 闭环驱动器：propose → 执行 → 读门禁结构化输出 → LLM 选修复策略 → 重跑
 *
 * 铁律（沿用 M3）：LLM 只在**有界策略菜单**里选修复动作并填有界槽位；
 * 修复的应用、执行与验收全部由确定性代码完成（validateToolCalls 同源拦截器钳制）。
 *
 * 与 verify 内建修复梯（分辨率升档/割线校正）的关系：梯内修复由 verify 确定性完成；
 * 本驱动器接管**梯外修复**——换曲面族 / 降周期数 / 换容器 / 改模式 / 参数层修正，
 * 以及「不可达」的结构化宣告（如 cylinder+diamond 类深水区，修复无意义应如实报告）。
 *
 * 用法：
 *   node tpms-driver.mjs --design 方案.json [--max-rounds 6] [--provider openai|ollama|mock] [--model X]
 * 退出码：0=收敛 PASS  2=参数/LLM 输出被拒  3=设计被宣告不可达  4=轮数耗尽未收敛
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateToolCalls,
  OllamaProvider, OpenAICompatProvider,
} from './llm-provider.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TPMS = join(HERE, 'tpms.mjs');

// ── 修复动作 schema（有界策略菜单；validateToolCalls 同源钳制）──
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd'];
const REPAIR_TOOL = {
  name: 'apply_repair',
  description: '根据 verify 失败诊断选择下一轮修复。规则：水密/非流形失败（薄壁自触族）优先降 periods 或换曲面族；分辨率不足优先提 resolution（≤128）；参数层错误按 paramErrors 逐项修正；确定不可达（如 cylinder+diamond 深水区）才 declare_unreachable。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'reason'],
    properties: {
      action: { type: 'string', enum: ['patch_design', 'declare_unreachable'] },
      patches: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: TYPES },
          porosity: { type: 'number', minimum: 0.05, maximum: 0.99, description: '目标孔隙率，0-1 小数口径（diag 的 designNormalized.porosity 同口径；勿用百分数）' },
          periods: { type: 'integer', minimum: 1, maximum: 12 },
          resolution: { type: 'integer', minimum: 48, maximum: 128 },
          container: { type: 'string', enum: ['cube', 'cylinder'] },
          mode: { type: 'string', enum: ['solid_network', 'shell', 'gradient_shell'] },
          material: { type: 'string', enum: ['tc4', 'polymer', 'thermal'] },
        },
      },
      reason: { type: 'string' },
    },
  },
};

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--design') a.design = argv[++i];
    else if (s === '--max-rounds') a.maxRounds = Number(argv[++i]);
    else if (s === '--provider') a.provider = argv[++i];
    else if (s === '--model') a.model = argv[++i];
    else if (s === '--base-url') a.baseUrl = argv[++i];
    else if (s === '--api-key') a.apiKey = argv[++i];
    else if (s === '--json') a.json = true;
    else if (s.startsWith('--')) { console.error(`未知选项 ${s}`); process.exit(2); }
    else a._.push(s);
  }
  return a;
}

/** 确定性执行 verify 并解析结构化 JSON（stdout 纯 JSON 契约） */
function runVerify(designFile, maxRounds) {
  const r = spawnSync(process.execPath, [TPMS, 'verify', '--design', designFile, '--max-rounds', String(maxRounds), '--json'], {
    encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024,
  });
  let out = null;
  try { out = JSON.parse(r.stdout ?? ''); } catch { /* fail 路径 stdout 为空 */ }
  return { exit: r.status, out, stderr: (r.stderr ?? '').slice(-400) };
}

const SYSTEM_PROMPT = `你是 TPMS 闭环驱动的修复策略器。每轮你会收到 verify 的结构化失败诊断
（finalStage / suggestions / 当前设计参数 / 已尝试轮次），请从有界动作菜单选择下一轮修复。
口径：patches.porosity 用 0-1 小数（diag.designNormalized 同口径，勿用百分数）。\n原则：①只动与失败相关的槽位，一次一小步；②薄壁自触类失败（非流形边>0）优先降 periods 或换低谐波曲面族，
其次升 resolution（≤128）；③cylinder+diamond 组合已知为不可达深水区，应 declare_unreachable；
④同一修复连续失败两次后应换策略或宣告不可达，不要重复无效修补。`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let maxRounds = 6;
  if (a.maxRounds !== undefined) {
    if (!Number.isInteger(a.maxRounds) || a.maxRounds < 1 || a.maxRounds > 12) { console.error('--max-rounds 须为 1~12 整数'); process.exitCode = 2; return; } // 红队 C C-14：静默回退违反无静默回退铁律
    maxRounds = a.maxRounds;
  }
  if (!a.design) { console.error('用法: node tpms-driver.mjs --design 方案.json [--max-rounds 6] [--provider openai|ollama|mock]'); process.exitCode = 2; return; }

  // 原始设计文件只读；工作副本独立维护（收官报告可 diff 出全部自动修复轨迹）
  let design;
  try { design = JSON.parse(readFileSync(a.design, 'utf8')); } catch (e) { console.error(`✗ 设计文件解析失败: ${e.message}`); process.exitCode = 2; return; }
  const workFile = a.design.replace(/\.json$/i, '') + `.driver-${process.pid}.json`; // 红队 C C-9：并发实例共享 workFile 竞态
  const writeWork = () => writeFileSync(workFile, JSON.stringify(design, null, 2));
  writeWork();

  const tools = [{ type: 'function', function: REPAIR_TOOL }];

  let provider;
  if (a.provider === 'mock') {
    // 离线回归：TPMS_DRIVER_MOCK_DECISIONS 为修复决策队列（每轮弹出一个，耗尽即宣告不可达）
    let q = [];
    try { q = process.env.TPMS_DRIVER_MOCK_DECISIONS ? JSON.parse(process.env.TPMS_DRIVER_MOCK_DECISIONS) : []; }
    catch { console.error('✗ TPMS_DRIVER_MOCK_DECISIONS 非法 JSON'); process.exitCode = 2; return; } // 红队 C C-6
    let qi = 0;
    provider = {
      complete: async () => ({
        // 队列元素必须已是 tool-call 形状（{function:{name,arguments:"JSON 串"}}）——原样透传
        toolCalls: [q[qi++] ?? { function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'declare_unreachable', reason: 'mock 队列耗尽' }) } }],
        raw: 'mock',
      }),
    };
  } else if (a.provider === 'openai') {
    provider = new OpenAICompatProvider({
      baseUrl: a.baseUrl ?? process.env.TPMS_LLM_BASE_URL,
      apiKey: a.apiKey ?? process.env.TPMS_LLM_API_KEY,
      model: a.model ?? process.env.TPMS_LLM_MODEL ?? 'glm-4-flash',
    });
  } else {
    provider = new OllamaProvider({ baseUrl: a.baseUrl, model: a.model });
  }
  // MockProvider 按队列弹出决策（见上方 mock 分支覆写 complete）

  const history = [];
  let verdict = null;
  let final = null;

  for (let round = 1; round <= maxRounds; round++) {
    const v = runVerify(workFile, 5);
    if (v.out?.verdict === 'pass') {
      verdict = 'pass';
      final = { rounds: round, file: v.out.file, metrics: v.out.metrics, resolutionUsed: v.out.resolutionUsed };
      break;
    }
    const diag = {
      round, exit: v.exit,
      finalStage: v.out?.finalStage ?? v.out?.stage ?? 'unknown',
      paramErrors: v.out?.paramErrors ?? [],
      designNormalized: v.out?.designNormalized ?? design,
      suggestions: v.out?.suggestions ?? [],
      stderrTail: v.out ? undefined : v.stderr,
    };
    history.push({ round: diag.round, finalStage: diag.finalStage, design: { ...design } });

    // LLM 选修复（有界菜单，M3 同源拦截器钳制）
    let llmOut;
    try {
      llmOut = await provider.complete([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: 'verify 失败诊断：\n' + JSON.stringify(diag, null, 2) },
      ], [{ type: 'function', function: REPAIR_TOOL }]);
    } catch (e) { console.error(`✗ LLM 调用失败: ${e.message}`); process.exitCode = 2; return; }

    const check = validateToolCalls(llmOut.toolCalls, { tools: [REPAIR_TOOL] });
    if (!check.ok) { console.error(`✗ 修复决策被拦截器拒绝: ${check.errors.join('；')}`); process.exitCode = 2; return; }
    // validateToolCalls 返回 {name, arguments}——action/patches/reason 在 arguments 内
    const decision = check.calls[0]?.arguments ?? {};
    const action = decision.action, patches = decision.patches ?? {}, reason = decision.reason;
    history.push({ round: diag.round, decision: { action, patches, reason } });

    if (action === 'declare_unreachable') {
      verdict = 'unreachable';
      final = { rounds: round, reason };
      break;
    }
    // patch_design：确定性应用（只覆盖给出的键）
    Object.assign(design, patches);
    writeWork();
    console.error(`[round ${round}] ${action} ${JSON.stringify(patches)} — ${reason}`);
  }

  if (!verdict) { verdict = 'max_rounds'; final = { rounds: maxRounds, workFile }; }
  const report = {
    command: 'tpms-driver', design: a.design, workFile, verdict,
    rounds: final?.rounds ?? maxRounds,
    ...(verdict === 'pass' ? { file: final.file, metrics: final.metrics, resolutionUsed: final.resolutionUsed } : {}),
    ...(verdict === 'unreachable' ? { reason: final.reason } : {}),
    history,
    boundary: 'M4 闭环驱动器：LLM 仅在有界策略菜单中选修复动作；修复应用/执行/验收为确定性代码；不可达宣告为结构化诚实输出',
  };
  if (a.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\n== DRIVER ${verdict.toUpperCase()}（${report.rounds} 轮）==`);
    if (verdict === 'pass') console.log(`  交付 ${final.file}（R=${final.resolutionUsed}，实测孔隙率 ${(final.metrics?.porosityEstimate * 100).toFixed(2)}%）`);
    if (verdict === 'unreachable') console.log(`  结构化不可达: ${final.reason}`);
  }
  process.exitCode = verdict === 'pass' ? 0 : verdict === 'unreachable' ? 3 : 4;
  // 工作副本保留供 diff 审计；失败时清理空工作文件
  // 红队 C C-4：语义反转修正——失败路径的修复轨迹审计价值最高，保留 workFile；
  // pass 路径 diff 已完成（报告含 history），清理工作副本防堆积
  if (verdict === 'pass') { try { rmSync(workFile); } catch { /* 保留亦可 */ } }
}

main();
