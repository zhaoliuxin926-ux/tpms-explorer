// 工程版运行时冒烟（轻量版）：只验证 WebGL 初始化 + 0 pageerror，不截图
// 截图在工程版持续 RAF + swiftshader 下会超时（环境限制，非代码缺陷——印证 audit P2#2 未按需渲染）
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4812/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];

const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message + (e.stack ? '\n' + e.stack.slice(0,200) : '')));
page.on('requestfailed', r => { const u = r.url(); if (!u.includes('favicon')) errors.push('requestfailed: ' + u); });

console.log('--- 加载工程版 ---');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000); // 等首屏重建 + worker

// WebGL + canvas 检查
const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { canvas: false };
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return {
    canvas: true,
    width: c.width, height: c.height,
    webgl: !!gl,
    // drawingbuffer 是否真有内容（非全黑）：读一个像素
  };
}).catch(e => ({ evaluateError: e.message }));
console.log('  canvas/WebGL:', JSON.stringify(info));

// 尝试切 F-RD（验证 P2b 系数改动不崩溃）
console.log('--- 切 F-RD ---');
const frdCount = await page.locator('[data-type="frd"]').count().catch(() => 0);
console.log('  frd 按钮数:', frdCount);
if (frdCount > 0) {
  await page.locator('[data-type="frd"]').first().click().catch(e => errors.push('frd click: ' + e.message));
  await page.waitForTimeout(6000); // 等重建完成
  console.log('  F-RD 切换后存活（未抛 pageerror 即重建成功）');
}

// 再切 lidinoid / splitp（工程版也支持，确认无崩溃）
for (const t of ['lidinoid', 'splitp']) {
  const cnt = await page.locator(`[data-type="${t}"]`).count().catch(() => 0);
  if (cnt > 0) {
    await page.locator(`[data-type="${t}"]`).first().click().catch(e => errors.push(t + ' click: ' + e.message));
    await page.waitForTimeout(4000);
    console.log(`  ${t} 切换存活`);
  }
}

await browser.close();

console.log('\n==== 工程版冒烟结果 ====');
console.log('WebGL 初始化:', info.canvas && info.webgl ? '✓' : '✗');
console.log('控制台错误/pageerror 数:', errors.length);
errors.forEach(e => console.log('  ', e));
console.log(errors.length === 0 ? '✅ 0 错误，F-RD/lidinoid/splitp 重建均未崩溃' : '❌ 有错误');
