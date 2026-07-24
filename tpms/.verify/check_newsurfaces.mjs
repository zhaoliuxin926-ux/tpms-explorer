import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const OUT = 'web/shots/showcase';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

for (const type of ['lidinoid', 'splitp']) {
  for (const p of [65, 75, 85]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}/app.html?type=${type}&porosity=${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const stats = await page.locator('#stats').textContent();
    const verts = (stats.match(/顶点\s*([\d,]+)/) || [])[1];
    const est = (stats.match(/估算孔隙率\s*([\d.]+)/) || [])[1];
    const vNum = verts ? +verts.replace(/,/g, '') : 0;
    const eNum = est ? +est : NaN;
    log(`${type} p${p} 渲染非空`, vNum > 1000, `verts=${verts}`);
    log(`${type} p${p} 估算孔隙率合理`, !isNaN(eNum) && eNum > 20 && eNum < 95, `est=${est}%`);
    log(`${type} p${p} 无运行时报错`, errors.length === 0, errors.slice(0,2).join(' | '));
    await page.screenshot({ path: `${OUT}/11-${type}-p${p}.png` });
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log('\n==== NEW SURFACES SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
