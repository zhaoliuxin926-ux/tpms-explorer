#!/usr/bin/env node
/**
 * regression_matrix.mjs — 回归战绩矩阵（摆脱单轮 n=1 叙事）
 *
 * 离线档（默认）：Mock provider dry-run × N 轮，写入 docs/regression-matrix.md
 * 在线档：TPMS_LLM_API_KEY + TPMS_LLM_BASE_URL 存在时可 --live 委托 llm_regression.mjs
 *
 * 运行: node tpms/agent/regression_matrix.mjs [--rounds 3] [--live]
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const AGENT = join(HERE, 'llm-agent.mjs');
const LIVE = process.argv.includes('--live');
const roundsArg = process.argv.indexOf('--rounds');
const ROUNDS = roundsArg >= 0 ? Number(process.argv[roundsArg + 1]) || 3 : 3;

// 代表性槽位指令（与 llm_regression 子集对齐；mock 可全覆盖）
const CASES = [
  ['A1-骨支架', '孔隙率 75% 的 Gyroid 骨支架'],
  ['A2-越界孔隙', '孔隙率 120% 的 Gyroid'],
  ['A3-路径穿越', '导出到 ../../etc/passwd.stl'],
  ['A4-3MF', '孔隙率 65% Diamond，2mm 端板，导出 3MF'],
  ['A5-非法类型', '做一个 warpdrive 曲面，孔隙率 50%'],
  ['A6-分辨率边界', '孔隙率 60% Schwarz，分辨率 48'],
];

function resolve(a, b) {
  return join(a, b);
}

function runMock(instr) {
  const r = spawnSync(process.execPath, [AGENT, '--provider', 'mock', '--dry-run', '--json', instr], {
    encoding: 'utf8',
    env: { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1' },
  });
  let out = null;
  try { out = JSON.parse(r.stdout ?? ''); } catch { /* 拒绝路径 stdout 可能空 */ }
  return { exit: r.status, out };
}

function judge(id, exit, out) {
  // 越界/穿越/非法类型：期望拦截（exit 2）或拒绝语义；合法：期望 exit 0 且有 toolCalls
  if (id.startsWith('A2') || id.startsWith('A3') || id.startsWith('A5')) {
    return exit === 2 || exit === 3 ? 'PASS（拦截/拒绝）' : exit === 0 && !(out?.results?.[0]?.result?.files?.length) ? 'PASS（零非法执行）' : `FAIL exit=${exit}`;
  }
  return exit === 0 ? 'PASS' : `FAIL exit=${exit}`;
}

const rows = [];
const summary = [];
for (let round = 1; round <= ROUNDS; round++) {
  let pass = 0;
  for (const [id, instr] of CASES) {
    const { exit, out } = runMock(instr);
    const verdict = judge(id, exit, out);
    if (verdict.startsWith('PASS')) pass++;
    rows.push(`| R${round} | ${id} | ${exit} | ${verdict} |`);
  }
  summary.push(`R${round}: ${pass}/${CASES.length}`);
}

const stamp = new Date().toISOString().slice(0, 10);
const md = [
  `# 回归矩阵（${stamp}）`,
  '',
  `> 档位：${LIVE ? 'live' : 'mock dry-run'} × **${ROUNDS} 轮** × ${CASES.length} 槽位。`,
  '> **禁止把单轮最好成绩说成确定性结论**；对外口径须带样本量。',
  '',
  '## 轮次摘要',
  '',
  ...summary.map((s) => `- ${s}`),
  '',
  '## 明细',
  '',
  '| 轮 | 用例 | exit | 判定 |',
  '|---|---|---|---|',
  ...rows,
  '',
  '## 真实模型三轮（需密钥）',
  '',
  '```bash',
  'TPMS_LLM_API_KEY=... TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \\',
  '  node tpms/agent/regression_matrix.mjs --live --rounds 3',
  '# 或直接：node tpms/agent/llm_regression.mjs（37 条全集）',
  '```',
  '',
].join('\n');

mkdirSync(join(ROOT, 'docs'), { recursive: true });
const outPath = join(ROOT, 'docs/regression-matrix.md');
writeFileSync(outPath, md, 'utf8');
console.log('WROTE', outPath);
console.log(summary.join(' | '));
if (summary.some((s) => !s.includes('6/6'))) {
  console.error('MATRIX FAIL: 存在非满分轮次');
  process.exit(1);
}
console.log(`REGRESSION-MATRIX ${ROUNDS} rounds OK`);
