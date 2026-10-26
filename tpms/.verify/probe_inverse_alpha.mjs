// probe_inverse_alpha.mjs — P1-04 修复验证（2026-10-26 批十五，一次性，不入 CI）
// 目标 E=10GPa/P=60% → 求解（收敛解含 α>1 放大）→ 应用 → 结果区出现「应用后核对」
// α=1 重算行，且重算 E 显著低于求解器预测（α 未兑现的缺口如实披露，非冒充达标）。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4871;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(ROOT, 'docs/platform')]);
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/Worker build timed out.*已重建 worker/.test(m.text())) errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });

// 目标：E=10GPa（inv-e 值=100 → /10）+ P=60%（评估同款复现场景）
await page.evaluate(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('inv-e', 100);
  set('inv-k', 0);
  set('inv-p', 60);
});
await page.evaluate(() => document.getElementById('btn-inv-solve')?.click());
await page.waitForFunction(() => /GPa/.test(document.getElementById('inverse-result')?.textContent || ''), { timeout: 60_000, polling: 400 });
const solveTxt = await page.evaluate(() => document.getElementById('inverse-result')?.textContent || '');
const predE = parseFloat((solveTxt.match(/E\*=(\d+\.\d+)GPa/) || [])[1] ?? '0');
const alphaM = solveTxt.match(/α=(\d+\.\d+)/);
ok('求解器收敛解含 E 预测与 α（复现前提）', predE > 5 && alphaM != null && parseFloat(alphaM[1]) > 1.2, solveTxt.slice(0, 90));

await page.evaluate(() => document.getElementById('btn-inv-apply')?.click());
await page.waitForFunction(() => /应用后核对/.test(document.getElementById('inverse-result')?.textContent || ''), { timeout: 30_000, polling: 300 });
const afterTxt = await page.evaluate(() => document.getElementById('inverse-result')?.textContent || '');
const reM = afterTxt.match(/α=1 重算同代理）：E\*=(\d+\.\d+) GPa vs 目标 ([\d.]+) GPa（([+-][\d.]+)%/);
ok('应用后核对行出现（α 不可几何化披露）', reM != null, afterTxt.split('\n').slice(-1)[0]?.slice(0, 80) ?? '');
if (reM) {
  const reE = parseFloat(reM[1]);
  const gap = parseFloat(reM[3]);
  ok('重算 E < 预测×0.85（α 未兑现缺口如实可见）', reE < predE * 0.85, `pred=${predE} recheck=${reE}`);
  ok('缺口百分比 ≈ (重算/预测−1)', Math.abs(gap - (reE / predE - 1) * 100) < 0.5, `gap=${gap}%`);
  ok('目标缺口披露为负（未达标不冒充）', gap < -5, `gap=${gap}%`);
}
ok('0 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
server.kill();
console.log(`\n== INVERSE ALPHA: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
