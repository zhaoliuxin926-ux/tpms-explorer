// probe_delivery_p3.mjs — 第三轮评估 P1-01/02/03 修复验证（2026-10-26 批十四，一次性，不入 CI）
// ①INP 实心修复：schwarz p75 sw=20 导 INP → 解析单元数+头部固相率（期望 ~16k 单元/固相 ~0.25，
//   bug 形态=64000 单元/固相率 1.0）
// ②导入完整恢复：保存 sw=20 → 上传小容器 → 导入 → sw=20mm 保持+容器清除（status 文案+重存无 notCaptured 容器项）
// ③脚本/VTI 尺度：sw=20 导 py+vti → py 含 width_mm = 20+网格 origin -10；vti cellSizeMm=20/origin -10
// ④0 pageerror（分级口径）
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4870;
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

// ── ① INP 实心修复（schwarz 显示档水密直通免升档；exactCapable=基础均匀设计=原 bug 触发域） ──
phase('inp');
await boot(`http://localhost:${PORT}/?type=schwarz&sw=20`);
const inp = (await exportViaMenu('inp')).toString('utf8');
// 头部格式（abaqus-inp-exporter.ts:69-70）：`** solid voxels: ... (solid fraction 0.xxxx)`；
// `** units: ... specimen size 20.000 mm`。单元行 = "id,n1..n8"（9 个数）。
const solidFrac = parseFloat((inp.match(/solid fraction ([\d.]+)/) || [])[1] ?? 'NaN');
const elemCount = (inp.match(/^\d+(?:,\s*\d+){8}\s*$/gm) || []).length;
const specSize = parseFloat((inp.match(/specimen size ([\d.]+) mm/) || [])[1] ?? 'NaN');
ok('INP 不再全实心（solid fraction ≈0.25 而非 1.0）',
  Number.isFinite(solidFrac) && solidFrac > 0.1 && solidFrac < 0.45, `solidFrac=${solidFrac}`);
ok('INP 单元数 ≈ 25% 体素（≈16000 而非 64000）',
  elemCount > 8000 && elemCount < 32000, `elemCount=${elemCount}`);
ok('INP 试样尺寸 20mm（体素 h 按 20/40）',
  Math.abs(specSize - 20) < 0.01, `specimen size=${specSize}`);

// ── ② 导入完整恢复（宽保持+容器清场） ──
phase('import');
const designBuf = await exportViaMenu('design');
const designText = designBuf.toString('utf8');
ok('sw=20 设计文件保存（state 含 specimenSizeMm:20）', /"specimenSizeMm":\s*20/.test(designText));
// 上传小容器（12 三角水密立方——六面外法向绕向逐面验证，边恰出现两次）
const cubeStl = (() => {
  const tris = [
    [[0,1,0],[1,1,0],[1,0,0]], [[0,1,0],[1,0,0],[0,0,0]], // -Z
    [[0,0,1],[1,0,1],[1,1,1]], [[0,0,1],[1,1,1],[0,1,1]], // +Z
    [[0,0,0],[1,0,0],[1,0,1]], [[0,0,0],[1,0,1],[0,0,1]], // -Y
    [[0,1,1],[1,1,1],[1,1,0]], [[0,1,1],[1,1,0],[0,1,0]], // +Y
    [[0,1,1],[0,1,0],[0,0,0]], [[0,1,1],[0,0,0],[0,0,1]], // -X
    [[1,0,0],[1,1,0],[1,1,1]], [[1,0,0],[1,1,1],[1,0,1]], // +X
  ];
  const n = tris.length;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('cube');
  buf.writeUInt32LE(n, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    [0,1,2,0].forEach((vi, j) => { const v = t[vi] ?? t[0]; buf.writeFloatLE(v[0], o + j*12); buf.writeFloatLE(v[1], o + j*12+4); buf.writeFloatLE(v[2], o + j*12+8); });
  });
  return buf;
})();
const cubePath = path.join(os.tmpdir(), 'probe-cube.stl');
writeFileSync(cubePath, cubeStl);
const mcInput = page.locator('#meshcont-file');
await mcInput.setInputFiles(cubePath, { timeout: 60_000 });
await page.waitForFunction(() => /已启用|✗/.test(document.querySelector('#meshcont-status')?.textContent ?? ''), { timeout: 90_000, polling: 500 });
const contOn = await page.evaluate(() => document.querySelector('#meshcont-status')?.textContent ?? '');
ok('外部容器已激活（上传成功）', /已启用/.test(contOn), contOn.slice(0, 50));
// 导入 sw=20 设计 → 宽保持 + 容器清场
await page.evaluate(([text]) => {
  const file = new File([text], 'sw20-design.json', { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('#import-design-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [designText]);
await page.waitForFunction(() => /已导入设计（完整状态替换）/.test(document.querySelector('#toast')?.textContent ?? ''), { timeout: 30_000, polling: 300 }).catch(() => {});
const afterImport = await page.evaluate(() => ({
  sw: document.querySelector('#sw-value')?.textContent ?? '',
  mc: document.querySelector('#meshcont-status')?.textContent ?? '',
}));
ok('导入后显式总宽 20mm 保持（nullable 修复）', /20 mm/.test(afterImport.sw) && /单胞 6\.67/.test(afterImport.sw), afterImport.sw);
ok('导入后外部容器已清除（替换语义覆盖外部资源）', /清除外部 STL 容器|未启用/.test(afterImport.mc), afterImport.mc.slice(0, 60));
// 重存验证 notCaptured 无容器项
const redesignBuf = await exportViaMenu('design');
const redesignText = redesignBuf.toString('utf8');
ok('重存设计文件不再携带容器 notCaptured', !/customContainerStl/.test(redesignText));

// ── ③ 脚本/VTI 尺度 ──
phase('scripts');
const py = (await exportViaMenu('py')).toString('utf8');
ok('Python 脚本 width_mm = 20（物理总宽贯通）', /^width_mm = 20(\.0)?\s*(#.*)?$/m.test(py), (py.match(/^width_mm = .*$/m) ?? [''])[0]);
ok('Python 网格 origin 用 width_mm', /origin=\(-width_mm\/2/.test(py));
const vti = (await exportViaMenu('vti')).toString('utf8');
ok('VTI cellSizeMm=20（origin -10）', /Name="cellSizeMm"[^>]*>20</.test(vti) && /WholeExtent="0 \d+ 0 \d+ 0 \d+"[^>]*Origin="-10(\.0+)? /.test(vti) || (/Origin="-10/.test(vti) && /Name="cellSizeMm"[^>]*>20</.test(vti)),
  ((vti.match(/Origin="[^"]*"/) ?? [''])[0]) + ' ' + ((vti.match(/Name="cellSizeMm"[^>]*>\S+/) ?? [''])[0]));

ok('0 pageerror / 0 console.error（分级口径）', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.kill();
console.log(`\n== DELIVERY P3: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
