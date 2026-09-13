// check_meshcont_card.mjs — C5 STL 容器卡片冒烟（一次性快检，不入 CI）
// 页面内合成 box STL（12 三角，封闭流形）→ 注入上传 → 断言状态文本 + 重建 + 0 pageerror
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4857;
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
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// 页面内合成 box STL Uint8Array（±10mm 立方体，12 三角，外向缠绕）
const stlBytes = await page.evaluate(() => {
  const h = 10;
  const v = [[-h,-h,-h],[h,-h,-h],[h,h,-h],[-h,h,-h],[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]];
  const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
  const tris = [];
  for (const q of quads) { tris.push([v[q[0]], v[q[1]], v[q[2]]]); tris.push([v[q[0]], v[q[2]], v[q[3]]]); }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const [a, b, c] of tris) {
    off += 12;
    for (const p of [a, b, c]) { dv.setFloat32(off, p[0], true); dv.setFloat32(off + 4, p[1], true); dv.setFloat32(off + 8, p[2], true); off += 12; }
    off += 2;
  }
  return new Uint8Array(buf);
});

await page.evaluate(() => {
  document.querySelector('#meshcont-file')?.closest('details')?.setAttribute('open', '');
});
const handle = await page.evaluateHandle(([bytes]) => {
  const file = new File([bytes], 'box.stl', { type: 'application/octet-stream' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#meshcont-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [stlBytes]);
await page.waitForTimeout(6000);

const statusText = await page.evaluate(() => document.querySelector('#meshcont-status')?.textContent ?? '');
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
ok('加载状态文本（三角数+已启用）', /已启用|启用/.test(statusText) && /\d/.test(statusText), statusText.slice(0, 80));
ok('水密自检通过（无 ✗ fail-closed 报错）', !statusText.includes('✗'));
ok('0 pageerror/console.error', errors.length === 0, errors.slice(0, 2).join(' | '));

// blend 滑块触发重建无错
await page.evaluate(() => {
  const el = document.querySelector('#meshcont-blend');
  el.value = '0.3';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(5000);
ok('blend 滑块重建 0 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== MESHCONT CARD SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
