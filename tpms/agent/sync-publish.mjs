// sync-publish.mjs — 正式版博客 → publish 粘贴版自动同步
//
// 变换规则（与 docs_consistency_check stripLinks 对齐）：
//   仅把相对 .md 链接（无 fragment）改写为 GitHub blob 绝对链接；
//   http(s)/mailto/#anchor、非 .md 相对路径一概不动——否则会触发同源门禁误报。
//
// 运行: node tpms/agent/sync-publish.mjs          （仓库根，写入 publish/）
// 校验: node tpms/agent/sync-publish.mjs --check  （不写，漂移则 exit 1）
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BLOG_DIR = join(ROOT, 'docs/blog');
const OUT_DIR = join(ROOT, 'docs/blog/publish');
const BASE = 'https://github.com/zhaoliuxin926-ux/tpms-explorer/blob/main/';

const CHECK = process.argv.includes('--check');

/** 相对 .md 链接 → GitHub blob 绝对链接（仅无 fragment 的 .md，对齐 stripLinks） */
function absolutizeMdLinks(src, fromRel) {
  const fromDir = posix.dirname(fromRel.replace(/\\/g, '/')); // docs/blog
  return src.replace(/\]\((?!https?:\/\/|#|mailto:)([^()#]+\.md)\)/g, (full, rel) => {
    const resolved = posix.normalize(posix.join(fromDir, rel));
    if (resolved.startsWith('..') || posix.isAbsolute(resolved)) return full;
    return `](${BASE}${resolved})`;
  });
}

function listFormal() {
  return readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

let changed = 0, skipped = 0, checked = 0;

for (const name of listFormal()) {
  const formalPath = join(BLOG_DIR, name);
  const outPath = join(OUT_DIR, name);
  const formalRel = `docs/blog/${name}`;
  const formal = readFileSync(formalPath, 'utf8');
  const expect = absolutizeMdLinks(formal, formalRel);

  if (!existsSync(outPath)) {
    if (CHECK) {
      console.log('FAIL 缺失粘贴版', name);
      process.exitCode = 1;
    } else {
      writeFileSync(outPath, expect, 'utf8');
      console.log('NEW ', name);
      changed++;
    }
    continue;
  }

  const current = readFileSync(outPath, 'utf8');
  checked++;
  if (current === expect) {
    console.log('OK  ', name);
    skipped++;
  } else if (CHECK) {
    console.log('FAIL 漂移', name, '（正式版已改，粘贴版未同步）');
    process.exitCode = 1;
  } else {
    writeFileSync(outPath, expect, 'utf8');
    console.log('SYNC', name);
    changed++;
  }
}

const mode = CHECK ? 'CHECK' : 'SYNC';
console.log(`\nSYNC-PUBLISH ${mode} ${changed} changed / ${skipped} ok / ${checked + changed} total`);
if (CHECK && process.exitCode) console.log('粘贴版落后于正式版，跑 node tpms/agent/sync-publish.mjs 同步');
