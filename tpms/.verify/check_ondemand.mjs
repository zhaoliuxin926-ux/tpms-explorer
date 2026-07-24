import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type()==='error') errs.push('CONSOLE.ERR ' + m.text()); });

// 统计 requestAnimationFrame 调用次数（证明按需渲染：空闲时不再排帧）
await page.addInitScript(() => {
  window.__raf = 0;
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf++; return _raf(cb); };
});

await page.goto('http://127.0.0.1:8123/app.html?autoRotate=0', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // 等初始渲染 + 阻尼沉降结束

const c1 = await page.evaluate(() => window.__raf);
await page.waitForTimeout(1500); // 空闲窗口
const c2 = await page.evaluate(() => window.__raf);

// 模拟一次拖拽（轨道交互）应触发重绘，随后再次停息
const box = await page.locator('#canvas-container').boundingBox();
const cx = box.x + box.width/2, cy = box.y + box.height/2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 120, cy + 40, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
const c3 = await page.evaluate(() => window.__raf);
await page.waitForTimeout(4000); // 阻尼完全沉降后再次空闲（窗口拉长以容纳阻尼惯性）
const c4 = await page.evaluate(() => window.__raf);

console.log('raf @settle(c1)   =', c1);
console.log('raf @idle+1.5s(c2)=', c2, ' -> idle delta =', c2 - c1, '(应为 0: 无渲染=省GPU)');
console.log('raf after drag(c3)=', c3, ' -> drag delta =', c3 - c2, '(应 >0: 交互触发重绘)');
console.log('raf @settle2(c4)  =', c4, ' -> post-drag idle delta =', c4 - c3, '(应为 0: 再次停息)');
const idleSaved = (c2 - c1) === 0;
const dragTriggered = (c3 - c2) > 0;
const reSettled = (c4 - c3) === 0;
console.log('RESULT idleSaved=', idleSaved, ' dragTriggered=', dragTriggered, ' reSettled=', reSettled);
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
process.exit(idleSaved && dragTriggered && reSettled && errs.length===0 ? 0 : 1);
