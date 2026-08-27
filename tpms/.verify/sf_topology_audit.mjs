/**
 * sf_topology_audit.mjs —— 页面内直调单文件版 buildSurface，精确索引级拓扑审计
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=default'] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
await page.goto('http://127.0.0.1:8123/app.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const CASES = [
  { name: 'gyroid75-solid', args: { type: 'gyroid', iso: 0, periods: 3, R: 48, options: { targetPorosity: 75, weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube', thickness: 1, preview: false } } },
  { name: 'diamond75-solid', args: { type: 'diamond', iso: 0, periods: 3, R: 48, options: { targetPorosity: 75, weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube', thickness: 1, preview: false } } },
  { name: 'schwarz-shell70', args: { type: 'schwarz', iso: 0, periods: 3, R: 48, options: { targetPorosity: 70, weights: [1, 1, 1, 1], structureMode: 'shell', containerShape: 'cube', thickness: 1, preview: false } } },
];

for (const tc of CASES) {
  const r = await page.evaluate((tc) => {
    const res = window.buildSurface(tc.args.type, tc.args.iso, tc.args.periods, tc.args.R, tc.args.options);
    const idx = res.geo.index.array;
    const pos = res.geo.attributes.position.array;
    const n = idx.length / 3 | 0;
    let maxV = 0; for (let i = 0; i < idx.length; i++) if (idx[i] > maxV) maxV = idx[i];
    const KM = maxV + 1;
    const edge = new Map();
    for (let t = 0; t < n; t++) {
      const a = idx[t*3], b = idx[t*3+1], c = idx[t*3+2];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? u * KM + v : v * KM + u;
        let rec = edge.get(key); if (!rec) { rec = [0, 0]; edge.set(key, rec); }
        if (u < v) rec[0]++; else rec[1]++;
      }
    }
    let open = 0, nm = 0, mis = 0;
    for (const [, [ab, ba]] of edge) {
      const tot = ab + ba;
      if (tot === 1) open++;
      else if (tot > 2) nm++;
      else if (ab === 0 || ba === 0) mis++;
    }
    let vol6 = 0;
    for (let t = 0; t < n; t++) {
      const i0 = idx[t*3]*3, i1 = idx[t*3+1]*3, i2 = idx[t*3+2]*3;
      vol6 += pos[i0]*(pos[i1+1]*pos[i2+2]-pos[i1+2]*pos[i2+1])
        + pos[i0+1]*(pos[i1+2]*pos[i2]-pos[i1]*pos[i2+2])
        + pos[i0+2]*(pos[i1]*pos[i2+1]-pos[i1+1]*pos[i2]);
    }
    const vol = Math.abs(vol6) / 6;   // wc³；box = (2π·k/2π)³ wc?? 无所谓，看比例
    const boxVol = Math.pow(2 * Math.PI * tc.args.periods / (2 * Math.PI) * (2 * Math.PI / (2 * Math.PI)), 3);
    return { verts: res.vertCount, tris: n, open, nm, mis, volWc: vol, poroEst: res.porosityEstimate };
  }, tc);
  const solidFrac = r.volWc / Math.pow(2 * Math.PI, 3);
  console.log(`${tc.name}: verts=${r.verts} 开放边=${r.open} 非流形=${r.nm} 定向错=${r.mis} | 固相占比=${(solidFrac * 100).toFixed(2)}% (目标 ${(100 - r.poroEst * 100).toFixed(1)}%)`);
}
console.log('pageerrors:', errors.length ? errors.join(' | ') : '(none)');
await browser.close();
