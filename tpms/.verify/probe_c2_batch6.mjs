/**
 * probe_c2_batch6.mjs —— C2 第六批（slotp/fs/qstar/ws）可产域探针（独立运行，不进 CI）
 *
 * 四曲面公式源：jwf23/Equation-Based-Lattice-Structure-Dataset（CC BY）。
 * 落地全链（13 文件四方同源）前先实测 surface-nets 可产域（C2 纪律）：
 * R{48,96} × p{0.5,0.6} × k2/k3 —— 输出 open/nm/degen/miso/孔隙率偏差。
 * 复跑：node probe_c2_batch6.mjs
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_c2b6_probe_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_c2b6_probe_entry.ts');
  const mods = [
    'src/geometry/surface-nets.ts:buildSurface',
    'src/geometry/buffer-pool.ts:globalBufferPool',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, globalBufferPool } = await import(pathToFileURL(BUNDLE));

// ── 审计（mesh_audit 同款轻量版：边配对 + 退化面）──
function auditMesh(positions, indices) {
  const edge = new Map();
  const addE = (a, b) => {
    const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    const dir = a < b ? 1 : 2;
    const e = edge.get(k) || { c: 0, d: 0 };
    e.c++; e.d |= dir;
    edge.set(k, e);
  };
  for (let t = 0; t < indices.length; t += 3) {
    addE(indices[t], indices[t + 1]);
    addE(indices[t + 1], indices[t + 2]);
    addE(indices[t + 2], indices[t]);
  }
  let openEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0, degenTris = 0;
  for (const e of edge.values()) {
    if (e.c === 1) openEdges++;
    else if (e.c > 2) nonManifoldEdges++;
    if (e.c === 2 && e.d !== 3) misorientedEdges++;
  }
  for (let t = 0; t < indices.length; t += 3) {
    if (indices[t] === indices[t + 1] || indices[t + 1] === indices[t + 2] || indices[t] === indices[t + 2]) degenTris++;
  }
  return { triCount: indices.length / 3, openEdges, nonManifoldEdges, misorientedEdges, degenTris };
}

const CASES = [];
for (const type of ['slotp', 'fs', 'qstar', 'ws']) {
  for (const R of [48, 96]) {
    for (const p of [0.5, 0.6]) {
      CASES.push({ type, R, p, k: 2 });
    }
  }
}

console.log('曲面  R   p    k | 三角    open  nm    miso  degen | 孔隙率实测(目标)');
for (const tc of CASES) {
  const params = {
    type: tc.type, iso: 0, periods: tc.k, resolution: tc.R, targetPorosity: tc.p,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  };
  globalBufferPool.reset();
  let res = null;
  try { res = buildSurface(params, globalBufferPool); } catch (e) {
    console.log(`${tc.type.padEnd(5)} R${tc.R} p${tc.p} k${tc.k} | 抛错: ${e.message.slice(0, 60)}`);
    continue;
  }
  const a = auditMesh(res.positions, res.indices);
  console.log(
    `${tc.type.padEnd(5)} R${String(tc.R).padEnd(3)} p${tc.p} k${tc.k} | ${String(a.triCount).padEnd(6)} ${String(a.openEdges).padEnd(5)} ${String(a.nonManifoldEdges).padEnd(5)} ${String(a.misorientedEdges).padEnd(5)} ${String(a.degenTris).padEnd(5)} | ${(res.porosityEstimate * 100).toFixed(2)}% (${tc.p * 100}%)`
  );
}
