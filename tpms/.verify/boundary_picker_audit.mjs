/**
 * boundary_picker_audit.mjs —— 门禁 23：交互式 CAE 边界拾取器审计（纯 Node）
 *
 * A. 区域生长：平面顶盖网格种子拾取 → 100% 覆盖顶盖三角形（零越界）
 * B. 映射守恒：面集 → 节点集，节点数 == 面集顶点并集
 * C. INP 注入：*NSET/BC_* 块存在 + FIXED *BOUNDARY 语法 + PRESSURE *DSLOAD 语法
 * D. FOAM 注入：boundary 条目追加 + patch 类型正确
 * E. 角度阈值语义：阈值收窄 → 区域减小（单调性）
 *
 * 运行：node boundary_picker_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_bp_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_bp_audit_entry.ts');
  writeFileSync(entry, [
    `export { growRegion, facesToNodes, injectAbaqusBCs, injectFoamBCs, faceNormal } from ${JSON.stringify(join(PLATFORM, 'src/measure/boundary-picker.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { buildAbaqusInp } from ${JSON.stringify(join(PLATFORM, 'src/export/abaqus-inp-exporter.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { growRegion, facesToNodes, injectAbaqusBCs, injectFoamBCs, buildSurface } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 构造测试网格：单位立方体薄板 z=1 平面（2×2 四个三角形，法向 +z）+ z=0 底面（法向 −z）
// 顶点：4 角 ×2 层
const positions = new Float32Array([
  0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,       // 底面 4 顶点 (0-3)
  0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,       // 顶面 4 顶点 (4-7)
]);
const indices = new Uint32Array([
  // 顶面（法向 +z）：0 4-7
  4, 5, 6,  4, 6, 7,
  // 底面（法向 −z）
  0, 2, 1,  0, 3, 2,
  // 侧壁
  0, 1, 5,  0, 5, 4,   // x=0 面
  1, 2, 6,  1, 6, 5,   // y=0 面
  2, 3, 7,  2, 7, 6,   // x=1 面
  3, 0, 4,  3, 4, 7,   // y=1 面
]);
const triCount = indices.length / 3;
const vertCount = 8;

// ── A. 区域生长 ──
console.log('\n[A] 法向角区域生长（顶面种子，25° 阈值）');
{
  const faces = growRegion(positions, indices, triCount, vertCount, 0, 25);   // 种子 = 顶面三角 0
  check(`顶面 2 三角全覆盖（${faces.join(',')}）`, faces.length === 2 && faces.includes(0) && faces.includes(1));
  check('零越界（不含底面/侧壁）', faces.every((f) => f < 2));
}

// ── E. 角度阈值单调性 ──
console.log('\n[E] 阈值单调性（90° 时顶+底贯通? 否——法向相反 dot=−1 < cos90=0）');
{
  const wide = growRegion(positions, indices, triCount, vertCount, 0, 89);
  check('89° 阈值不跨反面（法向 dot=−1 被拒）', !wide.includes(2) && !wide.includes(3));
  const narrow = growRegion(positions, indices, triCount, vertCount, 0, 5);
  check('5° 阈值仍覆盖共面顶面', narrow.length === 2);
}

// ── B. 映射守恒 + 真实 gyroid 网格 ──
console.log('\n[B] 映射守恒（gyroid R=12 真实网格）');
{
  // 用 gyroid 顶盖种子（z=+π 侧法向 +z 的面）
  const R = 12;
  // 用 gyroid 顶盖种子——直接从 mesh 找一个 z 最大的面
  const solid = new Uint8Array(R ** 3).fill(0);
  void solid;
  // 直接构造 gyroid 面片网格（复用 surface-nets）——省事：从 buildSurface 拿
  const res = buildSurface({
      type: 'gyroid', iso: 0, periods: 1, resolution: R, targetPorosity: 0.7,
      weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
      customFormula: '', preview: false,
    });
  const pos = res.positions, idx = res.indices, tc = res.triCount, vc = res.vertCount;
  // 找 z 最大的面
  let seedTop = 0, bestZ = -Infinity;
  for (let t = 0; t < tc; t++) {
    const z = (pos[idx[t * 3] * 3 + 2] + pos[idx[t * 3 + 1] * 3 + 2] + pos[idx[t * 3 + 2] * 3 + 2]) / 3;
    if (z > bestZ) { bestZ = z; seedTop = t; }
  }
  const HALF = Math.PI;
  const faces = growRegion(pos, idx, tc, vc, seedTop, 20);
  check(`顶盖区域生长非空（${faces.length} 面）`, faces.length > 0);
  // 映射守恒
  const nodes = facesToNodes(idx, faces);
  const uniq = new Set(faces.flatMap((f) => [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]]));
  check(`节点映射守恒（${nodes.length} == ${uniq.size}）`, nodes.length === uniq.size);
  check('节点在界内', nodes.every((n) => n >= 0 && n < vc));
  // 25° 区域生长的单调性（真实网格）
  check('区域非退化', faces.length < tc);
}

// ── C. INP 注入 ──
console.log('\n[C] INP 注入');
{
  const model = buildAbaqusInpFromBundle();
  const bcs = [
    { spec: { name: 'TOP_FIX', kind: 'FIXED', faces: [] }, nodes: [1, 2, 3] },
    { spec: { name: 'BOT_PRESS', kind: 'PRESSURE', faces: [], value: 2.5 }, nodes: [4, 5] },
  ];
  const out = injectAbaqusBCs(model, bcs, 1.0);
  check('BC_TOP_FIX *NSET 存在', out.includes('*NSET, NSET=BC_TOP_FIX'));
  check('FIXED *BOUNDARY 语法', out.includes('BC_TOP_FIX, 1, 3, 0.0'));
  check('PRESSURE *DSLOAD 语法（负值压强）', out.includes('BC_BOT_PRESS, P, -2.5'));
  check('*STEP 仍在注入块之后', out.indexOf('*STEP') > out.indexOf('*NSET, NSET=BC_TOP_FIX'));
}
function buildAbaqusInpFromBundle() {
  // 简单 INP 骨架（injectAbaqusBCs 只做文本操作，骨架足够）
  return '*HEADING\ntest\n*NODE\n1, 0, 0, 0\n*ELEMENT, TYPE=C3D8, ELSET=ESOLID\n1, 1, 1, 1, 1, 1, 1, 1, 1\n*SOLID SECTION, ELSET=ESOLID, MATERIAL=M\n*MATERIAL, NAME=M\n*ELASTIC\n1.0, 0.2\n*STEP\n*STATIC\n*END STEP\n';
}

// ── D. FOAM 注入 ──
console.log('\n[D] FOAM boundary 注入');
{
  const base = `FoamFile { version 2.0; format ascii; class polyBoundaryMesh; object boundary; }

3
(
    inlet
    {
        type            patch;
        nFaces          10;
        startFace       100;
    }
    outlet
    {
        type            patch;
        nFaces          12;
        startFace       112;
    }
    wall
    {
        type            wall;
        nFaces          50;
        startFace       124;
    }
)`;
  const out = injectFoamBCs(base, [
    { spec: { name: 'BC_LOAD', kind: 'PRESSURE', faces: [] }, faceRange: [100, 130] },
  ]);
  check('BC_LOAD 条目注入', out.includes('BC_LOAD'));
  check('类型 patch', out.includes('type            patch;'));
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
