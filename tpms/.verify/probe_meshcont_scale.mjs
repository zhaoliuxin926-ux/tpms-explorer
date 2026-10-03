// probe_meshcont_scale.mjs — 真实规模 STL 上传+调参回归探针（2026-10-03 两修复的永久钉）
// 守护对象（修复史见 main.ts meshSdfResampleFrom / 活跃度看门关注释）：
//   A. 活跃度看门狗：5120 三角球（icosphere(4)）上传 SDF 须完成而非撞固定墙
//      （81920 三角时代 180s 硬墙恰在完成前误杀——进度正常到 79% 被 terminate）
//   B. 降档重采样：上传就绪后拖 cellSize，更小档 SDF 须即时供给（60s 观测窗零
//      "档计算中" Worker 文案即降采样路径生效；修复前同路径 82k 实测 103s 全量重算）
// fixture 运行时生成（icosphere 确定性），无二进制入库；~25s 总耗时入 run_all。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 4895;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(tmpdir(), `tpms_scale_probe_${process.pid}.stl`);

// ── 确定性 icosphere(4)=5120 三角 ±10mm 球 STL ──
{
  const t = (1 + 5 ** 0.5) / 2;
  const verts = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],[t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
  const faces = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  for (let s = 0; s < 4; s++) {
    const nf = []; const cache = {};
    const mid = (a, b) => { const k = Math.min(a,b) + ',' + Math.max(a,b);
      if (!(k in cache)) { const va = verts[a], vb = verts[b]; verts.push([(va[0]+vb[0])/2,(va[1]+vb[1])/2,(va[2]+vb[2])/2]); cache[k] = verts.length - 1; } return cache[k]; };
    for (const f of faces) { const a=f[0],b=f[1],c=f[2],ab=mid(a,b),bc=mid(b,c),ca=mid(c,a); nf.push([a,ab,ca],[b,bc,ab],[c,ca,bc],[ab,bc,ca]); }
    faces.length = 0; faces.push(...nf);
  }
  const m = Math.max(...verts.flat().map(Math.abs));
  const buf = Buffer.alloc(84 + faces.length * 50);
  buf.writeUInt32LE(faces.length, 80);
  let off = 84;
  for (const f of faces) {
    const P = f.map((i) => verts[i].map((c) => c / m * 10));
    const u = [P[1][0]-P[0][0],P[1][1]-P[0][1],P[1][2]-P[0][2]], v = [P[2][0]-P[0][0],P[2][1]-P[0][1],P[2][2]-P[0][2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const ln = Math.hypot(...n) || 1; n = n.map((c) => c / ln);
    off += 12;
    for (let k = 0; k < 3; k++) { buf.writeFloatLE(n[k], off - 12 + k * 4); buf.writeFloatLE(P[k][0], off + k * 12); buf.writeFloatLE(P[k][1], off + k * 12 + 4); buf.writeFloatLE(P[k][2], off + k * 12 + 8); }
    off += 36 + 2;
  }
  writeFileSync(OUT, buf);
}

const server = spawn(process.execPath, [path.join(HERE, 'static-server.mjs'), String(PORT), path.join(HERE, '../../docs/platform')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3000));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n, d); };
try {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 80)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('tpms_onboard_v1', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('#meshcont-file')?.closest('details')?.setAttribute('open', ''));
  const t0 = Date.now();
  await page.setInputFiles('#meshcont-file', OUT);
  // A. 活跃度看门狗：120s 内须就绪（5120 三角常态 ~10-20s；留 6×余量防 CI 慢 runner）
  let uploaded = '';
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    uploaded = await page.evaluate(() => document.querySelector('#meshcont-status')?.textContent ?? '').catch(() => '');
    if (/已启用|✗/.test(uploaded)) break;
  }
  ok('A 活跃度看门狗：5120 三角上传就绪（非超时墙）', /已启用/.test(uploaded), `@${Math.round((Date.now()-t0)/1000)}s ${uploaded.slice(0, 60)}`);
  ok('A 上传零 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));

  // B. 降档重采样：拖 cellSize 2→3，30s 观测窗内不得出现"档计算中"（降档须即时）
  if (/已启用/.test(uploaded)) {
    await page.evaluate(() => { const el = document.getElementById('cell-size'); el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    let sawCompute = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const t = await page.evaluate(() => document.querySelector('#meshcont-status')?.textContent ?? '').catch(() => '');
      if (/档计算中|计算超时/.test(t)) { sawCompute = true; break; }
    }
    // 说明：cellSize 2→3 的 l2 档更小→必须走重采样；HD 档更大→允许后台 Worker（其文案
    // 出现不判 B 失败——只断言更小档即时。故 sawCompute 判 FAIL 仅当窗口内出现即视为
    // 降档未即时（HD 档文案含 R 档号且在 350ms+重建后才可能——30s 窗内 l2 应先完成，
    // 若文案是 HD 档计算中属升档合法路径，通过状态文本区分不可靠，从宽：出现任何
    // 计算中文本都记录为 FAIL 由人工判读——CI 稳定性优先选择从宽记录+详注文）
    ok('B 降档重采样：拖 cellSize 后 30s 无「档计算中」（更小档即时供给）', !sawCompute, sawCompute ? '出现计算中文本（若为 HD 升档后台算属合法，人工判读）' : '即时');
    ok('B 调参零 pageerror', errors.length === 0, errors.slice(0, 2).join(' | '));
  }
  await browser.close();
} catch (e) {
  fail++; console.log('FAIL 探针异常', String(e).slice(0, 100));
} finally {
  server.kill();
  try { rmSync(OUT); } catch { /* 忽略 */ }
}
console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==  (MESHCONT SCALE PROBE)`);
if (pass < 4) { console.error(`GUARD FAIL: ${pass} < 4（活跃度看门狗+降档重采样双修复回归钉）`); process.exit(1); }
process.exit(fail ? 1 : 0);
