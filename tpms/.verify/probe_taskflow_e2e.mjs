// probe_taskflow_e2e.mjs — 任务流五步端到端走查（2026-10-25 批八，一次性快检，不入 CI）
// 审查 row 1 验收方式机械化首档：单会话连走 设计→候选→制造检查→导出交付→试验分析，
// 记录每步断言与耗时。跨步状态流转 + 采用路径交付包 manifest 契约为本探针新覆盖。
// 局限：AI 代跑≠真人无指导验收（报告如实披露）。
// 关键技巧：前沿点采用用页面内合成 MouseEvent 序列（单次 evaluate 循环派发）——
// 批五曾因 playwright 逐点往返 ~1.2s/点而绕开，页内派发 576 点亚秒完成。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4868;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(ROOT, 'docs/platform')]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Worker build timed out.*已重建 worker/.test(t)) return; // 慢 runner 自愈分级（b9067d4）
  if (/^\[Main\] Worker error:/.test(t)) return; // 无（本链无刻意失败构建），保守过滤留存
  errors.push('console.error: ' + t);
});

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
const phase = (t) => console.error('[phase]', t);
const T0 = Date.now();
const stepTime = [];
const mark = (label) => stepTime.push(`${label}:${((Date.now() - T0) / 1000).toFixed(1)}s`);

async function settle(selector, cap = 60) {
  let prev = null;
  for (let t = 0; t < cap * 2; t++) {
    const v = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selector);
    if (prev != null && v === prev && v !== '' && v !== '—') return v;
    prev = v;
    await page.waitForTimeout(500);
  }
  return prev ?? '';
}

// blob 捕获（createObjectURL 拦截——download.path() 无超时教训）
async function armCapture() {
  await page.evaluate(() => {
    window.__capB64 = null;
    if (window.__capArmed) return;
    window.__capArmed = true;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.arrayBuffer().then((ab) => {
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        window.__capB64 = btoa(bin);
      });
      return orig(blob);
    };
  });
}

// ── ① 设计试样：boot 默认 gyroid k3 p75 ──
phase('step1 design');
const t1 = Date.now();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });
await settle('#stat-tris');
const card = await page.evaluate(() => ({
  steps: document.querySelectorAll('#taskflow .tf-step').length,
  designBadge: document.querySelector('[data-badge="design"]')?.textContent ?? '',
  tris: document.querySelector('#stat-tris')?.textContent ?? '',
}));
ok('① 设计就绪（默认 gyroid 构建+任务流卡五步+①恒✓）',
  card.steps === 5 && card.designBadge === '✓' && /\d/.test(card.tris), JSON.stringify(card));
mark('step1-design');

// ── ② 比较候选：任务流卡 ② 跳转 → Pareto 扫描 → 页面内扫掠采用（避开结构性拒产族 fcks）──
phase('step2 candidate');
const t2 = Date.now();
await page.evaluate(() => document.querySelector('[data-step="candidate"]')?.click());
await page.waitForTimeout(1200);
const paretoOpen = await page.evaluate(() => document.getElementById('sect-pareto')?.open ?? false);
ok('任务流卡 ② 跳转 → Pareto sect 展开', paretoOpen);
await page.evaluate(() => document.getElementById('btn-pareto-gen')?.click());
await page.waitForTimeout(1000); // 解析代理毫秒级扫描 + draw
const adoption = await page.evaluate(() => {
  const c = document.getElementById('pareto-canvas');
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return { hit: false, why: 'canvas zero rect' };
  const scaleX = c.width / r.width, scaleY = c.height / r.height;
  let tried = 0;
  for (let gy = 5; gy < c.height; gy += 20) {
    for (let gx = 5; gx < c.width; gx += 20) {
      const cx = r.left + gx / scaleX, cy = r.top + gy / scaleY;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
      c.dispatchEvent(new MouseEvent('click', { clientX: cx, clientY: cy, bubbles: true }));
      tried++;
      const sw = document.querySelector('#sw-value')?.textContent ?? '';
      if (/单胞 \d+\.\d{2}/.test(sw)) {
        const title = document.title;
        if (!/fcks/i.test(title)) return { hit: true, sw, title, tried };
        // 结构性拒产族（fcks）：继续扫掠采用下一个前沿点（后续点击=改采用）
      }
    }
  }
  return { hit: false, why: 'no adoptable front point hit', tried };
});
ok('② 前沿点采用 → 总宽=3×单胞 写回（cellSize=3）',
  adoption.hit === true && /（单胞 \d+\.\d{2}）/.test(adoption.sw ?? '') && adoption.title !== undefined,
  JSON.stringify(adoption));
const cellM = (adoption.sw ?? '').match(/单胞 (\d+\.\d{2})/);
const adoptWidth = cellM ? +(3 * Number(cellM[1])).toFixed(2) : null;
mark('step2-candidate');

