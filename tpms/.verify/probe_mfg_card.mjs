// probe_mfg_card.mjs — 制造检查卡冒烟（2026-10-25，一次性快检，不入 CI）
// 默认设计（gyroid@75）→ 运行制造检查 → 结果文本四指标齐备；封闭球腔负例走模块级 F8 已覆盖。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4860;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(ROOT, 'docs/platform')]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(90_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 90_000 }).catch(() => {});
await page.evaluate(() => document.querySelector('#btn-mfg')?.closest('details')?.setAttribute('open', ''));
await page.evaluate(() => (document.getElementById('btn-mfg') instanceof HTMLElement) && document.getElementById('btn-mfg').click());
await page.waitForFunction(() => /最小壁厚/.test(document.querySelector('#mfg-result')?.textContent ?? ''), { timeout: 90_000, polling: 300 });

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
const txt = await page.evaluate(() => document.querySelector('#mfg-result')?.textContent ?? '');
ok('结果文本四指标齐备（壁厚/孔喉/封闭腔/连通+分辨率披露）',
  /最小壁厚/.test(txt) && /主域孔喉/.test(txt) && /封闭孔腔/.test(txt) && /孔隙连通/.test(txt) && /量化误差/.test(txt), txt.split('\n')[0]);
ok('gyroid@75 默认设计壁厚为有限值', /medial 旋转不变）：\d/.test(txt));
ok('0 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== MFG CARD SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
