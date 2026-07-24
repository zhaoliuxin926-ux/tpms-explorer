// 终审目视验证：用系统 Chrome 驱动 app.html，验证 W1/W2/W5 视觉改动 + 抓控制台错误
// 前置：python -m http.server 8123 在 tpms/web 已起
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
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => { const u = r.url(); if (!u.includes('favicon')) errors.push('requestfailed: ' + u + ' ' + (r.failure()?.errorText||'')); });

async function loadAndSetup(type) {
  // 跳过新手引导：先设 onboarded，再带 type 参数加载
  await page.addInitScript(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch(e){} });
  await page.goto(`${BASE}?type=${type}&porosity=75&autoRotate=0`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // 等高清重建（约 200-400ms，留余量）
}

// === W1: lidinoid / splitp 法线（surface 模式默认，高金属度看高光）===
console.log('--- W1: lidinoid 法线 ---');
await loadAndSetup('lidinoid');
await page.screenshot({ path: path.join(OUT, 'W1-lidinoid-surface.png') });
console.log('  lidinoid 截图完成');

console.log('--- W1: splitp 法线 ---');
await loadAndSetup('splitp');
await page.screenshot({ path: path.join(OUT, 'W1-splitp-surface.png') });
console.log('  splitp 截图完成');

// === 对照：gyroid（法线逻辑未动，作为高光基准）===
console.log('--- 对照: gyroid ---');
await loadAndSetup('gyroid');
await page.screenshot({ path: path.join(OUT, 'W1-gyroid-baseline.png') });
console.log('  gyroid 基准截图完成');

// === W2: MSAA 边缘锯齿（frd 曲面，看边缘平滑度）===
console.log('--- W2: MSAA 边缘（frd）---');
await loadAndSetup('frd');
await page.screenshot({ path: path.join(OUT, 'W2-frd-msaa-edge.png') });
console.log('  frd MSAA 截图完成');

// === W5: 配图模式 — 进入后退出，确认画面不错位 ===
console.log('--- W5: 配图模式退出后画面 ---');
await loadAndSetup('gyroid');
// 点论文配图按钮（会自导出 PNG 再退出）
const figBtn = page.locator('#btn-figure');
await figBtn.click();
await page.waitForTimeout(2500); // 等进入+导出+退出动画
await page.screenshot({ path: path.join(OUT, 'W5-after-figure-exit.png') });
console.log('  配图退出后截图完成');

await browser.close();

console.log('\n==== 视觉验证完成 ====');
console.log('截图目录:', OUT);
fs.readdirSync(OUT).filter(f => f.endsWith('.png')).forEach(f => console.log('  -', f));
console.log('\n控制台错误数:', errors.length);
errors.forEach(e => console.log('  ', e));
console.log(errors.length === 0 ? '✅ 0 错误' : '❌ 有错误，见上');
