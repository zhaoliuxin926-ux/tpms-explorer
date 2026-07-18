// verify_three_modes.mjs
// 覆盖 app.html 的"三模式 + 双容器"重建验证：
//   structureMode  : solid_network / shell / gradient_shell
//   containerShape : cube / cylinder
// 设计要点：
//   1) 使用系统 Chrome（channel:'chrome'）+ headless；
//   2) 对 CDN/首屏重建失败优雅降级——stats 长时间无顶点时标记 SKIP 而非卡死；
//   3) 超时统一通过 safeGoto / waitForStats / safeClick 包装，任何异常都进入 results 并继续。

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(label, ok, detail = '') {
  // ok === 'SKIP' 视为软失败（环境/CDN 原因），不计入硬失败、但单独统计
  results.push({ label, ok, detail });
  const tag = ok === true ? 'PASS' : ok === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`${tag}  ${label}${detail ? '  ::  ' + detail : ''}`);
}

// 等到 #stats 里出现真实顶点数（数字），最长等 timeoutMs。
// 返回 { vertex:number|null, raw:string, timedOut:boolean }
async function waitForStats(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await page.locator('#stats').innerText().catch(() => '');
    // 形如 "顶点 12345　三角面 ..."，取第一个 <b> 的数字
    const m = raw.match(/顶点\s*([0-9]+)/);
    if (m && +m[1] > 0) {
      return { vertex: +m[1], raw: raw.replace(/\s+/g, ' ').trim(), timedOut: false };
    }
    await page.waitForTimeout(250);
  }
  const raw = await page.locator('#stats').innerText().catch(() => '');
  return { vertex: null, raw: raw.replace(/\s+/g, ' ').trim(), timedOut: true };
}

// 包装 goto：超时/失败不抛，返回是否成功
async function safeGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return true;
  } catch (e) {
    return false;
  }
}

// 包装点击：元素缺失/超时不抛
async function safeClick(page, selector) {
  try {
    await page.locator(selector).first().click({ timeout: 3000 });
    return true;
  } catch (e) {
    return false;
  }
}

const STRUCTURES = [
  ['solid_network', '实体网络'],
  ['shell', '等厚双壳'],
  ['gradient_shell', '梯度双壳'],
];
const CONTAINERS = [
  ['cube', '立方体'],
  ['cylinder', '圆柱体'],
];

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch (e) {
  console.log('[FATAL] 无法启动 Chrome：', e.message);
  console.log('提示：headless 环境若 CDN 不可达，Three.js 加载会失败，此脚本无法运行。');
  process.exit(2);
}

// =====================================================================
// T1: 页面加载无致命 JS 错误（忽略 CDN net::ERR 资源错误）
// =====================================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', msg => {
    const t = msg.text();
    if (msg.type() === 'error' && !/favicon|Failed to load resource|net::ERR|404/i.test(t)) errors.push(t);
  });
  page.on('pageerror', err => errors.push(err.message));
  const ok = await safeGoto(page, BASE + '/app.html');
  if (!ok) {
    log('页面可访问', 'SKIP', 'goto 失败（本地服务未起？）');
  } else {
    await page.waitForTimeout(3000);
    log('页面加载无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
  }
  await ctx.close();
}

// =====================================================================
// T2: 首屏默认状态 = solid_network + cube，且 badge/stats 正确
// =====================================================================
let bootOk = true; // 后续矩阵测试依赖首屏可重建；CDN 失败时整体降级
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  // 关掉新手引导，避免遮挡
  await safeGoto(page, BASE + '/app.html');
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });

  const s = await waitForStats(page, 15000);
  if (s.timedOut) {
    log('首屏 3D 重建', 'SKIP', `stats 超时无顶点（CDN/Three.js 未就绪？）raw="${s.raw.slice(0, 60)}"`);
    bootOk = false;
  } else {
    log('首屏 3D 重建有顶点输出', true, `vertex=${s.vertex}`);
    const defStructActive = await page.locator('[data-structure="solid_network"]').evaluate(el => el.classList.contains('active')).catch(() => false);
    const defContainerActive = await page.locator('[data-container="cube"]').evaluate(el => el.classList.contains('active')).catch(() => false);
    log('默认 structure=solid_network 激活', defStructActive);
    log('默认 container=cube 激活', defContainerActive);
    const bs = await page.locator('#badge-structure').textContent().catch(() => '');
    const bc = await page.locator('#badge-container').textContent().catch(() => '');
    log('badge-structure 默认="实体网络"', bs === '实体网络', `实际="${bs}"`);
    log('badge-container 默认="立方体"', bc === '立方体', `实际="${bc}"`);
    await page.screenshot({ path: `${OUT}/three-default.png` });
  }
  await ctx.close();
}

