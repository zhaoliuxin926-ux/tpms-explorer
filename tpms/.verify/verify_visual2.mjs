// W2/W5 目视验证（frd MSAA + 配图模式退出），独立脚本，加大等待
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:8123/app.html';
const OUT = 'D:/TRAE AI/tpms/.diag/shots';
fs.mkdirSync(OUT, { recursive: true });

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];

const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => { const u = r.url(); if (!u.includes('favicon')) errors.push('requestfailed: ' + u); });

async function loadAndSetup(type) {
  await page.addInitScript(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch(e){} });
  await page.goto(`${BASE}?type=${type}&porosity=75&autoRotate=0`, { waitUntil: 'domcontentloaded' });
  // 等高清重建完成标志：#stats 文本含"高清"
  await page.waitForFunction(() => {
    const s = document.getElementById('stats');
    return s && s.textContent && s.textContent.includes('高清');
  }, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// === W2: frd MSAA 边缘 ===
console.log('--- W2: frd MSAA 边缘 ---');
await loadAndSetup('frd');
await page.screenshot({ path: path.join(OUT, 'W2-frd-msaa-edge.png'), timeout: 60000 });
console.log('  frd 截图完成');

// === W5: 配图模式 ===
console.log('--- W5: 配图模式进入+退出 ---');
// 重新加载一次干净状态
await loadAndSetup('gyroid');
// 记录导出的下载（通过 download 事件或观察 canvas 尺寸变化）
const downloads = [];
ctx.on('page', () => {}); // no-op
const beforeCanvasW = await page.evaluate(() => document.querySelector('canvas')?.width);
console.log('  进入前 canvas.width =', beforeCanvasW);
await page.locator('#btn-figure').click();
await page.waitForTimeout(4000); // 进入→2x渲染→导出→退出
const afterExitCanvasW = await page.evaluate(() => document.querySelector('canvas')?.width);
console.log('  退出后 canvas.width =', afterExitCanvasW);
await page.screenshot({ path: path.join(OUT, 'W5-after-figure-exit.png'), timeout: 60000 });
console.log('  配图退出后截图完成');
console.log('  canvas 尺寸：进入前', beforeCanvasW, '→ 退出后', afterExitCanvasW, beforeCanvasW === afterExitCanvasW ? '(一致✓)' : '(不一致✗)');

await browser.close();

console.log('\n==== W2/W5 验证完成 ====');
console.log('控制台错误数:', errors.length);
errors.forEach(e => console.log('  ', e));
