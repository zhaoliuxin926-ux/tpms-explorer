// 重截 shots/ 五张展示图。前置：项目根目录运行 `python -m http.server 8123`，从 .verify 目录执行 `node reshoot.mjs`
import { chromium } from 'playwright';
const SHOTS = [
  ['01-gyroid-surface', 'autoRotate=0'],
  ['02-gyroid-bone', 'type=gyroid&model=surface&structure=shell&container=cylinder&porosity=84&cellSize=2&thickness=0.8&slice=34&material=tc4&autoRotate=0'],
  ['03-diamond-strut', 'type=diamond&model=strut&structure=solid_network&container=cube&porosity=68&cellSize=4&thickness=1.3&slice=100&material=polymer&autoRotate=0'],
  ['04-schwarz-heat', 'type=schwarz&model=solid&structure=gradient_shell&container=cube&porosity=74&cellSize=3&thickness=0.6&slice=16&material=thermal&autoRotate=0'],
  ['05-diamond-surface', 'type=diamond&model=surface&structure=solid_network&container=cube&porosity=75&cellSize=3&thickness=1.0&slice=100&material=auto&autoRotate=0'],
];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
for (const [name, query] of SHOTS) {
  await page.goto(`http://localhost:8123/app.html?${query}`, { waitUntil: 'networkidle' });
  // 等首次高清重建完成（状态栏出现耗时数字）
  await page.waitForFunction(() => /重建 <b>[\d.]/.test(document.getElementById('stats')?.innerHTML || ''), { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `../shots/${name}.png` });
  console.log('shot:', name);
}
await browser.close();
console.log('done');
