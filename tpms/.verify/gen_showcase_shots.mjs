/**
 * gen_showcase_shots.mjs —— README 首屏视觉资产生成器（T1/A3 清账，2026-09-16）
 *
 * 产出 docs/screenshots/ 四件：
 *   1. teaching-video.png   教学版概念视频模态（app.html?video=1）
 *   2. engineering-rg.png   工程版 radial-grad M(r) UI 卡 + MT 几何（真实生成流程）
 *   3. agent-terminal.png   Agent 闭环终端演示（真实 CLI 输出 + 终端样式渲染）
 *   4. social-preview.png   GitHub 社交预览图 1280×640（HTML 合成）
 * 复跑：node gen_showcase_shots.mjs（服务自起 8127，产物覆盖写）
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'docs/screenshots');
mkdirSync(OUT, { recursive: true });

// 双服务（static-server 子目录尾斜杠 500 的绕过：run_all 同款——工程版直接以 docs/platform 为根）
const PORT = 8127, PORT_PLAT = 8128;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.resolve(HERE, '../..')], { detached: true, stdio: 'ignore' });
const serverPlat = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT_PLAT), path.join(REPO, 'docs/platform')], { detached: true, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 900));
const U = (p) => `http://localhost:${PORT}/docs/${p}`;

const browser = await chromium.launch({
  channel: 'chrome',
  executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined,
  headless: true,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  // ── 1. 教学版概念视频模态 ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(U('app.html?video=1'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('video-overlay')?.classList.contains('show'), { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'teaching-video.png') });
    await page.close();
    console.log('✓ teaching-video.png');
  }

  // ── 2. 工程版 radial-grad 卡 + MT 几何（复刻 radialgrad_card_check 真实流程）──
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:${PORT_PLAT}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#rg-gen', { state: 'attached', timeout: 20000 });
    await page.evaluate(() => {
      document.querySelector('#grp-view .sgroup-h')?.dispatchEvent(new Event('click', { bubbles: true }));
      document.querySelector('[data-type="schwarz"]')?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.getElementById('rg-gen')?.click());
    await page.waitForFunction(() => (document.getElementById('rg-status')?.textContent || '').includes('实测孔隙率'), { timeout: 90000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('rg-gen')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    // swiftshader 重载合成器可能不产帧（verify.mjs 同款坑）：禁动画+加长超时+重试
    let shotOk = false;
    for (let attempt = 0; attempt < 2 && !shotOk; attempt++) {
      try { await page.screenshot({ path: path.join(OUT, 'engineering-rg.png'), animations: 'disabled', timeout: 90000 }); shotOk = true; }
      catch (e) { console.log(`  截图重试 ${attempt + 1}: ${String(e).slice(0, 80)}`); await new Promise(r => setTimeout(r, 2000)); }
    }
    if (!shotOk) throw new Error('engineering-rg.png 两次截图均超时');
    await page.close();
    console.log('✓ engineering-rg.png');
  }

  // ── 3. Agent 终端演示（真实 CLI 输出 + 终端样式渲染）──
  {
    // 真实跑一条 Agent 链路命令取输出（llm-agent mock dry-run 全链路，零 key 依赖）
    // 双命令演示：① mock agent 会话（真实执行工具链，env 逃生门）② mesh 水密门输出（门禁文化一图流）
    let agentOut = '';
    try {
      agentOut = execFileSync(process.execPath, [
        path.join(REPO, 'tpms/agent/llm-agent.mjs'), '--provider', 'mock',
        '设计一个孔隙率 75% 的 Gyroid 骨支架',
      ], { encoding: 'utf8', timeout: 120000, env: { ...process.env, TPMS_ALLOW_MOCK_EXEC: '1' } });
    } catch (e) { agentOut = (e.stdout || '') + (e.stderr || ''); }
    let meshOut = '';
    try {
      meshOut = execFileSync(process.execPath, [
        path.join(REPO, 'tpms/agent/tpms.mjs'), 'mesh', '--type', 'gyroid', '--porosity', '0.75',
        '--resolution', '96', '--out', (process.env.TEMP || '/tmp') + '/demo_gyroid.stl',
      ], { encoding: 'utf8', timeout: 300000 });
    } catch (e) { meshOut = (e.stdout || '') + (e.stderr || ''); }
    const lines = [
      ...agentOut.split('\n').slice(-9),
      '$ node tpms/agent/tpms.mjs mesh --type gyroid --porosity 0.75 --resolution 96 --out scaffold.stl',
      ...meshOut.split('\n').filter(l => l.trim()),
    ].slice(-30);
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#0d1117;padding:0}
      .term{font:13px/1.5 "Cascadia Code",Consolas,"Courier New",monospace;color:#c9d1d9;
        padding:18px 22px;background:#0d1117;border:1px solid #30363d;border-radius:10px;max-width:1080px;margin:24px auto}
      .bar{display:flex;gap:7px;margin:-6px -10px 14px;padding:8px 12px;border-bottom:1px solid #30363d}
      .dot{width:11px;height:11px;border-radius:50%}
      .cmd{color:#7ee787}
      .dim{color:#8b949e}
      .ok{color:#7ee787}
      .warn{color:#e3b341}
    </style></head><body><div class="term">
      <div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
      <span class="dim" style="margin-left:10px;font-size:11px">zsh — tpms-explorer · agentic CLI</span></div>
      <div class="cmd">$ node tpms/agent/llm-agent.mjs "设计一个孔隙率 75% 的 Gyroid 骨支架"</div>
      ${lines.map(l => {
        if (/✓|PASS|水密|exit 0/.test(l)) return `<span class="ok">${esc(l) || '&nbsp;'}</span>`;
        if (/✗|FAIL|拒|非流形/.test(l)) return `<span class="warn">${esc(l) || '&nbsp;'}</span>`;
        if (l.trim().startsWith('$') || l.trim().startsWith('>')) return `<span class="cmd">${esc(l)}</span>`;
        return `<span class="dim">${esc(l) || '&nbsp;'}</span>`;
      }).join('\n      ')}
    </div></body></html>`;
    const tmpHtml = path.join(OUT, '_agent_term_tmp.html');
    writeFileSync(tmpHtml, html, 'utf8');
    const page = await browser.newPage({ viewport: { width: 1180, height: 720 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    await page.locator('.term').screenshot({ path: path.join(OUT, 'agent-terminal.png') });
    await page.close();
    // 清理临时 html（产物只留 png）
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync(tmpHtml); } catch { /* 忽略 */ }
    console.log('✓ agent-terminal.png');
  }

  // ── 4. 社交预览图 1280×640 ──
  {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;width:1280px;height:640px;overflow:hidden;
        background:radial-gradient(1200px 700px at 20% 10%,#12233d 0%,#0a0f1c 55%,#070b14 100%);
        font-family:"Segoe UI",system-ui,sans-serif;color:#e6edf3}
      .wrap{padding:64px 72px;height:512px;display:flex;flex-direction:column;justify-content:center}
      h1{font-size:52px;margin:0 0 6px;letter-spacing:-1px}
      h1 .accent{background:linear-gradient(90deg,#7dd3fc,#34d399);-webkit-background-clip:text;background-clip:text;color:transparent}
      .sub{font-size:22px;color:#94a3b8;margin:0 0 40px}
      .stats{display:flex;gap:18px}
      .stat{background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.22);border-radius:14px;padding:18px 26px}
      .stat b{display:block;font-size:34px;color:#7dd3fc;font-weight:800}
      .stat span{font-size:14px;color:#8b949e}
      .foot{position:absolute;bottom:34px;left:72px;font-size:15px;color:#64748b}
    </style></head><body>
      <div class="wrap">
        <h1>TPMS Explorer <span class="accent">· 骨支架生成式平台</span></h1>
        <p class="sub">浏览器里的三周期极小曲面：设计 → 验证 → 3D 打印文件，零后端</p>
        <div class="stats">
          <div class="stat"><b>24</b><span>曲面族</span></div>
          <div class="stat"><b>44 × 3</b><span>CI 门禁 × 平台</span></div>
          <div class="stat"><b>1000+</b><span>断言（带防中和守卫）</span></div>
          <div class="stat"><b>M0-M5</b><span>LLM Agent 闭环</span></div>
        </div>
        <div class="foot">github.com/zhaoliuxin926-ux/tpms-explorer · v9.2.0</div>
      </div>
    </body></html>`;
    const tmp = path.join(OUT, '_social_tmp.html');
    writeFileSync(tmp, html, 'utf8');
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, 'social-preview.png') });
    await page.close();
    try { (await import('node:fs')).unlinkSync(tmp); } catch { /* 忽略 */ }
    console.log('✓ social-preview.png');
  }
} finally {
  await browser.close().catch(() => {});
  try { server.kill(); serverPlat.kill(); } catch { /* 忽略 */ }
}
console.log('DONE → docs/screenshots/');
