// probe_memory_leak.mjs —— 内存泄漏与资源释放探针（Task 5）
//
// 目标：连续 80 次滑块调节触发 Web Worker 网格重建 + Three.js 场景重建，
// 断言 GC 后堆残余增量 < 5MB，且 WebGL context 数量不增长（Geometry/Material
// 的 dispose 链生效——geometry.dispose() 释放的顶点缓冲是页面堆的最大头）。
//
// 方法论：
//   · CDP Performance.getMetrics(JSHeapUsedSize) + HeapProfiler.collectGarbage
//     —— 比 window.gc 可靠（无需 --expose-gc 启动参数）
//   · 先做最大幅度 warmup×4：BufferPool 是有意常驻的零分配设计（固定容量数组
//     复用，非泄漏），JIT/着色器缓存也一次性——全部计入 baseline 后再开测
//   · WebGL context 计数器经 addInitScript 在应用脚本前包装 getContext 注入
//     （Three.js 泄漏 renderer 时必然创建新 canvas/context，上限约 16 个即崩）
//   · Worker 线程堆不在页面 JSHeapUsedSize 内；其常驻 BufferPool 按设计有界，
//     传输侧 Transferable 零拷贝（tpms-worker.ts），不构成本断言对象
//
// 运行：node probe_memory_leak.mjs   （自动起停 4831 静态服务）
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const PORT = 4831;
const BASE = `http://localhost:${PORT}/`;
const CYCLES = Number(process.env.LEAK_ROUNDS || 80);   // 阶段 V：支持 200 轮压测（LEAK_ROUNDS=200）
const LEAK_BUDGET_MB = 5;

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { b: '\x1b[1m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', dim: '\x1b[2m', rst: '\x1b[0m' }
  : { b: '', red: '', grn: '', ylw: '', cyn: '', dim: '', rst: '' };

if (!existsSync(path.join(DEPLOYED, 'index.html'))) {
  console.error(`${C.red}✗ 缺少部署产物 docs/platform/index.html${C.rst}`);
  process.exit(2);
}

