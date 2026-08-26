// 修复验证：B1 权重滑块接线 / B2 统计面板 / B3 新手引导 / B4 快捷键 / 0 pageerror
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4811/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info = '') => { fail++; console.log('FAIL', name, info); };

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// ── 第一遍：干净首访（验 B3 引导 + B1 默认权重 UI）──
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500); // 首屏重建 + 引导 750ms 延时

// B3-1 首访自动弹出引导
let ob = await page.evaluate(() => ({
  show: document.getElementById('ob-card')?.classList.contains('show'),
  step1: document.querySelector('.ob-step')?.textContent,
  title: document.querySelector('#ob-card h4')?.textContent,
}));
ob.show && /第 1 步 \/ 共 6/.test(ob.step1 || '') && /欢迎/.test(ob.title || '')
  ? ok('B3 首访自动弹出第 1/6 步') : bad('B3 首访自动弹出', JSON.stringify(ob));

// B3-2 spotlight 聚焦 .viewer（spot 有尺寸）
let spot = await page.evaluate(() => {
  const s = document.getElementById('ob-spot');
  return { show: s?.classList.contains('show'), w: s?.offsetWidth, h: s?.offsetHeight };
});
spot.show && (spot.w || 0) > 50 && (spot.h || 0) > 50
  ? ok('B3 spotlight 聚焦视口') : bad('B3 spotlight', JSON.stringify(spot));

// B3-3 演示按钮驱动（第 2 步孔隙率滑块变 88）；用 DOM click 绕过 Playwright 对重建 DOM 的 actionability 等待
const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
await domClick('#ob-next');
await page.waitForTimeout(300);
const hasDemo2 = await page.evaluate(() => !!document.getElementById('ob-demo'));
hasDemo2 ? ok('B3 第 2 步有演示按钮') : bad('B3 第 2 步演示按钮');
await domClick('#ob-demo');
const porAfterDemo = await page.evaluate(() => document.getElementById('porosity')?.value);
porAfterDemo === '88' ? ok('B3 演示驱动孔隙率=88') : bad('B3 演示驱动', 'porosity=' + porAfterDemo);

// B3-4 走完 6 步并关闭
await domClick('#ob-next'); await page.waitForTimeout(200);
await domClick('#ob-next'); await page.waitForTimeout(200);
await domClick('#ob-next'); await page.waitForTimeout(200);
await domClick('#ob-next'); await page.waitForTimeout(200);
let lastTitle = await page.evaluate(() => document.querySelector('#ob-card h4')?.textContent);
/把结果带走/.test(lastTitle || '') ? ok('B3 到达第 6 步') : bad('B3 第 6 步', String(lastTitle));
await domClick('#ob-next'); // 开始探索 → 关闭
await page.waitForTimeout(300);
let closed = await page.evaluate(() => ({
  card: !document.getElementById('ob-card')?.classList.contains('show'),
  key: localStorage.getItem('tpms_onboard_v1'),
}));
closed.card && closed.key === '1' ? ok('B3 完成引导并写 localStorage') : bad('B3 关闭', JSON.stringify(closed));

// B3-5 刷新不再弹出；顶栏按钮重开 + Esc 关闭
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
let autoAgain = await page.evaluate(() => document.getElementById('ob-card')?.classList.contains('show'));
!autoAgain ? ok('B3 二次访问不自动弹出') : bad('B3 二次访问不应弹出');
await page.click('#btn-onboard');
await page.waitForTimeout(300);
let reopened = await page.evaluate(() => document.getElementById('ob-card')?.classList.contains('show'));
reopened ? ok('B3 顶栏按钮重开引导') : bad('B3 重开');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
let escClosed = await page.evaluate(() => !document.getElementById('ob-card')?.classList.contains('show'));
escClosed ? ok('B3 Esc 关闭') : bad('B3 Esc');

// ── B1 权重滑块 ──
// B1-1 默认 gyroid：3 行（fw-a/b/c），面板 .fw.show
let w1 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#weight-rows .fw-row')];
  return {
    n: rows.length,
    ids: rows.map(r => r.querySelector('input')?.id),
    show: document.getElementById('formula-weights')?.classList.contains('show'),
    vals: rows.map(r => r.querySelector('.fw-val')?.textContent),
  };
});
w1.n === 3 && w1.show && ['fw-a', 'fw-b', 'fw-c'].every(id => w1.ids.includes(id)) && w1.vals.every(v => v === '1.0')
  ? ok('B1 gyroid 3 滑块且默认 1.0') : bad('B1 gyroid', JSON.stringify(w1));

