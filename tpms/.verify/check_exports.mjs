import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8123';
const results = [];
function log(label, ok, detail=''){ results.push({label, ok, detail}); console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?'  ::  '+detail:''}`); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default','--enable-gpu','--ignore-gpu-blocklist','--enable-webgl'] });

// 带参进入：不弹引导，且确保生成曲面（baseGeo 非空）
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept()); // 万一出现杆模型确认框，自动接受
await page.goto(BASE + '/app.html?type=gyroid&porosity=70', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 确认 3D 已渲染（baseGeo 存在）
const statsText = await page.locator('#stats').textContent();
const rendered = /顶点\s*\d/.test(statsText);
log('进入即渲染（baseGeo 就绪）', rendered, `stats="${statsText.replace(/\s+/g,' ').trim().slice(0,60)}"`);

// ---- glTF (.glb) 导出校验 ----
{
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-gltf').click(),
  ]);
  const name = download.suggestedFilename();
  const path = await download.path();
  const buf = fs.readFileSync(path);
  const magic = buf.slice(0, 4).toString('latin1');
  const okName = name.endsWith('.glb');
  const okMagic = magic === 'glTF';          // glTF 二进制文件头 0x676C5446
  const okSize = buf.length > 1024;          // 非空且有实际几何
  log('glTF 下载文件名 .glb', okName, `name=${name}`);
  log('glTF 二进制文件头 glTF', okMagic, `magic=${JSON.stringify(magic)}`);
  log('glTF 体积有效 (>1KB)', okSize, `bytes=${buf.length}`);
}

// ---- OBJ 导出校验 ----
{
  const [ download ] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-obj').click(),
  ]);
  const name = download.suggestedFilename();
  const path = await download.path();
  const text = fs.readFileSync(path, 'utf8');
  const okName = name.endsWith('.obj');
  const okVerts = (text.match(/^v\s/gm) || []).length > 100;   // 顶点数充足
  const okFaces = (text.match(/^f\s/gm) || []).length > 100;   // 面数充足
  log('OBJ 下载文件名 .obj', okName, `name=${name}`);
  log('OBJ 含有效顶点 (v >100)', okVerts, `verts=${(text.match(/^v\s/gm)||[]).length}`);
  log('OBJ 含有效面 (f >100)', okFaces, `faces=${(text.match(/^f\s/gm)||[]).length}`);
}

await browser.close();

const failed = results.filter(r => !r.ok);
console.log('\n==== EXPORT SUMMARY ====');
console.log(`PASS ${results.length - failed.length} / ${results.length}`);
if (failed.length) { failed.forEach(f => console.log(`  - ${f.label} (${f.detail})`)); process.exit(1); }
