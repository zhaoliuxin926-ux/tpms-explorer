/**
 * card_smoke_check.mjs —— 深水功能卡默认配置冒烟（声子同款 bug 类的永久拦截）
 *
 * 背景：2026-09-20 走查实证——声子卡 N=6×k=3 采样简并在默认配置 100% 失败、压溃卡
 * σy/E 单位错（8.0 vs 0.008）+ 孤岛 K 奇异在默认配置 100% 失败，而 44 门全绿：门禁
 * 盖物理模块（合成掩码），UI 卡默认配置接线无人走过。本门=「每张卡默认配置点一次，
 * 断言结果区出正确数据或既有失败语义，不出新错误类」。
 *
 * A 声子能带（N=7 简并修复哨兵：默认 k=3 必须出读数不报「固相质点过少」）
 * B RVE 均质化（E(n) 读数+画布）
 * C 组织长入（28 天读数链）
 * D LPBF（熔池/残余应力读数）
 * E 屈服面（安全系数+包络半径带）
 * N yield-viewer 静态哨兵（create/dispose 幂等 + RAF/renderer 释放）
 * F 逆向 solve+apply（三族解+标题/徽标同步——updateBadges 修复哨兵）
 * G 压溃 wiring（σy/E=0.0080 单位哨兵+无 'undefined'+无孤岛求解失败+指引文案）
 * H 参数扫描（9 帧完成+孔隙率还原）
 * I 水平集（演化读数含柔度——主线程同步较重，宽超时）
 * J 结构开关三连（应力引导/分形统计/混合选项——网格规模差分+还原）
 * O 调色预设 engine/teach（切换+localStorage+active）
 * Z 全程 0 pageerror / 0 console.error
 *
 * 运行：node card_smoke_check.mjs（自起 4824 静态服务，服务 docs/platform 部署产物）
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.resolve(HERE, '../..');

const PORT = 4824;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(PLATFORM_DIR, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('  ✓ ' + n); };
const bad = (n, d = '') => { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); };
const errors = [];

const browser = await chromium.launch({ channel: 'chrome', executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('stat-tris')?.textContent?.includes('k'), null, { timeout: 120000, polling: 2000 }).catch(() => {});
  await page.evaluate(() => { const ob = document.getElementById('ob-card'); if (ob?.classList.contains('show')) document.getElementById('ob-skip')?.click(); });
  const readNote = (id) => page.evaluate((i) => (document.getElementById(i)?.textContent || '').replace(/\s+/g, ' ').trim(), id);
  const clickBtn = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);

  // L undo/redo（初始默认态最干净——置于 A 前防后续状态污染；toast 元素 id=toast，1.5s TTL 内抓拍）
  {
    const ur = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const ps = [...document.querySelectorAll('input[type=range]')].find(s => s.closest('.field') && /孔隙率/.test(s.closest('.field').textContent));
      const key = (k, opts) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
      const out = {};
      out.before = ps.value;
      ps.value = '80';
      ps.dispatchEvent(new Event('input', { bubbles: true }));
      ps.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1200);
      out.afterChange = ps.value;
      key('z', { ctrlKey: true });
      await sleep(350);
      out.undoToast = document.getElementById('toast')?.textContent || '';
      await sleep(1300);
      out.afterUndo = ps.value;
      key('z', { ctrlKey: true, shiftKey: true });
      await sleep(350);
      out.redoToast = document.getElementById('toast')?.textContent || '';
      await sleep(1300);
      out.afterRedo = ps.value;
      key('z', { ctrlKey: true });
      await sleep(1500);
      out.afterFinalUndo = ps.value;
      return out;
    });
    ur.afterChange === '80' && /已撤销/.test(ur.undoToast) && ur.afterUndo === ur.before
      && /已重做/.test(ur.redoToast) && ur.afterRedo === '80' && ur.afterFinalUndo === ur.before
      ? ok('L undo/redo toast+滑块同步+空栈鲁棒（' + ur.before + '→80→' + ur.afterUndo + '→80→' + ur.afterFinalUndo + '）')
      : bad('L undo/redo', JSON.stringify(ur));
  }

  // A 声子能带（默认 k=3——N=7 简并修复哨兵）
  await clickBtn('btn-phonon');
  await page.waitForFunction(() => {
    const t = document.getElementById('phonon-result')?.textContent || '';
    return t.length > 10 && !/计算中/.test(t);
  }, null, { timeout: 90000, polling: 1500 }).catch(() => {});
  const phNote = await readNote('phonon-result');
  (/零模态/.test(phNote) && !/固相质点过少/.test(phNote))
    ? ok('A 声子能带默认配置出读数（N=7 简并修复在位）')
    : bad('A 声子能带', phNote.slice(0, 80));

  // B RVE
  await clickBtn('btn-rve');
  await page.waitForFunction(() => /E\(x\/y\/z\)/.test(document.getElementById('rve-readout')?.textContent || ''), null, { timeout: 30000, polling: 800 }).catch(() => {});
  const rveNote = await readNote('rve-readout');
  (/E\(x\/y\/z\) = [\d.]+/.test(rveNote) && await page.evaluate(() => document.getElementById('rve-canvas').style.display !== 'none'))
    ? ok('B RVE 均质化 E(n) 读数+画布')
    : bad('B RVE', rveNote.slice(0, 80));

  // C 组织长入
  await clickBtn('btn-tissue');
  await page.waitForFunction(() => /第 28 天/.test(document.getElementById('tissue-result')?.textContent || ''), null, { timeout: 30000, polling: 800 }).catch(() => {});
  const tgNote = await readNote('tissue-result');
  (/第 28 天.*存活率 [\d.]+%/.test(tgNote))
    ? ok('C 组织长入 28 天读数链')
    : bad('C 组织长入', tgNote.slice(0, 80));

  // D LPBF
  await clickBtn('btn-lpbf');
  await page.waitForFunction(() => /σ_res|熔池/.test([...document.querySelectorAll('[id*=lpbf]')].map(e => e.textContent).join('')), null, { timeout: 30000, polling: 800 }).catch(() => {});
  const lpbfTxt = await page.evaluate(() => [...document.querySelectorAll('[id*=lpbf]')].map(e => (e.textContent || '').trim()).filter(Boolean).join(' '));
  (/峰值.*熔池.*σ_res/.test(lpbfTxt.replace(/\s+/g, ' ')))
    ? ok('D LPBF 熔池+残余应力读数')
    : bad('D LPBF', lpbfTxt.slice(0, 80));

  // E 屈服面
  await clickBtn('btn-yield');
  await page.waitForFunction(() => /安全系数/.test(document.getElementById('yield-result')?.textContent || ''), null, { timeout: 30000, polling: 800 }).catch(() => {});
  const yNote = await readNote('yield-result');
  (/安全系数 SF=[\d.]+/.test(yNote) && /包络半径带/.test(yNote))
    ? ok('E 屈服面包络+安全系数')
    : bad('E 屈服面', yNote.slice(0, 80));

  // G 压溃 wiring（默认配置同步求解——单位+孤岛+文案三哨兵；swiftshader 慢给宽超时）
  await clickBtn('btn-plasticity');
  await page.waitForFunction(() => /数字孪生压溃 R=/.test(document.getElementById('plas-result')?.textContent || ''), null, { timeout: 240000, polling: 2000 }).catch(() => {});
  const plasNote = await readNote('plas-result');
  (/σy\/E=0\.0080/.test(plasNote) && !/undefined/.test(plasNote) && !/求解失败：弹塑性求解：固相含/.test(plasNote) && /数字孪生压溃 R=8/.test(plasNote))
    ? ok('G 压溃 σy/E 单位哨兵 0.0080+无孤岛求解失败+无 undefined')
    : bad('G 压溃', plasNote.slice(0, 120));

  // H 参数扫描（9 帧+还原到扫描前状态；F 已 apply 反演解，断言须状态相对而非写死默认值）
  const poroBefore = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('input[type=range]')].find(s => s.closest('.field') && /孔隙率/.test(s.closest('.field').textContent));
    return ps?.value;
  });
  await clickBtn('btn-sweep');
  await page.waitForFunction(() => /已完成/.test(document.getElementById('sweep-status')?.textContent || '') || !document.querySelector('.sweep-card'), null, { timeout: 300000, polling: 3000 }).catch(() => {});
  const sweepDone = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('input[type=range]')].find(s => s.closest('.field') && /孔隙率/.test(s.closest('.field').textContent));
    return { status: document.getElementById('sweep-status')?.textContent || '', poro: ps?.value };
  });
  (/已完成/.test(sweepDone.status) && sweepDone.poro === poroBefore)
    ? ok('H 参数扫描 9 帧完成+孔隙率还原（前=' + poroBefore + '）')
    : bad('H 参数扫描', JSON.stringify({ ...sweepDone, poroBefore }));

  // I 水平集（主线程同步演化较慢；一次演化即出柔度读数）。演化内部走刚度 FEM——其体素化
  // 读 lastIsoUsed，若点击时上一重建（扫描还原）尚未完成会拿到陈旧 iso → 掩码碎片化 →
  // 孤岛 K 奇异抛错（windows 慢跑者实锤，本地快时踩不中）。先等重建静默（tris 读数两拍稳定）
  await page.waitForFunction(async () => {
    const a = document.getElementById('stat-tris')?.textContent || '';
    await new Promise(r => setTimeout(r, 1500));
    const b = document.getElementById('stat-tris')?.textContent || '';
    return a === b && a.length > 0;
  }, null, { timeout: 120000, polling: 4000 }).catch(() => {});
  await clickBtn('btn-ls-evolve');
  await page.waitForFunction(() => /累计演化.*柔度/.test(document.getElementById('ls-result')?.textContent || ''), null, { timeout: 240000, polling: 3000 }).catch(() => {});
  const lsNote = await readNote('ls-result');
  (/累计演化 \d+ 步：单位载荷柔度 [\d.e+]+/.test(lsNote))
    ? ok('I 水平集演化柔度读数')
    : bad('I 水平集', lsNote.slice(0, 80));

  // J 结构开关三连（应力引导=激活态接线；分形=统计读数轮询等重建；混合=选项展开；网格规模还原）
  const j = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const verts = () => document.getElementById('stat-verts')?.textContent;
    const out = {};
    out.base = verts();
    document.querySelector('[data-stress="bending"]')?.click(); await sleep(2200);
    out.stressActive = document.querySelector('[data-stress].active')?.dataset.stress === 'bending';
    document.querySelector('[data-stress="none"]')?.click(); await sleep(2200);
    document.getElementById('hier-enabled')?.click(); await sleep(300);
    // 分形统计在重建完成后写入——轮询至 30s（swiftshader 首建远慢于真机）
    for (let i = 0; i < 40 && !out.hierStats; i++) {
      await sleep(750);
      out.hierStats = (document.getElementById('hier-stats')?.textContent || '').includes('微孔连通率');
    }
    document.getElementById('hier-enabled')?.click(); await sleep(2600);
    document.getElementById('hybrid-enabled')?.click(); await sleep(2600);
    out.hybridOpts = getComputedStyle(document.getElementById('hybrid-options')).display !== 'none';
    document.getElementById('hybrid-enabled')?.click(); await sleep(2200);
    out.restored = verts();
    return out;
  });
  j.stressActive && j.hierStats && j.hybridOpts && j.restored === j.base
    ? ok('J 应力/分形/混合开关接线+网格还原（' + j.base + '→' + j.restored + '）')
    : bad('J 结构开关', JSON.stringify(j).slice(0, 140));

  // F 逆向 solve + apply（标题同步=updateBadges 哨兵）。置于末尾：apply 会落到极端参数态
  // （如 schwarz k5/P47），前置会污染后续卡的体素化域（windows 慢跑者 I 卡实锤）
  const titleBefore = await page.evaluate(() => document.title);
  await clickBtn('btn-inv-solve');
  await page.waitForFunction(() => /GPa/.test(document.getElementById('inverse-result')?.textContent || ''), null, { timeout: 30000, polling: 800 }).catch(() => {});
  const invNote = await readNote('inverse-result');
  const m1 = invNote.match(/^1\.\s+(\S+[^P]*?)\s*P=/);
  await clickBtn('btn-inv-apply');
  await page.waitForFunction((t) => document.title !== t || !document.getElementById('stat-tris'), titleBefore, { timeout: 30000, polling: 800 }).catch(() => {});
  await page.waitForTimeout(1500);
  const titleAfter = await page.evaluate(() => document.title);
  const familyKey = (m1?.[1] || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  (m1 && titleAfter !== titleBefore && titleAfter.toLowerCase().includes(familyKey))
    ? ok('F 逆向应用后标题同步（updateBadges 哨兵）')
    : bad('F 逆向', `title=${titleAfter} sol=${(m1?.[1] || '').slice(0, 20)}`);

  // K GPU submit encoder.finish() 静态哨兵（缺 .finish() 曾致 TypeError 被 catch 吞 →
  // GPU 加速自 v3.0 从未真跑、静默 CPU 回退——2026-09-20 真机走查抓出；CI 无 WebGPU
  // 无法运行时验证，静态源断言是唯一可行门禁形态）
  {
    const gpuSrc = readFileSync(path.join(PLATFORM_DIR, 'tpms/tpms-platform/src/geometry/webgpu-evaluator.ts'), 'utf8');
    /submit\(\[encoder\.finish\(\)/.test(gpuSrc) && !/submit\(\[encoder as/.test(gpuSrc)
      ? ok('K GPU submit encoder.finish() 静态哨兵')
      : bad('K GPU submit 哨兵', 'webgpu-evaluator.ts 缺 encoder.finish()');
  }

  // M GPU 状态行实报毫秒（条件断言：本机有 WebGPU 时状态行必须含「V 场 X ms」运行时实证——
  // 这是 submit finish() 修复的运行时哨兵；CI 无 WebGPU 环境显示「不可用 · CPU 回退」跳过）
  {
    const gpu = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById('btn-gpu')?.click();
      await sleep(400);
      document.getElementById('btn-gpu')?.click();
      await sleep(800);
      const ps = [...document.querySelectorAll('input[type=range]')].find(s => s.closest('.field') && /孔隙率/.test(s.closest('.field').textContent));
      ps.value = String(Math.max(+ps.min, Math.min(+ps.max, +ps.value === +ps.min ? +ps.min + 3 : +ps.value - 3)));
      ps.dispatchEvent(new Event('input', { bubbles: true }));
      ps.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(2800);
      return document.getElementById('gpu-status')?.textContent?.trim() || '';
    });
    (/WebGPU V 场 [\d.]+ ms · \d+³/.test(gpu))
      ? ok('M GPU 状态行实报毫秒（' + gpu + '）')
      : (/不可用|回退/.test(gpu) ? ok('M GPU 不可用环境跳过（' + gpu.slice(0, 20) + '）') : bad('M GPU 状态行', gpu.slice(0, 60)));
  }

  // N yield-viewer 静态哨兵（模块 0 运行时单测缺口；dispose/RAF 释放源断言，2026-09-22 P1-12）
  {
    const yvSrc = readFileSync(path.join(PLATFORM_DIR, 'tpms/tpms-platform/src/viewers/yield-viewer.ts'), 'utf8');
    /export function createYieldViewer\(/.test(yvSrc) && /if \(disposed\) return;/.test(yvSrc) && /get disposed\(\)/.test(yvSrc)
      ? ok('N yield-viewer create/dispose 幂等静态哨兵')
      : bad('N yield-viewer 幂等', 'createYieldViewer/disposed 契约缺失');
    /cancelAnimationFrame\(rafId\)/.test(yvSrc) && /renderer\.dispose\(\)/.test(yvSrc)
      ? ok('N yield-viewer dispose 释放 RAF+renderer')
      : bad('N yield-viewer 释放', '缺 cancelAnimationFrame 或 renderer.dispose');
  }

  // O 调色预设 engine/teach（2026-09-23 顶栏一键切；localStorage 记忆）
  {
    const thSrc = readFileSync(path.join(PLATFORM_DIR, 'tpms/tpms-platform/src/ui/theme.ts'), 'utf8');
    /PALETTE_KEY = 'tpms-palette-platform'/.test(thSrc) && /applyPalette/.test(thSrc) && /data-palette/.test(thSrc)
      ? ok('O 调色 applyPalette/PALETTE_KEY 契约静态哨兵')
      : bad('O 调色契约', 'theme.ts 缺 applyPalette/data-palette/PALETTE_KEY');
    const pal = await page.evaluate(async () => {
      const teach = document.querySelector('.palette-opt[data-palette-set="teach"]');
      const engine = document.querySelector('.palette-opt[data-palette-set="engine"]');
      if (!teach || !engine) return { err: 'buttons missing' };
      teach.click();
      await new Promise(r => setTimeout(r, 50));
      const afterTeach = {
        attr: document.documentElement.getAttribute('data-palette'),
        stored: localStorage.getItem('tpms-palette-platform'),
        teachActive: teach.classList.contains('active'),
      };
      engine.click();
      await new Promise(r => setTimeout(r, 50));
      const afterEngine = {
        attr: document.documentElement.getAttribute('data-palette'),
        stored: localStorage.getItem('tpms-palette-platform'),
        engineActive: engine.classList.contains('active'),
      };
      return { afterTeach, afterEngine };
    });
    const okPal = pal.afterTeach?.attr === 'teach' && pal.afterTeach?.stored === 'teach' && pal.afterTeach?.teachActive
      && pal.afterEngine?.attr === 'engine' && pal.afterEngine?.stored === 'engine' && pal.afterEngine?.engineActive;
    okPal ? ok('O 调色 teach/engine 切换+localStorage+active')
      : bad('O 调色切换', JSON.stringify(pal).slice(0, 120));
  }
  // Z 全程零 pageerror / console.error
  errors.length === 0 ? ok('Z 全程 0 pageerror / 0 console.error') : bad('Z 零错误', errors.slice(0, 3).join(' | ').slice(0, 150));
} finally {
  await browser.close().catch(() => {});
  try { process.kill(-server.pid); } catch { /* windows 下 detached 进程组杀不干净由端口复用兜底 */ }
  try { server.kill(); } catch {}
}
console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 18) { console.error(`GUARD FAIL: ${pass} < 18（14 + yield-viewer 2 + 调色 2，2026-09-23）`); process.exit(1); }
process.exit(fail > 0 ? 1 : 0);
