import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();

page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
page.on('requestfailed', req => console.log(`[failed] ${req.url()} - ${req.failure()?.errorText}`));

await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Check formula with weight coef
await page.locator('#w-a').evaluate((el, v) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, '1.5');
await page.waitForTimeout(500);

const formulaHTML = await page.locator('#formula-display').innerHTML();
console.log('\nFormula HTML:', formulaHTML.substring(0, 120));

const hasCoef = formulaHTML.includes('1.5') && formulaHTML.includes('wcoef');
console.log('Has coef 1.5:', hasCoef);

await page.screenshot({ path: '.verify/shots/gyroid-w-15.png' });
await browser.close();
console.log('Done');
