// check_meshcont_card.mjs — C5 STL 容器卡片冒烟（一次性快检，不入 CI）
// 页面内合成 box STL（12 三角，封闭流形）→ 注入上传 → 断言状态文本 + 重建 + 0 pageerror
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4857;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = process.env.SMOKE_DEPLOYED ?? path.join(ROOT, "docs/platform");
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
const diag = [];  // 2026-10-02 CI 诊断：SDF 0% 卡死两轮（Linux/macOS 确定性，Windows 本地过）——全 console + JS 资源网络状态转储进日志
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('response', (r) => { if (/\.js(\?|$)/.test(r.url()) && r.status() >= 400) diag.push('JS ' + r.status() + ' ' + r.url().split('/').pop()); });
page.on('worker', (w) => diag.push('worker: ' + w.url().split('/').pop()));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// 页面内合成 box STL Uint8Array（±10mm 立方体，12 三角，外向缠绕）
const stlBytes = await page.evaluate(() => {
  const h = 10;
  const v = [[-h,-h,-h],[h,-h,-h],[h,h,-h],[-h,h,-h],[-h,-h,h],[h,-h,h],[h,h,h],[-h,h,h]];
  const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,4,7,3]];
  const tris = [];
  for (const q of quads) { tris.push([v[q[0]], v[q[1]], v[q[2]]]); tris.push([v[q[0]], v[q[2]], v[q[3]]]); }
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const [a, b, c] of tris) {
    off += 12;
    for (const p of [a, b, c]) { dv.setFloat32(off, p[0], true); dv.setFloat32(off + 4, p[1], true); dv.setFloat32(off + 8, p[2], true); off += 12; }
    off += 2;
  }
  return new Uint8Array(buf);
});

async function dumpDiag() {
  console.log('DIAG status="' + statusText.slice(0, 90) + '"');
  console.log('DIAG workers/js404: ' + (diag.length ? diag.join(' ; ') : '(无 worker 事件/无 JS 4xx)'));
  // 主线程活性 + 长任务清单：timer 能回=活着；longtask 时长列表揭示谁在轰炸事件循环
  const alive = await page.evaluate(() => new Promise((res) => {
    const entries = [];
    let obs;
    try {
      obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) entries.push(Math.round(e.duration)); });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask 不可用退化为 timer */ }
    const t0 = Date.now();
    setTimeout(() => { try { obs?.disconnect(); } catch {} res('alive ' + (Date.now() - t0) + 'ms longtasks=[' + entries.join(',') + ']'); }, 2500);
  }))
    .catch((e) => 'BLOCKED/err: ' + String(e).slice(0, 60));
  console.log('DIAG mainThread=' + alive);
  // CPU profile 3s：CDP Profiler 抓轰炸源热点函数（bottom-up self 时间 top8）
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 10000 });
    await cdp.send('Profiler.start');
    await new Promise((r) => setTimeout(r, 3000));
    const { profile } = await cdp.send('Profiler.stop');
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const self = new Map();
    // samples→self 时间累计
    const dt = profile.timeDeltas;
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i];
      self.set(id, (self.get(id) ?? 0) + (dt[i] ?? 0));
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, us]) => {
        const cf = nodes.get(id)?.callFrame ?? {};
        return Math.round(us / 1000) + 'ms ' + (cf.functionName || '(anon)') + ' @' + String(cf.url || '').split('/').pop() + ':' + (cf.lineNumber ?? '?');
      });
    console.log('DIAG profileTop=' + JSON.stringify(top));
  } catch (e) {
    console.log('DIAG profile 失败: ' + String(e).slice(0, 80));
  }
  // CDP Tracing 3s：抓长任务的真实切片名（MajorGC/Layout/Parse/Compile…聚合 top10）
  try {
    const cdp2 = await ctx.newCDPSession(page);
    const chunks = [];
    cdp2.on('Tracing.dataCollected', (d) => chunks.push(...d.value));
    await cdp2.send('Tracing.start', { transferMode: 'ReturnAsStream', categories: 'devtools.timeline', options: 'sampling-frequency=10000' });
    await new Promise((r) => setTimeout(r, 3000));
    await cdp2.send('Tracing.end');
    await new Promise((r) => setTimeout(r, 500));
    const byName = new Map();
    for (const ev of chunks) {
      if (!ev.name || ev.ph !== 'X') continue;
      if (/^(RunTask|Task|Program|Thread|UpdateLayoutTree|Rasterizer|Layerize|FireAnimationFrame|RequestAnimationFrame|TimerFire|RunMicrotasks)$/i.test(ev.name)) continue;
      byName.set(ev.name, (byName.get(ev.name) ?? 0) + (ev.dur ?? 0));
    }
    const topT = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, us]) => n + '=' + Math.round(us / 1000) + 'ms');
    console.log('DIAG traceTop=' + topT.join(' | '));
  } catch (e) {
    console.log('DIAG trace 失败: ' + String(e).slice(0, 80));
  }
  // rAF 计数：2s 窗内帧数（0=按需渲染静默→轰源非渲染；≈120=持续渲染循环）
  try {
    const rafN = await page.evaluate(() => new Promise((res) => {
      let n = 0; const orig = window.requestAnimationFrame;
      const t0 = performance.now();
      const tick = window.requestAnimationFrame.bind(window);
      function loop() { n++; if (performance.now() - t0 < 2000) tick(loop); }
      tick(loop);
      setTimeout(() => res(n + ' rAF/2s'), 2200);
    }));
    console.log('DIAG raf=' + rafN);
  } catch (e) { console.log('DIAG raf 失败: ' + String(e).slice(0, 60)); }
  const probe = await page.evaluate(() => {
    const out = { meshcontFile: null };
    const inp = document.querySelector('#meshcont-file');
    out.meshcontFile = inp ? 'present' : 'missing';
    out.sw = (navigator.hardwareConcurrency ?? '?') + ' cores';
    return out;
  }).catch((e) => ({ err: String(e) }));
  console.log('DIAG probe=' + JSON.stringify(probe));
}

