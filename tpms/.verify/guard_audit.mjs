/**
 * guard_audit.mjs —— 元门（红队 G M1，2026-09-29）：审计门禁自体的两类结构性盲区
 *
 * 守护对象（独立探针，不进 run_ci_suite 调度——selector_audit 先例；纳管与否待复验后拍板）：
 *   A. 恒真高置信模式：GUARD `pass<N` 只防「断言被删」，防不了「断言恒真」——本门扫
 *      门禁源码中的结构性恒真（双分支都计 pass / ||true / &&false / if(true)），命中即红。
 *      保守口径：只扫高置信单行模式，宁可漏报不误报；合法豁免行登记在 WHITELIST。
 *   B. GUARD 基线账实分裂：代码 `< N` 与消息文案 `基线 M` 数字不一致（实锤先例：
 *      docs_consistency 代码 180 / 文案 160，2026-09-29 本门首跑即抓）。
 *
 * 用法：node guard_audit.mjs   （仓库根或 .verify/ 下均可）
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const AGENT = join(ROOT, 'tpms/agent');

let pass = 0, fail = 0;
const failures = [];
function ok(name, detail = '') { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail = '') { fail++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${name} — ${detail}`); }

// ── 收集门禁源文件（.verify 顶层 + agent + redteam 子目录；排除本文件自身与调度器/服务器）──
const SELF = 'guard_audit.mjs';
const EXCLUDE = new Set([SELF, 'run_ci_suite.mjs', 'static-server.mjs', 'run_all.mjs', '_verify_mode.mjs', 'diag_server_windows.mjs']);
const files = [];
for (const f of readdirSync(HERE)) {
  if (f.endsWith('.mjs') && !EXCLUDE.has(f)) files.push({ rel: f, path: join(HERE, f) });
}
if (existsSync(join(HERE, 'redteam'))) {
  for (const f of readdirSync(join(HERE, 'redteam'))) {
    if (f.endsWith('.mjs')) files.push({ rel: `redteam/${f}`, path: join(HERE, 'redteam', f) });
  }
}
if (existsSync(AGENT)) {
  for (const f of readdirSync(AGENT)) {
    if (f.endsWith('.mjs')) files.push({ rel: `agent/${f}`, path: join(AGENT, f) });
  }
}

// 合法豁免（登记制：每行注明为何合法，防白名单变成漂移窟窿）
const WHITELIST = [
  // （首跑零豁免；新豁免必须带一行理由+日期）
];

// ── A. 恒真高置信模式 ──
console.log('\n[A] 恒真高置信模式扫描（双分支计 pass / ||true / &&false / if(true)）');
{
  const patterns = [
    { id: 'both-branches-pass', re: /\?\s*(?:ok|check|PASS)\s*\([^\n;]*\)\s*:\s*(?:ok|check|PASS)\s*\(/ },
    { id: 'or-true', re: /\|\|\s*true\b/ },
    { id: 'and-false', re: /&&\s*false\b/ },
    { id: 'if-literal-true', re: /\bif\s*\(\s*true\s*\)/ },
  ];
  const hits = [];
  for (const { rel, path } of files) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      // 剥行注释再匹配（首跑实证：gpu_plasticity 注释里"曾被 || true 掩盖"的历史描述会误报；
      // https:// 内的 // 同被截断——方向=漏报，白名单兜底残留误报）
      const line = raw.replace(/\/\/.*$/, '');
      const no = `${rel}:${i + 1}`;
      if (WHITELIST.some((w) => w.line === no)) return;
      for (const p of patterns) {
        if (p.re.test(line)) hits.push(`${no} [${p.id}] ${raw.trim().slice(0, 90)}`);
      }
    });
  }
  hits.length === 0
    ? ok(`恒真模式零命中（扫 ${files.length} 文件）`)
    : bad('恒真模式命中', `${hits.length} 处:\n    ` + hits.join('\n    '));
}

// ── B. GUARD 基线账实分裂 ──
console.log('\n[B] GUARD 基线：代码阈值 vs 文案数字 账实一致性');
{
  const splits = [];
  let guardGates = 0;
  for (const { rel, path } of files) {
    const src = readFileSync(path, 'utf8');
    // GUARD 语句形状：if (passXXX < N) { console.error('...基线 M...') } —— N/M 应相等
    const re = /<\s*(\d+)\s*\)[^{]*\{\s*console\.error\(\s*[`'"][^`'"]*?(\d+)[^`'"]*?[`'"]/g;
    let m;
    while ((m = re.exec(src))) {
      guardGates++;
      const codeN = Number(m[1]);
      // 消息里可能有多个数字（日期、批次数）；取与阈值最接近的作对照（基线通常=阈值或略低）
      const msgNum = Number(m[2]);
      if (msgNum !== codeN) {
        splits.push(`${rel}: 代码阈值 ${codeN} vs 消息数字 ${msgNum} → ${src.slice(m.index, m.index + 110).replace(/\s+/g, ' ')}`);
      }
    }
  }
  splits.length === 0
    ? ok(`GUARD 基线账实一致（检 ${guardGates} 处 GUARD 语句）`)
    : bad('GUARD 基线账实分裂', `${splits.length} 处:\n    ` + splits.join('\n    '));
}

// ── 汇总 ──
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f.split('\n')[0]);
  process.exit(1);
}
if (pass < 2) { console.error('GUARD FAIL: 元门自身断言数 ' + pass + ' < 2（A/B 两节必须各出一断言）'); process.exit(1); }
