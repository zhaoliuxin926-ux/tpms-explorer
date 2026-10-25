// probe_specimen.mjs — UI 独立尺寸批六冒烟（2026-10-25，一次性快检，不入 CI）
// ①legacy 锚：无 sw、k=3 的 STL 包围盒≈3mm（默认语义逐位不变）
// ②URL sw=20 → STL 包围盒≈20mm（尺寸契约落地到产物）
// ③指标随宽度换算：单页 sw 切换，同网格 Sv 严格 ×3/20（cacheKey SW 段失效重算路径）
// ④采用回环（确定性按钮链）：逆设计反演→应用 → cellSize=3+总宽=3×单胞写回+STL 复核
// ⑤0 pageerror（慢 runner 自愈分级口径）
// STL 获取走 createObjectURL 拦截（blob→base64 回传）——playwright download.path() 无超时
// 曾致首版探针无界挂起，弃用下载事件通道。读数统一走稳定等待（preview→full 重建竞态）。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4866;
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

async function openAndWait(url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });
  await page.waitForTimeout(1500); // HD 升档窗口
}

// stat 面板读数稳定等待：连续两次相隔 500ms 读数相等（preview→full→HD 重建链收敛）
async function waitStatStable(selector) {
  let prev = null;
  for (let t = 0; t < 60; t++) {
    const v = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selector);
    if (prev != null && v === prev && v !== '' && v !== '—') return v;
    prev = v;
    await page.waitForTimeout(500);
  }
  return prev ?? '';
}

// 等待读数偏离 before（宽度切换后重建完成才会变值——重建期间旧值恒等，
// 「连续相等」判稳会误判，必须以「偏离切换前值」为完成信号）
async function waitStatChange(selector, before) {
  let prev = null;
  for (let t = 0; t < 120; t++) {
    const v = await page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selector);
    if (v !== before && prev === v && v !== '' && v !== '—') return v;
    prev = v;
    await page.waitForTimeout(500);
  }
  return prev ?? '';
}

// 拦截 createObjectURL：导出 blob → base64 存 window.__stlB64（每次导出前置空）
async function armStlCapture() {
  await page.evaluate(() => {
    window.__stlB64 = null;
    if (window.__stlCapArmed) return;
    window.__stlCapArmed = true;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.arrayBuffer().then((ab) => {
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        window.__stlB64 = btoa(bin);
      });
      return orig(blob);
    };
  });
}

async function exportStlBbox() {
  await armStlCapture();
  await page.evaluate(() => document.getElementById('btn-export')?.click());
  await page.waitForFunction(() => document.getElementById('export-menu')?.classList.contains('show'), { timeout: 10_000 });
  await page.evaluate(() => document.querySelector('.xm-item[data-export="stl"]')?.click());
  await page.waitForFunction(() => !!window.__stlB64, { timeout: 150_000, polling: 500 });
  const b64 = await page.evaluate(() => window.__stlB64);
  const buf = Buffer.from(b64, 'base64');
  // 二进制 STL：80B 头 + uint32 tri 数 + 50B/三角（法线 12B + 3 顶点 36B + 2B 属性）
  const n = buf.readUInt32LE(80);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let t = 0; t < n; t++) {
    const off = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off + v * 12), y = buf.readFloatLE(off + v * 12 + 4), z = buf.readFloatLE(off + v * 12 + 8);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y1 = Math.max(y1, y);
    }
  }
  const dims = [x1 - x0, y1 - y0, z1 - z0].map((v) => v.toFixed(3)).join(' × ');
  return { n, dims, span: [x1 - x0, y1 - y0, z1 - z0] };
}

// ① legacy 锚（无 sw，k=3）：总宽≈3mm（端面平齐截断≈3.006 离散上界，±5%）
phase('legacy load');
await openAndWait(`http://localhost:${PORT}/?type=schwarz`);
const svLegacyTxt = await waitStatStable('#stat-sv');
phase('legacy export');
const legacy = await exportStlBbox();
ok('legacy STL 总宽≈3mm（k=3 默认语义不变）',
  legacy.span.every((v) => Math.abs(v - 3) / 3 < 0.05), `${legacy.n} tris, ${legacy.dims}`);

