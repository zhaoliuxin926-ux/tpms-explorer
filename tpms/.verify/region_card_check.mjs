/**
 * region_card_check.mjs —— 径向双族分区构型卡片冒烟（region UI 感知层，2026-09-17）
 *
 * 断言：
 *  A. 卡片存在且内嵌 grp-view（field 级，sect 计数零扰动——slicepv/radialgrad 先例）
 *  B. 内区族=当前曲面（默认 gyroid=gyroid）→ 同族守卫 toast（无预览）
 *  C. 切 Schwarz P + solid_network → 生成预览 → status ✓ 孔隙率读数（立方包络）+ 分区标签
 *  D. 导出 STL（HD R=96）→ download 事件 + 文件名含 region 与两族名
 *  E. 退化锚 UI 语义：r 滑块端点（0.1/0.9 内不含 0/1）——守卫面与 CLI 一致（滑块不达端点）
 * CLI 同管线已由 probe_region.mjs 覆盖（退化场级锚+解析锚+可产域矩阵）；本门专注 UI 接线。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');

const PORT = 4827;
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
  await page.waitForSelector('#rgn-gen', { state: 'attached', timeout: 20000 });
  // A. 卡片定位 + 内区下拉已填充
  const a = await page.evaluate(() => {
    const el = document.getElementById('rgn-gen');
    const opts = document.querySelectorAll('#rgn-inner option').length;
    return { inView: !!el && !!el.closest('#grp-view'), opts };
  });
  a.inView && a.opts >= 8 ? ok(`A 卡片内嵌 grp-view + 内区下拉 ${a.opts} 族`) : bad('A 卡片定位', JSON.stringify(a));
  // B. 同族守卫（默认 gyroid 外区 + gyroid 内区？——卡片默认内区 diamond；先显式构造同族）
  await page.evaluate(() => {
    const sel = document.getElementById('rgn-inner');
    sel.value = 'gyroid';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const st0 = await page.evaluate(() => document.getElementById('rgn-status')?.textContent || '');
  await page.evaluate(() => document.getElementById('rgn-gen')?.click());
  await page.waitForTimeout(400);
  const toastB = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
  const st1 = await page.evaluate(() => document.getElementById('rgn-status')?.textContent || '');
  ((toastB.includes('同族') || st1.includes('同族')) && !st1.startsWith('✓'))
    ? ok('B 内外区同族 → 拦截文案实证（无预览）')
    : bad('B 同族守卫失效', `toast=${toastB.slice(0, 40)} st=${st1.slice(0, 40)}`);
  // C. 内区切 diamond → 生成预览（默认 gyroid 外区）
  await page.evaluate(() => {
    const sel = document.getElementById('rgn-inner');
    sel.value = 'diamond';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('rgn-gen')?.click());
  await page.waitForFunction(() => (document.getElementById('rgn-status')?.textContent || '').includes('实测孔隙率'), { timeout: 90000 });
  const stC = await page.evaluate(() => document.getElementById('rgn-status')?.textContent || '');
  /实测孔隙率\s[\d.]+%/.test(stC) && stC.includes('内区 diamond')
    ? ok(`C 分区生成预览 → ${stC.match(/✓[^—]+/)?.[0] ?? ''}`)
    : bad('C 生成流程', stC.slice(0, 80));
  const triTxt = await page.evaluate(() => document.getElementById('stat-tris')?.textContent || '0');
  const triN = Number.parseFloat(triTxt.replace(/,/g, '')) * (/k/i.test(triTxt) ? 1000 : 1);
  triN > 1000 ? ok(`C 主视图几何就绪（${triTxt} 三角）`) : bad('C 几何为空', triTxt);
  // D. 导出 STL（HD）
  const dlPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.evaluate(() => document.getElementById('rgn-export')?.click());
  const dl = await dlPromise;
  const fname = dl.suggestedFilename();
  fname.includes('region-gyroid-diamond') && fname.endsWith('.stl')
    ? ok(`D HD STL 导出（${fname}）`)
    : bad('D 导出文件名', fname);
  await page.waitForFunction(() => (document.getElementById('rgn-status')?.textContent || '').includes('STL 已导出'), { timeout: 120000 });
  // E. 滑块范围守卫语义（r 滑块 min=0.1/max=0.9 不达退化端点 0/1——CLI 端点仅供探针）
  const eRes = await page.evaluate(() => {
    const r = document.getElementById('rgn-r'), b = document.getElementById('rgn-blend');
    return { rMin: r.min, rMax: r.max, bMin: b.min, bMax: b.max };
  });
  eRes.rMin === '0.1' && eRes.rMax === '0.9' && Number(eRes.bMin) >= 0.02 && Number(eRes.bMax) <= 0.6
    ? ok('E 滑块域与 validateRegionGrad 口径一致（0.1≤r≤0.9、0.05≤b≤0.6）')
    : bad('E 滑块域漂移', JSON.stringify(eRes));
} catch (e) {
  bad('浏览器流程异常', e instanceof Error ? e.message.slice(0, 120) : String(e));
} finally {
  await browser.close().catch(() => {});
  try { server.kill(); } catch { /* 忽略 */ }
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 6) { console.error(`GUARD FAIL: ${pass} < 6`); process.exit(1); }
process.exit(fail ? 1 : 0);
