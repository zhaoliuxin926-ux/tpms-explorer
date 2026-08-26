// 红队修复复验：M1 URL 权重恢复 / M2 custom 面板隐藏 / M3 深色引导卡 / m1 高亮残留 / m3 引导期快捷键守卫
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4811/';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors = [];
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log('PASS', name); };
const bad = (name, info = '') => { fail++; console.log('FAIL', name, info); };

const browser = await chromium.launch({
  channel: 'chrome', executablePath: chromePath,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

// ── M1: URL 权重恢复 ──
await page.goto(BASE + '?type=diamond&wa=1.2&wb=0.8&material=tc4&autoRotate=0', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1')); // 抑制首访引导
await page.waitForTimeout(4000);
let m1 = await page.evaluate(() => ({
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
  fwA: document.getElementById('fw-a')?.value,
  fwAText: document.getElementById('fw-a-val')?.textContent,
  fwB: document.getElementById('fw-b')?.value,
  activeType: document.querySelector('[data-type].active')?.getAttribute('data-type'),
  activeMat: document.querySelector('[data-material].active')?.getAttribute('data-material'),
}));
m1.rows === 4 && m1.fwA === '1.2' && m1.fwAText === '1.2' && m1.fwB === '0.8' && m1.activeType === 'diamond' && m1.activeMat === 'tc4'
  ? ok('M1 URL 恢复 wa=1.2/wb=0.8 + type/material') : bad('M1 URL 权重恢复', JSON.stringify(m1));

// M1-b: 无 wa 参数的纯类型 URL 仍重置默认
await page.goto(BASE + '?type=diamond&autoRotate=0', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
let m1b = await page.evaluate(() => ({
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
  vals: [...document.querySelectorAll('#weight-rows .fw-val')].map(e => e.textContent),
}));
m1b.rows === 4 && m1b.vals.every(v => v === '1.0')
  ? ok('M1b 纯类型 URL 权重默认 1.0') : bad('M1b', JSON.stringify(m1b));

// M1-c: URL 恢复后点 1 切回 gyroid → 权重重置（无 URL 干扰）
await page.keyboard.press('1');
await page.waitForTimeout(400);
let m1c = await page.evaluate(() => ({
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
  vals: [...document.querySelectorAll('#weight-rows .fw-val')].map(e => e.textContent),
  active: document.querySelector('[data-type].active')?.getAttribute('data-type'),
}));
m1c.rows === 3 && m1c.active === 'gyroid' && m1c.vals.every(v => v === '1.0')
  ? ok('M1c 切回 gyroid 权重重置') : bad('M1c', JSON.stringify(m1c));

// ── M2: custom 公式模式隐藏权重面板 ──
await domClick('#custom-enabled');
await page.waitForTimeout(400);
let m2on = await page.evaluate(() => ({
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
  fwShow: document.getElementById('formula-weights')?.classList.contains('show'),
}));
m2on.rows === 0 && !m2on.fwShow ? ok('M2 勾选 custom 后权重面板隐藏') : bad('M2 隐藏', JSON.stringify(m2on));
await page.evaluate(() => {
  const ta = document.getElementById('custom-formula');
  ta.value = 'sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(1500);
await domClick('#custom-enabled'); // 取消勾选
await page.waitForTimeout(400);
let m2off = await page.evaluate(() => ({
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
  fwShow: document.getElementById('formula-weights')?.classList.contains('show'),
  active: document.querySelector('[data-type].active')?.getAttribute('data-type'),
}));
m2off.rows === 3 && m2off.fwShow && m2off.active === 'gyroid'
  ? ok('M2 取消 custom 后权重面板恢复') : bad('M2 恢复', JSON.stringify(m2off));

// ── M3: 深色主题引导卡 ──
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await domClick('#btn-onboard');
await page.waitForTimeout(400);
let m3 = await page.evaluate(() => {
  const card = document.getElementById('ob-card');
  const h4 = card.querySelector('h4');
  const ghost = card.querySelector('.ob-btn.ghost');
  return {
    bg: getComputedStyle(card).backgroundColor,
    h4Color: getComputedStyle(h4).color,
    ghostBg: getComputedStyle(ghost).backgroundColor,
  };
});
m3.bg !== 'rgb(255, 255, 255)' && m3.ghostBg !== 'rgb(240, 242, 247)'
  ? ok(`M3 深色引导卡 bg=${m3.bg} ghost=${m3.ghostBg}`) : bad('M3 深色引导卡', JSON.stringify(m3));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

// ── m1: 拖动中切类型 → 高亮不残留 ──
await page.evaluate(() => {
  const el = document.getElementById('fw-a');
  el.value = '0.3';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await domClick('[data-type="diamond"]');
await page.waitForTimeout(1000);
let mm1 = await page.evaluate(() => ({
  termHl: document.querySelectorAll('#formula-display .term-hl').length,
  tagOn: document.querySelectorAll('.fw-tag.on').length,
  rows: document.querySelectorAll('#weight-rows .fw-row').length,
}));
mm1.termHl === 0 && mm1.tagOn === 0 && mm1.rows === 4
  ? ok('m1 切类型后高亮清零') : bad('m1 高亮残留', JSON.stringify(mm1));

// ── m3: 引导打开时快捷键守卫 ──
await domClick('#btn-onboard');
await page.waitForTimeout(300);
await page.keyboard.press('2');
await page.waitForTimeout(400);
let mm3 = await page.evaluate(() => ({
  active: document.querySelector('[data-type].active')?.getAttribute('data-type'),
  open: document.getElementById('ob-card')?.classList.contains('show'),
}));
mm3.active === 'diamond' && mm3.open
  ? ok('m3 引导期按 2 不切曲面') : bad('m3 引导期快捷键', JSON.stringify(mm3));
// 引导自身 Esc 仍工作
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
let escOk = await page.evaluate(() => !document.getElementById('ob-card')?.classList.contains('show'));
escOk ? ok('m3 引导 Esc 关闭不受守卫影响') : bad('m3 Esc 失效');

if (errors.length) { bad('运行时错误', errors.slice(0, 5).join(' | ')); }
else ok('全程 0 pageerror / 0 console.error');

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
