import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await (await browser.newContext()).newPage();
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 150), '|| location:', JSON.stringify(m.location())); });
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
console.log('done');
await browser.close();
