import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', e => errors.push(`[PAGEERROR] ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });

await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // 等首屏重建完成

const types = ['gyroid', 'diamond', 'schwarz'];
const models = ['surface', 'strut', 'solid'];
const results = [];

for (const t of types) {
  for (const m of models) {
    // 切换曲面类型
    await page.click(`[data-type="${t}"]`);
    await page.waitForTimeout(150);
    // 切换模型
    await page.click(`[data-model="${m}"]`);
    await page.waitForTimeout(900); // 等高清重建
    const stats = await page.locator('#stats').innerText().catch(() => 'NO STATS');
    results.push({ t, m, stats: stats.replace(/\s+/g, ' ').trim() });
  }
}

// 截三张关键图
await page.click('[data-type="gyroid"]'); await page.click('[data-model="surface"]');
await page.waitForTimeout(1000); await page.screenshot({ path: 'shots/mesh-gyroid-surface.png' });
await page.click('[data-type="diamond"]'); await page.waitForTimeout(1000);
await page.screenshot({ path: 'shots/mesh-diamond-surface.png' });
await page.click('[data-type="schwarz"]'); await page.waitForTimeout(1000);
await page.screenshot({ path: 'shots/mesh-schwarz-surface.png' });

// 测试梯度结构
await page.click('[data-type="gyroid"]');
await page.click('[data-gradient="on"]'); await page.waitForTimeout(1000);
await page.screenshot({ path: 'shots/mesh-gradient.png' });
await page.click('[data-gradient="off"]');

console.log('=== 控制台错误 ===');
console.log(errors.length ? errors.join('\n') : '(无错误)');
console.log('\n=== 各组合统计 ===');
for (const r of results) console.log(`${r.t}/${r.m}: ${r.stats}`);
console.log('\n=== 截图已保存到 .verify/shots/mesh-*.png ===');

await browser.close();
