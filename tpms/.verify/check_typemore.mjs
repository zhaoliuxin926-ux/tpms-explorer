// 方向 E 验证：曲面分组折叠 + URL/预设联动展开
import { chromium } from 'playwright';
const browser = await chromium.launch({
  channel: 'chrome', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=swiftshader', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
let pass = 0, fail = 0;
const ok = n => { pass++; console.log('PASS', n); };
const bad = (n, i='') => { fail++; console.log('FAIL', n, i); };

const onboard = () => page.addInitScript(() => { try { localStorage.setItem('tpms-onboarded','1'); } catch { /* ignore */ } });

// 1) 默认首屏：折叠区收起、核心 3 可见
await onboard();
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const s1 = await page.evaluate(() => ({
  moreOpen: document.querySelector('.type-more')?.hasAttribute('open') ?? null,
  coreVisible: !!document.querySelector('[data-type="schwarz"]')?.offsetParent,
  advHidden: !document.querySelector('[data-type="lidinoid"]')?.offsetParent,
}));
s1.moreOpen === false && s1.coreVisible && s1.advHidden ? ok('默认首屏：核心 3 可见、高级 5 收起') : bad('默认首屏', JSON.stringify(s1));

// 2) URL ?type=splitp：折叠区自动展开 + Split-P 高亮
await page.goto('http://127.0.0.1:8123/app.html?type=splitp&autoRotate=0', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const s2 = await page.evaluate(() => ({
  moreOpen: document.querySelector('.type-more')?.hasAttribute('open'),
  active: document.querySelector('[data-type].active')?.dataset.type,
}));
s2.moreOpen && s2.active === 'splitp' ? ok('URL ?type=splitp → 自动展开 + Split-P 高亮') : bad('URL 联动', JSON.stringify(s2));

// 3) 预设联动：去新页面（默认 gyroid），点 catalyst 预设（→neovius）
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const before = await page.evaluate(() => document.querySelector('.type-more')?.hasAttribute('open'));
await page.evaluate(() => {
  const btn = document.querySelector('[data-scene="catalyst"]');
  btn?.scrollIntoView({ block: 'center' }); btn?.click();
});
await page.waitForTimeout(2500);
const s3 = await page.evaluate(() => ({
  moreOpen: document.querySelector('.type-more')?.hasAttribute('open'),
  active: document.querySelector('[data-type].active')?.dataset.type,
}));
before === false && s3.moreOpen && s3.active === 'neovius'
  ? ok('预设 catalyst → 折叠区展开 + Neovius 高亮') : bad('预设联动', JSON.stringify({ before, ...s3 }));

// 4) 高级曲面切换功能正常（展开后点 lidinoid 重建）
const verts = await page.evaluate(() => document.getElementById('stats')?.textContent?.replace(/\s+/g,' ').slice(0,40));
await page.evaluate(() => {
  const b = document.querySelector('[data-type="lidinoid"]');
  b?.scrollIntoView({ block: 'center' }); b?.click();
});
await page.waitForTimeout(2500);
const s4 = await page.evaluate(() => ({
  active: document.querySelector('[data-type].active')?.dataset.type,
  stats: document.getElementById('stats')?.textContent?.replace(/\s+/g,' ').slice(0,40),
}));
s4.active === 'lidinoid' && /顶点/.test(s4.stats || '') ? ok('高级曲面点击重建正常') : bad('高级曲面切换', JSON.stringify(s4));

// 5) 截图（目视降噪效果）
await page.screenshot({ path: 'D:/AI Project/tpms/tpms/.verify/shots/type-more-default.png', fullPage: false }).catch(() => {});

errors.length === 0 ? ok('0 pageerror / 0 console error') : errors.forEach(e => console.log('  ERR', e));
await browser.close();
console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
console.log(fail === 0 && errors.length === 0 ? '✅ 方向 E 全部通过' : '❌ 存在失败');
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