// 【2026-10-03 定案】上传路径存在已知深水 bug：偶发（本地 ~40%）主线程被 native 风暴
// 轰炸（GC/结构化克隆，疑 build worker 看门狗超时-重生循环——取证链见 bugs.md），
// SDF progress 消息永无主线程空隙。冻结自愈双试：每试冻结必留 DIAG 取证再整页重载；
// 两试全冻才判红（与 run_all RETRY 同语义，但冻结样本保证进日志）。
let statusText = '';
for (let attempt = 1; attempt <= 2; attempt++) {
  await page.evaluate(() => {
    document.querySelector('#meshcont-file')?.closest('details')?.setAttribute('open', '');
  });
  const handle = await page.evaluateHandle(([bytes]) => {
    const file = new File([bytes], 'box.stl', { type: 'application/octet-stream' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#meshcont-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [stlBytes]);
  // 轮询等待 SDF 终态（上传路径「已启用」会被后续 R 档 meshSdfEnsure 覆盖为「就绪」）
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(1000);
    const t = await page.evaluate(() => document.querySelector('#meshcont-status')?.textContent ?? '');
    if (/已启用|就绪|✗/.test(t)) { statusText = t; break; }
    statusText = t;
  }
  if (/已启用|就绪|✗/.test(statusText)) break;
  console.log(`[attempt${attempt}] SDF 冻结 180s——DIAG 取证后重载重试（已知深水 bug，非本测断言对象）`);
  await dumpDiag();
  if (attempt < 2) {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
}
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
ok('加载状态文本（三角数+已启用/就绪）', /已启用|就绪/.test(statusText) && /\d/.test(statusText), statusText.slice(0, 80));
ok('水密自检通过（✓ 且无 ✗）', statusText.includes('✓') && !statusText.includes('✗') && /就绪|已启用|三角/.test(statusText), statusText.slice(0, 80));
ok('0 pageerror/console.error', errors.length === 0, errors.slice(0, 2).join(' | '));

// blend 滑块触发重建无错
await page.evaluate(() => {
  const el = document.querySelector('#meshcont-blend');
  el.value = '0.3';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(5000);
ok('blend 滑块重建 0 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== MESHCONT CARD SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
