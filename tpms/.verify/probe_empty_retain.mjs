// probe_empty_retain.mjs — 失败保留最后成功设计行为钉（2026-10-25 批七，一次性快检，不入 CI）
// 审查改进表第 4 行验收项：「取消/失败保留最后成功设计」。空/失败重建走 onWorkerError
// （不触碰视口几何）+ 无背景透明空态浮层（.empty 无 background）——保留网格仍可见。
// 用常值场自定义公式（f=1，无等值面穿越）制造确定性失败，断言：
// ①空态浮层出现（含构建失败文案或空态引导）②#stat-tris 不变（网格未被清掉）③0 pageerror。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4867;
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
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Worker build timed out.*已重建 worker/.test(t)) return;
  if (/^\[Main\] Worker error:/.test(t)) return; // 常值场构建失败为本探针刻意制造（观测通道，页面已 toast+空态披露）
  errors.push('console.error: ' + t);
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });
await page.waitForTimeout(1500);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };

const settle = async () => {
  let prev = null;
  for (let t = 0; t < 60; t++) {
    const v = await page.evaluate(() => document.querySelector('#stat-tris')?.textContent ?? '');
    if (prev != null && v === prev && v !== '') return v;
    prev = v;
    await page.waitForTimeout(500);
  }
  return prev ?? '';
};
await settle();
const before = await page.evaluate(() => ({
  tris: document.querySelector('#stat-tris')?.textContent ?? '',
  verts: document.querySelector('#stat-verts')?.textContent ?? '',
}));

// 常值场（f=1）：无等值面穿越 → 求解器抛错（曲面场退化为常数守卫）。
// 注意：开启自定义公式的监听器会先触发一次预览重建（正常公式），before 须取其稳定后
// 的读数——保留语义=「最后一次成功构建」（可能是同设计的预览档），而非 boot 时的 HD 档。
await page.evaluate(() => {
  const en = document.getElementById('custom-enabled');
  if (en && !en.checked) en.click();
});
await settle();
const beforeCustom = await page.evaluate(() => ({
  tris: document.querySelector('#stat-tris')?.textContent ?? '',
  verts: document.querySelector('#stat-verts')?.textContent ?? '',
}));
await page.evaluate(() => {
  const ta = document.getElementById('custom-formula');
  if (ta) {
    ta.value = '1';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
// 等空态浮层出现（showEmpty 走内联 style.display，非 .show 类）
let emptyShown = false;
for (let t = 0; t < 120; t++) {
  await page.waitForTimeout(500);
  emptyShown = await page.evaluate(() => (document.getElementById('empty')?.style.display ?? 'none') !== 'none');
  if (emptyShown) break;
}
ok('常值场重建失败 → 空态浮层出现', emptyShown);

const after = await page.evaluate(() => ({
  tris: document.querySelector('#stat-tris')?.textContent ?? '',
  verts: document.querySelector('#stat-verts')?.textContent ?? '',
  emptyText: document.getElementById('empty')?.textContent ?? '',
}));
ok('失败后视口保留最后成功设计（#stat-tris 与失败前一致）',
  beforeCustom.tris !== '' && beforeCustom.tris === after.tris && beforeCustom.verts === after.verts,
  `before=${beforeCustom.tris}/${beforeCustom.verts} after=${after.tris}/${after.verts}`);
ok('空态浮层有解释文案（失败原因持久化）', /构建失败/.test(after.emptyText) && after.emptyText.trim().length > 10, after.emptyText.slice(0, 60));

// 恢复：关闭自定义公式 → 成功重建 → 空态浮层消失（下次成功重建由 showEmpty(false) 隐藏）
await page.evaluate(() => {
  const en = document.getElementById('custom-enabled');
  if (en && en.checked) en.click();
});
let recovered = false;
for (let t = 0; t < 120; t++) {
  await page.waitForTimeout(500);
  recovered = await page.evaluate(() => (document.getElementById('empty')?.style.display ?? 'flex') === 'none');
  if (recovered) break;
}
ok('恢复正常参数 → 空态浮层隐藏', recovered);

ok('0 pageerror / 0 console.error（自愈与刻意失败的观测日志已分级）', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== EMPTY RETAIN SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
