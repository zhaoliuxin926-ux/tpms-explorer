import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();

const msgs = [];
page.on('console', m => msgs.push(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', e => msgs.push(`[PAGEERROR] ${e.message}`));

await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 检查 ob-card 状态
const cardHTML = await page.locator('#ob-card').innerHTML().catch(() => 'NO INNER HTML');
const cardClasses = await page.locator('#ob-card').getAttribute('class');
const spotClasses = await page.locator('#ob-spot').getAttribute('class');
const ls = await page.evaluate(() => localStorage.getItem('tpms-onboarded'));
const btnExists = await page.locator('#btn-onboard').count();

console.log('=== card classes:', cardClasses);
console.log('=== spot classes:', spotClasses);
console.log('=== localStorage:', ls);
console.log('=== onboard btn exists:', btnExists);
console.log('=== card innerHTML length:', cardHTML.length);
console.log('=== card innerHTML:', cardHTML.slice(0, 200));
console.log('=== console msgs ===');
msgs.forEach(m => console.log(m));

await browser.close();
