/**
 * selector_audit.mjs — 测试选择器与真实 DOM 对齐审计（独立探针，不进 run_ci_suite）
 *
 * 背景：slicepv_check 曾用 [data-mode="shell"]，页面实际是 [data-structure="shell"]。
 * 选择器空匹配 + ?.click() 空操作 + 时序断言 = 假绿。本探针在应用初始化后核对
 * 各 UI 门禁用到的关键选择器是否至少命中 1 个元素。
 *
 * 运行（仓库根）：node tpms/.verify/selector_audit.mjs
 * 退出码：0 = 全部命中；1 = 存在零匹配选择器。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');
const PORT = 4831;

/** 门禁脚本用到的交互/断言选择器（按套件归组，便于定位） */
const SUITES = {
  slicepv: ['#slicepv-gen', '#slicepv-z', '#slicepv-status', '#slicepv-canvas', '#grp-view .sgroup-h', '[data-structure="shell"]', '[data-structure="solid_network"]'],
  radialgrad: ['#rg-gen', '#rg-export', '#rg-k', '#rg-ta', '#rg-tb', '#rg-status', '#iso-grad-toggle', '[data-type="schwarz"]', '[data-type="gyroid"]'],
  region: ['#rgn-gen', '#rgn-export', '#rgn-inner', '#rgn-r', '#rgn-blend', '#rgn-status'],
  meshcont: ['#meshcont-file', '#meshcont-status', '#meshcont-blend'],
  expfit: ['#expfit-file', '#expfit-result', '#expfit-curve'],
  cards: ['#btn-phonon', '#phonon-result', '#btn-lpbf', '#yield-result', '#tissue-result', '#plas-result', '#ls-result', '#inverse-result', '#rve-canvas', '#hier-enabled', '#hybrid-enabled', '#btn-gpu', '#stat-tris', '#stat-verts', '#toast'],
  fix: ['#porosity', '#btn-onboard', '#formula-weights', '#ob-card', 'canvas', '[data-type].active', '[data-material].active', '.stat-full'],
  ui_jump: ['.panel.controls', '.sgroup-h[data-target="grp-view"]', '[data-jump="grp-sim"]', '.ls-jump'],
  ui_mobile: ['#sheet-handle', '.controls'],
  stress: ['[data-stress="none"]', '[data-stress="bending"]'],
  palette: ['[data-palette-set="teach"]', '[data-palette-set="engine"]'],
};

const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(PLATFORM_DIR, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

let pass = 0, fail = 0;
const missing = [];

const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(45000);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等首屏几何（stat-tris 出现 k 后缀）；失败不中止——仍审计静态 DOM
  await page.waitForFunction(() => (document.getElementById('stat-tris')?.textContent || '').includes('k'), null, { timeout: 90000, polling: 1500 }).catch(() => {});
  // 引导卡可能盖住控件，但不影响 querySelector 存在性
  await page.evaluate(() => {
    const ob = document.getElementById('ob-card');
    if (ob?.classList.contains('show')) document.getElementById('ob-skip')?.click();
  });

  for (const [suite, selectors] of Object.entries(SUITES)) {
    const result = await page.evaluate((sels) => sels.map((s) => {
      try {
        const n = document.querySelectorAll(s).length;
        return { s, n };
      } catch (err) {
        return { s, n: -1, err: String(err) };
      }
    }), selectors);
    for (const r of result) {
      if (r.n === 0 || r.n < 0) {
        fail++;
        missing.push(`${suite}: ${r.s}`);
        console.log(`  ✗ ${suite} · ${r.s}  命中 ${r.n}${r.err ? ' ' + r.err : ''}`);
      } else {
        pass++;
      }
    }
  }

  // 动态元素：toast / 引导按钮（点击后才出现）
  const dyn = await page.evaluate(async () => {
    const out = [];
    // flashToast 会创建 #toast
    const btn = document.createElement('button');
    btn.id = '__audit_trigger';
    document.body.appendChild(btn);
    // 直接调用不可达——改为检查 toast.ts 契约：点一个会 toast 的守卫
    document.querySelector('[data-type="gyroid"]')?.click();
    await new Promise(r => setTimeout(r, 200));
    // 打开引导
    document.getElementById('btn-onboard')?.click();
    await new Promise(r => setTimeout(r, 400));
    out.push({ s: '#ob-card.show', n: document.querySelectorAll('#ob-card.show').length });
    out.push({ s: '#ob-skip', n: document.querySelectorAll('#ob-skip').length });
    out.push({ s: '.ob-step', n: document.querySelectorAll('.ob-step').length });
    return out;
  });
  for (const r of dyn) {
    if (r.n === 0) {
      fail++;
      missing.push(`dynamic: ${r.s}`);
      console.log(`  ✗ dynamic · ${r.s}  命中 0`);
    } else {
      pass++;
    }
  }
} catch (e) {
  fail++;
  console.log('  ✗ 浏览器流程异常', e instanceof Error ? e.message.slice(0, 160) : String(e));
} finally {
  await browser.close().catch(() => {});
  try { server.kill(); } catch { /* 忽略 */ }
}

console.log(`\n== SELECTOR-AUDIT ${pass} hit / ${fail} missing ==`);
if (missing.length) {
  console.log('零匹配选择器:');
  for (const m of missing) console.log('  - ' + m);
}
process.exit(fail ? 1 : 0);
