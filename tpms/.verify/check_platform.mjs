import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:' + (process.env.PORT || '8123');
const OUT = 'web/shots/showcase';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function log(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ::  ' + detail : ''}`);
}

function parseCount(t) {
  if (!t) return 0;
  t = String(t).trim().replace(/,/g, '');
  if (/k$/i.test(t)) return parseFloat(t) * 1000;
  if (/m$/i.test(t)) return parseFloat(t) * 1e6;
  return parseFloat(t) || 0;
}
async function waitVerts(page, timeout = 20000) {
  await page.waitForFunction(() => {
    const el = document.getElementById('stat-verts');
    if (!el) return false;
    const t = el.textContent || '';
    return t !== '—' && t.trim() !== '';
  }, { timeout });
  const t = await page.locator('#stat-verts').textContent();
  return parseCount(t);
}
async function waitForC1(page, expected, timeout = 8000) {
  try {
    await page.waitForFunction((exp) => {
      const el = document.getElementById('stat-c1');
      return !!el && (el.textContent || '').trim() === exp;
    }, expected, { timeout });
    return true;
  } catch { return false; }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});

// ---------- T18a/T18b: new surfaces render ----------
for (const type of ['lidinoid', 'splitp']) {
  for (const p of [65, 75, 85]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/index.html?porosity=${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const btnCount = await page.locator('.opt[data-type="lidinoid"]').count();
    if (btnCount === 0) {
      const html = await page.content();
      fs.writeFileSync(`${OUT}/debug-no-lidinoid.html`, html);
      log(`诊断: 页面无 lidinoid 按钮`, false, `htmlLen=${html.length} title=${await page.title()}`);
    }
    await page.locator(`.opt[data-type="${type}"]`).click();
    let vNum = 0;
    try { vNum = await waitVerts(page); } catch (e) { /* leave 0 */ }
    const active = await page.locator('.opt[data-type].active').getAttribute('data-type');
    const estEl = await page.locator('#stat-porosity').textContent();
    const expC1 = type === 'lidinoid' ? '0.37' : '0.39';
    const c1ok = await waitForC1(page, expC1);
    const c1 = (await page.locator('#stat-c1').textContent() || '').trim();
    log(`${type} p${p} 渲染非空(顶点>1000)`, vNum > 1000, `verts=${vNum}`);
    log(`${type} p${p} 激活曲面=${type}`, active === type, `active=${active}`);
    log(`${type} p${p} C1 值正确(确认曲面身份)`, c1ok, `c1=${c1} expect=${expC1}`);
    log(`${type} p${p} 孔隙率显示合理`, !!estEl && estEl !== '—', `porosity=${estEl}`);
    log(`${type} p${p} 无运行时报错`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.screenshot({ path: `${OUT}/plat-11-${type}-p${p}.png` });
    await ctx.close();
  }
}

// ---------- T18c/T18d: presets trigger teaching card ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/index.html?type=gyroid&porosity=70`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const expect = { catalyst: 'iwp', acoustic: 'gyroid', electrode: 'neovius' };
  const c1expect = { catalyst: '0.44', acoustic: '0.38', electrode: '0.36' };
  for (const key of Object.keys(expect)) {
    await page.locator(`[data-preset="${key}"]`).click();
    await page.waitForTimeout(1400);
    const cardShown = await page.locator('#preset-card').evaluate((el) => el.classList.contains('show')).catch(() => false);
    const title = await page.locator('#pc-title').textContent().catch(() => '');
    const activeType = await page.locator('.opt[data-type].active').getAttribute('data-type');
    const c1ok = await waitForC1(page, c1expect[key]);
    const c1 = (await page.locator('#stat-c1').textContent() || '').trim();
    let vNum = 0;
    try { vNum = await waitVerts(page, 8000); } catch (e) {}
    log(`预设[${key}] 教学卡弹出`, !!cardShown, `title="${title}"`);
    log(`预设[${key}] 切到正确曲面族=${expect[key]}`, activeType === expect[key], `actual=${activeType}`);
    log(`预设[${key}] C1 值正确(确认曲面身份)`, c1ok, `c1=${c1} expect=${c1expect[key]}`);
    log(`预设[${key}] 3D 渲染正常(顶点>0)`, vNum > 0, `verts=${vNum}`);
    await page.screenshot({ path: `${OUT}/plat-06-${key}.png` });
  }
  await ctx.close();
}

// ---------- T18g: theme toggle + persistence ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/index.html?type=gyroid&porosity=70`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.removeItem('tpms-theme-platform'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
  log('system+浅色系统 → 非深色', !isDark, `data-theme=${await page.evaluate(() => document.documentElement.getAttribute('data-theme'))}`);
  await page.screenshot({ path: `${OUT}/plat-09-theme-light.png` });

  await page.locator('#theme-switch .theme-opt[data-theme-set="dark"]').click();
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pressed: document.querySelector('#theme-switch .theme-opt[data-theme-set="dark"]').getAttribute('aria-pressed'),
    saved: (() => { try { return localStorage.getItem('tpms-theme-platform'); } catch (e) { return null; } })(),
    verts: document.getElementById('stat-verts')?.textContent,
  }));
  log('点击深色 → html[data-theme=dark]', st.theme === 'dark', `theme=${st.theme}`);
  log('深色调按钮 aria-pressed=true', st.pressed === 'true', `pressed=${st.pressed}`);
  log('主题偏好已持久化(tpms-theme-platform=dark)', st.saved === 'dark', `saved=${st.saved}`);
  log('深色下 3D 仍正常渲染', !!st.verts && st.verts !== '—' && parseCount(st.verts) > 0, `verts=${st.verts}`);
  await page.screenshot({ path: `${OUT}/plat-10-theme-dark.png` });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const restored = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
  log('刷新后恢复深色（持久化生效）', restored, `theme=${await page.evaluate(() => document.documentElement.getAttribute('data-theme'))}`);

  await page.locator('#theme-switch .theme-opt[data-theme-set="light"]').click();
  await page.waitForTimeout(600);
  const light = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark');
  log('点击浅色调 → 取消 dark', !light, `theme=${await page.evaluate(() => document.documentElement.getAttribute('data-theme'))}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n==== PLATFORM T18 VERIFY SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach((f) => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
