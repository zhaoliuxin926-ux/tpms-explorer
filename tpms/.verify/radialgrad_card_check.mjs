/**
 * radialgrad_card_check.mjs —— M(r) 径向梯度构型卡片冒烟（radial-grad UI 感知层）
 *
 * 断言：
 *  A. 卡片存在且内嵌 grp-view（field 级，sect 计数零扰动——slicepv 先例）
 *  B. 默认 gyroid 点生成 → 守卫 toast（不产预览）
 *  C. 切 Schwarz P + solid_network → 生成预览 → status ✓ 孔隙率读数 + K 联动标签
 *  D. K=1 联动：k 滑块置 1 → tb 禁用且=ta
 *  E. 导出 STL（HD R=96）→ download 事件 + 文件名含 radial-grad
 * CLI 同管线已由 cae_mesh_audit F4-F6 门禁覆盖（五 K 档水密）；本门专注 UI 接线。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');

const PORT = 4823;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(PLATFORM_DIR, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ✓ ' + n); };
const bad = (n, d = '') => { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); };

const browser = await chromium.launch({ channel: 'chrome', executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.setDefaultTimeout(60000);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#rg-gen', { state: 'attached', timeout: 20000 });
  // A. 卡片定位
  const inView = await page.evaluate(() => {
    const el = document.getElementById('rg-gen');
    return !!el && !!el.closest('#grp-view');
  });
  inView ? ok('A 卡片存在且内嵌 grp-view（field 级，sect 计数零扰动）') : bad('A 卡片定位');
  // B. 默认 gyroid 守卫（红队 B m4 强化：读 toast 元素实证守卫真触发——旧写法只比 status 不变，守卫没跑也过）
  const st0 = await page.evaluate(() => document.getElementById('rg-status')?.textContent || '');
  await page.evaluate(() => document.getElementById('rg-gen')?.click());
  await page.waitForTimeout(400);
  const toastB = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  const st1 = await page.evaluate(() => document.getElementById('rg-status')?.textContent || '');
  toastB.includes('须 Schwarz P') && st1 === st0
    ? ok('B 非 Schwarz P 点生成 → toast 实证拦截（无预览）')
    : bad('B 守卫失效', `toast=${toastB.slice(0, 40)} st=${st1.slice(0, 30)}`);
  // B2. 红队 B MAJOR-1 回归：isoGrad 开启时点生成 → 互斥守卫 toast（此前曾静默放行）
  await page.evaluate(() => {
    document.querySelector('[data-type="schwarz"]')?.dispatchEvent(new Event('click', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('iso-grad-toggle')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('rg-gen')?.click());
  await page.waitForTimeout(400);
  const toastB2 = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  toastB2.includes('互斥')
    ? ok('B2 isoGrad 开启时生成 → 互斥守卫（红队 B MAJOR-1 修复回归）')
    : bad('B2 isoGrad 互斥守卫失效', toastB2.slice(0, 40));
  await page.evaluate(() => document.getElementById('iso-grad-toggle')?.click());  // 关回
  // C. 切 schwarz → 生成预览
  await page.evaluate(() => {
    document.querySelector('[data-type="schwarz"]')?.dispatchEvent(new Event('click', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('rg-gen')?.click());
  await page.waitForFunction(() => (document.getElementById('rg-status')?.textContent || '').includes('实测孔隙率'), { timeout: 90000 });
  const stC = await page.evaluate(() => document.getElementById('rg-status')?.textContent || '');
  /实测孔隙率\s[\d.]+%/.test(stC) ? ok(`C Schwarz P 生成预览 → ${stC.match(/✓[^—]+/)?.[0] ?? ''}`) : bad('C 生成流程', stC.slice(0, 80));
  // 渲染几何非空（stats 面板三角计数 > 0；格式如 "192.4k"，兼容 k 后缀）
  const triTxt = await page.evaluate(() => document.getElementById('stat-tris')?.textContent || '0');
  const triN = Number.parseFloat(triTxt.replace(/,/g, '')) * (/k/i.test(triTxt) ? 1000 : 1);
  triN > 1000 ? ok(`C 主视图几何就绪（${triTxt} 三角）`) : bad('C 几何为空', triTxt);
  // D. K=1 联动
  const dRes = await page.evaluate(() => {
    const k = document.getElementById('rg-k'), tb = document.getElementById('rg-tb'), ta = document.getElementById('rg-ta');
    if (!k || !tb || !ta) return null;
    k.value = '1'; k.dispatchEvent(new Event('input', { bubbles: true }));
    return { disabled: tb.disabled, tbVal: tb.value, taVal: ta.value };
  });
  dRes && dRes.disabled && dRes.tbVal === dRes.taVal
    ? ok(`D K=1 联动（tb 禁用且=ta=${dRes.tbVal}）`)
    : bad('D K=1 联动', JSON.stringify(dRes));
  // E. 导出 STL（HD）
  await page.evaluate(() => { const k = document.getElementById('rg-k'); if (k) { k.value = '1.5'; k.dispatchEvent(new Event('input', { bubbles: true })); } });
  const dlPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => document.getElementById('rg-export')?.click());
  const dl = await dlPromise;
  const fname = dl.suggestedFilename();
  fname.includes('radial-grad') && fname.endsWith('.stl')
    ? ok(`E HD STL 导出（${fname}）`)
    : bad('E 导出文件名', fname);
  await page.waitForFunction(() => (document.getElementById('rg-status')?.textContent || '').includes('STL 已导出'), { timeout: 120000 });
} catch (e) {
  bad('浏览器流程异常', e instanceof Error ? e.message.slice(0, 120) : String(e));
} finally {
  await browser.close().catch(() => {});
  try { server.kill(); } catch { /* 忽略 */ }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 7) { console.error(`GUARD FAIL: ${pass} < 7`); process.exit(1); }
process.exit(fail ? 1 : 0);