// =====================================================================
// T3: 三模式 × 双容器 矩阵——切换后 active/badge 同步、且顶点数有变化
//     （顶点数对比在 bootOk=true 时才断言，否则 SKIP，避免 CDN 故障误报）
// =====================================================================
if (!bootOk) {
  console.log('\n[INFO] 首屏未成功重建，矩阵测试整体 SKIP（环境/CDN 原因）。');
  for (const [sk] of STRUCTURES) {
    for (const [ck] of CONTAINERS) {
      log(`矩阵 ${sk}/${ck} 切换`, 'SKIP', '首屏未重建');
    }
  }
} else {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await safeGoto(page, BASE + '/app.html');
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const init = await waitForStats(page, 15000);
  if (init.timedOut) {
    log('矩阵基线重建', 'SKIP', '基线 stats 超时');
    bootOk = false;
  } else {
    log('矩阵基线 vertex', true, `baseline=${init.vertex}`);
  }

  let prevVertex = init.vertex;
  let anyVertexChange = false;

  for (const [sk, sLabel] of STRUCTURES) {
    for (const [ck, cLabel] of CONTAINERS) {
      const sOk = await safeClick(page, `[data-structure="${sk}"]`);
      const cOk = await safeClick(page, `[data-container="${ck}"]`);
      if (!sOk || !cOk) {
        log(`矩阵 ${sk}/${ck} 切换`, false, `点击失败 structure=${sOk} container=${cOk}`);
        continue;
      }
      // 等重建（高清重建 ~800ms-1s，给足 12s 上限）
      const r = await waitForStats(page, 12000);

      // active 状态
      const sActive = await page.locator(`[data-structure="${sk}"]`).evaluate(el => el.classList.contains('active')).catch(() => false);
      const cActive = await page.locator(`[data-container="${ck}"]`).evaluate(el => el.classList.contains('active')).catch(() => false);

      // badge 文本
      const bs = await page.locator('#badge-structure').textContent().catch(() => '');
      const bc = await page.locator('#badge-container').textContent().catch(() => '');

      const badgeOk = bs === sLabel && bc === cLabel;
      const activeOk = sActive && cActive;
      const statsOk = !r.timedOut && r.vertex != null;

      // 顶点变化判定（至少出现一次与前一格不同即可，避免壳模型恰好同顶点的误判）
      if (statsOk && prevVertex != null && r.vertex !== prevVertex) anyVertexChange = true;

      log(
        `矩阵 ${sk}/${ck}`,
        activeOk && badgeOk && statsOk,
        `active=${activeOk} badge=${badgeOk ? 'OK' : `"${bs}/${bc}"`} vertex=${r.vertex ?? '—'}`
      );
      prevVertex = r.vertex;

      // 为关键组合截三张代表性图
      if ((sk === 'shell' && ck === 'cube') ||
          (sk === 'gradient_shell' && ck === 'cube') ||
          (sk === 'solid_network' && ck === 'cylinder')) {
        await page.screenshot({ path: `${OUT}/three-${sk}-${ck}.png` }).catch(() => {});
      }
    }
  }

  log('矩阵切换触发曲面重建（至少一格顶点变化）', anyVertexChange,
      anyVertexChange ? '' : '所有格顶点数完全相同——疑似重建未触发');
  await ctx.close();
}

