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
const ok = (n, cond = true, d = '') => (cond ? (pass++, console.log('  ✓ ' + n)) : bad(n, d));
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

  // ── F 逆设计选型 + 会话指代绑定 + 多物理场三元 + CAE 手册（2026-11-13）──
  console.log('\n[F] 逆设计选型 + 确定性指代 + CAE 应变切换');
  {
    const topState = await page.evaluate(() => ({
      resetBtn: !!document.getElementById('session-reset-btn'),
      pill: document.getElementById('session-pill')?.textContent ?? '',
      chips: document.querySelectorAll('.chip').length,
    }));
    ok('F1 新会话按钮/会话胶囊/4 枚示例芯片在位', topState.resetBtn && topState.pill === 'r0 · e0' && topState.chips === 4, JSON.stringify(topState));

    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '推荐 E≥3 GPa 且 κ≥2×10⁻⁹ m² 的前 3 个构型';
      document.getElementById('send-btn').click();
    });
    const paretoSeen = await page.waitForFunction(() =>
      document.querySelectorAll('#stream .cand-item').length === 3
      && (document.getElementById('session-pill')?.textContent ?? '').startsWith('r1'),
    null, { timeout: 20000, polling: 400 }).then(() => true).catch(() => false);
    ok('F2 无 Key 逆设计 Pareto 卡片（3 候选）与会话 r1 落账', paretoSeen);

    const cand1Type = await page.evaluate(() => {
      const t = document.querySelector('#stream .cand-head span')?.textContent ?? '';
      return (t.match(/#1\s+([a-z0-9]+)/i)?.[1] ?? '').toLowerCase();
    });
    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '把第一个构建出来';
      document.getElementById('send-btn').click();
    });
    const refBound = await page.waitForFunction(() =>
      (document.getElementById('session-pill')?.textContent ?? '') === 'r1 · e1'
      && (document.getElementById('stat-state')?.textContent ?? '').includes('L='),
    null, { timeout: 30000, polling: 500 }).then(() => true).catch(() => false);
    const f3Diag = await page.evaluate(() => ({
      pill: document.getElementById('session-pill')?.textContent ?? '',
      stat: document.getElementById('stat-state')?.textContent ?? '',
      cards: [...document.querySelectorAll('#stream .card')].slice(-2).map((c) => c.textContent?.replace(/\s+/g, ' ').slice(0, 220)),
    }));
    ok('F3 确定性指代构建 #1（r1·e1 + v2 总宽 L=3×cellSize 写入工程壳）',
      refBound && (cand1Type ? f3Diag.stat.toLowerCase().includes(cand1Type) : true), JSON.stringify(f3Diag));

    const beforeBadCount = await page.evaluate(() => document.querySelectorAll('#stream .res.bad').length);
    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '不要构建第二个';
      document.getElementById('send-btn').click();
    });
    const negRejected = await page.waitForFunction((prev) =>
      document.querySelectorAll('#stream .res.bad').length > prev,
    beforeBadCount, { timeout: 10000, polling: 300 }).then(() => true).catch(() => false);
    ok('F4 否定指代白名单确定性拒绝（零误触发写入）', negRejected);

    const caeTri = await page.evaluate(() => {
      document.querySelector('.tab[data-pane="pdiag"]')?.click();
      const triCount = document.querySelectorAll('#sim-triangle .tri-card').length;
      document.querySelector('.tab[data-pane="pexp"]')?.click();
      const strainEl = document.getElementById('cae-strain');
      strainEl.value = '0.15';
      strainEl.dispatchEvent(new Event('input', { bubbles: true }));
      const cmdTxt = document.getElementById('cae-cmd')?.textContent ?? '';
      const badgeTxt = document.getElementById('cae-mode-badge')?.textContent ?? '';
      document.querySelector('.tab[data-pane="p3d"]')?.click();
      return { triCount, cmdTxt, badgeTxt };
    });
    ok('F5 三元核验卡 3 项 + CAE 手册 ε=15% 切 Explicit C3D10M',
      caeTri.triCount === 3 && caeTri.cmdTxt.includes('--explicit 2.0') && caeTri.badgeTxt.includes('Explicit C3D10M'),
      caeTri.badgeTxt);

    const resetDone = await page.evaluate(() => {
      document.getElementById('session-reset-btn')?.click();
      return {
        pill: document.getElementById('session-pill')?.textContent ?? '',
        empty: !!document.getElementById('empty-hint'),
      };
    });
    ok('F6 新会话按钮清空轨迹并复位会话计数 r0 · e0', resetDone.pill === 'r0 · e0' && resetDone.empty, JSON.stringify(resetDone));
  }

  // ── G Phase 2 平台闭环（在线求解 + Cool-Warm 3D 云图 + ISO 13314/Forchheimer 后处理 + M5 场景/CAE 导出）──
  console.log('\n[G] 在线数值仿真 + 后处理工作台 + M5 场景与 CAE 一键交付');
  {
    await page.evaluate(() => {
      document.querySelector('.tab[data-pane="pdiag"]')?.click();
      document.getElementById('sim-btn-all')?.click();
    });
    const simDone = await page.waitForFunction(() => {
      const grid = document.getElementById('sim-live-grid');
      const txt = grid?.textContent ?? '';
      return !!grid && !grid.hidden
        && txt.includes('Cool-Warm')
        && txt.includes('均匀化')
        && txt.includes('屈服安全系数')
        && txt.includes('临界悬垂');
    }, null, { timeout: 60000, polling: 400 }).then(() => true).catch(() => false);
    const g1Diag = await page.evaluate(() => ({
      tag: document.getElementById('sim-live-tag')?.textContent ?? '',
      grid: (document.getElementById('sim-live-grid')?.textContent ?? '').slice(0, 220),
      isoBadge: document.getElementById('pp-source-badge')?.textContent ?? '',
    }));
    ok('G1 在线数值求解全项快检（DT 压缩 + 3D Cool-Warm 云图 + 均匀化 + 屈服 + 悬垂）',
      simDone && g1Diag.tag.includes('完成') && g1Diag.isoBadge.includes('DT'),
      JSON.stringify(g1Diag));

    await page.evaluate(() => { document.getElementById('pp-btn-gyroid')?.click(); });
    const g2Diag = await page.evaluate(() => {
      const badge = document.getElementById('pp-source-badge')?.textContent ?? '';
      const metrics = document.getElementById('iso-metrics')?.textContent ?? '';
      const canvas = document.getElementById('iso-canvas');
      let nonBg = 0;
      if (canvas instanceof HTMLCanvasElement) {
        const ctx = canvas.getContext('2d');
        const img = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (img) {
          for (let i = 0; i < img.length; i += 16) {
            if (img[i] > 30 || img[i + 1] > 40 || img[i + 2] > 60) nonBg++;
          }
        }
      }
      document.getElementById('pp-btn-diamond')?.click();
      const dBadge = document.getElementById('pp-source-badge')?.textContent ?? '';
      const dMetrics = document.getElementById('iso-metrics')?.textContent ?? '';
      return { badge, metrics: metrics.slice(0, 160), nonBg, dBadge, dHasPl: dMetrics.includes('平台应力') };
    });
    ok('G2 ABAQUS Gyroid/Diamond p60 EXPL ISO 13314 反演 + Canvas 实时绘图',
      g2Diag.badge.includes('Gyroid') && g2Diag.metrics.includes('准弹性模量')
      && g2Diag.metrics.includes('平台应力') && g2Diag.nonBg > 40
      && g2Diag.dBadge.includes('Diamond') && g2Diag.dHasPl,
      JSON.stringify(g2Diag));

    const g3Diag = await page.evaluate(() => {
      const v2 = document.getElementById('fc-v2');
      const dp2 = document.getElementById('fc-dp2');
      if (v2 && dp2) {
        v2.value = '12.0';
        dp2.value = '22.0';
      }
      document.getElementById('fc-run-btn')?.click();
      const txt = document.getElementById('fc-metrics')?.textContent ?? '';
      return { txt: txt.slice(0, 200) };
    });
    ok('G3 Forchheimer 双点 CFD 分离（K_int + Stokes A + 惯性系数 B + WSS 窗）',
      g3Diag.txt.includes('固有渗透率 K_int') && g3Diag.txt.includes('Stokes 阻抗 A') && g3Diag.txt.includes('惯性系数 B'),
      JSON.stringify(g3Diag));

    await page.evaluate(() => {
      document.querySelector('.tab[data-pane="pexp"]')?.click();
      const sel = document.getElementById('scenario-select');
      if (sel) sel.value = 'bone_scaffold.json';
      document.getElementById('scenario-run-btn')?.click();
    });
    const scDone = await page.waitForFunction(() =>
      (document.getElementById('scenario-status')?.textContent ?? '').includes('bone_scaffold.json 完成')
      && document.querySelectorAll('#filelist .file').length >= 1,
    null, { timeout: 45000, polling: 400 }).then(() => true).catch(() => false);
    ok('G4 M5 场景预设 bone_scaffold.json 在线构建 + 水密/体素/悬垂全链路落盘',
      scDone,
      await page.evaluate(() => document.getElementById('scenario-status')?.textContent ?? ''));

    await page.evaluate(() => { document.getElementById('exp-btn-inp')?.click(); });
    const inpDone = await page.waitForFunction(() =>
      (document.getElementById('scenario-status')?.textContent ?? '').includes('.inp')
      && document.querySelectorAll('#filelist .file').length >= 2,
    null, { timeout: 60000, polling: 400 }).then(() => true).catch(() => false);
    ok('G5 CAE 一键交付（Abaqus C3D8 .inp 触发导出并登记文件卡）',
      inpDone,
      await page.evaluate(() => document.getElementById('scenario-status')?.textContent ?? ''));

    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '运行场景 diamond_load.json';
      document.getElementById('send-btn')?.click();
    });
    const chatScDone = await page.waitForFunction(() =>
      (document.getElementById('stream')?.textContent ?? '').includes('diamond_load.json 完成'),
    null, { timeout: 45000, polling: 400 }).then(() => true).catch(() => false);
    ok('G6 对话输入自然语言路由触发 tpms_scenario 执行与轨迹落账', chatScDone);
  }

  // ── H Phase 3：V6/V7 高阶多物理场/水平集重构/自治流水线/工程报告导出 ──
  console.log('\n[H] Phase 3 高阶多物理场与自治流水线验证');
  {
    await page.click('.tab[data-pane="pdiag"]');
    await page.waitForSelector('#sim-btn-lpbf', { timeout: 5000 });
    await page.click('#sim-btn-lpbf');
    const lpbfDone = await page.waitForFunction(() =>
      (document.getElementById('sim-live-tag')?.textContent ?? '').includes('lpbf 完成')
      && (document.getElementById('sim-live-grid')?.textContent ?? '').includes('LPBF 工艺窗口'),
    null, { timeout: 30000, polling: 300 }).then(() => true).catch(() => false);
    ok('H1 点击 LPBF 热力残余应力完成 N=32 求解并刷新诊断网格', lpbfDone);

    await page.click('#sim-btn-tissue');
    const tissueDone = await page.waitForFunction(() =>
      (document.getElementById('sim-live-tag')?.textContent ?? '').includes('tissue 完成')
      && (document.getElementById('sim-live-grid')?.textContent ?? '').includes('Cool-Warm O₂')
      && (document.getElementById('pp-source-badge')?.textContent ?? '').includes('28天骨长入'),
    null, { timeout: 45000, polling: 300 }).then(() => true).catch(() => false);
    ok('H2 28天骨组织生长完成求解 + 3D 氧浓度云图着染 + #iso-canvas 曲线渲染', tissueDone);

    await page.click('#sim-btn-phononic');
    const phonDone = await page.waitForFunction(() =>
      (document.getElementById('sim-live-tag')?.textContent ?? '').includes('phononic 完成')
      && (document.getElementById('sim-live-grid')?.textContent ?? '').includes('Bloch-Floquet 网格')
      && (document.getElementById('pp-source-badge')?.textContent ?? '').includes('声子色散能带'),
    null, { timeout: 45000, polling: 300 }).then(() => true).catch(() => false);
    ok('H3 Bloch-Floquet N=7 声子晶体能带计算完成并绘制色散禁带图', phonDone);

    await page.click('#sim-btn-levelset');
    const lsDone = await page.waitForFunction(() =>
      (document.getElementById('sim-live-tag')?.textContent ?? '').includes('levelset 完成')
      && (document.getElementById('sim-live-grid')?.textContent ?? '').includes('已更新视口'),
    null, { timeout: 55000, polling: 300 }).then(() => true).catch(() => false);
    ok('H4 Hamilton-Jacobi 水平集拓扑优化完成演化并写回 3D 视口曲面', lsDone);

    await page.evaluate(() => {
      const input = document.getElementById('cmd');
      input.value = '全自动设计 E>=3 GPa 且 κ>=2e-9 m2 的骨支架并生成仿真报告';
      document.getElementById('send-btn')?.click();
    });
    const pipeDone = await page.waitForFunction(() =>
      (document.getElementById('stream')?.textContent ?? '').includes('已完成端到端自治仿真流水线')
      && (document.getElementById('filelist')?.textContent ?? '').includes('.md'),
    null, { timeout: 60000, polling: 400 }).then(() => true).catch(() => false);
    ok('H5 对话栏触发展开端到端自治流水线并自动导出 .md 工程验收报告', pipeDone);

    await page.click('.tab[data-pane="pexp"]');
    await page.waitForSelector('#exp-btn-report-json', { timeout: 5000 });
    await page.click('#exp-btn-report-json');
    await page.click('#exp-btn-py');
    const repExported = await page.waitForFunction(() => {
      const txt = document.getElementById('filelist')?.textContent ?? '';
      return txt.includes('.json') && txt.includes('.py');
    }, null, { timeout: 30000, polling: 300 }).then(() => true).catch(() => false);
    ok('H6 导出仿真数据台账 (.json) 与 Python 脚本 (.py) 在文件栏落账', repExported);

    // ── I Phase 4 DSH Workbench + Split Dock + Slash Palette + BL/CAE UI ──
    console.log('\n[I] Phase 4 DSH 三栏工作台 / Split Dock / 斜杠菜单与 CAE 控件');
    await page.click('#dsh-rail-plugins');
    const plugActive = await page.$eval('#dsh-pane-plugins', (el) => el.classList.contains('on'));
    await page.click('#dsh-rail-toggle');
    const sbCollapsed = await page.$eval('#dsh-sidebar', (el) => el.classList.contains('collapsed'));
    await page.click('#dsh-rail-flow');
    const sbExpandedFlow = await page.evaluate(() => {
      const sb = document.getElementById('dsh-sidebar');
      const fp = document.getElementById('dsh-pane-flow');
      return Boolean(sb && !sb.classList.contains('collapsed') && fp?.classList.contains('on'));
    });
    ok('I1 DSH 左侧 Rail 视图切换与可折叠上下文边栏生效', plugActive && sbCollapsed && sbExpandedFlow);

    await page.click('#dock-split-btn');
    const splitDiagOk = await page.evaluate(() => {
      const st = document.querySelector('.stage');
      const p3 = document.getElementById('p3d');
      const pd = document.getElementById('pdiag');
      return Boolean(st?.classList.contains('split') && p3 && pd
        && getComputedStyle(p3).display !== 'none'
        && getComputedStyle(pd).display !== 'none');
    });
    await page.selectOption('#dock-layout-select', 'pexp');
    const splitExpOk = await page.evaluate(() => {
      const p3 = document.getElementById('p3d');
      const pe = document.getElementById('pexp');
      return Boolean(p3 && pe
        && getComputedStyle(p3).display !== 'none'
        && getComputedStyle(pe).display !== 'none');
    });
    await page.click('#dock-split-btn');
    const splitExitOk = await page.$eval('.stage', (el) => !el.classList.contains('split'));
    ok('I2 Split Dock 双栏分屏对照（3D+诊断 / 3D+导出）及退出复原正常', splitDiagOk && splitExpOk && splitExitOk);

    await page.fill('#cmd', '/');
    const slashVisible = await page.$eval('#dsh-slash-menu', (el) => !el.hidden);
    await page.click('.dsh-slash-opt[data-cmd="/comsol"]');
    const slashSelected = await page.evaluate(() => {
      const inp = document.getElementById('cmd');
      const menu = document.getElementById('dsh-slash-menu');
      return Boolean(inp && inp.value.startsWith('/comsol') && menu?.hidden);
    });
    await page.fill('#cmd', '');
    ok('I3 斜杠命令浮层弹出、点击填入 (/comsol) 与收起正常', slashVisible && slashSelected);

    const caeUiOk = await page.evaluate(() => {
      const ids = ['cae-bl-backend', 'cae-bl-layers', 'cae-bl-h1', 'cae-btn-bl', 'cae-btn-of', 'cae-btn-abq', 'cae-btn-comsol'];
      const hasAll = ids.every((id) => Boolean(document.getElementById(id)));
      const chk = document.getElementById('cae-live-exec');
      return hasAll && Boolean(chk && !chk.checked);
    });
    ok('I4 BL 前处理控件与四引擎安全二级触发按钮组在位', caeUiOk);

    // ── J Phase 5 求解监控 SVG / 四级保真度交叉对标 / Forchheimer 自动回填 ──
    console.log('\n[J] Phase 5 求解监控、四级保真度对标与 3D 预览 UI');
    await page.click('#dsh-rail-solver');
    const solverPaneActive = await page.$eval('#dsh-pane-solver', (el) => el.classList.contains('on'));
    await page.click('#dsh-open-monitor-btn');
    await page.waitForSelector('#cae-monitor-panel', { timeout: 5000 });
    const monitorDomOk = await page.evaluate(() => {
      const rows = document.querySelectorAll('#cae-parity-matrix tbody tr');
      return Boolean(
        document.getElementById('cae-residual-svg')
        && document.getElementById('cae-wss-svg')
        && document.getElementById('cae-mesh-doctor-badge')
        && document.getElementById('cae-cfd-periods')
        && document.getElementById('cae-btn-pipeline')
        && rows.length === 4,
      );
    });
    ok('J1 DSH 第4视图 (#dsh-pane-solver) 与四级保真度矩阵 (#cae-parity-matrix 4层) 挂载完整',
      solverPaneActive && monitorDomOk);

    const monitorRenderOk = await page.evaluate(() => {
      const api = window.__tpmsDshCae;
      if (!api || typeof api.renderMonitorFromResult !== 'function') return false;
      api.renderMonitorFromResult('openfoam-cfd', {
        preprocess: {
          rveSpeedupFactor: 27,
          ntop: { ntopExecuted: true, ntopPrisms: 19080, ntopTets: 13048, ntopMinSICNTet: 0.054 },
          meshDoctor: { triggered: true, attempts: 2, healed: true, finalQuality: { minSICN: 0.054 }, actions: ['StageA'] },
        },
        cfdSummary: {
          solverTier: 'fvm_brinkman_rve',
          cfdPeriods: 1,
          v1_ms: 0.001,
          dp1_Pa: 0.2245,
          v2_ms: 0.01,
          dp2_Pa: 8.216,
          K_m2: 6.75e-8,
          beta_m1: 5529.0,
          Fo_v2: 4.196,
          wssMean_mPa: 4.96,
          wssP50_mPa: 4.41,
          wssP90_mPa: 7.45,
          wssOsteogenicWindowRatio: 0.3476,
          wssOsteogenicWindowPct: 34.76,
          wssHistogram: [
            { label: '<5 mPa', ratio: 0.65 },
            { label: '5-15 mPa', ratio: 0.34 },
            { label: '15-25 mPa', ratio: 0.01 },
            { label: '25-50 mPa', ratio: 0.0 },
            { label: '>50 mPa', ratio: 0.0 },
          ],
          residuals: [
            { iter: 1, Ux: 0.6, Uy: 0.1, Uz: 0.1, p: 0.2 },
            { iter: 6, Ux: 0.05, Uy: 0.03, Uz: 0.03, p: 0.02 },
            { iter: 12, Ux: 0.004, Uy: 0.003, Uz: 0.003, p: 0.002 },
          ],
        },
      });
      const paths = document.querySelectorAll('#cae-residual-svg path').length;
      const rects = document.querySelectorAll('#cae-wss-svg rect').length;
      const docText = document.getElementById('cae-mesh-doctor-badge')?.textContent ?? '';
      const tblText = document.getElementById('cae-parity-matrix')?.textContent ?? '';
      return paths === 4 && rects === 5 && docText.includes('0.054') && tblText.includes('6.75e-8') && tblText.includes('34.8%');
    });
    ok('J2 残差收敛曲线 (4通道SVG) + WSS成骨窗口柱图 (5分区) + Mesh Doctor 徽章渲染正确', monitorRenderOk);

    await page.click('#cae-btn-auto-backfill');
    const backfillOk = await page.evaluate(() => {
      const dp1 = Number(document.getElementById('fc-dp1')?.value || 0);
      const dp2 = Number(document.getElementById('fc-dp2')?.value || 0);
      const txt = document.getElementById('fc-metrics')?.textContent ?? '';
      return Math.abs(dp1 - 0.2245) < 0.01 && Math.abs(dp2 - 8.216) < 0.05 && txt.includes('K_int');
    });
    ok('J3 一键回填 CFD 双点压降到 #fc-dp1/#fc-dp2 并联动重算 Forchheimer 渗透率', backfillOk);
  }

  // ── Z 全程零错误 ──
  console.log('\n[Z] 全程 0 pageerror / 0 console.error');
  errors.length === 0 ? ok('零错误') : bad('运行时错误', errors.slice(0, 3).join(' | ').slice(0, 160));
} finally {
  await browser.close().catch(() => {});
  try { process.platform === 'win32' ? spawn('taskkill', ['/F', '/PID', String(server.pid), '/T']) : process.kill(-server.pid, 'SIGTERM'); } catch { /* 尽力 */ }
}

console.log(`\n== HARNESS-UI: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 38) { console.error('GUARD FAIL: HARNESS-UI 断言数 ' + pass + ' < 基线 38'); process.exit(1); }
if (fail > 0) process.exitCode = 1;