// ② 显式总宽 20mm + ③ 单页切换严格比（同一网格：宽度只改因子，Sv 严格 ×3/20）
phase('sw=20 load');
await openAndWait(`http://localhost:${PORT}/?type=schwarz&sw=20`);
const swDisplay = await page.evaluate(() => ({
  val: document.querySelector('#sw-value')?.textContent ?? '',
  input: document.getElementById('sw-mm')?.value ?? '',
}));
ok('sw=20 状态与输入框回显（20 mm 单胞 6.67）',
  swDisplay.val.includes('20 mm') && swDisplay.val.includes('6.67') && swDisplay.input === '20', JSON.stringify(swDisplay));
phase('sw=20 export');
const wide = await exportStlBbox();
ok('sw=20 STL 总宽≈20mm（尺寸契约落地产物）',
  wide.span.every((v) => Math.abs(v - 20) / 20 < 0.02), `${wide.n} tris, ${wide.dims}`);
const svWide = parseFloat(await waitStatStable('#stat-sv'));
phase('toggle back to auto');
await page.evaluate(() => document.getElementById('sw-auto')?.click());
const svAuto = parseFloat(await waitStatChange('#stat-sv', `${svWide.toFixed(3)} mm⁻¹`));
ok(`Sv 随宽度严格换算（sw=20 页内回退自动：${svWide} → ${svAuto}）`,
  Number.isFinite(svWide) && Number.isFinite(svAuto) && Math.abs(svWide / svAuto - 3 / 20) < 0.01,
  `ratio=${(svWide / svAuto).toFixed(4)}（同网格期望 0.15）`);

// ④ 采用回环（确定性按钮链）：逆设计反演→应用 → cellSize=3+总宽=3×单胞写回。
// 最终尺度导出已由 ② 证明（同一 effMm 消费链）；此处不导出——逆设计胜出族可能
// 非显示档水密（触发 R96 升档慢路径），与写回语义无关。
phase('inverse solve');
await page.evaluate(() => document.getElementById('btn-inv-solve')?.click());
await page.waitForFunction(() => /GPa/.test(document.getElementById('inverse-result')?.textContent || ''), { timeout: 60_000, polling: 500 });
const invLine = await page.evaluate(() => (document.getElementById('inverse-result')?.textContent || '').split('\n')[0]);
const cellMatch = invLine.match(/单胞 ([\d.]+)mm/);
phase('inverse apply');
await page.evaluate(() => document.getElementById('btn-inv-apply')?.click());
await page.waitForFunction(() => /单胞 [\d.]+/.test(document.querySelector('#sw-value')?.textContent ?? ''), { timeout: 30_000, polling: 300 });
const adoptSw = await page.evaluate(() => document.querySelector('#sw-value')?.textContent ?? '');
const adoptPor = await page.evaluate(() => document.querySelector('#porosity-value')?.textContent ?? '');
if (cellMatch) {
  const expectW = +(3 * Number(cellMatch[1])).toFixed(2);
  ok(`逆设计应用 → 总宽=${expectW}（3 周期 × 单胞 ${cellMatch[1]}）写回`,
    adoptSw.startsWith(`${expectW} mm（单胞 ${Number(cellMatch[1]).toFixed(2)}）`),
    `inv="${invLine.slice(0, 60)}" sw="${adoptSw}"`);
  ok('应用后孔隙率显示同步', /^\d+%$/.test(adoptPor), adoptPor);
} else {
  ok('逆设计结果行含单胞（探针解析）', false, invLine.slice(0, 80));
}

ok('0 pageerror / 0 console.error（慢 runner 自愈分级口径）', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== SPECIMEN SMOKE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
