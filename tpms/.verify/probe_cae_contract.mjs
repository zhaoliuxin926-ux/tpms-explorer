// probe_cae_contract.mjs — P1-06 修复验证（2026-10-26 批十七，一次性，不入 CI）
// ①INP FIELD 输出含 U/RF（runner fieldOutputs['RF'] 契约——旧仅 HISTORY 致 KeyError）
// ②CAE 套件 ZIP：run_abaqus.sh 缺省 SPEC=设计总宽（20）；runner py 含绝对窗口/
//   sigma_pl_valid/-rf_sum 符号修正；INP 与 runner 的输出契约交叉一致（FIELD RF）
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4872;
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
page.on('console', (m) => { if (m.type() === 'error' && !/Worker build timed out.*已重建 worker/.test(m.text())) errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };

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
function parseStoredZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const td = new TextDecoder();
  const entries = {};
  let off = 0;
  while (off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50) {
    if (dv.getUint16(off + 8, true) !== 0) throw new Error('non-stored entry @' + off);
    const compSize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = td.decode(buf.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    entries[name] = buf.slice(dataStart, dataStart + compSize);
    off = dataStart + compSize;
  }
  return entries;
}

await page.goto(`http://localhost:${PORT}/?type=schwarz&sw=20`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /\d/.test(document.querySelector('#stat-tris')?.textContent ?? ''), { timeout: 120_000 });
await page.waitForTimeout(1500);

// ① INP FIELD 含 U/RF
const inp = (await exportViaMenu('inp')).toString('utf8');
const fieldBlock = (inp.match(/\*OUTPUT, FIELD[\s\S]*?(?=\*OUTPUT|\*STEP|$)/) || [''])[0];
ok('INP *OUTPUT,FIELD 含节点 U, RF（runner fieldOutputs 契约）',
  /\*NODE OUTPUT/.test(fieldBlock) && /(^|\n)U, RF/.test(fieldBlock), fieldBlock.replace(/\n/g, ' ¶ ').slice(0, 90));
ok('INP HISTORY 输出保留（S1-S11 协议）', /\*OUTPUT, HISTORY/.test(inp) && /(^|\n)RF, U/.test(inp.match(/\*OUTPUT, HISTORY[\s\S]*?(?=\*\*|\*STEP|$)/)?.[0] ?? ''));

// ② CAE 套件 ZIP
const suiteZip = await exportViaMenu('caesuite');
const entries = parseStoredZip(suiteZip);
const sh = new TextDecoder().decode(entries['run_abaqus.sh'] ?? Buffer.alloc(0));
const runner = new TextDecoder().decode(entries['abaqus_auto_runner.py'] ?? Buffer.alloc(0));
ok('套件 ZIP 四件在位', !!entries['run_abaqus.sh'] && !!entries['abaqus_auto_runner.py'] && !!entries['run_openfoam.sh'] && !!entries['README.md'], Object.keys(entries).join(','));
ok('run_abaqus.sh 缺省 SPEC=20（总宽随包贯通）', /SPEC=\$\{2:-20\}/.test(sh), (sh.match(/SPEC=.*/) ?? [''])[0]);
ok('runner 绝对窗口（0.05/0.25 不乘 EPS_MAX）', /e <= 0\.05\b/.test(runner) && /0\.05 <= e <= 0\.25/.test(runner) && !/0\.05 \* EPS_MAX/.test(runner));
ok('runner 符号修正（force=-rf_sum）与 sigma_pl_valid 标记', /force\.append\(-rf_sum\)/.test(runner) && /sigma_pl_valid/.test(runner));
ok('runner 读 fieldOutputs[RF]（与 INP FIELD 契约闭环）', /fieldOutputs\['RF'\]/.test(runner));

ok('0 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
server.kill();
console.log(`\n== CAE CONTRACT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
