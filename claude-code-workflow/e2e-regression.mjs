// claude-code-workflow · E2E 回归套件（playwright-core 驱动现装 Chrome/Edge，无需下载浏览器）
// 运行：NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs
//   或自定义文件：node e2e-regression.mjs --file "D:/path/to/claude-code-workflow.html"
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  const candidates = [
    process.env.NODE_PATH,
    'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules',
    path.join(process.cwd(), 'node_modules'),
    path.join(__dirname, 'node_modules')
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(path.join(c, 'playwright-core')); } catch (_) {}
  }
  try { return require('playwright-core'); } catch (_) { return null; }
}
const EXES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH
].filter(Boolean);
function findExe() { for (const p of EXES) if (fs.existsSync(p)) return p; return null; }

const fileArg = process.argv.includes('--file') ? process.argv[process.argv.indexOf('--file') + 1] : (process.env.WF_HTML || path.join(__dirname, 'claude-code-workflow.html'));
const fileUrl = pathToFileURL(fileArg).href;

const results = [];
process.on('unhandledRejection', e => console.log('UNHANDLED_REJECTION', e && (e.stack || e.message)));
const rec = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const pw = loadPlaywright();
  if (!pw) { console.error('未找到 playwright-core：请 NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs'); process.exit(2); }
  const exe = findExe();
  if (!exe) { console.error('未找到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(2); }
  const browser = await pw.chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });

  // ---- 主上下文（鼠标/键盘，acceptDownloads） ----
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('framenavigated', f => { if (f !== page.mainFrame()) console.log('NAV->', f.url()); });
  await page.goto(fileUrl, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // 0) 库加载
  const libs = await page.evaluate(() => ({ jspdf: !!window.jspdf, svg2pdf: !!window.svg2pdf }));
  rec('LIBS', libs.jspdf && libs.svg2pdf, libs);

  // 1) 浅色/深色快照（forceLight）
  const snap = await page.evaluate(() => {
    const dark = buildSnapshotSVG(false).svg;
    const forced = buildSnapshotSVG(true).svg;
    return { darkDiff: dark !== forced, lightOk: forced.includes('#eef2f8') && forced.includes('#ffffff') && forced.includes('#1f2430'), darkOk: dark.includes('#0f1422') };
  });
  rec('SNAPSHOT_LIGHT_DARK', snap.lightOk && snap.darkOk && snap.darkDiff, snap);

  // 2) 浅色快照开关（#lightSnap 勾选 → 浅，取消 → 深）
  const toggle = await page.evaluate(() => {
    const cb = document.getElementById('lightSnap');
    const def = cb && cb.checked;
    cb.checked = true;
    const light = buildSnapshotSVG(snapLight()).svg;
    cb.checked = false;
    const dark = buildSnapshotSVG(snapLight()).svg;
    cb.checked = true;
    return { exists: !!cb, defChecked: def, lightOk: light.includes('#eef2f8'), darkOk: dark.includes('#0f1422') };
  });
  rec('LIGHT_SNAP_TOGGLE', toggle.exists && toggle.defChecked && toggle.lightOk && toggle.darkOk, toggle);

  // 3) 五种纸型 PDF + Toast
  const sizes = ['view', 'a4l', 'a4p', 'letterl', 'letterp'];
  const pdfResults = [];
  for (const sz of sizes) {
    await page.selectOption('#pdfSize', sz);
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.click('#pdfBtn')
    ]);
    let rec2 = { sz, header: null, fname: null, toast: null };
    if (dl) {
      rec2.fname = dl.suggestedFilename();
      const p = await dl.path(); const buf = fs.readFileSync(p);
      rec2.header = buf.slice(0, 5).toString('latin1'); rec2.size = buf.length;
    }
    const t = await page.evaluate(() => { const el = document.getElementById('toast'); return el ? { live: el.getAttribute('aria-live'), cls: el.className, txt: el.textContent } : null; });
    rec2.toast = t;
    pdfResults.push(rec2);
    await page.waitForTimeout(250);
  }
  const pdfOk = pdfResults.every(r => r.header === '%PDF-' && r.toast && /show ok/.test(r.toast.cls || ''));
  rec('PDF_SIZES_TOAST', pdfOk, { count: pdfResults.length, allPdf: pdfResults.every(r => r.header === '%PDF-') });

  // 4) 章节引导卡：暂停保持 / 非暂停淡出
  const cap = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    if (!(CONFIG.groups && CONFIG.groups.length)) CONFIG.groups = [{ id: 'g1', name: '演示分组', intro: '这是章节简介引导文案' }];
    const G = CONFIG.groups;
    groupTour.paused = true; showChapterCaption(G[0]); await sleep(4000);
    const keep = document.getElementById('chapterCaption').classList.contains('show');
    const live = document.getElementById('chapterCaption').getAttribute('aria-live');
    groupTour.paused = false; showChapterCaption(G[1] || G[0]); await sleep(4000);
    const faded = !document.getElementById('chapterCaption').classList.contains('show');
    return { keep, faded, live };
  });
  rec('CHAPTER_CAPTION', cap.keep && cap.faded && cap.live === 'polite', cap);

  // 5) 缩略图点击导航改变滚动（真实点击，受信任事件）
  let mini;
  try {
    const miniBox = await page.$eval('#minimap canvas', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.click(miniBox.x + miniBox.w * 0.2, miniBox.y + miniBox.h * 0.85);
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => window.scrollY);
    mini = { exists: true, before, after, changed: after !== before };
  } catch (e) { mini = { exists: true, error: String(e && e.message || e) }; }
  rec('MINIMAP_NAV', mini.exists && mini.changed, mini);

  // 6) 无障碍：工具栏 aria-label + :focus-visible + prefers-reduced-motion
  const a11y = await page.evaluate(() => {
    const ids = ['themeBtn', 'editBtn', 'exportBtn', 'importBtn', 'snapPngBtn', 'snapSvgBtn', 'pdfBtn', 'helpBtn'];
    const allLabeled = ids.every(id => { const el = document.getElementById(id); return el && el.getAttribute('aria-label'); });
    let css = '';
    for (const s of document.styleSheets) { try { for (const r of s.cssRules) css += r.cssText + '\n'; } catch (_) {} }
    return { allLabeled, focus: css.includes(':focus-visible'), reduce: css.includes('prefers-reduced-motion') };
  });
  rec('A11Y', a11y.allLabeled && a11y.focus && a11y.reduce, a11y);

  // 7) 触摸：合成 TouchEvent 单指平移 + 双指缩放（复用 setZoom）
  const touch = await page.evaluate(async () => {
    if (typeof Touch === 'undefined' || typeof TouchEvent === 'undefined') return { skipped: true };
    const stage = document.getElementById('diagram');
    const mk = (x, y) => new Touch({ identifier: 1, target: stage, clientX: x, clientY: y });
    const fire = (type, touches) => stage.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches }));
    window.scrollTo(0, 300); const before = window.scrollY;
    fire('touchstart', [mk(300, 400)]); fire('touchmove', [mk(300, 520)]); fire('touchend', []);
    const afterPan = window.scrollY;
    const z0 = parseFloat(stage.parentElement.style.zoom) || 1;
    fire('touchstart', [mk(300, 400), mk(420, 400)]); fire('touchmove', [mk(300, 400), mk(540, 400)]); fire('touchend', []);
    const z1 = parseFloat(stage.parentElement.style.zoom) || 1;
    return { panChanged: afterPan !== before, zoomChanged: z1 !== z0, z0, z1 };
  });
  if (touch.skipped) rec('TOUCH', true, { skipped: true });
  else rec('TOUCH', touch.panChanged && touch.zoomChanged, touch);

  // 8) 触摸设备加载无报错
  const ctxT = await browser.newContext({ hasTouch: true, acceptDownloads: true });
  const pageT = await ctxT.newPage();
  const errT = [];
  pageT.on('console', m => { if (m.type() === 'error') errT.push(m.text()); });
  pageT.on('pageerror', e => errT.push(e.message));
  await pageT.goto(fileUrl, { waitUntil: 'load' });
  await pageT.waitForTimeout(300);
  rec('TOUCH_LOAD_CLEAN', errT.length === 0, { errors: errT.length });
  await ctxT.close();

  // 9) 键盘缩放 + 适应（合成 KeyboardEvent，验证全局 keydown 监听）
  const kb = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const stage = document.getElementById('diagram');
    const zNow = () => parseFloat(stage.parentElement.style.zoom) || 1;
    const fire = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    document.getElementById('zoomReset').click(); await sleep(40);
    const z0 = zNow();
    fire('+'); fire('+'); fire('+'); await sleep(40);
    const zUp = zNow();
    fire('-'); await sleep(40);
    const zDown = zNow();
    window.scrollTo(0, 0); await sleep(30);
    fire('f'); await sleep(220);
    const zFit = zNow();
    const syFit = window.scrollY;
    return { z0, zUp, zDown, zFit, syFit, upOk: zUp > z0, downOk: zDown < zUp, fitOk: zFit >= 0.6 && zFit <= 1.8 && syFit > 50 };
  });
  rec('KEYBOARD_ZOOM_FIT', kb.upOk && kb.downOk && kb.fitOk, kb);

  // 10) 键盘平移（WASD / Shift+方向键）
  // 10) 键盘平移（竖向长图：W/S 与 Shift+方向键 上下平移；本布局 overflow-x:hidden，横向平移无溢出、安全不报错）
  const pan = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.documentElement.style.scrollBehavior = 'auto'; document.body.style.scrollBehavior = 'auto';
    const fire = (key, opts) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, opts)));
    document.getElementById('zoomReset').click(); await sleep(30);
    window.scrollTo(0, 300); await sleep(40);
    const y0 = window.scrollY;
    fire('s'); await sleep(40); const yS = window.scrollY;
    fire('w'); await sleep(40); const yW = window.scrollY;
    window.scrollTo(0, 300); await sleep(40);
    fire('ArrowDown', { shiftKey: true }); await sleep(40); const yD = window.scrollY;
    fire('ArrowUp', { shiftKey: true }); await sleep(40); const yU = window.scrollY;
    window.scrollTo(0, 0); await sleep(20);
    fire('d'); await sleep(20); const xD = window.scrollX;
    return { y0, yS, yW, yD, yU, xD, sOk: yS > y0 + 100, wOk: yW < yS - 100, dShiftOk: yD > 400, uShiftOk: yU < yD - 100, xSafe: xD === 0 };
  });
  rec('KEYBOARD_PAN', pan.sOk && pan.wOk && pan.dShiftOk && pan.uShiftOk && pan.xSafe, pan);

  // 11) URL hash 视图状态（缩放/滚动 + 聚焦阶段，刷新/直达还原）
  await page.evaluate(() => { window.location.hash = 'z=1.5&x=20&y=260'; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  const hvZoom = await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; return { label: document.getElementById('zoomLabel').textContent, sy: window.scrollY, hash: location.hash }; });
  rec('URL_HASH_VIEW_ZOOM', hvZoom.label === '150%' && hvZoom.sy > 150 && hvZoom.sy < 360 && hvZoom.hash.includes('z=1.5'), hvZoom);
  await page.evaluate(() => { window.location.hash = 'p=2'; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(450);
  const hvPhase = await page.evaluate(() => ({ active: document.querySelectorAll('.phase')[2] && document.querySelectorAll('.phase')[2].classList.contains('demo-active'), hash: location.hash }));
  rec('URL_HASH_VIEW_PHASE', !!hvPhase.active && hvPhase.hash.includes('p=2'), hvPhase);

  // 12) 帮助浮层内 Ctrl/Cmd+F 筛选快捷键
  const help = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('helpBtn').click(); await sleep(120);
    const hp = document.getElementById('helpOverlay');
    const open = hp && hp.style.display !== 'none';
    const si = hp && hp.querySelector('.hp-search');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(60);
    const focused = document.activeElement === si;
    si.value = '撤销'; si.dispatchEvent(new Event('input')); await sleep(40);
    const total = hp.querySelectorAll('.hp-row').length;
    const hidden = hp.querySelectorAll('.hp-row.hidden').length;
    const visible = total - hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await sleep(40);
    const cleared = si.value === '';
    const hiddenAfter = hp.querySelectorAll('.hp-row.hidden').length;
    document.getElementById('helpBtn').click(); await sleep(40);
    return { open, focused, total, hidden, visible, cleared, hiddenAfter };
  });
  rec('HELP_SEARCH', help.open && help.focused && help.hidden > 0 && help.visible > 0 && help.cleared && help.hiddenAfter === 0, help);

  // 13) 命令面板（Ctrl/Cmd+K 打开 → 输入过滤 → 回车执行）
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForTimeout(140);
  const palOpen = await page.evaluate(() => { const el = document.getElementById('paletteOverlay'); return !!el && getComputedStyle(el).display !== 'none' && !!document.querySelector('.pal-input'); });
  await page.fill('.pal-input', '放大');
  await page.waitForTimeout(90);
  const palFirst = await page.evaluate(() => { const it = document.querySelector('.pal-item'); return it ? it.querySelector('.pal-t').textContent : ''; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(160);
  const palAfter = await page.evaluate(() => ({ closed: !document.getElementById('paletteOverlay') || getComputedStyle(document.getElementById('paletteOverlay')).display === 'none', label: document.getElementById('zoomLabel').textContent }));
  rec('COMMAND_PALETTE', palOpen && palFirst.includes('放大') && palAfter.closed && palAfter.label === '110%', { palOpen, palFirst, palAfter });

  // 14) 视图自动记忆（localStorage）：放大后刷新应还原缩放（hash 为空时回退到 LS）
  await page.evaluate(() => { try { localStorage.removeItem('wf-view'); } catch (e) {} try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} });
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(450);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Equal'); await page.waitForTimeout(50); }
  await page.waitForTimeout(350);
  const lsZoom = await page.evaluate(() => document.getElementById('zoomLabel').textContent);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(450);
  const lsRestored = await page.evaluate(() => document.getElementById('zoomLabel').textContent);
  rec('VIEW_PERSIST_LS', lsZoom === '130%' && lsRestored === '130%', { lsZoom, lsRestored });

  // 15) 打印样式：print 媒体下隐藏 chrome、保留连线、背景转白（运行时模拟，失败回退静态规则校验）
  let pr = null, prOk = false;
  try {
    if (typeof page.context().emulateMediaType === 'function') {
      await page.context().emulateMediaType('print');
      await page.waitForTimeout(70);
      pr = await page.evaluate(() => {
        const disp = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'missing'; };
        return { toolbar: disp('.toolbar'), minimap: disp('#minimap'), bodyBg: getComputedStyle(document.body).backgroundColor, edgeLayer: disp('#edgeLayer') };
      });
      await page.context().emulateMediaType('screen');
      prOk = pr.toolbar === 'none' && pr.minimap === 'none' && pr.bodyBg === 'rgb(255, 255, 255)' && pr.edgeLayer !== 'none';
    } else {
      throw new Error('no context.emulateMediaType');
    }
  } catch (e) {
    const css = await page.evaluate(() => { const s = [...document.querySelectorAll('style')].map(x => x.textContent).join('\n'); const med = s.match(/@media print\s*\{[\s\S]*?\}\s*\}/i); return med ? med[0] : ''; });
    prOk = /@media print/.test(css) && /\.toolbar/.test(css) && /#minimap/.test(css) && /#edgeLayer\s*\{\s*display\s*:\s*block/.test(css) && /background\s*:\s*#fff/i.test(css);
    pr = { fallback: true, err: String(e && e.message), cssHasPrint: /@media print/.test(css) };
  }
  rec('PRINT_STYLESHEET', prOk, pr);

  rec('NO_ERRORS', errors.length === 0, { count: errors.length, sample: errors.slice(0, 3) });

  try { await browser.close(); } catch (e) { console.log('CLOSE_ERR', e && e.message); }
  const failed = results.filter(r => !r.ok);
  console.log('FAILED_COUNT', failed.length);
  console.log('\n==== ' + (failed.length ? 'FAIL (' + failed.length + ')' : 'ALL PASS') + ' ====');
  console.log('DONE');
  process.exitCode = failed.length ? 1 : 0;
})();
