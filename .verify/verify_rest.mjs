import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8123';
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

// ---- T14: 类型切换后权重重置 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.locator('#w-a').evaluate((el, v) => {
    el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '2');
  await page.locator('#w-a').dispatchEvent('change');
  await page.waitForTimeout(500);

  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(800);
  await page.locator('[data-type="gyroid"]').click();
  await page.waitForTimeout(1000);

  const wVal = await page.locator('#w-a-val').textContent();
  log('类型切换后权重重置为 1.0', wVal === '1.0', `实际=${wVal}`);
  await ctx.close();
}

// ---- T15: 分享链接含权重参数 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.locator('#btn-share').click();
  await page.waitForTimeout(500);
  const clipText = await page.evaluate(() => navigator.clipboard.readText());
  const url = new URL(clipText);
  log('分享链接含 wa', url.searchParams.has('wa'));
  log('分享链接含 wd', url.searchParams.has('wd'));
  await ctx.close();
}

// ---- T16: URL 恢复 Diamond wd ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html?type=diamond&wd=1.8', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const wdExists = await page.locator('#w-d-val').count();
  if (wdExists > 0) {
    const wdVal = await page.locator('#w-d-val').textContent();
    log('URL 恢复 Diamond wd=1.8', wdVal === '1.8', `实际=${wdVal}`);
  } else {
    log('URL 恢复 Diamond wd=1.8', false, '#w-d-val 不存在');
  }

  // 也测 Gyroid URL 恢复
  await page.goto(BASE + '/app.html?type=gyroid&wa=0.5&wb=1.5', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const waVal = await page.locator('#w-a-val').textContent();
  const wbVal = await page.locator('#w-b-val').textContent();
  log('URL 恢复 Gyroid wa=0.5/wb=1.5', waVal === '0.5' && wbVal === '1.5', `wa=${waVal} wb=${wbVal}`);

  await ctx.close();
}

await browser.close();
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
