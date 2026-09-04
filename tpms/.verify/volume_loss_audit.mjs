// volume_loss_audit.mjs —— 网格体积损耗量化审计（数据基准，独立运行不进 CI 调度）
// 量化 surface-nets 网格固相体积相对解析等值面的偏差（type × R × porosity 表）。
// 运行：node volume_loss_audit.mjs
import { writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const DEBUG = process.argv.includes('--debug');

const BUNDLE = join(tmpdir(), 'volume_loss_audit_bundle.mjs');
{
  const fs = await import('node:fs');
  const entry = join(tmpdir(), `volume_loss_entry_${process.pid}.ts`);
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
    'src/core/tpms-functions.ts:getTpmsFunction',
  ];
  fs.writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
  fs.rmSync(entry, { force: true });
}
const { buildSurface, globalBufferPool, getTpmsFunction } = await import(pathToFileURL(BUNDLE));

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const RS = [48, 64, 96];
const PS = [0.3, 0.5, 0.65, 0.8];
const K = 6;
const W = [1, 1, 1, 1];

let seed = 123456789;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// 解析固相分数（多周期域采样，与 build 的函数域一致）
function analyticSolid(type, iso, samples) {
  const fn = getTpmsFunction(type);
  let solid = 0;
  for (let s = 0; s < samples; s++) {
    const px = (rnd() * 2 - 1) * Math.PI * K;
    const py = (rnd() * 2 - 1) * Math.PI * K;
    const pz = (rnd() * 2 - 1) * Math.PI * K;
    if (iso - fn(px, py, pz, W) > 0) solid++;
  }
  return solid / samples;
}

function build(type, iso, R) {
  globalBufferPool.reset();
  return buildSurface({
    type, iso, periods: K, resolution: R, targetPorosity: undefined,
    weights: W, structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  }, globalBufferPool);
}

function meshSolidFraction(res) {
  let vol6 = 0;
  const { positions, indices } = res;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  const mm3 = Math.pow(K / (2 * Math.PI), 3);
  const env = Math.pow(K, 3);
  return Math.min(1, Math.abs(vol6) / 6 * mm3 / env);
}

const rows = [];
let fail = 0;
console.log('体积损耗表（解析固相 − 网格固相，正 = 网格缺料）');
for (const type of TYPES) {
  for (const p of PS) {
    let lo = -1.6, hi = 1.6;
    for (let it = 0; it < 28; it++) {
      const mid = (lo + hi) / 2;
      if (analyticSolid(type, mid, 100000) > 1 - p) lo = mid; else hi = mid;
    }
    const iso = (lo + hi) / 2;
    const ana = analyticSolid(type, iso, 300000);
    const cells = [];
    for (const R of RS) {
      const res = build(type, iso, R);
      const mesh = meshSolidFraction(res);
      const lossPp = (ana - mesh) * 100;
      cells.push(`R${R}:${lossPp.toFixed(2)}`);
      if (lossPp < -15 || lossPp > 15) fail++;
    }
    rows.push(`${type} p${p}: ${cells.join(' | ')}`);
    console.log(rows[rows.length - 1]);
  }
}

writeFileSync(join(HERE, 'volume_loss_table.txt'), rows.join('\n') + '\n');
console.log(`\nRESULT: VOLUME-LOSS-TABLE rows=${rows.length} fail=${fail}`);
process.exit(fail ? 1 : 0);
