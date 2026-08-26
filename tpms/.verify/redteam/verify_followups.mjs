// 遗留修复验证：m4 redo / m2 clipboard / DOI 行为
import { chromium } from 'playwright';

const BASE = 'http://localhost:4811/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info = '') => { fail++; console.log('FAIL', name, info); };

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4811' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// ── m4: redo 恢复 ──
await page.goto(BASE + '?autoRotate=0', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const el = document.getElementById('fw-a');
  el.value = '1.5';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(800);
const before = await page.evaluate(() => document.getElementById('fw-a')?.value);
await page.keyboard.press('Control+z');
await page.waitForTimeout(600);
const afterUndo = await page.evaluate(() => document.getElementById('fw-a')?.value);
afterUndo === '1' ? ok('m4 undo 权重回 1.0') : bad('m4 undo', 'fw-a=' + afterUndo);
await page.keyboard.press('Control+y');
await page.waitForTimeout(600);
const afterRedo = await page.evaluate(() => document.getElementById('fw-a')?.value);
afterRedo === '1.5' ? ok('m4 Ctrl+Y redo 恢复 1.5') : bad('m4 redo', 'fw-a=' + afterRedo);
// Ctrl+Shift+Z 路径
await page.keyboard.press('Control+z');
await page.waitForTimeout(600);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(600);
const afterRedo2 = await page.evaluate(() => document.getElementById('fw-a')?.value);
afterRedo2 === '1.5' ? ok('m4 Ctrl+Shift+Z redo 亦生效') : bad('m4 redo2', 'fw-a=' + afterRedo2);
// undo 后新操作应丢弃 redo 分支（标准语义）
await page.keyboard.press('Control+z'); // 回 1.0
await page.waitForTimeout(500);
await domClick('[data-type="diamond"]'); // 新操作
await page.waitForTimeout(500);
await page.keyboard.press('Control+y'); // redo 应无效果（分支已被新操作覆盖）
await page.waitForTimeout(500);
const typeAfter = await page.evaluate(() => document.querySelector('[data-type].active')?.getAttribute('data-type'));
typeAfter === 'diamond' ? ok('m4 新操作后 redo 分支正确丢弃') : bad('m4 分支', 'type=' + typeAfter);

// ── m2: clipboard 成功路径 toast（非 alert）──
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message().slice(0, 30)); await d.dismiss(); });
await domClick('#btn-share');
await page.waitForTimeout(600);
const clip = await page.evaluate(() => {
  const toast = document.body.innerText.includes('已复制到剪贴板');
  return { toast, url: location.href };
});
clip.toast && dialogs.length === 0 ? ok('m2 分享 toast 且无 alert') : bad('m2 分享', JSON.stringify({ toast: clip.toast, dialogs }));
const clipContent = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
clipContent.includes('type=') ? ok('m2 剪贴板实际写入 URL') : bad('m2 剪贴板', String(clipContent).slice(0, 60));

// ── DOI: BibTeX 导出 ──
async function exportBib(type) {
  await domClick(`[data-type="${type}"]`);
  await page.waitForTimeout(2500); // 等 mesh（meshHash 需要几何）
  await domClick('#btn-export');
  await page.waitForTimeout(200);
  const dlPromise = page.waitForEvent('download', { timeout: 15000 });
  await domClick('[data-export="bibtex"]');
  const dl = await dlPromise;
  const p = await dl.path();
  const fs = await import('node:fs');
  return p ? fs.readFileSync(p, 'utf8') : '';
}
const bibNeovius = await exportBib('neovius');
bibNeovius.includes('doi = {https://doi.org/10.1016/j.eml.2020.100688}')
  ? ok('DOI neovius 输出确认的 DOI 行') : bad('DOI neovius', bibNeovius.slice(0, 300));
const bibSplitp = await exportBib('splitp');
!/doi\s*=/.test(bibSplitp) && /@misc\{tpms_explorer_/.test(bibSplitp)
  ? ok('DOI splitp 无 DOI 时省略 doi 行') : bad('DOI splitp', bibSplitp.slice(0, 300));
const bibIwp = await exportBib('iwp');
bibIwp.includes('10.1016/j.mechmat.2022.104504')
  ? ok('DOI i-wp 输出 Viet2022 DOI') : bad('DOI iwp', bibIwp.slice(0, 300));

if (errors.length) { bad('运行时错误', errors.slice(0, 5).join(' | ')); }
else ok('全程 0 pageerror / 0 console.error');

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
