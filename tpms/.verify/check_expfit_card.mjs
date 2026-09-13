// check_expfit_card.mjs — 试验曲线反演卡片冒烟（一次性快检，不入 CI）
// 合成 CSV 上传 → 断言指标文本渲染 + canvas 显示 + 0 pageerror
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4856;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// 合成 ISO 13314 形 CSV（应变-应力双列）
const csv = await page.evaluate(() => {
  const E0 = 1200, K = 60000;
  const sig = (e) => {
    if (e <= 0.01) return K * e * e;
    if (e <= 0.035) return K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * 30 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 1.2 * Math.sin(2 * Math.PI * 0.37 / 0.075) * Math.exp(-0.37 / 0.25) + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = [];
  for (let e = 0; e <= 0.5001; e += 0.001) lines.push(e.toFixed(4) + ',' + sig(e).toFixed(4));
  return lines.join('\n');
});

// 展开仿真组 + 打开反演卡片 + 经 DataTransfer 注入文件
await page.evaluate(() => {
  const card = document.querySelector('#expfit-file');
  card?.closest('details')?.setAttribute('open', '');
});
const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
await page.evaluate(([csvText]) => {
  const file = new File([csvText], 'synthetic.csv', { type: 'text/csv' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#expfit-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [csv]);
await page.waitForTimeout(800);

const resultText = await page.evaluate(() => document.querySelector('#expfit-result')?.textContent ?? '');
const canvasVisible = await page.evaluate(() => {
  const cv = document.querySelector('#expfit-curve');
  return cv && cv.style.display !== 'none';
});
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
ok('指标文本渲染（E*/σpl/εd/GA 比）', /E\*=\d/.test(resultText) && /σpl=\d/.test(resultText) && /GA\/实测=\d/.test(resultText), resultText.slice(0, 90));
ok('E* 恢复 ≈1200（±3%）', (() => { const m = resultText.match(/E\*=(\d+)/); return m && Math.abs(Number(m[1]) - 1200) / 1200 < 0.03; })());
ok('canvas 已显示', canvasVisible);
ok('0 pageerror/console.error', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== EXPFIT CARD SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
