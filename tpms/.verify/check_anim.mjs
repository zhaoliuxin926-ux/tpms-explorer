import { chromium } from 'playwright-core';
import fs from 'fs';

const BASE = 'http://localhost:8123/app.html';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));

await page.addInitScript(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#btn-anim');
await page.waitForFunction(() => {
  const e = document.getElementById('stat-meas');
  return e && e.textContent.trim().length > 0;
}, { timeout: 15000 });

let dlName = null, dlSize = 0;
page.on('download', async (dl) => {
  dlName = dl.suggestedFilename();
  try { const p = await dl.path(); if (p) dlSize = fs.statSync(p).size; } catch (e) {}
});

await page.click('#btn-anim');
// 录制中应进入 rec 态
await page.waitForTimeout(600);
const recOn = await page.evaluate(() => document.getElementById('btn-anim').classList.contains('rec'));
ok('点击后进入录制态(rec类)', recOn);

// 等待下载（录制 ~4s + 收尾）
try {
  await page.waitForEvent('download', { timeout: 12000 });
} catch (e) {}
await page.waitForTimeout(400);

ok('下载得到.webm文件', !!dlName && /\.webm$/.test(dlName));
ok('webm文件大小>1KB', dlSize > 1024);

// 录制结束后应退出 rec 态
const recOff = await page.evaluate(() => document.getElementById('btn-anim').classList.contains('rec'));
ok('录制结束后退出rec态', !recOff);
ok('无console错误', errs.length === 0);

await browser.close();
const pass = results.filter(r => r[0] === 'PASS').length;
for (const [s, n] of results) console.log(`${s}  ${n}`);
console.log(`\n==== ANIM SUMMARY ====\nPASS ${pass} / ${results.length}`);
process.exit(pass === results.length ? 0 : 1);
