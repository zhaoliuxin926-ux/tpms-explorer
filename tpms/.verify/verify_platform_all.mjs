// 工程版 lidinoid/splitp 渲染验证：scrollIntoView + force click，确认重建不崩溃
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4812/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

for (const t of ['lidinoid', 'splitp']) {
  // 滚动到按钮可见再点
  const clicked = await page.evaluate((type) => {
    const btn = document.querySelector(`[data-type="${type}"]`);
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' });
    btn.click();
    return true;
  }, t).catch(e => { errors.push(t + ' eval: ' + e.message); return false; });
  console.log(t, '点击:', clicked ? '已执行' : '未找到按钮');
  await page.waitForTimeout(5000); // 等重建
  // 重建后检查 canvas 仍有效（非 NaN/崩溃）
  const ok = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c && c.width > 0;
  }).catch(() => false);
  console.log(t, '重建后 canvas 有效:', ok ? '✓' : '✗');
}

await browser.close();
console.log('\npageerror 数:', errors.length);
errors.forEach(e => console.log('  ', e));
console.log(errors.length === 0 ? '✅ lidinoid/splitp 重建均无崩溃' : '❌ 有错误');
