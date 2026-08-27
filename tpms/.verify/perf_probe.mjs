/**
 * perf_probe.mjs —— 重建性能计时（独立打包 buffer-pool + surface-nets）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PLATFORM = 'D:/AI Project/tpms/tpms/tpms-platform';
const dir = join(tmpdir(), 'tpms_perf2');
mkdirSync(dir, { recursive: true });

// 复用 mesh_audit 的打包产物（先跑一次 node mesh_audit.mjs 确保存在）
const BUNDLE = join(tmpdir(), 'tpms_mesh_audit_bundle.mjs');
if (!existsSync(BUNDLE)) { console.error('先运行 node mesh_audit.mjs 生成 bundle'); process.exit(1); }
const mod = await import(pathToFileURL(BUNDLE));
const { buildSurface, globalBufferPool } = mod;
const CASES = [
  ['gyroid solid75 k3 R61 (默认高清)', { type: 'gyroid', periods: 3, R: 61, mode: 'solid_network', p: 0.75 }],
  ['gyroid solid75 k5 R88 (大模型)', { type: 'gyroid', periods: 5, R: 88, mode: 'solid_network', p: 0.75 }],
  ['frd solid75 k3 R88 (倍频)', { type: 'frd', periods: 3, R: 88, mode: 'solid_network', p: 0.75 }],
  ['schwarz shell70 k3 R61 (壳)', { type: 'schwarz', periods: 3, R: 61, mode: 'shell', p: 0.70 }],
];

for (const [name, tc] of CASES) {
  globalBufferPool.reset();
  if (name.includes('默认')) console.log('TC:', JSON.stringify(tc), 'keys:', Object.keys(tc));
  const res = buildSurface({
    type: tc.type, iso: 0, periods: tc.periods, resolution: tc.R, targetPorosity: tc.p,
    weights: [1, 1, 1, 1], structureMode: tc.mode, containerShape: 'cube', thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
  }, globalBufferPool);
  console.log(`${name}: ${res.buildTimeMs.toFixed(0)} ms, verts=${res.vertCount}, tris=${res.triCount}, 孔隙率(实测)=${(res.porosityEstimate * 100).toFixed(1)}%`);
}
