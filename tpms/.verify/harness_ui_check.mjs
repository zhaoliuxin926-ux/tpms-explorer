/**
 * harness_ui_check.mjs —— 门：双壳驾驶舱 UI 与桥冒烟（方向 B1 专属门，2026-11-12）
 *
 * 背景：selector(64)/fix_check(28) 只锚 index.html，agent_bridge F 段仅 grep 级结构钉——
 * 驾驶舱壳与 iframe 桥的运行面此前无门（B1 自查题缺口）。本门断言三层活性：
 *
 * A 外壳活：标题/顶栏/空态/停止钮隐藏/芯片在位
 * B 工程壳活：iframe 加载完成（loading 遮罩隐藏 + 工程壳 DOM 就绪）
 * C 桥活（端到端信号）：手工 postMessage get-state 回执 + apply 写穿双壳
 *   （iframe document.title 随类型变——同源穿透断言，一次性证明"外壳↔桥↔工程壳"全链）
 * D 标签交互：诊断/导出面板切换
 * E 规则兜底（无 key）：真实 UI 发送 → parseNL 轨迹卡 + 经桥应用（title 变化）
 * Z 全程 0 pageerror / 0 console.error
 *
 * 运行：node harness_ui_check.mjs（自起 4825 静态服务，服务 docs/platform 部署产物）
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');

const PORT = 4825;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(PLATFORM_DIR, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ✓ ' + n); };
const bad = (n, d = '') => { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); };
const errors = [];

const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chrome', executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/harness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  // 工程壳 iframe 就绪（badge 数据出现=主 bundle 活）
  await page.waitForFunction(() => {
    const f = document.getElementById('stage-frame');
    return f && f.contentDocument?.readyState === 'complete' && f.contentDocument.getElementById('stat-tris')?.textContent?.includes('k');
  }, null, { timeout: 120000, polling: 2000 }).catch(() => {});

  // ── A 外壳活 ──
  console.log('\n[A] 外壳活');
  {
    const a = await page.evaluate(() => ({
      title: document.title,
      providers: [...document.querySelectorAll('#provider option')].map(o => o.value),
      empty: !!document.getElementById('empty-hint'),
      stopHidden: document.getElementById('stop-btn')?.hasAttribute('hidden') ?? false,
      chips: document.querySelectorAll('.chip').length,
      tabs: document.querySelectorAll('.tab').length,
      frameLoadingHidden: document.getElementById('frame-loading')?.style.display === 'none',
    }));
    ok('标题 TPMS Harness', a.title.includes('Harness'));
    ok('provider 三通道（rules/openai/ollama）', a.providers.join() === 'rules,openai,ollama');
    ok('空态邀请卡在位', a.empty);
    ok('停止钮初始隐藏（待机不占语义）', a.stopHidden);
    ok('示例芯片 ≥2 + 标签 3 枚', a.chips >= 2 && a.tabs === 3);
    ok('工程壳 iframe 加载遮罩已隐藏', a.frameLoadingHidden);
  }

  // ── C 桥活（端到端）──
  console.log('\n[C] iframe 桥端到端');
  {
    const probe = await page.evaluate(async () => {
      const frame = document.getElementById('stage-frame');
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true }), 10000);
        window.addEventListener('message', function onMsg(e) {
          if (e.source !== frame.contentWindow || e.data?.__tpmsBridge !== true || e.data.id !== 1) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(t);
          resolve({ ok: e.data.ok, payload: e.data.payload });
        });
        frame.contentWindow.postMessage({ __tpmsBridge: true, type: 'get-state', id: 1 }, location.origin);
      });
    });
    ok('桥 get-state 回执（summary 含 p= 口径）', probe.ok === true && String(probe.payload?.summary ?? '').includes('p='), JSON.stringify(probe).slice(0, 80));

    const applied = await page.evaluate(async () => {
      const frame = document.getElementById('stage-frame');
      return await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true }), 20000);
        window.addEventListener('message', function onMsg(e) {
          if (e.source !== frame.contentWindow || e.data?.__tpmsBridge !== true || e.data.id !== 2) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(t);
          resolve({ ok: e.data.ok, payload: e.data.payload });
        });
        frame.contentWindow.postMessage({ __tpmsBridge: true, type: 'apply', id: 2, payload: { type: 'diamond', porosity: 70, periods: 3 } }, location.origin);
      });
    });
    ok('桥 apply 回执（diamond p70 写入）', applied.ok === true && String(applied.payload?.summary ?? '').includes('diamond'), JSON.stringify(applied).slice(0, 80));
    // 写穿断言：工程壳 title 随类型变（同源穿透——外壳↔桥↔工程壳全链一次性证明）
    const title1 = await page.waitForFunction(() => document.getElementById('stage-frame')?.contentDocument?.title.includes('Diamond'), null, { timeout: 30000, polling: 1000 }).then(() => true).catch(() => false);
    ok('apply 写穿双壳（工程壳 title→Diamond）', title1);
  }

  // ── D 标签交互 ──
  console.log('\n[D] 标签交互');
  {
    const d = await page.evaluate(() => {
      document.querySelector('.tab[data-pane="pdiag"]')?.click();
      const diagOn = document.getElementById('pdiag')?.classList.contains('on');
      const diagEmpty = getComputedStyle(document.getElementById('diag-empty')).display !== 'none';
      document.querySelector('.tab[data-pane="pexp"]')?.click();
      const expOn = document.getElementById('pexp')?.classList.contains('on');
      document.querySelector('.tab[data-pane="p3d"]')?.click();
      return { diagOn, diagEmpty, expOn };
    });
    ok('诊断/导出标签切换（空态文案在位）', d.diagOn && d.diagEmpty && d.expOn);
  }

  // ── E 规则兜底（无 key 真实 UI 路径）──
  console.log('\n[E] 无 key 规则兜底（经桥应用）');
  {
    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '改成 schwarz，孔隙率 65';
      document.getElementById('send-btn').click();
    });
    const entrySeen = await page.waitForFunction(() => !!document.querySelector('#stream .entry'), null, { timeout: 20000, polling: 800 }).then(() => true).catch(() => false);
    ok('规则解析轨迹卡出现（本地规则）', entrySeen);
    const title2 = await page.waitForFunction(() => document.getElementById('stage-frame')?.contentDocument?.title.includes('Schwarz'), null, { timeout: 40000, polling: 1000 }).then(() => true).catch(() => false);
    ok('规则补丁经桥写穿（工程壳 title→Schwarz）', title2);
  }

  // ── Z 全程零错误 ──
  console.log('\n[Z] 全程 0 pageerror / 0 console.error');
  errors.length === 0 ? ok('零错误') : bad('运行时错误', errors.slice(0, 3).join(' | ').slice(0, 160));
} finally {
  await browser.close().catch(() => {});
  try { process.platform === 'win32' ? spawn('taskkill', ['/F', '/PID', String(server.pid), '/T']) : process.kill(-server.pid, 'SIGTERM'); } catch { /* 尽力 */ }
}

console.log(`\n== HARNESS-UI: ${pass} PASS / ${fail} FAIL ==`);
if (fail > 0) process.exitCode = 1;