// ── 静态服务自启停（已占用则复用并在结束时保留不动）──
function portBusy(p) {
  return new Promise((resolve) => {
    const s = net.connect({ host: 'localhost', port: p, timeout: 800 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}
let srv = null;
if (await portBusy(PORT)) {
  console.log(`${C.dim}[服务] ${PORT} 已被占用，复用现有服务（结束时不杀）${C.rst}`);
} else {
  srv = spawn('python', ['-m', 'http.server', String(PORT), '--directory', DEPLOYED], { stdio: 'ignore' });
  const t0 = Date.now();
  while (!(await portBusy(PORT)) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 300));
  console.log(`[服务] python http.server :${PORT} ← docs/platform`);
}

const errors = [];
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log(`${C.grn}PASS${C.rst} ${n}${d ? ` ${C.dim}— ${d}${C.rst}` : ''}`); };
const bad = (n, d = '') => { fail++; console.log(`${C.red}FAIL${C.rst} ${n} ${C.red}${d}${C.rst}`); };

let browser = null, exitCode = 0;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  // getContext 包装：统计 distinct canvas 上的 webgl 获取次数
  await page.addInitScript(() => {
    window.__glCanvasCount = 0;
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === 'string' && type.startsWith('webgl') && !this.dataset.__glTagged) {
        this.dataset.__glTagged = '1';
        window.__glCanvasCount++;
      }
      return orig.call(this, type, ...rest);
    };
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable').catch(() => {});
  await cdp.send('Performance.enable').catch(() => {});
  async function gcAndMeasure(samples = 3) {
    const vals = [];
    for (let i = 0; i < samples; i++) {
      try { await cdp.send('HeapProfiler.collectGarbage'); } catch { /* 通道不可用时跳过 */ }
      await new Promise(r => setTimeout(r, 250));
      const { metrics } = await cdp.send('Performance.getMetrics');
      vals.push(metrics.find(m => m.name === 'JSHeapUsedSize').value / 1048576);
    }
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  await page.goto(BASE + '?autoRotate=0', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000); // 首屏重建

  // 引导浮层若存在则跳过（不阻塞 evaluate 派发事件，纯卫生措施）
  try {
    await page.click('button:has-text("跳过")', { timeout: 1500 });
  } catch { /* 无引导 */ }

  // ── Warmup ×4 极值往复：让 BufferPool/JIT/纹理达到稳态 ──
  for (let i = 0; i < 4; i++) {
    for (const v of ['90', '60']) {
      await page.evaluate((val) => {
        const el = document.querySelector('#porosity');
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, v);
      await page.waitForTimeout(1300);
    }
  }
  const glAfterWarmup = await page.evaluate(() => window.__glCanvasCount);

  const heapStart = await gcAndMeasure();

  // ── 压力循环：80 次滑块调节（每次 input → preview 重建 → 150ms 防
  //    抖后 HD 重建入队 worker）；每 16 拍翻转顶点着色，每 20 拍切换
  //    剖切深度（激活 stencil cap + percolation 路径），压满渲染/分析双管线 ──
  const t0 = Date.now();
  for (let i = 0; i < CYCLES; i++) {
    const v = i % 2 === 0 ? '62' : '88';
    await page.evaluate((val) => {
      const el = document.querySelector('#porosity');
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const slow = i % 16 === 15;
    const keepElevation = i >= CYCLES * 0.75;
    const wantColoring = slow ? (keepElevation ? 'elevation' : (Math.floor(i / 16) % 2 === 0 ? 'elevation' : 'none')) : null;
    if (wantColoring) {
      await page.evaluate((mode) => {
        const btn = document.querySelector(`[data-coloring="${mode}"]`);
        btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }, wantColoring);
    }
    // 每 20 拍切换剖切深度（stencil overlay 挂卸 + 3D 孤岛 BFS）
    if (i % 20 === 10) {
      await page.evaluate((sv) => {
        const el = document.querySelector('#slice');
        el.value = sv;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, i % 40 === 10 ? '80' : '45');
    }
    await page.waitForTimeout(slow ? 600 : 70);
  }
  const loopSec = ((Date.now() - t0) / 1000).toFixed(1);
  await page.waitForTimeout(2500); // 收尾 HD 重建完成
  const heapEnd = await gcAndMeasure();
  const glEnd = await page.evaluate(() => window.__glCanvasCount);

  const deltaMB = heapEnd - heapStart;
  console.log(`
堆基线 ${heapStart.toFixed(2)} MB → 结束 ${heapEnd.toFixed(2)} MB | 循环 ${CYCLES} 次 ${loopSec}s | GL canvas ${glAfterWarmup}→${glEnd}`);

  deltaMB < LEAK_BUDGET_MB
    ? ok('堆稳定（GC 后）', `Δ=${deltaMB.toFixed(2)} MB < 预算 ${LEAK_BUDGET_MB} MB`)
    : bad('堆增长超预算', `Δ=${deltaMB.toFixed(2)} MB ≥ ${LEAK_BUDGET_MB} MB`);
  glEnd <= glAfterWarmup
    ? ok('WebGL context 无泄漏', `${glAfterWarmup}→${glEnd}`)
    : bad('WebGL context 增长', `${glAfterWarmup}→${glEnd}（renderer 未释放？）`);
  const relErrs = errors.filter(e => !e.includes('favicon'));
  relErrs.length === 0
    ? ok('0 pageerror / console.error')
    : bad('运行期错误', relErrs.slice(0, 3).join(' | '));

  pass + fail > 0 && console.log(`\n===== 内存泄漏探针：${pass} PASS / ${fail} FAIL =====`);
  exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error(`${C.red}探针异常退出：${e.message}${C.rst}`);
  exitCode = 2;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (srv) { try { srv.kill(); } catch {} }
}

process.exit(exitCode);
