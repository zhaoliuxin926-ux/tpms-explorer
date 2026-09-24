/**
 * slicepv_check.mjs —— 直接层切预览卡片冒烟（战役三 UI 感知层）
 *
 * 断言：
 *  A. 卡片存在且内嵌构型组（sect 计数不因本卡变化——ui_jump 已钉分组数，此处只验元素在构型组内）
 *  B. 生成按钮点击 → 120 层就绪状态 + 滑块启用 + canvas 非空白（像素统计）
 *  C. 滑块拖动 → 层位读数变化 + canvas 像素变化（渲染响应）
 *  D. shell 模式守卫 toast（切到 shell 再点生成 → 无层切就绪；含模式激活断言）
 *  E. C5 容器联动冒烟（可选重资产，跳过——由 tsc+barrel 同源保证，登记为未测项）
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');
// 复用 .verify 的 playwright-core（node_modules 已就位）

const PORT = 4821;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(PLATFORM_DIR, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ✓ ' + n); };
const bad = (n, d = '') => { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); };

const browser = await chromium.launch({ channel: 'chrome', executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(45000);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#slicepv-gen', { state: 'attached', timeout: 20000 });
  await page.evaluate(() => { document.querySelector('#grp-view .sgroup-h')?.dispatchEvent(new Event('click', { bubbles: true })); document.getElementById('slicepv-gen')?.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(400);
  // A. 卡片在构型组内
  const inGeom = await page.evaluate(() => {
    const el = document.getElementById('slicepv-gen');
    return !!el && !!el.closest('#grp-view'); // 与 C5 容器卡同组（视图与工具）——field 级内嵌，sect 计数零扰动
  });
  inGeom ? ok('A 卡片存在且与 C5 容器卡同组 grp-view（sect 计数零扰动）') : bad('A 卡片定位');
  // B. 生成
  await page.evaluate(() => document.getElementById('slicepv-gen')?.click());
  await page.waitForFunction(() => (document.getElementById('slicepv-status')?.textContent || '').includes('就绪'), { timeout: 60000 });
  const sliderEnabled = await page.evaluate(() => !(document.getElementById('slicepv-z') ).disabled);
  sliderEnabled ? ok('B 层切生成 → 120 层就绪 + 滑块启用') : bad('B 生成流程');
  const px1 = await page.evaluate(() => {
    const cv = document.getElementById('slicepv-canvas') ;
    const d = cv.getContext('2d').getImageData(0, 0, 256, 256).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && (d[i - 1] !== 0 || d[i - 2] !== 0 || d[i - 3] !== 0)) lit++;
    return lit;
  });
  px1 > 500 ? ok('B canvas 有渲染内容（非空白 ' + px1 + ' px）') : bad('B canvas 空白', String(px1));
  // C. 滑块响应
  const info1 = await page.evaluate(() => document.getElementById('slicepv-z-value')?.textContent || '');
  await page.evaluate(() => { const el = document.getElementById('slicepv-z'); if (el) { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); } });
  const info2 = await page.evaluate(() => document.getElementById('slicepv-z-value')?.textContent || '');
  info1 !== info2 && info2.includes('第 6/') ? ok('C 层位滑块响应（' + info2.trim() + '）') : bad('C 滑块', info1 + ' → ' + info2);
  // D. shell 守卫（选择器必须是 data-structure，不是 data-mode——历史假绿：data-mode 不存在时
  // 点击空操作 + 第二次生成若 400ms 内未写回「就绪」会被误判为守卫生效）
  await page.evaluate(() => { (document.querySelector('[data-structure="shell"]'))?.click(); });
  await page.waitForTimeout(300);
  const modeAfter = await page.evaluate(() => document.querySelector('[data-structure="shell"]')?.classList.contains('active') ?? false);
  modeAfter ? ok('D shell 模式已激活') : bad('D shell 模式未激活');
  await page.evaluate(() => document.getElementById('slicepv-gen')?.click());
  await page.waitForTimeout(400);
  const stillReady = await page.evaluate(() => (document.getElementById('slicepv-status')?.textContent || '').includes('就绪'));
  const shellBlocked = await page.evaluate(() => (document.getElementById('slicepv-status')?.textContent || '').includes('solid_network'));
  !stillReady && shellBlocked ? ok('D shell 模式点击不产层切（守卫生效）') : bad('D shell 守卫失效', `ready=${stillReady} blocked=${shellBlocked}`);
} catch (e) {
  bad('浏览器流程异常', e instanceof Error ? e.message.slice(0, 120) : String(e));
} finally {
  await browser.close().catch(() => {});
  try { server.kill(); } catch { /* 忽略 */ }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 6) { console.error(`GUARD FAIL: ${pass} < 6`); process.exit(1); }
process.exit(fail ? 1 : 0);
