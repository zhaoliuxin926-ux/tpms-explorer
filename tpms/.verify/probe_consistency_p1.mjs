// probe_consistency_p1.mjs — 外部评估三 P1 修复验证（2026-10-25 批十一，一次性快检，不入 CI）
// ①脏页导入替换语义：开端板/混合/渐变后导入普通设计 → 高级设置被显式清除（不再继承）
// ②渐变导出一致性：同页关/开渐变两次导出 STL → 哈希与三角数必须不同（bug 形态=恒等，
//   经 HD 缓存帧传递可同时覆盖 HD 升档与导出重建两条路径）
// ③体素口径守卫：渐变态跑制造检查/导出 INP → fail-closed 拒绝文案，不产出结果
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4869;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(ROOT, 'docs/platform')]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Worker build timed out.*已重建 worker/.test(t)) return;
  errors.push('console.error: ' + t);
});

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
const phase = (t) => console.error('[phase]', t);

async function boot(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });
  await page.waitForTimeout(1500);
}
async function armCapture() {
  await page.evaluate(() => {
    window.__capB64 = null;
    if (window.__capArmed) return;
    window.__capArmed = true;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.arrayBuffer().then((ab) => {
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        window.__capB64 = btoa(bin);
      });
      return orig(blob);
    };
  });
}
async function exportViaMenu(fmt) {
  await armCapture();
  await page.evaluate(() => document.getElementById('btn-export')?.click());
  await page.waitForFunction(() => document.getElementById('export-menu')?.classList.contains('show'), { timeout: 10_000 });
  await page.evaluate((f) => document.querySelector(`.xm-item[data-export="${f}"]`)?.click(), fmt);
  await page.waitForFunction(() => !!window.__capB64, { timeout: 180_000, polling: 500 });
  return Buffer.from(await page.evaluate(() => window.__capB64), 'base64');
}
const toastOnce = async () => {
  const t = await page.evaluate(() => document.querySelector('#toast')?.textContent ?? '');
  return t;
};

// ── ① 脏页导入：替换语义 ──
phase('dirty import');
await boot(`http://localhost:${PORT}/`);
const designBuf = await exportViaMenu('design');
const designText = designBuf.toString('utf8');
ok('普通设计文件导出（含 state 快照）', /"format":\s*"tpms-design\/1\.0"/.test(designText) && /"state"/.test(designText));
// 弄脏页面：端板 2.0 + 混合开 + 渐变开
await page.evaluate(() => {
  const ep = document.getElementById('endplate');
  ep.value = '2';
  ep.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => document.getElementById('hybrid-enabled')?.click());
await page.evaluate(() => document.getElementById('iso-grad-toggle')?.click());
await page.waitForTimeout(800);
const dirty = await page.evaluate(() => ({
  ep: document.getElementById('endplate-value')?.textContent ?? '',
  hyb: document.getElementById('hybrid-enabled')?.checked,
  ig: document.getElementById('iso-grad-toggle')?.textContent ?? '',
}));
ok('页面已弄脏（端板 2.0/混合开/渐变开）', dirty.ep.includes('2') && dirty.hyb === true && dirty.ig.includes('关闭'), JSON.stringify(dirty));
// 导入普通设计文件
await page.evaluate(([text]) => {
  const file = new File([text], 'plain-design.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#import-design-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [designText]);
await page.waitForFunction(() => /已导入设计（完整状态替换）/.test(document.querySelector('#toast')?.textContent ?? ''), { timeout: 30_000, polling: 300 }).catch(() => {});
const restored = await page.evaluate(() => ({
  ep: document.getElementById('endplate-value')?.textContent ?? '',
  hyb: document.getElementById('hybrid-enabled')?.checked,
  ig: document.getElementById('iso-grad-toggle')?.textContent ?? '',
  toast: document.querySelector('#toast')?.textContent ?? '',
}));
ok('脏页导入 → 端板/混合/渐变全部回落关闭（替换语义，不再继承）',
  restored.ep.startsWith('关') && restored.hyb === false && restored.ig.includes('开启'),
  JSON.stringify(restored));

// ── ② 渐变导出一致性（schwarz：显示档水密直通，免升档） ──
phase('gradient export');
await boot(`http://localhost:${PORT}/?type=schwarz`);
const stlPlain = await exportViaMenu('stl');
const hashPlain = createHash('sha256').update(stlPlain).digest('hex').slice(0, 16);
const trisPlain = stlPlain.readUInt32LE(80);
await page.evaluate(() => document.getElementById('iso-grad-toggle')?.click());
await page.waitForTimeout(2500); // 重建+HD 升档（渐变帧）
const stlGrad = await exportViaMenu('stl');
const hashGrad = createHash('sha256').update(stlGrad).digest('hex').slice(0, 16);
const trisGrad = stlGrad.readUInt32LE(80);
ok('渐变设计导出 STL ≠ 均匀基线（哈希+三角数双差；bug 形态=恒等）',
  hashPlain !== hashGrad && trisPlain !== trisGrad,
  `plain=${trisPlain}/${hashPlain} grad=${trisGrad}/${hashGrad}`);

// ── ③ 体素口径守卫（渐变态） ──
phase('voxel guard');
let mfgToast = '';
page.on('console', () => {});
await page.evaluate(() => {
  (window).__t = [];
  new MutationObserver(() => {
    const x = document.querySelector('#toast')?.textContent ?? '';
    if (x) (window).__t.push(x);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
await page.evaluate(() => document.getElementById('btn-mfg')?.click());
await page.waitForTimeout(600);
mfgToast = await page.evaluate(() => ((window).__t || []).join(' ¶ '));
ok('渐变态制造检查 → fail-closed 拒绝（不产出均匀体素报告）',
  /制造检查暂不支持/.test(mfgToast) && /渐变等值场/.test(mfgToast), mfgToast.slice(0, 80));
const mfgBadge = await page.evaluate(() => document.querySelector('[data-badge="mfg"]')?.className ?? '');
ok('拒绝后 ③ 徽章不置 done', !mfgBadge.includes('done'), mfgBadge);
await page.evaluate(() => document.getElementById('btn-export')?.click());
await page.waitForFunction(() => document.getElementById('export-menu')?.classList.contains('show'), { timeout: 10_000 });
await page.evaluate(() => { window.__capB64 = null; });
await page.evaluate(() => document.querySelector('.xm-item[data-export="inp"]')?.click());
await page.waitForTimeout(600);
const inpToast = await page.evaluate(() => ((window).__t || []).join(' ¶ '));
const noInp = await page.evaluate(() => !window.__capB64);
ok('渐变态 INP 导出 → fail-closed 拒绝且零下载',
  /体网格导出暂不支持/.test(inpToast) && noInp, inpToast.slice(-80));

ok('0 pageerror / 0 console.error（分级口径）', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== CONSISTENCY P1: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
