// 跳转导航功能快检：点击"仿真" → 滚动 + 高亮 + 分组可见
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4855;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
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
for (let t = 0; t < 20; t++) {
  await page.waitForTimeout(250);
  after = await page.evaluate(() => {
    const rail = document.querySelector('.panel.controls');
    const on = document.querySelector('.ls-jump button.on');
    return { scrollTop: rail.scrollTop, onLabel: on?.textContent?.trim() };
  });
  // 语义终点：高亮真迁移到目标组（scrollTop>50 只证明开始滚，构型组变长后远未到位——ubuntu R1 实测漂移）
  if (after.onLabel === '仿真' && after.scrollTop > 50) break;
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
ok('分组计数 13/10/1/5 = 29（构型组 +26 族画廊 sect，2026-10-05）', counts.geometry === 13 && counts.sim === 10 && counts.optimize === 1 && counts.view === 5 && counts.total === 29, JSON.stringify(counts));

// 4. 关键交互元素仍在 controls 内（CI 兼容抽查）
const probes = await page.evaluate(() => ['btn-plasticity', 'btn-lpbf', 'btn-yield', 'btn-phonon', 'btn-tissue', 'btn-ls-evolve', 'neural-enabled', 'inv-preset', 'custom-formula']
  .map((id) => ({ id, inControls: !!document.querySelector('.panel.controls #' + id) })));
ok('9 个关键控件均在侧栏内', probes.every((p) => p.inControls), JSON.stringify(probes.filter((p) => !p.inControls)));

// 5. 分组头点击联动
await page.evaluate(() => document.querySelector('.sgroup-h[data-target="grp-view"]').click());
await page.waitForTimeout(700);
const onView = await page.evaluate(() => document.querySelector('.ls-jump button.on')?.textContent?.trim());
ok('分组头点击 → 视图高亮', onView === '视图', `on=${onView}`);

// 6. 26 族画廊行为冒烟（2026-10-05 第五十一批权重污染级 bug 的行为钉——结构断言抓不住，
//    只有真路径能抓）：先点 strut 按钮污染 state.weights（切族重置为 [0.25,0,0,0]——
//    旧代码此场景画廊退化 21/26），再生成必须 26/26；点击缩略 → title 即时切（updateBadges）。
await page.evaluate(() => {
  document.querySelector('button[data-type="strutoctet"]')?.click();
  document.getElementById('sect-gallery').open = true;
  document.getElementById('btn-gallery-gen').click();
});
let galNote = '';
for (let t = 0; t < 90; t++) { // 90s：慢 runner（ubuntu 469s 门）画廊单轮可 >40s
  await page.waitForTimeout(1000);
  galNote = await page.evaluate(() => document.getElementById('gallery-note')?.textContent ?? '');
  if (galNote.startsWith('画廊完成')) break;
}
const galImgs = await page.evaluate(() => document.querySelectorAll('#gallery-grid img').length);
ok('画廊 strutoctet 预污染后生成 26/26（getDefaultWeights 根修防回归）', galNote.startsWith('画廊完成：26/26') && galImgs === 26, `note=${galNote.slice(0, 22)} imgs=${galImgs}`);
const titleAfterGallery = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('#gallery-grid > div')];
  const oct = cells.find((c) => c.textContent.includes('Octet'));
  oct?.click();
  return document.title.split('·')[0].trim();
});
ok('画廊点击切族 → title 即时更新（updateBadges 防回归）', titleAfterGallery === 'Octet 桁架', `title=${titleAfterGallery}`);

