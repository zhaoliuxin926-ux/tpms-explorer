// 跳转导航功能快检：点击"仿真" → 滚动 + 高亮 + 分组可见
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4855;
const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', '../tpms/docs/platform'], { shell: true });
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { c ? (pass++, console.log('PASS', n)) : (fail++, console.log('FAIL', n, i)); };

// 1. 跳转导航存在且 4 键
const btnCount = await page.locator('.ls-jump [data-jump]').count();
ok('跳转导航 4 键', btnCount === 4, `got ${btnCount}`);

// 2. 点击"仿真" → controls 滚动到 grp-sim 附近 + 高亮迁移
await page.evaluate(() => document.querySelector('[data-jump="grp-sim"]').click());
// smooth-scroll 时序抖动：轮询等待滚动到位（≤3s），同时取高亮
let after = null;
for (let t = 0; t < 12; t++) {
  await page.waitForTimeout(250);
  after = await page.evaluate(() => {
    const rail = document.querySelector('.panel.controls');
    const on = document.querySelector('.ls-jump button.on');
    return { scrollTop: rail.scrollTop, onLabel: on?.textContent?.trim() };
  });
  if (after.scrollTop > 50) break;
}
ok('点击仿真后 rail 滚动', after.scrollTop > 50, `scrollTop=${after.scrollTop}`);
ok('高亮迁移到仿真', after.onLabel === '仿真', `on=${after.onLabel}`);

// 3. 分组完整性：4 组各含正确 section 数
const counts = await page.evaluate(() => ({
  geometry: document.querySelectorAll('#grp-geometry .sect').length,
  sim: document.querySelectorAll('#grp-sim .sect').length,
  optimize: document.querySelectorAll('#grp-optimize .sect').length,
  view: document.querySelectorAll('#grp-view .sect').length,
  total: document.querySelectorAll('.panel.controls .sect').length,
}));
ok('分组计数 11/8/1/5 = 25', counts.geometry === 11 && counts.sim === 8 && counts.optimize === 1 && counts.view === 5 && counts.total === 25, JSON.stringify(counts));

// 4. 关键交互元素仍在 controls 内（CI 兼容抽查）
const probes = await page.evaluate(() => ['btn-plasticity', 'btn-lpbf', 'btn-yield', 'btn-phonon', 'btn-tissue', 'btn-ls-evolve', 'neural-enabled', 'inv-preset', 'custom-formula']
  .map((id) => ({ id, inControls: !!document.querySelector('.panel.controls #' + id) })));
ok('9 个关键控件均在侧栏内', probes.every((p) => p.inControls), JSON.stringify(probes.filter((p) => !p.inControls)));

// 5. 分组头点击联动
await page.evaluate(() => document.querySelector('.sgroup-h[data-target="grp-view"]').click());
await page.waitForTimeout(700);
const onView = await page.evaluate(() => document.querySelector('.ls-jump button.on')?.textContent?.trim());
ok('分组头点击 → 视图高亮', onView === '视图', `on=${onView}`);

ok('0 pageerror/console.error', errors.length === 0, errors.join('; '));
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);
