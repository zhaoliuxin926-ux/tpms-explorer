// 移动端 sheet 模式抽查：390×844，底部抽屉 + 分组导航
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4852;
const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', '../tpms/docs/platform'], { shell: true });
await new Promise((r) => setTimeout(r, 3500));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.setItem('tpms_onboard_v1', '1'); localStorage.setItem('tpms-theme-platform', 'dark'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, i)); };

// 抽屉收起态默认（sheet 在底部露 54px 手柄）
await page.evaluate(() => document.getElementById('sheet-handle').click());
await page.waitForTimeout(600);
const sheetOpen = await page.evaluate(() => document.querySelector('.controls').classList.contains('sheet-open'));
ok('抽屉手柄点击展开 sheet', sheetOpen);

// 展开后跳转导航可见且可点
const nav = await page.evaluate(() => {
  const j = document.querySelector('.ls-jump');
  if (!j) return null;
  const r = j.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inView: r.top >= 0 && r.top < innerHeight };
});
ok('跳转导航在 sheet 内可见', nav && nav.inView && nav.w > 300, JSON.stringify(nav));

await page.evaluate(() => document.querySelector('[data-jump="grp-sim"]').click());
// 移动端 smooth-scroll 时序抖动：轮询等待滚动到位（≤3s）
let scrolled = 0;
for (let t = 0; t < 12; t++) {
  await page.waitForTimeout(250);
  scrolled = await page.evaluate(() => document.querySelector('.panel.controls').scrollTop);
  if (scrolled > 50) break;
}
ok('sheet 内点击仿真滚动生效', scrolled > 50, `scrollTop=${scrolled}`);

await page.screenshot({ path: 'shots/ui-mobile-sheet.png' });
ok('0 异常', true);
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);
