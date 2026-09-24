#!/usr/bin/env node
/**
 * gen-boundary-table.mjs — 从 bugs.md「已定案边界」重生诚实边界表
 * 防 README / 博客 / 面试包与内部定案漂移。
 *
 * 运行: node tpms/agent/gen-boundary-table.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CHECK = process.argv.includes('--check');

function resolve(a, b) { return join(a, b); }

const bugs = readFileSync(join(ROOT, 'tpms/agent_memory/bugs.md'), 'utf8');
const start = bugs.indexOf('## 一、已定案边界');
const end = bugs.search(/^## 二、/m);
if (start < 0 || end < 0) {
  console.error('bugs.md 未找到「已定案边界」节');
  process.exit(1);
}
const section = bugs.slice(start, end);
const items = [];
for (const m of section.matchAll(/^(\d+)\. \*\*(.+?)\*\*[：:]\s*([\s\S]*?)(?=\n\d+\. \*\*|\n*$)/gm)) {
  const title = m[2];
  const body = m[3].replace(/\s+/g, ' ').trim();
  // 已修复/移除出清单的定案不得留在边界表（红队 MED）
  if (/已修复|从边界清单移除|此条从边界/.test(title + body)) continue;
  items.push({ n: m[1], title, body });
}

const md = [
  '# 诚实边界表（自动生成）',
  '',
  `> 由 \`node tpms/agent/gen-boundary-table.mjs\` 从 \`tpms/agent_memory/bugs.md\` §一 重生（${new Date().toISOString().slice(0, 10)}）。`,
  '> **改边界只改 bugs.md 定案，再跑本脚本**；禁止手改本表导致双源漂移。',
  '',
  '| # | 边界 | 说明（摘要） |',
  '|---|---|---|',
  ...items.map((it) => `| ${it.n} | ${it.title} | ${it.body.slice(0, 120)}${it.body.length > 120 ? '…' : ''} |`),
  '',
  `共 **${items.length}** 条已定案边界。`,
  '',
].join('\n');

const outPath = join(ROOT, 'docs/HONESTY_BOUNDARIES.md');
if (CHECK) {
  if (!existsSync(outPath)) {
    console.error('缺少 docs/HONESTY_BOUNDARIES.md');
    process.exit(1);
  }
  const cur = readFileSync(outPath, 'utf8');
  const curN = (cur.match(/^\| \d+ \|/gm) || []).length;
  if (!items.length) {
    console.error('BOUNDARY EMPTY: 定案解析 0 条');
    process.exit(1);
  }
  const expect = items.map((it) => `${it.n} | ${it.title}`).join('\n');
  const got = items.map((it) => {
    const row = cur.split('\n').find((l) => l.startsWith(`| ${it.n} |`));
    return row ? `${it.n} | ${row.split('|')[2]?.trim() || ''}` : `${it.n} | MISSING`;
  }).join('\n');
  if (curN !== items.length || !cur.includes(`共 **${items.length}** 条`) || expect !== got) {
    console.error(`BOUNDARY DRIFT: 文件 ${curN} 条 vs 定案 ${items.length} 条（或标题不一致）`);
    process.exit(1);
  }
  console.log(`BOUNDARY-TABLE CHECK OK ${items.length}`);
} else {
  writeFileSync(outPath, md, 'utf8');
  console.log('WROTE', outPath, 'items', items.length);
}
