import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// 模拟拖动 range（只触发 input，不触发 change），更接近真实用户拖动中间状态
async function dragSlider(page, selector, val){
  await page.locator(selector).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, val);
}

// 模拟松手（触发 change）
async function releaseSlider(page, selector){
  await page.locator(selector).dispatchEvent('change');
}

// ---- Test 1: 页面正常加载，无 JS 错误 ----
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

// ---- Test 2-5: 权重区可见性 + 类型切换（同一 page）----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // T2: gyroid 默认权重区可见
  const visibleDefault = await page.locator('#formula-weights').evaluate(el => el.classList.contains('show'));
  log('Gyroid 时权重区可见', visibleDefault);

  // T3: 切 diamond 隐藏
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(500);
  const hiddenDiamond = await page.locator('#formula-weights').evaluate(el => !el.classList.contains('show'));
  log('Diamond 时权重区隐藏', hiddenDiamond);

  // T4: 切回 gyroid 恢复
  await page.locator('[data-type="gyroid"]').click();
  await page.waitForTimeout(500);
  const visibleAgain = await page.locator('#formula-weights').evaluate(el => el.classList.contains('show'));
  log('切回 Gyroid 时权重区恢复', visibleAgain);

  // T5: 切换类型后权重重置
  await dragSlider(page, '#w-b', 1.8);
  await page.waitForTimeout(300);
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-type="gyroid"]').click();
  await page.waitForTimeout(500);
  const wBval = await page.locator('#w-b').inputValue();
  log('切换类型后权重重置为 1', wBval === '1', `actual=${wBval}`);

  await ctx.close();
}

// ---- Test 6: 拖动权重 → 高亮 + 重建 + 松手清除 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const statsBefore = await page.locator('#stats').textContent();

  // 拖动 w-a 到 0（只触发 input）
  await dragSlider(page, '#w-a', 0);
  await page.waitForTimeout(600);

  // 公式项 a 应高亮
  const hlActive = await page.locator('#formula-display .term[data-w="a"]').evaluate(el => el.classList.contains('term-hl'));
  log('拖动 w-a 时公式项 a 高亮', hlActive);

  // 数值更新
  const coefText = await page.locator('#w-a-val').textContent();
  log('w-a 数值更新为 0.0', coefText === '0.0', `actual="${coefText}"`);

  // 曲面重建
  const statsAfter = await page.locator('#stats').textContent();
  log('权重变化触发曲面重建', statsBefore !== statsAfter);

  await page.screenshot({ path: `${OUT}/04-weight-a-zero.png` });

  // 松手 → 高亮消失
  await releaseSlider(page, '#w-a');
  await page.waitForTimeout(600);
  const hlCleared = await page.locator('#formula-display .term[data-w="a"]').evaluate(el => !el.classList.contains('term-hl'));
  log('松手后公式项高亮消失', hlCleared);

  await ctx.close();
}

// ---- Test 7: 权重差异导致曲面形态不同 + URL 恢复 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();

  // 默认权重截图
  await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('#btn-rotate').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-default-weights.png` });

  // w-a=0, w-b=1, w-c=1 → 形态必须不同
  await dragSlider(page, '#w-a', 0);
  await releaseSlider(page, '#w-a');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/07-weight-a-zero-bc-one.png` });

  const s1 = fs.statSync(`${OUT}/05-default-weights.png`).size;
  const s3 = fs.statSync(`${OUT}/07-weight-a-zero-bc-one.png`).size;
  const diffReal = Math.abs(s1 - s3) / Math.max(s1, s3);
  log('权重差异导致曲面形态不同', diffReal > 0.01, `sizeDiff=${(diffReal*100).toFixed(1)}%`);

  await ctx.close();
}

// ---- Test 8: URL 参数恢复权重 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/app.html?wa=0.5&wb=1.5&wc=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const wa = await page.locator('#w-a').inputValue();
  const wb = await page.locator('#w-b').inputValue();
  log('URL 参数恢复权重', wa === '0.5' && wb === '1.5', `wa=${wa} wb=${wb}`);
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
