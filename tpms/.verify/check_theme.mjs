import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = 'web/shots/showcase';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

// 清除已有主题偏好，验证 auto 默认
{
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/app.html?type=gyroid&porosity=70', { waitUntil: 'networkidle' });
  await page.evaluate(() => { try{ localStorage.removeItem('tpms-theme'); }catch(e){} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  log('auto + 浅色系统 → 非深色', !isDark, `dark=${isDark}`);
  await page.screenshot({ path: `${OUT}/09-theme-light.png` });

  // 切到深色
  await page.locator('#theme-switch button[data-theme="dark"]').click();
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    pressed: document.querySelector('#theme-switch button[data-theme="dark"]').getAttribute('aria-pressed'),
    saved: (()=>{ try{ return localStorage.getItem('tpms-theme'); }catch(e){ return null; } })(),
    stats: document.getElementById('stats').textContent,
  }));
  log('点击深色调 → html.dark', st.dark, `dark=${st.dark}`);
  log('深色调按钮 aria-pressed=true', st.pressed === 'true', `pressed=${st.pressed}`);
  log('主题偏好已持久化', st.saved === 'dark', `saved=${st.saved}`);
  log('深色下 3D 仍正常渲染', /顶点\s*\d/.test(st.stats), `stats="${st.stats.replace(/\s+/g,' ').trim().slice(0,40)}"`);
  await page.screenshot({ path: `${OUT}/10-theme-dark.png` });

  // 重新加载应恢复深色
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const restored = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  log('刷新后恢复深色（持久化生效）', restored, `dark=${restored}`);

  // 切回浅色
  await page.locator('#theme-switch button[data-theme="light"]').click();
  await page.waitForTimeout(500);
  const light = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  log('点击浅色调 → 取消 dark', !light, `dark=${light}`);

  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log('\n==== THEME SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
