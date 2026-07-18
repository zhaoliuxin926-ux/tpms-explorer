import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function dragSlider(page, selector, val){
  await page.locator(selector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, val);
}
async function releaseSlider(page, selector){
  await page.locator(selector).dispatchEvent('change');
}

// ---- T1: 页面加载无 JS 错误 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  log('页面无 JS 错误', errors.length === 0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

// ---- T2-T7: 三种类型权重区始终可见 + 滑块数量正确 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // T2: Gyroid 权重区可见
  const gVisible = await page.locator('#formula-weights').evaluate(el => el.classList.contains('show'));
  log('Gyroid 权重区可见', gVisible);

  // T3: Gyroid 有 3 个权重滑块
  const gCount = await page.locator('#weight-rows .fw-row').count();
  log('Gyroid 权重滑块数=3', gCount === 3, `实际=${gCount}`);

  // T4: 切 Diamond，权重区仍可见
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(800);
  const dVisible = await page.locator('#formula-weights').evaluate(el => el.classList.contains('show'));
  log('Diamond 权重区可见', dVisible);

  // T5: Diamond 有 4 个权重滑块
  const dCount = await page.locator('#weight-rows .fw-row').count();
  log('Diamond 权重滑块数=4', dCount === 4, `实际=${dCount}`);

  // T6: 切 Schwarz，权重区仍可见
  await page.locator('[data-type="schwarz"]').click();
  await page.waitForTimeout(800);
  const sVisible = await page.locator('#formula-weights').evaluate(el => el.classList.contains('show'));
  log('Schwarz 权重区可见', sVisible);

  // T7: Schwarz 有 3 个权重滑块
  const sCount = await page.locator('#weight-rows .fw-row').count();
  log('Schwarz 权重滑块数=3', sCount === 3, `实际=${sCount}`);

  await ctx.close();
}

// ---- T8-T10: Diamond 权重拖动时曲面变化 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 切 Diamond
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(1500);

  // 记录默认顶点数
  const vBefore = await page.locator('#stats b').first().textContent();
  console.log(`  Diamond 默认顶点数: ${vBefore}`);

  // 拖动第 1 个权重到 2.0
  await dragSlider(page, '#w-a', '2');
  await page.waitForTimeout(1500);
  await releaseSlider(page, '#w-a');
  await page.waitForTimeout(500);
  const vAfter = await page.locator('#stats b').first().textContent();
  console.log(`  Diamond w-a=2 顶点数: ${vAfter}`);

  // 顶点数应该变化（曲面形态改变导致等值面顶点数不同）
  log('Diamond 权重变化时曲面重建', vBefore !== vAfter, `${vBefore} → ${vAfter}`);

  await page.screenshot({ path: `${OUT}/diamond-w-a-2.png` });
  await ctx.close();
}

// ---- T11-T12: Schwarz 权重拖动时曲面变化 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.locator('[data-type="schwarz"]').click();
  await page.waitForTimeout(1500);

  const vBefore = await page.locator('#stats b').first().textContent();
  console.log(`  Schwarz 默认顶点数: ${vBefore}`);

  await dragSlider(page, '#w-a', '0');
  await page.waitForTimeout(1500);
  await releaseSlider(page, '#w-a');
  await page.waitForTimeout(500);
  const vAfter = await page.locator('#stats b').first().textContent();
  console.log(`  Schwarz w-a=0 顶点数: ${vAfter}`);

  log('Schwarz 权重变化时曲面重建', vBefore !== vAfter, `${vBefore} → ${vAfter}`);

  await page.screenshot({ path: `${OUT}/schwarz-w-a-0.png` });
  await ctx.close();
}

// ---- T13: 公式显示权重系数 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Gyroid: 拖 w-a 到 1.5，公式应显示 "1.5·"
  await dragSlider(page, '#w-a', '1.5');
  await page.waitForTimeout(500);
  const formulaHTML = await page.locator('#formula-display').innerHTML();
  const hasCoef = formulaHTML.includes('1.5') && formulaHTML.includes('wcoef');
  log('Gyroid 公式显示权重系数 1.5', hasCoef, formulaHTML.substring(0, 80));

  await ctx.close();
}

// ---- T14: 类型切换时权重重置 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 修改 Gyroid 权重
  await dragSlider(page, '#w-a', '2');
  await releaseSlider(page, '#w-a');
  await page.waitForTimeout(500);

  // 切到 Diamond 再切回 Gyroid
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-type="gyroid"]').click();
  await page.waitForTimeout(800);

  // 权重应该重置为 1.0
  const wVal = await page.locator('#w-a-val').textContent();
  log('类型切换后权重重置为 1.0', wVal === '1.0', `实际=${wVal}`);

  await ctx.close();
}

// ---- T15: 分享链接包含权重参数 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 读取 clipboard 权限
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.locator('#btn-share').click();
  await page.waitForTimeout(500);

  const clipText = await page.evaluate(() => navigator.clipboard.readText());
  const url = new URL(clipText);
  const hasWa = url.searchParams.has('wa');
  const hasWd = url.searchParams.has('wd');
  log('分享链接含 wa/wd', hasWa && hasWd, `wa=${hasWa} wd=${hasWd}`);

  await ctx.close();
}

// ---- T16: URL 参数恢复 Diamond 权重 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html?type=diamond&wd=1.8', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const wdVal = await page.locator('#w-d-val').textContent();
  log('URL 恢复 Diamond wd=1.8', wdVal === '1.8', `实际=${wdVal}`);

  await ctx.close();
}

await browser.close();

const passed = results.filter(r => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
