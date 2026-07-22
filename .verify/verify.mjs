import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

// ---- Test 1: 首次进入自动弹出引导（清除 localStorage）----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // 750ms 延迟 + buffer
  const cardVisible = await page.locator('#ob-card').isVisible();
  log('首次进入自动弹出引导卡片', cardVisible);
  await page.screenshot({ path: `${OUT}/01-onboard-start.png` });

  // 第一步文字
  const h4 = await page.locator('#ob-card h4').textContent();
  log('第一步标题正确', /TPMS/.test(h4), `actual="${h4}"`);

  await ctx.close();
}

// ---- Test 2: 走完全部 5 步 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const stepTitles = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(400);
    const t = await page.locator('#ob-card h4').textContent();
    stepTitles.push(t);
    const dotCount = await page.locator('.ob-dots i').count();
    log(`第${i+1}步: "${t}"`, !!t, `dots=${dotCount}`);
    await page.screenshot({ path: `${OUT}/02-step-${i+1}.png` });
    if (i < 4) await page.locator('#ob-next').click();
  }
  log('共 5 步且标题不重复', stepTitles.length === 5 && new Set(stepTitles).size === 5);

  // 最后一步点"开始探索"应关闭
  await page.locator('#ob-next').click();
  await page.waitForTimeout(600);
  const closed = !(await page.locator('#ob-card').evaluate(el => el.classList.contains('show')));
  log('最后一步"开始探索"关闭引导', closed);

  await ctx.close();
}

// ---- Test 3: 演示按钮驱动控件 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 第2步演示孔隙率
  await page.locator('#ob-next').click();
  await page.waitForTimeout(400);
  await page.locator('#ob-demo').click();
  await page.waitForTimeout(500);
  const porosity = await page.locator('#porosity').inputValue();
  log('演示·孔隙率→88', porosity === '88', `actual=${porosity}`);

  // 第3步演示切 Schwarz P
  await page.locator('#ob-next').click();
  await page.waitForTimeout(400);
  await page.locator('#ob-demo').click();
  await page.waitForTimeout(800);
  const activeType = await page.locator('[data-type].active').getAttribute('data-type');
  log('演示·切到 Schwarz P', activeType === 'schwarz', `actual=${activeType}`);

  // 第4步演示截面
  await page.locator('#ob-next').click();
  await page.waitForTimeout(400);
  await page.locator('#ob-demo').click();
  await page.waitForTimeout(400);
  const sliceVal = await page.locator('#slice').inputValue();
  log('演示·截面剖到中部', +sliceVal < 90, `actual=${sliceVal}`);

  await ctx.close();
}

// ---- Test 4: 跳过后写入 localStorage，刷新不再弹 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.locator('#ob-skip').click();
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => localStorage.getItem('tpms-onboarded'));
  log('跳过后写入 localStorage', stored === '1', `actual=${stored}`);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const again = await page.locator('#ob-card').evaluate(el => el.classList.contains('show'));
  log('刷新后不再弹', !again);

  await ctx.close();
}

// ---- Test 5: 带 URL 参数时不弹 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html?type=diamond&porosity=70', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const popup = await page.locator('#ob-card').evaluate(el => el.classList.contains('show'));
  log('带 URL 参数时不弹', !popup);

  await ctx.close();
}

// ---- Test 6: 顶栏手动重开 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('#ob-skip').click();
  await page.waitForTimeout(400);
  await page.locator('#btn-onboard').click();
  await page.waitForTimeout(600);
  const reopened = await page.locator('#ob-card').evaluate(el => el.classList.contains('show'));
  log('顶栏"新手引导"可重开', reopened);

  await ctx.close();
}

// ---- Test 7: 专业用户默认体验（3D 渲染正常）----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
  // 不清 localStorage——带参数自然不弹
  await page.waitForTimeout(2000);
  const statsText = await page.locator('#stats').textContent();
  const rendered = /顶点\s*\d/.test(statsText);
  log('3D 渲染正常（顶点数已输出）', rendered, `stats="${statsText.replace(/\s+/g,' ').trim().slice(0,60)}"`);
  await page.screenshot({ path: `${OUT}/03-render-check.png` });

  await ctx.close();
}

await browser.close();

const failed = results.filter(r => !r.ok);
console.log('\n==== SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`));
  process.exit(1);
}
