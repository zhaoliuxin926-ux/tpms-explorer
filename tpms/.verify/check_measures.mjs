import { chromium } from 'playwright-core';

const BASE = 'http://localhost:8123/app.html';
const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => {
  const e = document.getElementById('stat-meas');
  return e && e.textContent.trim().length > 0;
}, { timeout: 15000 });
await page.click('#stat-toggle'); // 展开查看完整读数

const grab = async () => {
  const t = await page.textContent('#stat-meas');
  const m = t.match(/材料体积 ([\d.,eE+]+) (mm³|cm³|µm³)/);
  return { text: t, unit: m ? m[2] : null, vol: m ? parseFloat(m[1].replace(/,/g, '')) : NaN };
};

const base = await grab();
ok('默认(mm)有测量读数', /比表面积/.test(base.text) && /mm³/.test(base.text));
ok('含材料体积/孔体积/总表面积', /材料体积/.test(base.text) && /孔体积/.test(base.text) && /总表面积/.test(base.text));
ok('初始默认单位为mm', base.unit === 'mm³');

// 切换到 µm
await page.click('[data-unit="um"]');
await page.waitForTimeout(200);
const um = await grab();
ok('切换µm后单位变为µm³', um.unit === 'µm³');
ok('µm下体积数值大于mm', um.vol > base.vol);

// 切换到 cm
await page.click('[data-unit="cm"]');
await page.waitForTimeout(200);
const cm = await grab();
ok('切换cm后单位变为cm³', cm.unit === 'cm³');
ok('cm下体积数值小于mm', cm.vol < base.vol);

// 持久化：刷新后应保持 cm
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => {
  const e = document.getElementById('stat-meas');
  return e && e.textContent.trim().length > 0;
}, { timeout: 15000 });
const reloaded = await grab();
ok('刷新后单位保持(cm)', reloaded.unit === 'cm³');

ok('无console错误', errs.length === 0);

await browser.close();
const pass = results.filter(r => r[0] === 'PASS').length;
for (const [s, n] of results) console.log(`${s}  ${n}`);
console.log(`\n==== MEASURE SUMMARY ====\nPASS ${pass} / ${results.length}`);
process.exit(pass === results.length ? 0 : 1);