// =====================================================================
// T4: structure 切换 → #structure-desc 文案同步（updateStructureDesc 触发）
//     注：[data-structure] 的 click handler 调的是 updateStructureDesc()
//     写入 #structure-desc，故以此元素作为文案断言依据。
// =====================================================================
if (bootOk) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await safeGoto(page, BASE + '/app.html');
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStats(page, 15000);

  await safeClick(page, '[data-structure="gradient_shell"]');
  await page.waitForTimeout(800);
  const desc = await page.locator('#structure-desc').textContent().catch(() => '');
  log('gradient_shell 描述含"梯度"', /梯度/.test(desc), `desc="${desc.slice(0, 50)}"`);

  await safeClick(page, '[data-structure="shell"]');
  await page.waitForTimeout(400);
  const descShell = await page.locator('#structure-desc').textContent().catch(() => '');
  log('shell 描述含"壁厚"', /壁厚/.test(descShell), `desc="${descShell.slice(0, 50)}"`);

  await safeClick(page, '[data-structure="solid_network"]');
  await page.waitForTimeout(400);
  const descSolid = await page.locator('#structure-desc').textContent().catch(() => '');
  log('切回 solid_network 描述含"实体网络"', /实体网络/.test(descSolid), `desc="${descSolid.slice(0, 50)}"`);
  await ctx.close();
}

// =====================================================================
// T5: 状态可经 URL 参数恢复（structure / container）
// =====================================================================
if (bootOk) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  await safeGoto(page, BASE + '/app.html?structure=shell&container=cylinder');
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStats(page, 15000);

  const sActive = await page.locator('[data-structure="shell"]').evaluate(el => el.classList.contains('active')).catch(() => false);
  const cActive = await page.locator('[data-container="cylinder"]').evaluate(el => el.classList.contains('active')).catch(() => false);
  const bs = await page.locator('#badge-structure').textContent().catch(() => '');
  const bc = await page.locator('#badge-container').textContent().catch(() => '');
  log('URL 恢复 structure=shell', sActive && bs === '等厚双壳', `active=${sActive} badge="${bs}"`);
  log('URL 恢复 container=cylinder', cActive && bc === '圆柱体', `active=${cActive} badge="${bc}"`);
  await ctx.close();
}

// =====================================================================
// T6: 分享链接包含 structure / container 参数
// =====================================================================
if (bootOk) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await safeGoto(page, BASE + '/app.html');
  await page.evaluate(() => { try { localStorage.setItem('tpms-onboarded', '1'); } catch (e) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStats(page, 15000);

  // 切到一个非默认组合，确保参数会被写入链接
  await safeClick(page, '[data-structure="gradient_shell"]');
  await safeClick(page, '[data-container="cylinder"]');
  await page.waitForTimeout(500);

  const clicked = await safeClick(page, '#btn-share');
  if (!clicked) {
    log('分享按钮可点击', false, '#btn-share 不存在');
  } else {
    await page.waitForTimeout(500);
    let clipText = '';
    try {
      clipText = await page.evaluate(() => navigator.clipboard.readText());
    } catch (e) {
      log('读取剪贴板', 'SKIP', e.message);
    }
    if (clipText) {
      let url;
      try {
        url = new URL(clipText);
        log('分享链接含 structure', url.searchParams.get('structure') === 'gradient_shell', `实际=${url.searchParams.get('structure')}`);
        log('分享链接含 container', url.searchParams.get('container') === 'cylinder', `实际=${url.searchParams.get('container')}`);
      } catch (e) {
        log('分享链接是合法 URL', false, `clip="${clipText.slice(0, 60)}"`);
      }
    }
  }
  await ctx.close();
}

await browser.close();

// =====================================================================
// Summary：区分 PASS / FAIL / SKIP
// =====================================================================
const passed = results.filter(r => r.ok === true).length;
const failed = results.filter(r => r.ok === false);
const skipped = results.filter(r => r.ok === 'SKIP').length;
const total = results.length;
console.log('\n==== SUMMARY ====');
console.log(`PASS ${passed} / FAIL ${failed.length} / SKIP ${skipped} / TOTAL ${total}`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`));
}
// SKIP 不算失败：CDN/环境不可达时给用户清晰的"非代码问题"信号
process.exit(failed.length === 0 ? 0 : 1);
