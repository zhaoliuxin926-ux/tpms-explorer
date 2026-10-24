// probe_delivery_pkg.mjs — 批三交付包验收（2026-10-24，一次性快检，不入 CI）
// 链路：置态→导出交付包 ZIP→node 解包→manifest 哈希链核对（逐文件 sha256 前 16 重算）→
// 尺寸契约/水密审计字段→包内 design.json 经导入路径恢复（换电脑可复现）→fcks 拒产不交付。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 4859;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const BASE = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), DEPLOYED]);
await new Promise((r) => setTimeout(r, 4000));

const browser = await chromium.launch({
  channel: 'chrome', executablePath: process.platform === 'win32' ? chromePath : undefined,
  args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(90_000);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
page.on('pageerror', (e) => console.error('  [pageerror]', String(e.message).slice(0, 160)));

// STORED ZIP 解析（零依赖：顺序读 local file header，compression=0）
function parseStoredZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const td = new TextDecoder();
  const entries = {};
  let off = 0;
  while (off + 4 <= buf.byteLength && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    if (method !== 0) throw new Error('non-stored entry @' + off);
    const compSize = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = td.decode(u8.subarray(off + 30, off + 30 + nameLen));
    const dataStart = off + 30 + nameLen + extraLen;
    entries[name] = u8.slice(dataStart, dataStart + compSize);
    off = dataStart + compSize;
  }
  return entries;
}
const sha16 = (u8) => createHash('sha256').update(u8).digest('hex').slice(0, 16);

async function waitBuild() {
  await page.waitForFunction(() => {
    const tris = document.querySelector('#stat-tris')?.textContent ?? '';
    const loading = document.querySelector('#loading');
    return /\d/.test(tris) && (!loading || loading.style.display === 'none' || !loading.classList.contains('on'));
  }, { timeout: 90_000, polling: 400 });
}
async function menuExport(fmt) {
  await page.evaluate(() => (document.getElementById('btn-export') instanceof HTMLElement) && document.getElementById('btn-export').click());
  await page.waitForTimeout(300);
  const dlPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.evaluate((f) => {
    const item = document.querySelector(`.xm-item[data-export="${f}"]`);
    if (!(item instanceof HTMLElement)) throw new Error('menu item not found: ' + f);
    item.click();
  }, fmt);
  return dlPromise;
}
async function injectDesignText(text) {
  await page.evaluate((t) => {
    const file = new File([t], 'design.json', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('#import-design-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

// 1. 置态 schwarz 75 k3（显示档水密直通）→ 导出交付包
await page.goto(`${BASE}?type=schwarz&porosity=75&cellSize=3`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await waitBuild();
await page.waitForTimeout(1200);
const dl = await menuExport('pkg');
const pkgName = dl.suggestedFilename() ?? '';
const zipBuf = readFileSync(await dl.path());
ok('包文件名含时间戳（同名导出不混淆）', /tpms-pkg-schwarz-p75-\d{12}\.zip$/.test(pkgName), pkgName);

// 2. 解包+manifest 哈希链核对
const entries = parseStoredZip(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength));
const names = Object.keys(entries);
const stlName = names.find((n) => n.endsWith('.stl')) ?? '';
ok('包内三件齐备（design.json+STL+manifest.json）',
  !!entries['design.json'] && !!stlName && !!entries['manifest.json'], names.join(', '));
const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
ok('manifest format=tpms-delivery/1.0', manifest.format === 'tpms-delivery/1.0', String(manifest.format));
const stlEntry = (manifest.files ?? []).find((f) => f.name?.endsWith('.stl'));
const dsgEntry = (manifest.files ?? []).find((f) => f.name === 'design.json');
ok('manifest 哈希链：design.json sha256 前 16 与实包文件一致',
  dsgEntry && dsgEntry.sha256_16 === sha16(entries['design.json']), `${dsgEntry?.sha256_16} vs ${sha16(entries['design.json'])}`);
ok('manifest 哈希链：STL sha256 前 16 与实包文件一致',
  stlEntry && stlEntry.sha256_16 === sha16(entries[stlName]), `${stlEntry?.sha256_16} vs ${sha16(entries[stlName])}`);
ok('manifest 尺寸契约在位（总宽/周期/单胞+口径注记）',
  manifest.sizeContract?.periods === 3 && manifest.sizeContract?.cellSizeMm === 1 && typeof manifest.sizeContract?.convention === 'string');
ok('manifest 水密审计实测值（交付门已过=全零）',
  manifest.meshAudit?.openEdges === 0 && manifest.meshAudit?.nonManifoldEdges === 0 && manifest.meshAudit?.degenTris === 0,
  JSON.stringify(manifest.meshAudit ?? {}));
ok('manifest 模型口径溯源（exact/meshHash/C1 来源注记）',
  typeof manifest.modelProvenance?.meshHash === 'string' && typeof manifest.modelProvenance?.exactSolver === 'boolean' && /gibson-ashby/.test(String(manifest.modelProvenance?.note ?? '')));
ok('包内 STL 为二进制且三角数>0（水密网格随包交付）',
  entries[stlName]?.byteLength > 84 && new DataView(entries[stlName].buffer, entries[stlName].byteOffset).getUint32(80, true) > 0,
  `${entries[stlName]?.byteLength} bytes`);

// 3. 换电脑可恢复：包内 design.json 经导入路径恢复设计
const designInPkg = new TextDecoder().decode(entries['design.json']);
const dJson = JSON.parse(designInPkg);
ok('包内 design.json 为 tpms-design/1.0 且含置态', dJson.format === 'tpms-design/1.0' && dJson.state?.type === 'schwarz' && dJson.state?.porosity === 75);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await waitBuild();
await page.waitForTimeout(1000);
const titleBefore = await page.evaluate(() => document.title);
await injectDesignText(designInPkg);
await page.waitForFunction((t0) => document.title !== t0, titleBefore, { timeout: 90_000, polling: 400 }).catch(() => {});
await waitBuild();
await page.waitForTimeout(1500);
const titleRestored = await page.evaluate(() => document.title);
ok('包内 design.json 导入恢复（title→Schwarz）', /Schwarz/i.test(titleRestored), `title=${titleRestored}`);

// 4. fcks 负例：交付包过水密门——升档后仍结构性非水密 → 拒不交付
await page.goto(`${BASE}?type=fcks&porosity=75&cellSize=3`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await waitBuild();
await page.waitForTimeout(1000);
await page.evaluate(() => {
  (window).__pkgToasts = [];
  new MutationObserver(() => {
    const x = document.querySelector('#toast')?.textContent ?? '';
    if (x) (window).__pkgToasts.push(x);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
let dl2Fired = false;
const dl2 = page.waitForEvent('download', { timeout: 90_000 }).then(() => { dl2Fired = true; }).catch(() => {});
await page.evaluate(() => (document.getElementById('btn-export') instanceof HTMLElement) && document.getElementById('btn-export').click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const item = document.querySelector('.xm-item[data-export="pkg"]');
  if (item instanceof HTMLElement) item.click();
});
await page.waitForFunction(() => ((window).__pkgToasts || []).some((x) => x.includes('已阻止导出')), { timeout: 90_000, polling: 300 })
  .then(() => ok('fcks 交付包被水密门硬拒（toast 已阻止导出）', true))
  .catch(() => ok('fcks 交付包被水密门硬拒', false, '无阻止 toast'));
await dl2;
ok('fcks 拒产时交付包不下载', !dl2Fired);

await browser.close();
server.kill();
console.log(`\n== DELIVERY PKG PROBE: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
