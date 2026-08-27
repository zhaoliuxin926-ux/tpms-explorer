/**
 * regen_official_shots.mjs —— 用 v2 管线重生成官方展示截图（1480×920，对齐当前预设定义）
 */
import { chromium } from 'playwright';

const OUT = 'D:/AI Project/tpms/docs/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));

// 首访种下引导已读标记，避免浮层入镜
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { try { localStorage.setItem('tpms_onboard_v1', '1'); } catch {} });
const SHOT_MS = 2600;   // 高清重建 + 渲染稳定

async function snap(filename) {
  await page.evaluate(() => { try { window.hidePresetCard && window.hidePresetCard(); } catch {} });
  await page.waitForTimeout(SHOT_MS);
  await page.screenshot({ path: `${OUT}/${filename}` });
  const stats = await page.locator('#stats').innerText().catch(() => '');
  console.log(`${filename} ✓ | ${stats.replace(/\s+/g, ' ').slice(0, 70)}`);
}

// 01 默认 Gyroid 曲面（刷新以重置到默认态）
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await snap('01-gyroid-surface.png');

// 02 仿生骨支架预设
await page.evaluate(() => { document.querySelector('[data-scene="bone"]')?.click(); });
await snap('02-gyroid-bone.png');

// 03 Diamond 杆模型
await page.evaluate(() => {
  document.querySelector('[data-scene]')?.closest('.scenes');
  document.querySelector('[data-type="diamond"]')?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => { document.querySelector('[data-model="strut"]')?.click(); });
await snap('03-diamond-strut.png');

// 04 散热结构预设（Schwarz P 壳）
await page.evaluate(() => { document.querySelector('[data-scene="heat"]')?.click(); });
await snap('04-schwarz-heat.png');

// 05 轻量化零件预设（Gyroid 杆 p90 k4）
await page.evaluate(() => { document.querySelector('[data-scene="lightweight"]')?.click(); });
await snap('05-diamond-surface.png');

console.log('pageerrors:', errs.length ? errs.join(' | ') : '(none)');
await browser.close();
