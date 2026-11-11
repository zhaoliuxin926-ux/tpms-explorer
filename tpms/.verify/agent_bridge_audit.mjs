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
writeFileSync(entry, `export { TOOLS_SCHEMA, BROWSER_TOOL_NAMES, validateToolCalls, checkViewportConflicts, VIEWPORT_OUT } from ${JSON.stringify(join(PLATFORM, 'src/core/agent-contract.ts'))};`);
const BUNDLE = join(tmpdir(), 'agbr_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
const { TOOLS_SCHEMA, BROWSER_TOOL_NAMES, validateToolCalls, checkViewportConflicts, VIEWPORT_OUT } = await import(pathToFileURL(BUNDLE));

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
}

console.log(`\n== AGENT-BRIDGE: ${passCount} PASS / ${failCount} FAIL ==`);
if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exitCode = 1; }
try { rmSync(BUNDLE); rmSync(entry); } catch { /* 临时文件清理尽力 */ }
