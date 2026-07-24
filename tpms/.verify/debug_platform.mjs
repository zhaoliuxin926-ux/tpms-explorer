import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:' + (process.env.PORT || '8123');
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
page.on('weberror', (e) => console.log('[weberror]', String(e)));

await page.goto(`${BASE}/index.html?type=gyroid&porosity=70`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const before = await page.locator('.opt[data-type].active').getAttribute('data-type');
console.log('BEFORE active type =', before);

// is the lidinoid button visible & receiving events?
const info = await page.locator('.opt[data-type="lidinoid"]').evaluate((el) => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    tagAtCenter: top ? top.tagName + '.' + (top.className || '') : null,
    sameEl: top === el,
    disabled: el.disabled,
    visible: r.width > 0 && r.height > 0,
  };
});
console.log('lidinoid btn info =', JSON.stringify(info));

async function clickSurface(type) {
  const v0 = await page.locator('#stat-verts').textContent();
  await page.locator(`.opt[data-type="${type}"]`).click();
  await page.waitForTimeout(3500);
  const act = await page.locator('.opt[data-type].active').getAttribute('data-type');
  const v1 = await page.locator('#stat-verts').textContent();
  console.log(`click ${type}: active=${act}  verts ${v0} -> ${v1}`);
}

await clickSurface('diamond');
await clickSurface('lidinoid');
await clickSurface('splitp');
await clickSurface('gyroid');

await browser.close();