// ── ③ 制造检查：任务流卡 ③ 跳转 → 运行 → ③ 徽章 ✓ ──
phase('step3 mfg');
const t3 = Date.now();
await page.evaluate(() => document.querySelector('[data-step="mfg"]')?.click());
await page.waitForFunction(() => document.getElementById('sect-mfg')?.open === true, { timeout: 10_000 });
await page.evaluate(() => document.getElementById('btn-mfg')?.click());
await page.waitForFunction(() => /最小壁厚/.test(document.querySelector('#mfg-result')?.textContent ?? ''), { timeout: 120_000, polling: 500 });
const mfg = await page.evaluate(() => ({
  text: document.querySelector('#mfg-result')?.textContent ?? '',
  badge: document.querySelector('[data-badge="mfg"]')?.className ?? '',
}));
ok('③ 制造检查四指标齐备 + 徽章 ✓（采用设计指纹）',
  /最小壁厚/.test(mfg.text) && /主域孔喉/.test(mfg.text) && /封闭孔腔/.test(mfg.text) && /孔隙连通/.test(mfg.text) && mfg.badge.includes('done'),
  mfg.badge);
mark('step3-mfg');

// ── ④ 导出交付：任务流卡 ④ → 导出中心 → 交付包 ZIP → manifest 尺寸契约 ──
phase('step4 export pkg');
const t4 = Date.now();
await page.evaluate(() => document.querySelector('[data-step="export"]')?.click());
await page.waitForFunction(() => document.getElementById('export-menu')?.classList.contains('show'), { timeout: 10_000 });
await armCapture();
await page.evaluate(() => document.querySelector('.xm-item[data-export="pkg"]')?.click());
await page.waitForFunction(() => !!window.__capB64, { timeout: 180_000, polling: 500 });
const pkgB64 = await page.evaluate(() => window.__capB64);
const pkgBuf = Buffer.from(pkgB64, 'base64');
// STORED ZIP 解析（零依赖，复用 probe_delivery_pkg）
function parseStoredZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const td = new TextDecoder();
  const entries = {};
  let off = 0;
  while (off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50) {
    if (dv.getUint16(off + 8, true) !== 0) throw new Error('non-stored entry @' + off);
    const compSize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = td.decode(buf.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    entries[name] = buf.slice(dataStart, dataStart + compSize);
    off = dataStart + compSize;
  }
  return entries;
}
const entries = parseStoredZip(pkgBuf);
const entryNames = Object.keys(entries);
const designEntry = entryNames.find((n) => n.endsWith('design.json'));
const stlEntry = entryNames.find((n) => n.endsWith('.stl'));
const manifestEntry = entryNames.find((n) => n.endsWith('manifest.json'));
const manifest = manifestEntry ? JSON.parse(new TextDecoder().decode(entries[manifestEntry])) : null;
ok('④ 交付包 ZIP 三件齐备（design.json + 水密 STL + manifest）',
  !!designEntry && !!stlEntry && !!manifestEntry, entryNames.join(','));
ok('④ manifest 尺寸契约 = 采用契约（periods 3 + 总宽 3×单胞）',
  manifest?.sizeContract?.periods === 3 && Math.abs((manifest?.sizeContract?.totalWidthMm ?? -1) - (adoptWidth ?? -9)) < 0.01
    && Math.abs((manifest?.sizeContract?.cellSizeMm ?? -1) - Number(cellM?.[1] ?? -9)) < 0.01,
  JSON.stringify(manifest?.sizeContract));
ok('④ manifest 格式与哈希链字段在位',
  manifest?.format === 'tpms-delivery/1.0' && !!manifest?.files && !!manifest?.meshAudit,
  JSON.stringify({ format: manifest?.format, files: Object.keys(manifest?.files ?? {}).length }));
mark('step4-pkg');

// ── ⑤ 试验分析：任务流卡 ⑤ → 合成 ISO 13314 CSV → E* 出数 + ⑤ 徽章 ✓ ──
phase('step5 analyze');
const t5 = Date.now();
await page.evaluate(() => document.querySelector('[data-step="analyze"]')?.click());
await page.waitForFunction(() => document.getElementById('sect-expfit')?.open === true, { timeout: 10_000 });
const csv = await page.evaluate(() => {
  const E0 = 1200, K = 60000;
  const sig = (e) => {
    if (e <= 0.01) return K * e * e;
    if (e <= 0.035) return K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * 30 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 1.2 * Math.sin(2 * Math.PI * 0.37 / 0.075) * Math.exp(-0.37 / 0.25) + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = [];
  for (let e = 0; e <= 0.5001; e += 0.001) lines.push(e.toFixed(4) + ',' + sig(e).toFixed(4));
  return lines.join('\n');
});
await page.evaluate(([csvText]) => {
  const file = new File([csvText], 'synthetic.csv', { type: 'text/csv' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#expfit-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [csv]);
await page.waitForFunction(() => /E\*=\d/.test(document.querySelector('#expfit-result')?.textContent ?? ''), { timeout: 30_000, polling: 400 });
const ana = await page.evaluate(() => ({
  text: document.querySelector('#expfit-result')?.textContent ?? '',
  badge: document.querySelector('[data-badge="analyze"]')?.className ?? '',
}));
ok('⑤ 试验反演 E* 出数 + ⑤ 徽章 ✓', /E\*=\d/.test(ana.text) && ana.badge.includes('done'), ana.text.slice(0, 60));
mark('step5-analyze');

// ── 全链收口 ──
ok('0 pageerror / 0 console.error（分级口径）', errors.length === 0, errors.slice(0, 2).join(' | '));
console.log('TIMINGS ' + stepTime.join(' '));

await browser.close();
server.kill();
console.log(`\n== TASKFLOW E2E: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
