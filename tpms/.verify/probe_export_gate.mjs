// probe_export_gate.mjs — P4 导出检查统一浏览器验收（2026-10-24 实用性审查 #7，一次性快检，不入 CI）
// 用例 1（拒）：fcks 75% k3——hdR=R61 nm=786（与审查探针同数）且 96/120/128 全档结构性非水密
//              （薄壁自触族）→ 升档重试后仍拒：toast 阻止 + 无 download
// 用例 2（救）：gyroid 75% k3——显示档 R61 非水密（UI 历史静默交付源）→ 32 格/周期升档 R96
//              救回：download 事件触发（默认设计导出恢复）
// 用例 3（直通）：schwarz 75% k3（显示档即水密）→ download 事件触发（不触发升档快路径）
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
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000);
const probeErrs = [];
page.on('pageerror', (e) => probeErrs.push(String(e.message).slice(0, 200)));

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };

async function exportCase(type, inC2Group) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // 选族（C2 组先展开 details）；孔隙率 75 / cell-size 3 为默认值
  if (inC2Group) await page.evaluate(() => document.querySelector('#type-more-c2')?.setAttribute('open', ''));
  await page.evaluate((t) => {
    const btn = document.querySelector(`.opt[data-type="${t}"]`);
    if (!(btn instanceof HTMLElement)) throw new Error('type button not found: ' + t);
    btn.click();
  }, type);
  // 等主构建完成（stat-tris 出数 + loading 隐藏）
  await page.waitForFunction(() => {
    const tris = document.querySelector('#stat-tris')?.textContent ?? '';
    const loading = document.querySelector('#loading');
    return /\d/.test(tris) && (!loading || loading.style.display === 'none' || !loading.classList.contains('on'));
  }, { timeout: 90_000 });
  // 导出 STL（工具栏入口统一走 handleExport）
  // 全程记录 toast（元素 1.5s 自清空，事后读会漏——MutationObserver 先装）
  await page.evaluate(() => {
    (window).__toasts = [];
    const rec = () => {
      const t = document.querySelector('#toast');
      const txt = t?.textContent ?? '';
      if (txt) (window).__toasts.push(txt);
    };
    new MutationObserver(rec).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  let downloadFired = false;
  const dl = page.waitForEvent('download', { timeout: 60_000 }).then(() => { downloadFired = true; }).catch(() => {});
  await page.evaluate(() => (document.getElementById('btn-stl') instanceof HTMLElement) && document.getElementById('btn-stl').click());
  // 等 toast 阻止文本出现（1.5s 窗口，rAF 轮询可捕获）或 download
  const blocked = await page.waitForFunction(
    () => (document.querySelector('#toast')?.textContent ?? '').includes('已阻止导出'),
    { timeout: 60_000, polling: 100 },
  ).then(() => true).catch(() => false);
  await dl;   // 等满 download 监听窗（导出级 HD 重建可能数秒）
  const toastText = ((await page.evaluate(() => (window).__toasts?.join(' ¶ ') ?? '').catch(() => '<evaluate 失败>')) ?? '');
  return { blocked, downloadFired, toastText, pageErrs: probeErrs.join(' | ') };
}

const r1 = await exportCase('fcks', true);
ok('fcks 75% k3 升档重试后仍硬拒（toast 已阻止导出）', r1.blocked, r1.toastText.slice(0, 70));
ok('fcks 拒产时不触发下载', !r1.downloadFired);

const r2 = await exportCase('gyroid', false);
ok('gyroid 75% k3 经 32 格/周期升档救回（默认设计导出恢复，download 触发）', r2.downloadFired, `toast="${r2.toastText.slice(0, 80)}" errs=${r2.pageErrs.slice(0, 120)}`);
ok('gyroid 救回路径不误报阻止', !r2.blocked);

const r3 = await exportCase('schwarz', false);
ok('schwarz 75% k3 显示档即水密直通（download 触发）', r3.downloadFired, `toast="${r3.toastText.slice(0, 80)}"`);
ok('schwarz 直通不误报阻止', !r3.blocked);

await browser.close();
server.kill();
console.log(`\n== EXPORT GATE PROBE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
