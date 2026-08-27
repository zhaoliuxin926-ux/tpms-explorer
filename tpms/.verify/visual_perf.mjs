/**
 * visual_perf.mjs —— 双版本截图 + 重建性能计时
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default', '--enable-gpu'] });

// ── 单文件版 ──
{
  const page = await (await browser.newContext({ viewport: { width: 1480, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const stats1 = await page.locator('#stats').innerText();
  const t1 = (stats1.match(/重建\s*([\d.]+)\s*ms/) || [])[1];
  console.log('单文件版默认(gyroid75): 重建', t1, 'ms |', stats1.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: 'shots/vis-sf-gyroid.png' });
  // diamond shell 模式（最难case之一）
  await page.evaluate(() => { document.querySelector('[data-type="schwarz"]')?.click(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'shots/vis-sf-schwarz.png' });
  console.log('单文件版 errors:', errors.length ? errors.join(' | ') : '(none)');
  await page.close();
}

// ── 工程版 ──
{
  const page = await (await browser.newContext({ viewport: { width: 1480, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console]' + m.text()); });
  await page.goto('http://127.0.0.1:8123/platform/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const timing = await page.evaluate(async () => {
    // 等 worker 首帧结果
    const waitStats = () => new Promise((resolve) => {
      let n = 0;
      const iv = setInterval(() => {
        const el = document.querySelector('#stats, .stat-overlay, [class*=stat]');
        const txt = el ? el.textContent : '';
        if (/重建|buildTime|ms/.test(txt) || ++n > 40) { clearInterval(iv); resolve(txt); }
      }, 250);
    });
    const txt = await waitStats();
    return txt.replace(/\s+/g, ' ').slice(0, 120);
  });
  console.log('工程版默认 stats:', timing);
  await page.screenshot({ path: 'shots/vis-plat-gyroid.png' });
  console.log('工程版 errors:', errors.length ? errors.join(' | ') : '(none)');
  await page.close();
}

await browser.close();
console.log('screenshots saved: shots/vis-*.png');
