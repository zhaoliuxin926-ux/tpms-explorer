import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8123';
const args = ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
const page = await (await browser.newContext({ viewport: { width: 1480, height: 900 } })).newPage();
await page.goto(BASE + '/app.html?type=gyroid', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  function tick(){ n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res((n / 3).toFixed(1)); }
  requestAnimationFrame(tick);
}));
console.log('rAF fps:', fps);
await page.evaluate(() => {
  window.__lt = [];
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
});
await page.waitForTimeout(3000);
console.log('idle longtasks in 3s:', JSON.stringify(await page.evaluate(() => window.__lt)));
await browser.close();
