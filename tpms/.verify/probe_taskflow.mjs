// probe_taskflow.mjs — 任务流卡冒烟（2026-10-25 批五，一次性快检，不入 CI）
// 五步在位/③制造检查 ✓ → 改设计转 stale（!）/跳转展开/④导出菜单直达/0 pageerror。
// console.error 分级口径与 ui_jump 一致（b9067d4）：「已重建 worker」自愈观测日志不判红。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4863;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(ROOT, 'docs/platform')]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(90_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Worker build timed out.*已重建 worker/.test(t)) return; // 慢 runner 自愈观测日志（b9067d4 分级）
  errors.push('console.error: ' + t);
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 90_000 }).catch(() => {});

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };

// 1. 卡在位：五步、不用 .sect 类（ui_jump .panel.controls .sect=30 计数隔离）、不用 data-jump
const card = await page.evaluate(() => ({
  steps: document.querySelectorAll('#taskflow .tf-step').length,
  asSect: document.querySelectorAll('#taskflow .sect').length,
  dataJump: document.querySelectorAll('#taskflow [data-jump]').length,
  sectTotal: document.querySelectorAll('.panel.controls .sect').length,
  designBadge: document.querySelector('[data-badge="design"]')?.textContent ?? '',
  mfgBadgeClass: document.querySelector('[data-badge="mfg"]')?.className ?? '',
}));
ok('任务流卡五步在位', card.steps === 5, `steps=${card.steps}`);
ok('卡与 ui_jump 计数隔离（无 .sect / 无 data-jump，controls .sect 总数仍 30）',
  card.asSect === 0 && card.dataJump === 0 && card.sectTotal === 30, JSON.stringify(card));
ok('①设计徽章初始 ✓（默认设计即就绪）', card.designBadge === '✓', card.designBadge);
ok('③制造检查初始无标记', card.mfgBadgeClass === 'tf-badge', card.mfgBadgeClass);

// 2. 跑制造检查（gyroid@75 默认设计）→ ③转 ✓
await page.evaluate(() => (document.getElementById('btn-mfg') instanceof HTMLElement) && document.getElementById('btn-mfg').click());
await page.waitForFunction(() => /最小壁厚/.test(document.querySelector('#mfg-result')?.textContent ?? ''), { timeout: 90_000, polling: 300 });
const doneBadge = await page.evaluate(() => document.querySelector('[data-badge="mfg"]')?.className ?? '');
ok('制造检查完成后 ③ 转为 done ✓', doneBadge.includes('done'), doneBadge);

// 3. 改设计（孔隙率 75→70，触发 scheduleRebuild→refreshTaskFlow）→ ③转 stale（!）
await page.evaluate(() => {
  const el = document.getElementById('porosity');
  el.value = '70';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => (document.querySelector('[data-badge="mfg"]')?.className ?? '').includes('stale'), { timeout: 30_000, polling: 300 });
const staleBadge = await page.evaluate(() => ({
  cls: document.querySelector('[data-badge="mfg"]')?.className ?? '',
  txt: document.querySelector('[data-badge="mfg"]')?.textContent ?? '',
  title: document.querySelector('[data-badge="mfg"]')?.title ?? '',
}));
ok('设计变更后 ③ 转 stale（!）并带过期提示', staleBadge.cls.includes('stale') && staleBadge.txt === '!' && staleBadge.title.includes('过期'), JSON.stringify(staleBadge));

// 4. 跳转语义：点 ③ → sect-mfg 展开 + rail 滚动（轮询语义终点，ui_jump 同款——
//    smooth 滚动与 rebuild 期布局变化竞争，硬等待会假红）
await page.evaluate(() => document.querySelector('[data-step="mfg"]')?.click());
let jump = null;
for (let t = 0; t < 16; t++) {
  await page.waitForTimeout(250);
  jump = await page.evaluate(() => ({
    open: document.getElementById('sect-mfg')?.open ?? false,
    scrollTop: document.querySelector('.panel.controls')?.scrollTop ?? 0,
  }));
  if (jump.open && jump.scrollTop > 50) break;
}
ok('点 ③ 后制造检查 sect 展开且侧栏滚动', jump.open && jump.scrollTop > 50, JSON.stringify(jump));

// 5. 点 ② 候选 → sect-pareto 展开（跳转对不同目标同样生效）
await page.evaluate(() => document.querySelector('[data-step="candidate"]')?.click());
await page.waitForTimeout(1200);
const jump2 = await page.evaluate(() => document.getElementById('sect-pareto')?.open ?? false);
ok('点 ② 后 Pareto sect 展开', jump2);

// 6. 点 ④ 导出 → 导出中心浮层展开
await page.evaluate(() => document.querySelector('[data-step="export"]')?.click());
await page.waitForTimeout(400);
const menuShown = await page.evaluate(() => document.getElementById('export-menu')?.classList.contains('show') ?? false);
ok('点 ④ 后导出中心浮层展开', menuShown);

ok('0 pageerror / 0 console.error（慢 runner 自愈分级口径）', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== TASKFLOW SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
