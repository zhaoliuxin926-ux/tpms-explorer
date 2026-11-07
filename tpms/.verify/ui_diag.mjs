// UI 诊断探针电池（2026-11-07 工位侧批次）：CI ubuntu verify #ob-next 挂死事件（见
// agent_memory/bugs.md 2026-11-07 条）暴露伏击网盲区——五探针常驻在 card_smoke/meshcont
// 系套件，verify 套件零探针，真红时无 traceTop 落证。本模块忠实移植 check_meshcont_card.mjs
// 实战版探针（10-03~10-05 深水风暴取证装备，meshcont 内联版原样保留不重构），并加
// 失败路径防挂死包裹（原版依赖套件 watchdog 兜底，verify 失败路径需自限）。
//
// 用法：关键 click 失败/超时时 await dumpUiDiag(page, label) 落证后重抛原错误。
// 总耗时约 14s（页面健康时）；每探针 8s 自限（页面冻结时 evaluate 永挂，race 兜底）。

const PROBE_BUDGET_MS = 8000;

function bounded(p, tag) {
  return Promise.race([
    p,
    new Promise((res) => setTimeout(() => res(tag + ' 超时(' + PROBE_BUDGET_MS + 'ms)'), PROBE_BUDGET_MS)),
  ]);
}

export async function dumpUiDiag(page, label = 'click-fail') {
  console.log(`[DIAG] ===== ${label} =====`);
  // 1. 主线程活性 + longtask 清单：timer 能回=活着；longtask 时长列表揭示谁在轰炸事件循环
  const alive = await bounded(page.evaluate(() => new Promise((res) => {
    const entries = [];
    let obs;
    try {
      obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) entries.push(Math.round(e.duration)); });
      obs.observe({ entryTypes: ['longtask'] });
    } catch { /* longtask 不可用退化为 timer */ }
    const t0 = Date.now();
    setTimeout(() => { try { obs?.disconnect(); } catch {} res('alive ' + (Date.now() - t0) + 'ms longtasks=[' + entries.join(',') + ']'); }, 2500);
  })), '[DIAG] mainThread');
  console.log('[DIAG] mainThread=' + alive);
  // 2. 堆双采样斜率（2.5s 间隔 JSHeapUsedSize——证伪/证实 GC 主导）
  //    【2026-11-07 修正】meshcont 原版用 Memory.getDOMCounters 取 jsHeapSize——该 CDP
  //    域无此字段（恒 NaN，nodes 有效）；本模块改 Performance.getMetrics.JSHeapUsedSize。
  try {
    await bounded((async () => {
      const cdpM = await page.context().newCDPSession(page);
      await cdpM.send('Performance.enable');
      const m1 = await cdpM.send('Performance.getMetrics');
      const c1 = await cdpM.send('Memory.getDOMCounters');
      await new Promise((r) => setTimeout(r, 2500));
      const m2 = await cdpM.send('Performance.getMetrics');
      const c2 = await cdpM.send('Memory.getDOMCounters');
      const heapOf = (ms) => Math.round((ms.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576);
      console.log(`[DIAG] heap=${heapOf(m1)}MB→${heapOf(m2)}MB (Δ${heapOf(m2) - heapOf(m1)}MB/2.5s) nodes=${c1.nodes}→${c2.nodes}`);
      try { await cdpM.detach(); } catch {}
    })(), '[DIAG] heap');
  } catch (e) { console.log('[DIAG] heap 失败: ' + String(e).slice(0, 60)); }
  // 3. CPU profile 3s：CDP Profiler 抓热点函数（bottom-up self 时间 top8）
  try {
    await bounded((async () => {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 10000 });
      await cdp.send('Profiler.start');
      await new Promise((r) => setTimeout(r, 3000));
      const { profile } = await cdp.send('Profiler.stop');
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
      const self = new Map();
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
      console.log('[DIAG] profileTop=' + JSON.stringify(top));
      try { await cdp.detach(); } catch {}
    })(), '[DIAG] profile');
  } catch (e) {
    console.log('[DIAG] profile 失败: ' + String(e).slice(0, 80));
  }
  // 4. CDP Tracing 3s：抓长任务的真实切片名（MajorGC/Layout/Parse/Compile…聚合 top10）
  //    【ReportEvents 纪律】ReturnAsStream 下 dataCollected 永不推送（meshcont 实证交付即死）
  try {
    await bounded((async () => {
      const cdp2 = await page.context().newCDPSession(page);
      const chunks = [];
      cdp2.on('Tracing.dataCollected', (d) => chunks.push(...d.value));
      await cdp2.send('Tracing.start', { transferMode: 'ReportEvents', categories: 'devtools.timeline' });
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
      console.log('[DIAG] traceTop=' + topT.join(' | ') + ' (events=' + chunks.length + ')');
      try { await cdp2.detach(); } catch { /* 防御性收尾 */ }
    })(), '[DIAG] trace');
  } catch (e) {
    console.log('[DIAG] trace 失败: ' + String(e).slice(0, 80));
  }
  // 5. rAF 计数：2s 窗内帧数（0=按需渲染静默→轰源非渲染；≈120=持续渲染循环）
  try {
    const rafN = await bounded(page.evaluate(() => new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = window.requestAnimationFrame.bind(window);
      function loop() { n++; if (performance.now() - t0 < 2000) tick(loop); }
      tick(loop);
      setTimeout(() => res(n + ' rAF/2s'), 2200);
    })), '[DIAG] raf');
    console.log('[DIAG] raf=' + rafN);
  } catch (e) { console.log('[DIAG] raf 失败: ' + String(e).slice(0, 60)); }
  console.log('[DIAG] ===== end =====');
}
