// check_expfit_card.mjs — 试验曲线反演卡片冒烟（一次性快检，不入 CI）
// 合成 CSV 上传 → 断言指标文本渲染 + canvas 显示 + 0 pageerror
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4856;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// 合成 ISO 13314 形 CSV（应变-应力双列）
const csv = await page.evaluate(() => {
  const E0 = 1200, K = 60000;
  const sig = (e) => {
    if (e <= 0.01) return K * e * e;
    if (e <= 0.035) return K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * 30 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 1.2 * Math.sin(2 * Math.PI * 0.37 / 0.075) * Math.exp(-0.37 / 0.25) + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = [];
  for (let e = 0; e <= 0.5001; e += 0.001) lines.push(e.toFixed(4) + ',' + sig(e).toFixed(4));
  return lines.join('\n');
});

// 展开仿真组 + 打开反演卡片 + 经 DataTransfer 注入文件
await page.evaluate(() => {
  const card = document.querySelector('#expfit-file');
  card?.closest('details')?.setAttribute('open', '');
});
const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
await page.evaluate(([csvText]) => {
  const file = new File([csvText], 'synthetic.csv', { type: 'text/csv' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#expfit-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [csv]);
// 【2026-09-29 Windows runner 校准（B5 同型）】拟合计算在慢 runner 高负载下超 800ms 固定窗
//（CI 实测 resultText 空 → 指标文本/E* 恢复/canvas 三断言连挂）——改轮询等待结果节点
// 出现 E* 文本，上限 15s；超时则照常进入断言（失败详情可见，不静默吞）
await page.waitForFunction(() => /E\*=\d/.test(document.querySelector('#expfit-result')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});

const resultText = await page.evaluate(() => document.querySelector('#expfit-result')?.textContent ?? '');
const canvasVisible = await page.evaluate(() => {
  const cv = document.querySelector('#expfit-curve');
  return cv && cv.style.display !== 'none';
});
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
ok('指标文本渲染（E*/σpl/εd/GA 比）', /E\*=\d/.test(resultText) && /σpl=\d/.test(resultText) && /GA\/实测=\d/.test(resultText), resultText.slice(0, 90));
ok('E* 恢复 ≈1200（±3%）', (() => { const m = resultText.match(/E\*=(\d+)/); return m && Math.abs(Number(m[1]) - 1200) / 1200 < 0.03; })());
ok('canvas 已显示', canvasVisible);

// ── df 用例（批九 H₀ 档位防呆）：合成位移-载荷 CSV（S1_G60 ×2.5 档标称 H₀=24/A₀=400）──
// 由同一 sig(e) 应变-应力真值换算：d=e·H₀, F=σ(e)·A₀——L₀=24 时换算互逆，E* 应恢复同值。
const dfCsv = (H0, A, emax = 0.4991) => page.evaluate(([h0, a, em]) => {
  const E0 = 1200, K = 60000;
  const sig = (e) => {
    if (e <= 0.01) return K * e * e;
    if (e <= 0.035) return K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * 30 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02; const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 1.2 * Math.sin(2 * Math.PI * 0.37 / 0.075) * Math.exp(-0.37 / 0.25) + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = [];
  for (let e = 0; e <= em + 0.0001; e += 0.001) lines.push((e * h0).toFixed(4) + ',' + (sig(e) * a).toFixed(4));
  return lines.join('\n');
}, [H0, A, emax]);
async function runDf(l0, a0, csvH0, csvEmax) {
  await page.evaluate(([l, a]) => {
    (document.getElementById('expfit-l0')).value = String(l);
    (document.getElementById('expfit-area')).value = String(a);
    (document.getElementById('expfit-df')).checked = true;
  }, [l0, a0]);
  // CSV 位移列按 csvH0 生成（与所填 L₀ 解耦——越档场景=同一份数据用错误 L₀ 重解释）
  const text = await dfCsv(csvH0, a0, csvEmax);
  await page.evaluate(([csvText]) => {
    const file = new File([csvText], 'synthetic-df.csv', { type: 'text/csv' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#expfit-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [text]);
  await page.waitForFunction((p) => {
    const t = document.querySelector('#expfit-result')?.textContent ?? '';
    return new RegExp('E\\*=\\d[\\s\\S]*L₀=' + p).test(t);
  }, String(l0), { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => document.querySelector('#expfit-result')?.textContent ?? '');
}
// 24 档（S1_G60 标称）：无 ⚠ + 口径披露含 L₀=24 + E* 与应变-应力基线同值（换算互逆）
const df24 = await runDf(24, 400, 24);
ok('df L₀=24 档内：无越档 ⚠ + 口径披露 L₀/A₀ 可见',
  !/⚠/.test(df24) && /L₀=24mm/.test(df24) && /A₀=400mm²/.test(df24), df24.slice(0, 100));
ok('df L₀=24 E* 与应变-应力基线同值（换算互逆）', (() => {
  const m = df24.match(/E\*=(\d+)/); const b = resultText.match(/E\*=(\d+)/);
  return m && b && Math.abs(Number(m[1]) - Number(b[1])) / Number(b[1]) < 0.02;
})(), `df=${(df24.match(/E\*=(\d+)/) ?? [])[1]} base=${(resultText.match(/E\*=(\d+)/) ?? [])[1]}`);
// 30 越档（忘改口径的典型）：同一份 24 基准 CSV（ε 上限加长到 0.52，保证 L₀=30 重解释后
// max ε=0.416 仍够 0.40 平台窗）→ 应变压缩 σ-ε 斜率放大 → ⚠ 出现 + E* 按 30/24 放大
const df30 = await runDf(30, 400, 24, 0.52);
ok('df L₀=30 越档：⚠ 告警出现（协议档 {12,24,34}±1）',
  /⚠ H₀=30mm 越协议档/.test(df30), df30.slice(0, 80));
ok('df L₀=30 E* 按 30/24 放大（应变换算基准漂移可见）', (() => {
  const m = df30.match(/E\*=(\d+)/); const b = df24.match(/E\*=(\d+)/);
  return m && b && Math.abs(Number(m[1]) - Number(b[1]) * 30 / 24) / (Number(b[1]) * 30 / 24) < 0.03;
})(), `df30=${(df30.match(/E\*=(\d+)/) ?? [])[1]} expect≈${(((df24.match(/E\*=(\d+)/) ?? [])[1] ?? 0) * 30 / 24).toFixed(0)}`);
// 复位（避免影响后续用例/会话状态）
await page.evaluate(() => {
  (document.getElementById('expfit-df')).checked = false;
  (document.getElementById('expfit-l0')).value = '12';
  (document.getElementById('expfit-area')).value = '100';
});
ok('0 pageerror/console.error', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== EXPFIT CARD SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
