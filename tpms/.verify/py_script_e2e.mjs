/**
 * py_script_e2e.mjs —— 端到端：平台导出 Python 脚本 → pyvista 实跑 → 网格核验
 */
import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'shots');
fs.mkdirSync(OUT, { recursive: true });
// 平台部署在 docs/platform，走 8123 静态服务
const BASE = 'http://127.0.0.1:8123/platform/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 打开导出中心，下载 Python 脚本
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.evaluate(() => {
    document.getElementById('btn-export')?.click();
    const item = document.querySelector('[data-export="py"], [data-format="py"]');
    if (item) item.click();
    else {
      const btns = [...document.querySelectorAll('button, a')];
      const target = btns.find(b => /python/i.test(b.textContent || ''));
      target?.click();
    }
  }),
]);
const pyPath = path.join(OUT, 'exported_script.py');
await download.saveAs(pyPath);
console.log('python script saved:', fs.statSync(pyPath).size, 'bytes');
await browser.close();

// 实跑
const workdir = path.join(OUT, 'pyrun');
fs.mkdirSync(workdir, { recursive: true });
fs.copyFileSync(pyPath, path.join(workdir, 'script.py'));
const out = execSync(`cd "${workdir.replaceAll('\\', '/')}" && python script.py`, { encoding: 'utf8', timeout: 300000 });
console.log('script stdout:', out.trim().split('\n').pop());

// 核验
const check = execSync(`cd "${workdir.replaceAll('\\', '/')}" && python -c "
import trimesh
m = trimesh.load('tpms_reconstructed.vtk')
import numpy as np
e = np.sort(m.faces[:, [[0,1],[1,2],[2,0]]].reshape(-1,2), axis=1)
ue, cnt = np.unique(e, axis=0, return_counts=True)
print(f'verts={m.vertices.shape[0]} faces={m.faces.shape[0]} openEdges={int((cnt==1).sum())} vol={m.volume:.3f}')
"`).toString().trim();
console.log('mesh check:', check);
console.log('pageerrors:', errors.length ? errors.join(' | ') : '(none)');