// B1-2 拖 fw-a → 数值/公式系数/高亮联动
await page.evaluate(() => {
  const el = document.getElementById('fw-a');
  el.value = '1.5';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
let hl = await page.evaluate(() => ({
  val: document.getElementById('fw-a-val')?.textContent,
  tagOn: document.querySelector('.fw-tag[data-w="a"]')?.classList.contains('on'),
  termHl: document.querySelector('#formula-display .term[data-w="a"]')?.classList.contains('term-hl'),
}));
hl.val === '1.5' && hl.tagOn && hl.termHl ? ok('B1 拖动实时值+高亮联动') : bad('B1 拖动联动', JSON.stringify(hl));
await page.evaluate(() => {
  const el = document.getElementById('fw-a');
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
// 等 worker 回来后公式显示系数 1.5·
await page.waitForFunction(() => document.querySelector('#formula-display .wcoef')?.textContent?.includes('1.5'), null, { timeout: 20000 }).catch(() => {});
const coef = await page.evaluate(() => document.querySelector('#formula-display .wcoef')?.textContent || '');
coef.includes('1.5') ? ok('B1 松手后公式系数 1.5·') : bad('B1 公式系数', 'coef=' + coef);

// B1-3 切换曲面类型重建滑块行（diamond 4 / neovius 2）且值重置
await domClick('[data-type="diamond"]');
await page.waitForTimeout(400);
let w2 = await page.evaluate(() => ({
  n: document.querySelectorAll('#weight-rows .fw-row').length,
  vals: [...document.querySelectorAll('#weight-rows .fw-val')].map(e => e.textContent),
}));
w2.n === 4 && w2.vals.every(v => v === '1.0') ? ok('B1 diamond 4 滑块重置') : bad('B1 diamond', JSON.stringify(w2));
await domClick('[data-type="neovius"]');
await page.waitForTimeout(400);
let w3 = await page.evaluate(() => document.querySelectorAll('#weight-rows .fw-row').length);
w3 === 2 ? ok('B1 neovius 2 滑块') : bad('B1 neovius', 'n=' + w3);

// B1-4 预设恢复（预设含 type，syncUI 重建）
await domClick('[data-preset="bone"]');
await page.waitForTimeout(400);
let w4 = await page.evaluate(() => ({
  n: document.querySelectorAll('#weight-rows .fw-row').length,
  activeType: document.querySelector('[data-type].active')?.getAttribute('data-type'),
}));
w4.activeType === 'gyroid' && w4.n === 3 ? ok('B1 预设后权重行重建') : bad('B1 预设', JSON.stringify(w4));

// ── B2 统计面板 ──
await domClick('#stat-toggle');
let stat = await page.evaluate(() => {
  const box = document.getElementById('statbox');
  const full = document.querySelector('.stat-full');
  return { open: box?.classList.contains('open'), display: full ? getComputedStyle(full).display : null };
});
stat.open && stat.display !== 'none' ? ok('B2 统计面板展开') : bad('B2 展开', JSON.stringify(stat));
await domClick('#stat-toggle');
let stat2 = await page.evaluate(() => ({
  open: document.getElementById('statbox')?.classList.contains('open'),
  display: getComputedStyle(document.querySelector('.stat-full')).display,
}));
!stat2.open && stat2.display === 'none' ? ok('B2 统计面板收起') : bad('B2 收起', JSON.stringify(stat2));

// ── B4 快捷键 ──
await page.evaluate(() => document.body.focus()); // 确保焦点不在输入框（keydown 绑在 window 上）
await domClick('[data-material="auto"]'); // 材料回 auto，让循环断言起点确定
await page.waitForTimeout(200);
await page.keyboard.press('5');
await page.waitForTimeout(500);
let t5 = await page.evaluate(() => document.querySelector('[data-type].active')?.getAttribute('data-type'));
t5 === 'iwp' ? ok('B4 按 5 切 I-WP') : bad('B4 按 5', 'active=' + t5);
await page.keyboard.press('8');
await page.waitForTimeout(300);
let t8 = await page.evaluate(() => document.querySelector('[data-type].active')?.getAttribute('data-type'));
t8 === 'splitp' ? ok('B4 按 8 切 Split-P') : bad('B4 按 8', 'active=' + t8);
await page.keyboard.press('9');
await page.waitForTimeout(300);
let m1 = await page.evaluate(() => document.querySelector('[data-material].active')?.getAttribute('data-material'));
m1 === 'tc4' ? ok('B4 按 9 材料循环 auto→tc4') : bad('B4 按 9', 'material=' + m1);
await page.keyboard.press('9');
await page.waitForTimeout(300);
let m2 = await page.evaluate(() => document.querySelector('[data-material].active')?.getAttribute('data-material'));
m2 === 'polymer' ? ok('B4 再按 9 材料 tc4→polymer') : bad('B4 材料2', 'material=' + m2);
await page.keyboard.press('?');
await page.waitForTimeout(300);
const toastText = await page.evaluate(() => document.body.innerText.match(/1-8 曲面[^\n]*/)?.[0] || '');
toastText.includes('1-8 曲面') && toastText.includes('9 材料') && toastText.includes('R 旋转') && toastText.includes('V 复位视角')
  ? ok('B4 帮助文案与实际一致') : bad('B4 帮助文案', toastText);

// ── 汇总 ──
if (errors.length) { bad('运行时错误', errors.slice(0, 5).join(' | ')); }
else ok('全程 0 pageerror / 0 console.error');

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
