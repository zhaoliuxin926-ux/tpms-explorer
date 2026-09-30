/**
 * probe_ui_soak.mjs —— UI 长跑 soak 探针（2026-09-30 第八轮：运行时长期行为，独立不进 CI）
 *
 * 守护对象：一次性走查（run_all/fix_check）覆盖不了的长期交互行为——
 *   ① 内存无界增长（Worker 泄漏/监听器堆积/TypedArray 池不回收的运行时证据）
 *   ② 多轮随机交互后的稳定性（零 pageerror/console.error、末轮重建仍成功）
 *
 * 口径：heap 用 min-of-K 抗 GC 噪声（泄漏签名=持续无界增长，偶发 spike 不算）。
 * 用法：node probe_ui_soak.mjs [轮数=30]
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUNDS = Number(process.argv[2] || 30);
const PORT = 4862;

const srv = spawn(process.execPath, [join(HERE, 'static-server.mjs'), String(PORT), join(HERE, '../../docs/platform')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`PASS ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`FAIL ${n} — ${d}`); };

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd', 'slotp', 'fs', 'qstar', 'ws'];
const MODES = ['solid_network', 'shell', 'gradient_shell'];
const errors = [];

const browser = await chromium.launch({ channel: 'chrome', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--headless=new'] });
try {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 90)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 90)); });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  const heap = async () => (await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0));
  const minOf = async (k) => { let m = Infinity; for (let i = 0; i < k; i++) { m = Math.min(m, await heap()); await new Promise((r) => setTimeout(r, 400)); } return m; };

  const baseline = await minOf(3);
  let rndState = 42;
  const rnd = () => (rndState = (rndState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  for (let i = 0; i < ROUNDS; i++) {
    const type = TYPES[(rnd() * TYPES.length) | 0];
    const porosity = 50 + ((rnd() * 40) | 0);
    const mode = MODES[(rnd() * MODES.length) | 0];
    // 走 UI 真实事件链：type 下拉 + porosity input + mode 切换（DOM 直点，playwright actionability 对折叠组超时的先例）
    await page.evaluate(({ type, porosity, mode }) => {
      const t = document.querySelector('#ctl-type, [data-ctl="type"], select');
      if (t) { t.value = type; t.dispatchEvent(new Event('change', { bubbles: true })); }
      const p = document.querySelector('#ctl-porosity, input[type="range"][min="50"], input[data-ctl="porosity"]');
      if (p) { p.value = String(porosity); p.dispatchEvent(new Event('input', { bubbles: true })); }
      const m = document.querySelector(`[data-mode="${mode}"]`);
      if (m) m.click();
    }, { type, porosity, mode });
    await new Promise((r) => setTimeout(r, 1200 + rnd() * 800));
    if ((i + 1) % 10 === 0) console.log(`  … round ${i + 1}/${ROUNDS} heap=${((await heap()) / 1048576).toFixed(0)}MB errors=${errors.length}`);
  }

  const endHeap = await minOf(3);
  const growthMB = (endHeap - baseline) / 1048576;
  errors.length === 0
    ? ok(`soak ${ROUNDS} 轮随机交互零 pageerror/console.error`)
    : bad('soak 运行时错误', errors.slice(0, 3).join(' | '));
  growthMB < 150
    ? ok(`heap 无泄漏级增长（${growthMB.toFixed(1)}MB < 150MB；baseline=${(baseline / 1048576).toFixed(0)}MB end=${(endHeap / 1048576).toFixed(0)}MB，min-of-3 抗 GC）`)
    : bad('heap 疑似无界增长', `${growthMB.toFixed(1)}MB（baseline=${(baseline / 1048576).toFixed(0)} end=${(endHeap / 1048576).toFixed(0)}）`);
  // 末轮仍可交互：再触发一次 type 切换并确认无错
  await page.evaluate(() => {
    const t = document.querySelector('#ctl-type, [data-ctl="type"], select');
    if (t) { t.value = 'gyroid'; t.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 2000));
  errors.length === 0 ? ok('soak 末轮仍可交互（末次切换无新增错误）') : bad('末轮交互异常', String(errors[errors.length - 1]).slice(0, 80));
} finally {
  await browser.close().catch(() => {});
  srv.kill();
}
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
