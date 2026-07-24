import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8123';
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

// ---- 常规模式：ARIA / 帮助层 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/app.html?type=gyroid&porosity=70', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const a11y = await page.evaluate(() => {
    const p = document.getElementById('porosity');
    return {
      role: p.getAttribute('role'),
      min: p.getAttribute('aria-valuemin'),
      max: p.getAttribute('aria-valuemax'),
      now: p.getAttribute('aria-valuenow'),
      label: p.getAttribute('aria-label'),
      statsLive: document.getElementById('stats').getAttribute('aria-live'),
      rotatePressed: document.getElementById('btn-rotate').getAttribute('aria-pressed'),
      rotateOn: document.getElementById('btn-rotate').classList.contains('on'),
    };
  });
  log('滑块 role=slider', a11y.role === 'slider', `role=${a11y.role}`);
  log('滑块 aria-valuemin/max/now 存在', a11y.min==='60' && a11y.max==='90' && a11y.now!=null, `min=${a11y.min} max=${a11y.max} now=${a11y.now}`);
  log('滑块 aria-label 存在', !!a11y.label, `label=${a11y.label}`);
  log('#stats aria-live=polite', a11y.statsLive === 'polite', `live=${a11y.statsLive}`);
  log('自动旋转按钮初始 pressed=true', a11y.rotatePressed === 'true' && a11y.rotateOn, `pressed=${a11y.rotatePressed} on=${a11y.rotateOn}`);

  // 改值后 aria-valuenow 实时更新
  await page.evaluate(() => {
    const p = document.getElementById('porosity');
    p.value = '88'; p.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const nowAfter = await page.getAttribute('#porosity', 'aria-valuenow');
  log('滑块改值后 aria-valuenow 更新', nowAfter === '88', `now=${nowAfter}`);

  // 帮助层：按钮打开 → Esc 关闭
  await page.locator('#btn-help').click();
  await page.waitForTimeout(300);
  const helpShown = await page.locator('#help-overlay').evaluate(el => el.classList.contains('show') && el.getAttribute('aria-hidden')==='false');
  log('帮助层可打开', helpShown);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const helpClosed = await page.locator('#help-overlay').evaluate(el => !el.classList.contains('show'));
  log('Esc 关闭帮助层', helpClosed);

  // 帮助层：? 键打开
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  const helpShown2 = await page.locator('#help-overlay').evaluate(el => el.classList.contains('show'));
  log('? 键可打开帮助层', helpShown2);
  await page.keyboard.press('?');
  await page.waitForTimeout(300);
  const helpClosed2 = await page.locator('#help-overlay').evaluate(el => !el.classList.contains('show'));
  log('再次 ? 键关闭帮助层', helpClosed2);

  await ctx.close();
}

// ---- 减少动态效果：默认不自动旋转 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/app.html?type=gyroid&porosity=70', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    on: document.getElementById('btn-rotate').classList.contains('on'),
    pressed: document.getElementById('btn-rotate').getAttribute('aria-pressed'),
  }));
  log('减少动态效果：自动旋转默认关闭', !st.on && st.pressed === 'false', `on=${st.on} pressed=${st.pressed}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log('\n==== A11Y SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
