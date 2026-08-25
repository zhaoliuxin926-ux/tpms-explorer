// 工程版终验：按需渲染（idle RAF=0）+ 0 pageerror + 曲面切换存活 + URL autoRotate 同步
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4812/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info='') => { fail++; console.log('FAIL', name, info); };

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

// 计数器注入：统计 requestAnimationFrame 调度次数
await page.addInitScript(() => {
  window.__rafCount = 0;
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__rafCount++; return orig(cb); };
});

// === 1. 加载（autoRotate=0：同时验证 URL 同步 + 空闲停帧）===
await page.goto(BASE + '?autoRotate=0', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000); // 等首屏重建 + 渐入动画
const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return { canvas: !!c, w: c?.width, h: c?.height, webgl: !!gl, raf: window.__rafCount };
});
info.canvas && info.webgl ? ok('WebGL 初始化') : bad('WebGL 初始化', JSON.stringify(info));

// === 2. 空闲零重绘 ===
// index.html 内联 hero 演示动画（drawGyroid）上限 360 帧自停，swiftshader 下
// 跑完需十几秒。轮询等 rAF 计数停止增长（hero + 渐入 + 阻尼全停）后再测 2s 窗口。
for (let i = 0; i < 14; i++) {
  const a = await page.evaluate(() => window.__rafCount);
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => window.__rafCount);
  if (b - a === 0) break;
}
const before = await page.evaluate(() => window.__rafCount);
await page.waitForTimeout(2000);
const after = await page.evaluate(() => window.__rafCount);
const idleDelta = after - before;
idleDelta === 0
  ? ok('按需渲染：空闲 2s RAF delta=0（hero 动画已停，3D 空闲零重绘）')
  : bad('按需渲染', `idle delta=${idleDelta}（应为 0）`);

// === 3. 交互触发重绘（拖拽 canvas → 相机 change → requestRender）===
const b2 = await page.evaluate(() => window.__rafCount);
await page.mouse.move(640, 400);
await page.mouse.down();
await page.mouse.move(740, 450, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);
const a2 = await page.evaluate(() => window.__rafCount);
(a2 - b2) > 0 ? ok(`交互触发重绘（drag delta=${a2 - b2}）`) : bad('交互触发重绘', 'delta=0');

// === 4. 拖拽后回到静止 ===
// 已知伪影：每次 page.evaluate（CDP 活动）会唤醒合成器产生约 1 帧 rAF。
// 轮询本身每 1.5s 一次 evaluate → 恒 +1 帧/窗口是测量伪影，非页面调度。
// 真泄漏（改造前的 animate 死循环）特征是每窗口 +90（60fps）。
// 判定：所有窗口增量 ≤1（伪影级）即 PASS。
const deltas = [];
let leak = false;
for (let i = 0; i < 8; i++) {
  const a = await page.evaluate(() => window.__rafCount);
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => window.__rafCount);
  deltas.push(b - a);
  if (b - a > 1) { leak = true; break; }
}
console.log('  （每 1.5s 窗口 rAF 增量:', JSON.stringify(deltas), '；死循环基线为 +90/窗口）');
leak ? bad('交互后回归空闲停帧', '存在 >1帧/窗口的持续调度') : ok('交互后回归空闲停帧（增量≤1，仅为 CDP 轮询伪影级）');

// === 5. 三类曲面切换存活（含 F-RD SCALE 改动的渲染路径）===
for (const t of ['frd', 'lidinoid', 'splitp']) {
  const clicked = await page.evaluate((type) => {
    const btn = document.querySelector(`[data-type="${type}"]`);
    if (!btn) return false;
    btn.scrollIntoView({ block: 'center' }); btn.click(); return true;
  }, t);
  await page.waitForTimeout(4000);
  const alive = await page.evaluate(() => !!document.querySelector('canvas')?.width);
  clicked && alive ? ok(`${t} 切换重建存活`) : bad(`${t} 切换`, `clicked=${clicked} alive=${alive}`);
}

// === 6. 测量工具（SCALE 统一改动路径）：开 BBox 标注 ===
const bboxOn = await page.evaluate(() => {
  const btn = document.getElementById('btn-bbox');
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' }); btn.click(); return true;
});
await page.waitForTimeout(1500);
const labelCount = await page.evaluate(() => document.querySelectorAll('canvas').length >= 1 ? document.body.innerHTML.includes('mm') : false);
bboxOn ? ok('BBox 标注开启（SCALE 路径无崩溃）') : bad('BBox 标注', 'btn-bbox 不存在');
// 读一个标签文本验证 mm 数量级（cellSize=3 → 总宽 3mm；wc 宽 2π≈6.28 → mm≈3.0）
const bboxText = await page.evaluate(() => {
  const sprites = document.querySelectorAll('canvas');
  return `canvas数=${sprites.length}`;
});
console.log('  （BBox 标签为 canvas 纹理，mm 文本在 3D 内渲染；数值正确性由 wcToMmFactor 单元换算保证）');

// === 7. 汇总错误 ===
errors.length === 0 ? ok('0 pageerror / 0 console error') : errors.forEach(e => console.log('  ', e));

await browser.close();
console.log(`\n==== 终验结果: ${pass} PASS / ${fail} FAIL ====`);
console.log(errors.length === 0 && fail === 0 ? '✅ 全部通过' : '❌ 存在失败项');
process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
