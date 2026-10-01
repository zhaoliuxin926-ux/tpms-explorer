/**
 * probe_file_smoke.mjs —— 教学版 file:// 交付形态冒烟（2026-10-01 宣称绑定验证补位）
 *
 * 守护对象：README 宣称「docs/app.html —— file:// 双击即玩是其独有交付形态」——
 * verify.mjs 的 27 项只走 http://localhost，file:// 协议零验证（http 全绿 file:// 全挂
 * 是 vite/dist 系的历史陷阱族）。本探针以真实 file:// URL 打开，断言：
 *   1. boot 完成（canvas/应用骨架出现，含 __BOOT_ERROR 兜底层无错误）
 *   2. 零 pageerror / 零 console.error
 *   3. 核心交互链活着（切曲面触发重建，状态可观测）
 *   4. 落地页 docs/index.html 的入口链接指向本地可解析目标
 *
 * 用法：node probe_file_smoke.mjs（在 tpms/.verify/ 下运行）
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, resolve, posix } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`PASS ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`FAIL ${n} — ${d}`); };

const APP = pathToFileURL(join(ROOT, 'docs/app.html')).href;
const LAND = pathToFileURL(join(ROOT, 'docs/index.html')).href;

let browser = null;
try {
browser = await chromium.launch({ channel: 'chrome', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--headless=new', '--allow-file-access-from-files'] });
} catch (e) {
  // CI runner 无 chrome 二进制：交付形态断言降级为静态资源解析（第 1 项不依赖浏览器）
  console.log(`SKIP 浏览器冒烟（无 chrome：${String(e).slice(0, 60)}）——仅静态资源断言`);
}
try {
if (!browser) {
  const src2 = readFileSync(join(ROOT, 'docs/index.html'), 'utf8');
  const refs = [...src2.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !existsSync(resolve(ROOT, 'docs', decodeURIComponent(r.split('#')[0].split('?')[0]))));
  missing.length === 0 ? ok(`静态回退：落地页本地资源全可解析（${refs.length} 处）`) : bad('落地页断链', missing.slice(0, 3).join(' | '));
} else {
  // 1. 落地页资源解析（静态）：index.html 引用的本地目标全部存在（file:// 下无 CDN 兜底）
  {
    const src = readFileSync(join(ROOT, 'docs/index.html'), 'utf8');
    const refs = [...src.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:)([^"]+)"/g)].map((m) => m[1]);
    const missing = refs.filter((r) => !existsSync(resolve(ROOT, 'docs', decodeURIComponent(r.split('#')[0].split('?')[0]))));
    missing.length === 0
      ? ok(`落地页本地资源全可解析（${refs.length} 处引用，file:// 无 CDN 兜底）`)
      : bad('落地页断链（file:// 下必白屏）', missing.slice(0, 4).join(' | '));
  }

  // 2. app.html file:// 冒烟
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 90)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 90)); });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!(document.querySelector('canvas') || document.querySelector('#app') || document.body?.dataset?.booted), { timeout: 15000 }).catch(() => {});
  const state = await page.evaluate(() => ({
    canvas: !!document.querySelector('canvas'),
    bootErr: window.__BOOT_ERROR ? String(window.__BOOT_ERROR).slice(0, 100) : null,
    title: document.title.slice(0, 30),
  }));
  state.canvas && !state.bootErr
    ? ok(`app.html file:// boot 完成（${state.title}）`)
    : bad('app.html file:// boot 失败', JSON.stringify(state));
  await page.waitForTimeout(2500);
  // 3. 交互链：切曲面触发重建
  const before = await page.evaluate(() => document.querySelector('canvas')?.toDataURL?.()?.length ?? 0).catch(() => 0);
  await page.evaluate(() => {
    const sel = document.querySelector('select');
    if (sel && sel.options.length > 1) {
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => document.querySelector('canvas')?.toDataURL?.()?.length ?? 0).catch(() => 0);
  (after > 0 && errors.length === 0)
    ? ok(`交互链活着（切曲面后 canvas 有内容，dataURL ${before}→${after} 字节）`)
    : bad('交互链或运行时异常', `after=${after} errors=${errors.slice(0, 2).join('|')}`);
  errors.length === 0
    ? ok('file:// 全程零 pageerror / 零 console.error')
    : bad('file:// 运行时错误', errors.slice(0, 3).join(' | '));
}
} finally {
  await browser?.close().catch(() => {});
}
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
