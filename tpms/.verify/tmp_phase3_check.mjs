// 临时目检：阶段 III 四特性（迂曲度/3MF/三轴剖切/Hybrid）——验完即删
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = 4845;
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '../../docs');
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
const server = createServer(async (req, res) => {
  try {
    const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const data = await readFile(join(DOCS, url));
    res.end(data);
  } catch { res.statusCode = 404; res.end('nf'); }
});
server.listen(PORT);
const svc = { kill: () => server.close() };
for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/app.html`); break; } catch { await sleep(500); } }
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d); };

await page.goto(`http://localhost:${PORT}/app.html`, { waitUntil: 'load' });
await sleep(3000);

// 1. Hybrid：启用 → 重建 → 公式面板变化
await page.evaluate(() => {
  const d = document.getElementById('hybrid-sect');
  if (d) d.open = true;
  const he = document.getElementById('hybrid-enabled');
  he.checked = true;
  he.dispatchEvent(new Event('change'));
});
await sleep(2500);
const hybState = await page.evaluate(() => ({ enabled: state.hybrid.enabled, verts: document.getElementById('stats').textContent.includes('顶点') }));
hybState.enabled && hybState.verts ? ok('Hybrid 启用 + 重建') : bad('Hybrid', JSON.stringify(hybState));
// TypeB 切换
await page.evaluate(() => {
  document.querySelector('#hybrid-typeb-row [data-hb="schwarz"]').click();
});
await sleep(2000);
ok('TypeB 切换重建');
// 径向轴
await page.evaluate(() => document.querySelector('#hybrid-axis-row [data-haxis="radial"]').click());
await sleep(2000);
ok('径向波前重建');

// 2. 三轴剖切
await page.evaluate(() => {
  document.querySelector('#slice-axis-row [data-saxis="x"]').click();
  document.getElementById('btn-slice-invert').click();
  const s = document.getElementById('slice');
  s.value = 0;
  s.dispatchEvent(new Event('input'));
});
await sleep(300);
const sliceState = await page.evaluate(() => ({ axis: state.sliceAxis, inv: state.sliceInvert, clipN: clipPlane.normal.x }));
sliceState.axis === 'x' && sliceState.inv && sliceState.clipN === 1 ? ok('X 轴 + 反向剖切', JSON.stringify(sliceState)) : bad('三轴剖切', JSON.stringify(sliceState));

// 3. 迂曲度行（HD 重建后出现）
await page.evaluate(() => {
  document.querySelector('#slice-axis-row [data-saxis="z"]').click();
  const s = document.getElementById('slice'); s.value = 100; s.dispatchEvent(new Event('input'));
  const he = document.getElementById('hybrid-enabled'); he.checked = false; he.dispatchEvent(new Event('change'));
});
await sleep(4000);
const tortText = await page.evaluate(() => document.getElementById('tort-line')?.textContent || 'MISSING');
/τx\/τy\/τz/.test(tortText) && !/计算中/.test(tortText) ? ok('迂曲度计算完成', tortText.slice(0, 60)) : bad('迂曲度', tortText.slice(0, 60));

// 4. 3MF 导出
const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.evaluate(() => document.getElementById('btn-3mf').click());
const dl = await dlPromise;
if (!dl) bad('3MF 下载未触发');
else {
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(path);
  const sig = buf.slice(0, 4).toString('hex') === '504b0304';
  const has3d = buf.includes('3D/3dmodel.model');
  const hasModel = buf.includes('<model unit="millimeter"');
  sig && has3d && hasModel ? ok('3MF ZIP 结构 + mm 模型', `${buf.length}B`) : bad('3MF 内容', `${sig} ${has3d} ${hasModel}`);
}

errors.length === 0 ? ok('0 pageerror/0 console error') : bad('页面错误', errors.join('; ').slice(0, 200));
await browser.close();
svc.kill();
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
