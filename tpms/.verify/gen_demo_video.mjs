/**
 * gen_demo_video.mjs —— 演示视频素材（T6 可选）：playwright 录屏工程版操作流
 * 产出 docs/screenshots/demo-tour.webm（≥60s）——配音/剪配后可发 B 站。
 * 复跑：node gen_demo_video.mjs
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PORT = 8131;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(REPO, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: path.join(REPO, 'docs/screenshots'), size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /顶点\s*\d|三角/.test(document.body.innerText), { timeout: 120000 }).catch(() => {});
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 幕1：默认几何自转展示（5s）
  await wait(5000);

  // 幕2：切 24 族曲面轮播（每族 1.2s，取 8 族）
  const types = ['diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'octo', 'karcher'];
  for (const t of types) {
    await page.evaluate((ty) => {
      const b = document.querySelector(`[data-type="${ty}"]`);
      if (b) { b.dispatchEvent(new Event('click', { bubbles: true })); b.scrollIntoView({ block: 'center' }); }
    }, t);
    await wait(1200);
  }

  // 幕3：孔隙率滑块拖动（75 → 45）
  await page.evaluate(() => {
    const s = document.getElementById('porosity');
    if (s) { s.value = '45'; s.dispatchEvent(new Event('input', { bubbles: true })); s.scrollIntoView({ block: 'center' }); }
  });
  await wait(4000);

  // 幕4：radial-grad M(r) 卡生成（MT 实时预览）
  await page.evaluate(() => {
    document.querySelector('#grp-view .sgroup-h')?.dispatchEvent(new Event('click', { bubbles: true }));
    document.querySelector('[data-type="schwarz"]')?.dispatchEvent(new Event('click', { bubbles: true }));
    document.getElementById('rg-gen')?.scrollIntoView({ block: 'center' });
  });
  await wait(600);
  await page.evaluate(() => document.getElementById('rg-gen')?.click());
  await page.waitForFunction(() => (document.getElementById('rg-status')?.textContent || '').includes('实测孔隙率'), { timeout: 120000 }).catch(() => {});
  await wait(6000);

  // 幕5：直接层切预览（扫描线视图）
  await page.evaluate(() => {
    document.getElementById('slicepv-gen')?.scrollIntoView({ block: 'center' });
    document.getElementById('slicepv-gen')?.click();
  });
  await wait(6000);

  // 幕6：层位滑块扫几层
  for (const z of ['10', '60', '110']) {
    await page.evaluate((v) => {
      const s = document.getElementById('slicepv-z');
      if (s) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }
    }, z);
    await wait(1500);
  }
  await wait(2000);
} finally {
  const video = page.video();
  await ctx.close();  // 关闭上下文落盘视频
  const saved = await video?.path().catch(() => null);
  await browser.close().catch(() => {});
  try { server.kill(); } catch { /* 忽略 */ }
  console.log('VIDEO:', saved || '(无)');
}
