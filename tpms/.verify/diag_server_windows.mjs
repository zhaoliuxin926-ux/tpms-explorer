// diag_server_windows.mjs —— windows runner 静态服务稳定性诊断（2026-09-06 CI 排障）
// 背景：run48-53 windows 的 verify 套件六红五，失败点在页面加载/截图/随机漂移，怀疑
// runner 环境层（服务器挂起 vs 浏览器层）。本脚本分层探测并输出铁证：
//   A. python http.server 裸并发 100 请求——服务器层稳定性
//   B. Playwright Chromium 30 次加载同一页——浏览器×服务器全链路稳定性
// 结论解读：A 失败=服务器/OS 层；A 稳 B 挂=浏览器或两者交互层；A/B 均稳=失败在 run_all
// 的更长时序（内存累积/套件间干扰）。
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4899;
const ROOT = process.argv[2];
const PY = process.platform === 'win32' ? 'python' : 'python3';
const results = { raw: { fail: 0, slow: 0 }, browser: { fail: 0, slow: 0 } };

const server = spawn(PY, ['-m', 'http.server', String(PORT), '--directory', ROOT], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

// ── A. 服务器裸并发（curl 等价的 node fetch，100 连发）──
{
  const t0 = Date.now();
  const jobs = Array.from({ length: 100 }, async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/index.html`, { signal: AbortSignal.timeout(5000) });
      if (r.status !== 200) results.raw.fail++;
    } catch { results.raw.fail++; }
  });
  await Promise.all(jobs);
  console.log(`[A] python http.server 裸并发 100: failures=${results.raw.fail}, ${Date.now() - t0}ms total`);
}

// ── B. 浏览器全链路（30 次加载 + reload）──
{
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-swiftshader'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    try {
      await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (i % 3 === 0) await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      const dt = Date.now() - t0;
      if (dt > 10000) { results.browser.slow++; console.log(`  [B] slow load #${i}: ${dt}ms`); }
    } catch (e) {
      results.browser.fail++;
      console.log(`  [B] FAIL #${i}: ${String(e.message).slice(0, 80)}`);
    }
  }
  await browser.close();
  console.log(`[B] Chromium 30 loads: failures=${results.browser.fail}, slow(>10s)=${results.browser.slow}`);
}

server.kill();
const verdict = results.raw.fail === 0 && results.browser.fail === 0
  ? 'STABLE — 服务器与浏览器层均稳；失败在 run_all 长时序（套件间干扰/资源累积），往套件隔离方向查'
  : results.raw.fail > 0
    ? 'SERVER-LAYER — python http.server 在 windows runner 本身不稳，换实现或加守护'
    : 'BROWSER-LAYER — 服务器稳而浏览器链路挂，往 Chromium/渲染层查';
console.log('[VERDICT]', verdict);
process.exit(0);
