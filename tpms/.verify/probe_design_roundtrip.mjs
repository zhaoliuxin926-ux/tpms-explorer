// probe_design_roundtrip.mjs — 第二批 #8 验收（2026-10-24，一次性快检，不入 CI）
// 链路：URL 置态 → 导出设计文件 → 断言快照/shareUrl → 裸地址重开（关闭语义）→ 导入
// → 几何重建等价（title/孔隙率/三角数）→ sidecar 6 新参数+分享链接 → 坏文件拒绝。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4858;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const BASE = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
const toasts = [];
page.on('pageerror', (e) => console.error('  [pageerror]', String(e.message).slice(0, 160)));

const snapState = () => page.evaluate(() => ({
  title: document.title,
  porosity: document.querySelector('#stat-porosity')?.textContent ?? '',
  tris: document.querySelector('#stat-tris')?.textContent ?? '',
}));
async function armToasts() {
  await page.evaluate(() => {
    (window).__rtToasts = [];
    new MutationObserver(() => {
      const x = document.querySelector('#toast')?.textContent ?? '';
      if (x) (window).__rtToasts.push(x);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
const readToasts = () => page.evaluate(() => (window).__rtToasts.join(' ¶ '));
async function menuExport(fmt) {
  await page.evaluate(() => (document.getElementById('btn-export') instanceof HTMLElement) && document.getElementById('btn-export').click());
  await page.waitForTimeout(300);
  const dlPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.evaluate((f) => {
    const item = document.querySelector(`.xm-item[data-export="${f}"]`);
    if (!(item instanceof HTMLElement)) throw new Error('menu item not found: ' + f);
    item.click();
  }, fmt);
  return dlPromise;
}
async function waitBuild() {
  await page.waitForFunction(() => {
    const tris = document.querySelector('#stat-tris')?.textContent ?? '';
    const loading = document.querySelector('#loading');
    return /\d/.test(tris) && (!loading || loading.style.display === 'none' || !loading.classList.contains('on'));
  }, { timeout: 90_000, polling: 400 });
}
async function injectDesignFile(text) {
  await page.evaluate((t) => {
    const file = new File([t], 'design.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#import-design-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'design-rt-'));
try {
  // 1. URL 置态（neovius 82% k4）
  await page.goto(`${BASE}?type=neovius&porosity=82&cellSize=4`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitBuild();
  await page.waitForTimeout(1500);
  const before = await snapState();
  ok('置态基线（neovius@82%）', /Neovius/i.test(before.title), `title=${before.title}`);

  // 2. 导出设计文件
  await armToasts();
  const dl1 = await menuExport('design');
  const designPath = await dl1.path();
  const design = JSON.parse(readFileSync(designPath, 'utf8'));
  ok('设计文件 format=tpms-design/1.0', design.format === 'tpms-design/1.0', String(design.format));
  ok('设计文件 state 快照含置态', design.state?.type === 'neovius' && design.state?.porosity === 82, `${design.state?.type}/${design.state?.porosity}`);
  ok('设计文件 shareUrl 按当前状态构造（含查询串）', /type=neovius/.test(String(design.shareUrl)) && String(design.shareUrl).includes('?'), String(design.shareUrl).slice(-60));
  ok('设计文件 notCaptured 披露在位', Array.isArray(design.notCaptured) && design.notCaptured.length >= 1);

  // 3. sidecar：6 新参数 + 分享链接
  const dl2 = await menuExport('json');
  const sidecar = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
  const p = sidecar.parameters ?? {};
  const six = ['endplateMm', 'isoGrad', 'manifold', 'stress', 'hierarchical', 'neural'];
  ok('sidecar v2.2 六项几何配置齐备', six.every((k) => k in p), six.filter((k) => !(k in p)).join(',') || '全在');
  ok('sidecar url=分享链接（非裸地址栏）', String(sidecar.reproducibility?.url).includes('?'), String(sidecar.reproducibility?.url).slice(-60));

  // 4. 裸地址重开（关闭语义）→ 导入 → 重建等价
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitBuild();
  await page.waitForTimeout(1200);
  const fresh = await snapState();
  ok('重开为默认设计（gyroid 基线）', !/Neovius/i.test(fresh.title), `title=${fresh.title}`);
  await armToasts();
  await injectDesignFile(readFileSync(designPath, 'utf8'));
  await page.waitForFunction((t0) => document.title !== t0, fresh.title, { timeout: 90_000, polling: 400 }).catch(() => {});
  await waitBuild();
  await page.waitForTimeout(1500);
  const after = await snapState();
  ok('导入后族恢复（title→Neovius）', /Neovius/i.test(after.title), `title=${after.title}`);
  // HD 升级为异步档位调度：轮询等待三角数收敛到基线档（62.4k=l2 中间档，234.2k=HD 档）；
  // 实测孔隙率随分辨率收敛（l2 档离散误差大）——断言一律取 HD 收敛后终值
  const hdOk = await page.waitForFunction(
    (target) => (document.querySelector('#stat-tris')?.textContent ?? '') === target,
    before.tris, { timeout: 90_000, polling: 1000 },
  ).then(() => true).catch(() => false);
  const final2 = await snapState();
  ok('导入后 HD 档收敛（三角数=基线）', hdOk && final2.tris === before.tris, `tris ${before.tris} → 中间 ${after.tris} → 终 ${final2.tris}`);
  // #stat-porosity 为实测口径：与置态基线（URL 恢复路径同态）终值等价
  ok('导入后实测孔隙率与基线一致（HD 终值）', final2.porosity === before.porosity, `实测 ${before.porosity} → l2 ${after.porosity} → 终 ${final2.porosity}`);
  ok('导入 toast 成功提示', /已导入设计/.test(await readToasts()), (await readToasts()).slice(0, 60));

  // 5. 坏文件拒绝：非 JSON + 未知 format（各独立断言，注入后留足 FileReader 异步窗）
  await armToasts();
  await injectDesignFile('this is not json');
  await page.waitForTimeout(1500);
  const bad1 = await readToasts();
  ok('坏文件拒绝：非 JSON', /导入失败：非有效 JSON/.test(bad1), bad1.slice(0, 60));
  await armToasts();
  await injectDesignFile(JSON.stringify({ format: 'tpms-design/9.9' }));
  await page.waitForTimeout(1500);
  const bad2 = await readToasts();
  ok('坏文件拒绝：未知 format', /导入失败：未知设计文件格式/.test(bad2), bad2.slice(0, 60));
  ok('坏文件导入后状态不变（仍 Neovius）', /Neovius/i.test((await snapState()).title));
} finally { rmSync(tmp, { recursive: true, force: true }); }

await browser.close();
server.kill();
console.log(`\n== DESIGN ROUNDTRIP PROBE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
