/**
 * refresh_teach_shots.mjs —— docs/shots 五张教学版展示图复拍（2026-09-27）
 *
 * 背景：原五张为 2026-08-27 手拍；其后 226e59d（相机 FOV 30 + 机位拉远）与
 * 1244f02（顶栏调色切换）改变了画面构图/顶栏 —— 落地页 og:image 与 showcase 已失真。
 * app.html URL 参数本就为「自动截图脚本按场景截图」设计（源码注释 M5），此处按
 * 原五张构图语义复拍：默认曲面 / bone 双壳圆柱 / diamond 桁架 / schwarz 传热 / diamond 曲面。
 *
 * 复跑：node refresh_teach_shots.mjs   （自起 8129，覆盖写 docs/shots/*.png）
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'docs/shots');
const PORT = 8129;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(REPO, 'docs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const BASE = `http://localhost:${PORT}/app.html`;

const SHOTS = [
  { file: '01-gyroid-surface.png', q: '' },
  { file: '02-gyroid-bone.png', q: '?type=gyroid&model=surface&structure=gradient_shell&container=cylinder&porosity=70&cellSize=3&thickness=1.3&material=tc4&slice=34' },
  { file: '03-diamond-strut.png', q: '?type=diamond&model=strut&structure=solid_network&container=cube&porosity=90&cellSize=4&thickness=1.3&material=polymer&slice=100' },
  { file: '04-schwarz-heat.png', q: '?type=schwarz&model=surface&structure=shell&container=cube&porosity=74&cellSize=2&thickness=1.0&material=thermal&slice=16' },
  { file: '05-diamond-surface.png', q: '?type=diamond&model=surface&structure=solid_network&container=cube&porosity=75&cellSize=3&thickness=1.0&material=auto&slice=100' },
];

const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// 先落一次教学版写 onboard 标记（键名 tpms-onboarded，见 app.html 引导 IIFE），防 ob-card 弹进画面
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms-onboarded', '1'));

for (const s of SHOTS) {
  await page.goto(BASE + s.q, { waitUntil: 'domcontentloaded' });
  // 等首次重建出画：canvas 非空且 loading 覆盖层退场，再留旋前静止帧
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    const ld = document.getElementById('loading');
    return !!c && c.width > 100 && (!ld || ld.style.display === 'none' || !ld.offsetParent);
  }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, s.file) });
  console.log('✓', s.file);
}

await browser.close();
server.kill();
console.log('DONE → docs/shots/');
