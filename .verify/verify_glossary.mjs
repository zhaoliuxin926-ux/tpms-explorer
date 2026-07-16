import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

// 7 个术语及其标题预期关键词
const TERMS = [
  ['porosity', '孔隙率'],
  ['cell-density', '单元密度'],
  ['thickness', '壁厚'],
  ['slice', '截面'],
  ['gradient', '梯度'],
  ['iso-c', '等值常数'],
  ['weight', '权重'],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---- T1: 页面加载无 JS 错误（gloss IIFE 不破坏模块） ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => { const t = msg.text(); if (msg.type() === 'error' && !/favicon|Failed to load resource|net::ERR|404/i.test(t)) errors.push(t); });
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  log('页面无 JS 错误', errors.length === 0, errors.slice(0,2).join(' | '));
  await ctx.close();
}

// ---- 主上下文：gloss 功能 + 回归 ----
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 关闭可能弹出的新手引导，避免遮挡
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded','1'); } catch(e){} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // T2: #gloss 存在且初始隐藏
  const glossExists = await page.locator('#gloss').count();
  const glossHiddenInitially = await page.locator('#gloss').evaluate(el => !el.classList.contains('show'));
  log('#gloss 容器存在', glossExists === 1);
  log('#gloss 初始隐藏', glossHiddenInitially);

  // T3: .gloss-term 元素数量 = 7
  const termCount = await page.locator('.gloss-term').count();
  log('.gloss-term 共 7 个', termCount === 7, `实际=${termCount}`);

  // T4: 真实 hover porosity → 显示 + 内容正确
  await page.locator('.gloss-term[data-term="porosity"]').hover();
  await page.waitForTimeout(300);
  const hoverShown = await page.locator('#gloss').evaluate(el => el.classList.contains('show'));
  const hoverTitle = await page.locator('#gloss-title').textContent();
  const hoverBodyLen = (await page.locator('#gloss-body').textContent()).length;
  log('hover 孔隙率 → 卡片显示', hoverShown);
  log('hover 标题含“孔隙率”', hoverTitle.includes('孔隙率'), `实际=${hoverTitle}`);
  log('hover 正文非空', hoverBodyLen > 10, `len=${hoverBodyLen}`);

  // 截图：hover 状态
  await page.screenshot({ path: `${OUT}/c-gloss-hover.png`, fullPage: false });

  // T5: 遍历全部 7 个 term（click 触发），标题关键词匹配
  for (const [term, kw] of TERMS) {
    await page.locator(`.gloss-term[data-term="${term}"]`).click();
    await page.waitForTimeout(150);
    const shown = await page.locator('#gloss').evaluate(el => el.classList.contains('show'));
    const title = await page.locator('#gloss-title').textContent();
    log(`click ${term} → 显示且标题含“${kw}”`, shown && title.includes(kw), `标题=${title}`);
  }

  // T6: 点击 viewer 外部区域 → 隐藏
  await page.locator('#canvas-container').click({ position: { x: 50, y: 50 } });
  await page.waitForTimeout(200);
  const hiddenAfterOutsideClick = await page.locator('#gloss').evaluate(el => !el.classList.contains('show'));
  log('点击外部 → 卡片隐藏', hiddenAfterOutsideClick);

  // T7: 显示后按 Esc → 隐藏
  await page.locator('.gloss-term[data-term="thickness"]').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const hiddenAfterEsc = await page.locator('#gloss').evaluate(el => !el.classList.contains('show'));
  log('Esc → 卡片隐藏', hiddenAfterEsc);

  // T8: 回归 - gloss 不破坏方向 B 权重交互（切 Diamond 仍 4 行）
  await page.locator('[data-type="diamond"]').click();
  await page.waitForTimeout(800);
  const dRows = await page.locator('#weight-rows .fw-row').count();
  log('回归 Diamond 权重仍 4 行', dRows === 4, `实际=${dRows}`);
  // gloss 仍能工作
  await page.locator('.gloss-term[data-term="weight"]').click();
  await page.waitForTimeout(150);
  const glossAfterTypeSwitch = await page.locator('#gloss').evaluate(el => el.classList.contains('show'));
  log('切类型后 gloss 仍可用', glossAfterTypeSwitch);

  // T9: 回归 - 方向 A 引导按钮仍在
  const obBtn = await page.locator('#btn-onboard').count();
  log('回归 新手引导按钮仍在', obBtn === 1);

  await ctx.close();
}

await browser.close();

const passed = results.filter(r => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
