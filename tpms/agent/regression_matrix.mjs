#!/usr/bin/env node
/**
 * regression_matrix.mjs — 回归矩阵（覆盖拦截器，禁止 mock 假绿）
 *
 * 离线：TPMS_MOCK_TOOLCALLS 注入合法/非法 toolCalls，对照 validateToolCalls。
 * 在线：--live 委托 llm_regression.mjs（需 TPMS_LLM_API_KEY/BASE_URL）。
 *
 * 运行: node tpms/agent/regression_matrix.mjs [--rounds 3] [--live]
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const AGENT = join(HERE, 'llm-agent.mjs');
const LIVE = process.argv.includes('--live');
const roundsArg = process.argv.indexOf('--rounds');
const ROUNDS_RAW = roundsArg >= 0 ? Number(process.argv[roundsArg + 1]) : 3;
const ROUNDS = Number.isInteger(ROUNDS_RAW) && ROUNDS_RAW > 0 ? ROUNDS_RAW : (roundsArg >= 0 ? 0 : 3);
if (ROUNDS < 1) {
  console.error('FAIL --rounds 必须为正整数');
  process.exit(1);
}

/** id | 期望 | 注入 toolCalls */
const CASES = [
  {
    id: 'A1-骨支架合法',
    expect: 'accept',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 75, resolution: 64 }) } }],
  },
  {
    id: 'A2-越界孔隙',
    expect: 'reject',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 120, resolution: 64 }) } }],
  },
  {
    id: 'A3-路径穿越',
    expect: 'reject',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'gyroid', porosity: 65, resolution: 64, out: '../../etc/passwd.stl' }) } }],
  },
  {
    id: 'A4-Diamond合法',
    expect: 'accept',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'diamond', porosity: 65, resolution: 48 }) } }],
  },
  {
    id: 'A5-非法类型',
    expect: 'reject',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'warpdrive', porosity: 50, resolution: 48 }) } }],
  },
  {
    id: 'A6-分辨率下界',
    expect: 'accept',
    calls: [{ function: { name: 'tpms_mesh', arguments: JSON.stringify({ type: 'schwarz', porosity: 60, resolution: 48 }) } }],
  },
];

function runInjected(calls) {
  const r = spawnSync(process.execPath, [AGENT, '--provider', 'mock', '--dry-run', '--json', 'regression-matrix'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TPMS_MOCK_TOOLCALLS: JSON.stringify({ toolCalls: calls }),
      TPMS_ALLOW_MOCK_EXEC: '1',
    },
  });
  return { exit: r.status, stderr: r.stderr || '', stdout: r.stdout || '' };
}

function judge(expect, exit) {
  if (expect === 'reject') {
    // 拦截器：非法 tool call → exit 2（validateToolCalls 结构化拒绝）
    return exit === 2 ? 'PASS（拦截）' : `FAIL（应拦截 exit=2，实得 ${exit}）`;
  }
  return exit === 0 ? 'PASS（放行）' : `FAIL（应放行 exit=0，实得 ${exit}）`;
}

const rows = [];
const summary = [];
for (let round = 1; round <= ROUNDS; round++) {
  let pass = 0;
  for (const c of CASES) {
    const { exit } = runInjected(c.calls);
    const verdict = judge(c.expect, exit);
    if (verdict.startsWith('PASS')) pass++;
    rows.push(`| R${round} | ${c.id} | ${c.expect} | ${exit} | ${verdict} |`);
  }
  summary.push(`R${round}: ${pass}/${CASES.length}`);
}

if (LIVE) {
  const lr = spawnSync(process.execPath, [join(HERE, 'llm_regression.mjs')], {
    encoding: 'utf8',
    timeout: 30 * 60_000,
  });
  console.log(lr.stdout || '');
  if (lr.status !== 0) {
    console.error('LIVE llm_regression exit', lr.status);
    process.exit(lr.status || 1);
  }
  console.log('LIVE llm_regression OK — 矩阵仍以注入 toolCalls 为准');
}

const stamp = new Date().toISOString().slice(0, 10);
const md = [
  `# 回归矩阵（${stamp}）`,
  '',
  `> 档位：${LIVE ? 'live' : 'mock 注入 toolCalls'} × **${ROUNDS} 轮** × ${CASES.length} 槽位。`,
  '> 覆盖 **拦截器**（非法参必须 exit 2）与合法放行；**禁止把单轮最好成绩说成确定性**。',
  '',
  '## 轮次摘要',
  '',
  ...summary.map((s) => `- ${s}`),
  '',
  '## 明细',
  '',
  '| 轮 | 用例 | 期望 | exit | 判定 |',
  '|---|---|---|---|---|',
  ...rows,
  '',
  '## 真实模型三轮（需密钥）',
  '',
  '```bash',
  'TPMS_LLM_API_KEY=... TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \\',
  '  node tpms/agent/regression_matrix.mjs --live --rounds 3',
  'node tpms/agent/llm_regression.mjs --model glm-5.3-flash   # 37 条全集',
  '```',
  '',
].join('\n');

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs/regression-matrix.md'), md, 'utf8');
console.log(summary.join(' | '));
const anyBad = rows.some((r) => r.includes('FAIL') || r.includes('WEAK'));
if (summary.some((s) => !s.includes(`${CASES.length}/${CASES.length}`)) || anyBad) {
  console.error('MATRIX FAIL');
  process.exit(1);
}
console.log(`REGRESSION-MATRIX ${ROUNDS} rounds OK`);
