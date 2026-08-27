/**
 * export_audit.mjs —— 浏览器端到端：单文件版 STL 导出 → trimesh 水密/体积/定向核验
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'shots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`[PAGEERROR] ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`); });

await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const CASES = [
  { name: 'gyroid75-default', file: 'sf-gyroid75.stl' },
  { name: 'diamond75', file: 'sf-diamond75.stl', clickType: 'diamond' },
];

for (const tc of CASES) {
  if (tc.clickType) {
    await page.evaluate((t) => { document.querySelector(`[data-type="${t}"]`)?.click(); }, tc.clickType);
    await page.waitForTimeout(1500);   // 等高清重建
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => { document.getElementById('btn-stl')?.click(); }),
  ]);
  const p = path.join(OUT, tc.file);
  await download.saveAs(p);
  const size = fs.statSync(p).size;
  console.log(`${tc.name}: STL ${size} bytes -> ${tc.file}`);
}
await browser.close();

// trimesh 审计
for (const tc of CASES) {
  const p = path.join(OUT, tc.file);
  const r = execSync(`python -c "
import trimesh
m = trimesh.load(r'${p.replaceAll('\\', '/')}')
frac = m.volume / (m.bounding_box.volume) if m.bounding_box.volume else 0
print(f'watertight={m.is_watertight} winding={m.is_winding_consistent} vol={m.volume:.3f} bboxVol={m.bounding_box.volume:.3f} solidFrac={frac:.4f} bodies={m.body_count}')
"`).toString().trim();
  console.log(`${tc.name}: ${r}`);
}
console.log('console errors:', errors.length ? errors.join(' | ') : '(none)');
