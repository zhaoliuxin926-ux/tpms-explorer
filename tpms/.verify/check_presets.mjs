import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = 'web/shots/showcase';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(BASE + '/app.html?type=gyroid&porosity=70', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const expect = { catalyst:'neovius', acoustic:'iwp', electrode:'frd' };
for (const key of Object.keys(expect)) {
  await page.locator(`[data-scene="${key}"]`).click();
  await page.waitForTimeout(1200); // 等待重建
  const cardShown = await page.locator('#preset-card').evaluate(el => el.classList.contains('show'));
  const title = await page.locator('#pc-title').textContent();
  const activeType = await page.locator('[data-type].active').getAttribute('data-type');
  const stats = await page.locator('#stats').textContent();
  const rendered = /顶点\s*\d/.test(stats);
  log(`预设[${key}] 教学卡弹出`, cardShown, `title="${title}"`);
  log(`预设[${key}] 切到正确曲面族=${expect[key]}`, activeType === expect[key], `actual=${activeType}`);
  log(`预设[${key}] 3D 渲染正常`, rendered, `stats="${stats.replace(/\s+/g,' ').trim().slice(0,48)}"`);
  await page.screenshot({ path: `${OUT}/06-${key}.png` });
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log('\n==== PRESET SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