// 7. Pareto 逆设计推荐行为冒烟（2026-10-05 第五十批）——"达标子集优先"语义在 UI 层
//    （ml_pareto 只钉 nearestFrontCandidates 纯函数），可达/不可达双分支+推荐达标语义
//    只有真路径能验：可达目标 → 推荐必须全部达标（首版全局最近 bug 推 E=1.11<2 的回归锚）；
//    不可达目标 → 妥协文案分支；非法输入 → fail-closed 不炸。
await page.evaluate(() => { document.getElementById('sect-pareto').open = true; });
await page.evaluate(() => document.getElementById('btn-pareto-gen').click());
let scanNote = '';
for (let t = 0; t < 20; t++) {
  await page.waitForTimeout(500);
  scanNote = await page.evaluate(() => document.getElementById('pareto-note')?.textContent ?? '');
  if (scanNote.startsWith('扫描完成')) break;
}
const inv1 = await page.evaluate(() => {
  document.getElementById('pareto-target-e').value = '2';
  document.getElementById('pareto-target-k').value = '5';
  document.getElementById('btn-pareto-target').click();
  return document.getElementById('pareto-note').textContent;
});
ok('逆设计可达目标 → 达标文案+首推荐 strutoctet E≥2（达标子集优先防回归）', inv1.startsWith('目标可满足') && inv1.includes('1. strutoctet'), inv1.slice(0, 40));
const inv2 = await page.evaluate(() => {
  document.getElementById('pareto-target-e').value = '50';
  document.getElementById('pareto-target-k').value = '500';
  document.getElementById('btn-pareto-target').click();
  return document.getElementById('pareto-note').textContent;
});
ok('逆设计不可达目标 → 妥协文案分支', inv2.startsWith('目标在当前设计空间不可达'), inv2.slice(0, 30));
const inv3 = await page.evaluate(() => {
  document.getElementById('pareto-target-e').value = '';
  document.getElementById('btn-pareto-target').click();
  return { note: document.getElementById('pareto-note').textContent.slice(0, 20) };
});
ok('逆设计非法输入 fail-closed（不炸+状态保持）', inv3.note.startsWith('目标在当前设计空间不可达'), inv3.note);

// 8. 画廊 hybrid 隔离钉（2026-10-06 红队 A2：主界面开 hybrid 后抄 s.hybrid 会把 26 族
//    缩略全污染成混合场——修复=画廊 params 与 state 全解耦教科书形态。回归锚：
//    hybrid 开启 → 生成 → 26/26，且两次生成首图 dataURL 确定性一致。
//    CI 时序校准（ubuntu 实测 469s 门内画廊单轮可 >25s）：窗口 90s+必须等到"画廊完成"
//    终态文案才采样（快机 5s/慢机 ~40s）；"生成中"中途态的 imgs 截断值不作判据）
await page.evaluate(() => document.getElementById('hybrid-enabled')?.click());
await page.waitForTimeout(6000); // hybrid 开启触发主视图重建——慢 runner 2.5s 不够，等 6s
const hyGal = await page.evaluate(async () => {
  const waitGalleryDone = async () => {
    const t = performance.now();
    while (performance.now() - t < 90000) {
      await new Promise((r) => setTimeout(r, 800));
      const n = document.getElementById('gallery-note')?.textContent ?? '';
      if (n.startsWith('画廊完成')) {
        // 完成文案已出，等 grid 渲染稳定（imgs 计数等于完成数）
        for (let k = 0; k < 10; k++) {
          await new Promise((r) => setTimeout(r, 400));
          const c = document.querySelectorAll('#gallery-grid > div').length;
          const im = document.querySelectorAll('#gallery-grid img').length;
          if (c === 26 && im === 26) break;
        }
        return true;
      }
    }
    return false;
  };
  document.getElementById('sect-gallery').open = true;
  document.getElementById('btn-gallery-gen').click();
  const d1 = await waitGalleryDone();
  const n1 = document.querySelectorAll('#gallery-grid img')[0]?.src.length ?? 0;
  document.getElementById('btn-gallery-gen').click();
  const d2 = await waitGalleryDone();
  const n2 = document.querySelectorAll('#gallery-grid img')[0]?.src.length ?? 0;
  return { d1, d2, imgs: document.querySelectorAll('#gallery-grid img').length, n1, n2 };
});
ok('画廊 hybrid 开启下 26/26 且两次生成确定（state 解耦防回归）', hyGal.d1 && hyGal.d2 && hyGal.imgs === 26 && hyGal.n1 === hyGal.n2 && hyGal.n1 > 0, `d1=${hyGal.d1} d2=${hyGal.d2} imgs=${hyGal.imgs} n1=${hyGal.n1} n2=${hyGal.n2}`);
await page.evaluate(() => document.getElementById('hybrid-enabled')?.click()); // 还原关闭

ok('0 pageerror/console.error', errors.length === 0, errors.join('; '));
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
  const guardFail = pass < 13;
  if (guardFail) console.error('GUARD FAIL: 断言执行数 ' + pass + ' < 基线 13（恒真/集体跳过防护；2026-10-05 +2 画廊/+3 逆设计；2026-10-06 +1 hybrid 隔离）');
await browser.close();
server.kill();
process.exit(fail || guardFail ? 1 : 0);
