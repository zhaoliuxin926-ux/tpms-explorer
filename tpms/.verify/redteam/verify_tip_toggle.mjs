// UI 收纳验证：底部建议条（两版）默认收起 / 展开 / 收回 / 深色可见性
// 运行前置：python -m http.server 4814 --directory <部署产物目录> 与 8125 --directory docs/
// （端口可按需调整；4811/vite preview 在本机曾因端口残留与 D 盘抖动不可用，见 agent_memory）
import { chromium } from 'playwright';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info = '') => { fail++; console.log('FAIL', name, info); };

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});

async function checkTipbar(label, url, onboardKey) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // 文件系统间歇抖动可能让 http.server 瞬时回退到目录列表页：加载后校验关键元素，失败则重试
  let loaded = false;
  for (let i = 0; i < 4 && !loaded; i++) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(i === 0 ? 3500 : 1500);
    loaded = await page.evaluate(() => !!document.querySelector('.tip-extra') && !!document.getElementById('tip1'));
  }
  if (!loaded) { bad(`${label} 页面加载（.tip-extra 缺失，疑似目录列表页）`); await ctx.close(); return; }
  await page.evaluate((k) => localStorage.setItem(k, '1'), onboardKey);

  const vis = (el) => el && el.getBoundingClientRect().width > 0;
  let s = await page.evaluate(() => ({
    tip1: document.getElementById('tip1')?.textContent?.length || 0,
    btn: document.getElementById('tip-toggle')?.textContent,
    extraShown: getComputedStyle(document.querySelector('.tip-extra')).display,
    open: document.getElementById('tipbar')?.classList.contains('open'),
  }));
  s.tip1 > 5 && !s.open && s.extraShown === 'none' && /建议/.test(s.btn || '')
    ? ok(`${label} 默认仅 tip1（建议收起）`) : bad(`${label} 默认态`, JSON.stringify(s));

  await page.evaluate(() => document.getElementById('tip-toggle')?.click());
  await page.waitForTimeout(200);
  s = await page.evaluate(() => ({
    extraShown: getComputedStyle(document.querySelector('.tip-extra')).display,
    btn: document.getElementById('tip-toggle')?.textContent,
    tip2W: document.getElementById('tip2')?.getBoundingClientRect().width || 0,
    tip3W: document.getElementById('tip3')?.getBoundingClientRect().width || 0,
    aria: document.getElementById('tip-toggle')?.getAttribute('aria-expanded'),
  }));
  s.extraShown === 'contents' && s.tip2W > 10 && s.tip3W > 10 && /收起/.test(s.btn || '') && s.aria === 'true'
    ? ok(`${label} 展开显示 tip2/tip3（display:contents 生效）`) : bad(`${label} 展开`, JSON.stringify(s));

  await page.evaluate(() => document.getElementById('tip-toggle')?.click());
  await page.waitForTimeout(200);
  s = await page.evaluate(() => ({
    extraShown: getComputedStyle(document.querySelector('.tip-extra')).display,
    aria: document.getElementById('tip-toggle')?.getAttribute('aria-expanded'),
  }));
  s.extraShown === 'none' && s.aria === 'false'
    ? ok(`${label} 再点收回`) : bad(`${label} 收回`, JSON.stringify(s));

  // 深色主题下按钮可见可用
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  const dark = await page.evaluate(() => {
    const b = document.getElementById('tip-toggle');
    const r = b.getBoundingClientRect();
    return { w: r.width, bg: getComputedStyle(b).backgroundColor };
  });
  dark.w > 20 ? ok(`${label} 深色主题按钮正常`) : bad(`${label} 深色按钮`, JSON.stringify(dark));

  if (errors.length) bad(`${label} 运行时错误`, errors.slice(0, 3).join(' | '));
  else ok(`${label} 0 pageerror / 0 console.error`);
  await ctx.close();
}

await checkTipbar('工程版', 'http://localhost:4814/?autoRotate=0', 'tpms_onboard_v1');
await checkTipbar('单文件版', 'http://localhost:8125/app.html', 'tpms-onboarded');

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
