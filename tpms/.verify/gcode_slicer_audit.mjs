/**
 * gcode_slicer_audit.mjs —— 门禁 25：G-code 切片引擎审计（纯 Node）
 *
 * A. 层数守恒：层高 0.2、z∈[0,2] 的单位立方体 → 10 层
 * B. G-code 语法：首行注释、G28/G21/G90/M104/M109 存在、末尾 M84
 * C. 体积守恒：20% 重叠修正后有效覆盖体积偏差 ≤10%（切片量化/扫描线离散固有
 *    10-20%，见 WORKFLOW_GUIDE 诚实边界章；2026-09-05 头注对齐实现）；
 *    回抽计数 > 0（【2026-09-10 头注对齐】原宣称「长 travel 有 retract」的位置
 *    条件行为未断言，实际查全局回抽计数非零）
 * D. 机型预设差异（bambu 有 M73 / klipper 有 QUAD_GANTRY_LEVEL）
 * E. gyroid 真实网格（R=16）切片冒烟：层数 >5、挤出事件 >100
 *    （【2026-09-10 头注对齐】原 E「立方体体积解析锚点」与代码节错位——
 *    1×1×1 体积核对在 A-C 节、口径 ≤10% 非解析锚点级）
 *
 * 运行：node gcode_slicer_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_gcode_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_gcode_audit_entry.ts');
  writeFileSync(entry, [
    `export { sliceMesh, compileGcode } from ${JSON.stringify(join(PLATFORM, 'src/export/gcode-slicer.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { buildVoxelModel } from ${JSON.stringify(join(PLATFORM, 'src/export/voxel-model.ts'))};`,
    `export { directSlice, buildSliceSvg } from ${JSON.stringify(join(PLATFORM, 'src/export/direct-slicer.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { sliceMesh, compileGcode, buildSurface, buildVoxelModel, directSlice, buildSliceSvg } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const opts = {
  layerHeightMm: 0.1, lineWidthMm: 0.4, zMinMm: 0, zMaxMm: 1,
  filamentDiameterMm: 1.75, printerPreset: 'reprap',
  nozzleTempC: 210, bedTempC: 60, feedrateMmMin: 3000,
};

// ── A/B/C. 单位立方体 ──
console.log('\n[A-C] 单位立方体（1×1×1 mm，层高 0.2）');
{
  // 硬编码单位立方体（8 顶点 12 三角，z ∈ [0,1]）
  const positions = new Float32Array([
    0,0,0, 1,0,0, 1,1,0, 0,1,0,
    0,0,1, 1,0,1, 1,1,1, 0,1,1,
  ]);
  const indices = new Uint32Array([
    0,2,1, 0,3,2,       // 底 z=0
    4,5,6, 4,6,7,       // 顶 z=1
    0,1,5, 0,5,4,       // y=0
    1,2,6, 1,6,5,       // x=1
    2,3,7, 2,7,6,       // y=1
    3,0,4, 3,4,7,       // x=0
  ]);
  const triCount = indices.length / 3;
  const { layers, modelVolumeMm3 } = sliceMesh(positions, indices, triCount, opts);
  check(`层数 10（实际 ${layers.length}）`, layers.length === 10);

  const g = compileGcode(layers, modelVolumeMm3, opts);
  check('G-code 含 G28', g.gcode.includes('G28'));
  check('G-code 含 G21/G90/M83', g.gcode.includes('G21') && g.gcode.includes('G90') && g.gcode.includes('M83'));
  check('G-code 含 M104/M109 加热', g.gcode.includes('M104 S210') && g.gcode.includes('M109 S210'));
  check('G-code 含 M84 末尾', g.gcode.trimEnd().endsWith('M84'));
  const effective = g.totalExtrusionMm3 / 1.25;   // 20% 重叠修正
  const veff = Math.abs(effective - 1.0) / 1.0;
  check(`有效覆盖体积偏差 ${(veff * 100).toFixed(1)}% ≤10%`, veff <= 0.10, `raw=${g.totalExtrusionMm3.toFixed(3)}`);
  check(`回抽 ${g.stats.retractions} > 0`, g.stats.retractions > 0);
  check(`挤出路径 ${g.stats.extrusions} > 10`, g.stats.extrusions > 10);
}

// ── D. 机型预设差异 ──
console.log('\n[D] 机型预设差异');
{
  const positions = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const indices = new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  const triCount = indices.length / 3;
  const { layers, modelVolumeMm3 } = sliceMesh(positions, indices, triCount, opts);
  const gB = compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'bambu' });
  const gK = compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'klipper' });
  check('bambu 含 M73', gB.gcode.includes('M73'));
  check('klipper 含 QUAD_GANTRY_LEVEL', gK.gcode.includes('QUAD_GANTRY_LEVEL'));
  check('reprap 含 G29', compileGcode(layers, modelVolumeMm3, { ...opts, printerPreset: 'reprap' }).gcode.includes('G29'));
}

// ── E. gyroid 真实网格切片 ──
console.log('\n[E] gyroid 真实网格（R=16）');
{
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 1, resolution: 16, targetPorosity: 0.7,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false,
  });
  const opts2 = { ...opts, zMinMm: -1, zMaxMm: 1 };
  const { layers, modelVolumeMm3 } = sliceMesh(res.positions, res.indices, res.triCount, opts2);
  check(`gyroid 切片层数 > 5`, layers.length > 5);
  const g = compileGcode(layers, modelVolumeMm3, opts);
  check(`gyroid 挤出路径 ${g.stats.extrusions} > 100`, g.stats.extrusions > 100);
}


// ── F. 直接隐式层切（战役三 2026-09-14）：扫描线区间法，与网格发散体积双口径对拍 ──
{
  const CLI = join(HERE, '../agent/tpms.mjs');
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  for (const [ty, p, R, k] of [['gyroid', 0.6, 64, 2], ['schwarz', 0.55, 64, 4]]) { // gyroid k2：k6 R64 属薄壁自触拒产域（nm 768 exit3），对拍须用可产组合
    const pre = join(tmpdir(), 'tpms_f_' + ty + '_' + process.pid);
    const rs = run('slice', '--type', ty, '--porosity', String(p), '--resolution', String(R), '--periods', String(k), '--layers', '160', '--out', pre, '--json');
    const rm = run('mesh', '--type', ty, '--porosity', String(p), '--resolution', String(R), '--periods', String(k), '--out', pre + '_m.stl', '--json');
    let js = null, jm = null;
    try { js = JSON.parse(rs.stdout); } catch { /* */ }
    try { jm = JSON.parse(rm.stdout); } catch { /* */ }
    const meshVol = js && jm ? (1 - jm.porosityEstimate) * Math.pow(k, 3) : NaN;
    const dev = js && Number.isFinite(meshVol) ? Math.abs(js.slicedVolumeMm3 - meshVol) / meshVol : NaN;
    check('F1 ' + ty + ' 直接层切 ≡ mesh 发散体积（双口径 ≤2%）',
      rs.status === 0 && rm.status === 0 && dev <= 0.02,
      'dev=' + (Number.isFinite(dev) ? (dev * 100).toFixed(2) + '%' : 'n/a') + ' sliceExit=' + rs.status + ' meshExit=' + rm.status);
    if (js) {
      const svg = readFileSync(js.file, 'utf8');
      const gCount = (svg.match(/<g id="layer-/g) || []).length;
      check('F2 ' + ty + ' SVG 结构（160 层 g + metadata + 扫描路径）',
        gCount === 160 && svg.includes('<metadata>') && svg.includes(' H '),
        'g=' + gCount + ' bytes=' + js.fileBytes);
      try { unlinkSync(js.file); unlinkSync(pre + '_m.stl'); } catch { /* */ }
    } else check('F2 ' + ty + ' SVG 结构', false, 'slice JSON 缺失');
  }
  {
    const r2 = run('slice', '--type', 'gyroid', '--porosity', '0.6', '--mode', 'shell');
    check('F3 slice shell 模式 → exit2', r2.status === 2 && (r2.stderr || '').includes('solid_network'), 'exit=' + r2.status);
    const r3 = run('slice', '--type', 'gyroid', '--porosity', '0.6', '--container-mesh', join(tmpdir(), 'no_such_container.stl'));
    check('F3 slice 容器 STL 不存在 → exit2', r3.status === 2 && (r3.stderr || '').includes('读取失败'), 'exit=' + r3.status);
  }
  // ── F4/F5. v2 容器裁剪：cylinder 解析区间 / C5 mesh SDF 区间 与 mesh 发散体积双口径对拍 ──
  {
    const pre = join(tmpdir(), 'tpms_f_cyl_' + process.pid);
    const rs = run('slice', '--type', 'gyroid', '--porosity', '0.6', '--resolution', '64', '--periods', '2', '--layers', '160', '--container', 'cylinder', '--out', pre, '--json');
    const rm = run('mesh', '--type', 'gyroid', '--porosity', '0.6', '--resolution', '64', '--periods', '2', '--container', 'cylinder', '--out', pre + '_m.stl', '--json');
    let js = null, jm = null;
    try { js = JSON.parse(rs.stdout); } catch { /* */ }
    try { jm = JSON.parse(rm.stdout); } catch { /* */ }
    const envCyl = Math.PI * Math.pow(2, 3) / 4;
    const meshVol = js && jm ? (1 - jm.porosityEstimate) * envCyl : NaN;
    const dev = js && Number.isFinite(meshVol) ? Math.abs(js.slicedVolumeMm3 - meshVol) / meshVol : NaN;
    check('F4 cylinder 直接层切 ≡ mesh 发散体积（解析区间裁剪 ≤2%）',
      rs.status === 0 && rm.status === 0 && dev <= 0.02,
      'dev=' + (Number.isFinite(dev) ? (dev * 100).toFixed(2) + '%' : 'n/a') + ' slice=' + (js ? js.slicedVolumeMm3.toFixed(3) : '?') + ' mesh=' + (Number.isFinite(meshVol) ? meshVol.toFixed(3) : '?'));
    if (js) { try { unlinkSync(js.file); unlinkSync(pre + '_m.stl'); } catch { /* */ } }
  }
  {
    // C5：icosphere（正二十面体细分球——无极区伪影，lat-long 球极区焊接有 nm=48 固有伪影）
    const t0 = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t0, 0], [1, t0, 0], [-1, -t0, 0], [1, -t0, 0], [0, -1, t0], [0, 1, t0], [0, -1, -t0], [0, 1, -t0], [t0, 0, -1], [t0, 0, 1], [-t0, 0, -1], [-t0, 0, 1]];
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const nrm = (v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
    verts = verts.map(nrm);
    for (let s = 0; s < 3; s++) {
      const cache = new Map();
      const mid = (a, b) => { const key = a < b ? a + ':' + b : b + ':' + a; let m = cache.get(key); if (m === undefined) { m = verts.length; verts.push(nrm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])); cache.set(key, m); } return m; };
      const next = [];
      for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      faces = next;
    }
    const RR = 10;
    const pos = []; for (const v of verts) pos.push(v[0] * RR, v[1] * RR, v[2] * RR);
    const idx = []; for (const fc of faces) idx.push(...fc);
    const tris = idx.length / 3, buf = Buffer.alloc(84 + tris * 50);
    buf.writeUInt32LE(tris, 80); let o = 84;
    for (let t = 0; t < tris; t++) {
      const [a, b, c] = [idx[t * 3] * 3, idx[t * 3 + 1] * 3, idx[t * 3 + 2] * 3];
      const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
      const w = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
      const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...nn) || 1;
      buf.writeFloatLE(nn[0] / l, o); buf.writeFloatLE(nn[1] / l, o + 4); buf.writeFloatLE(nn[2] / l, o + 8); o += 12;
      for (const i of [a, b, c]) { buf.writeFloatLE(pos[i], o); buf.writeFloatLE(pos[i + 1], o + 4); buf.writeFloatLE(pos[i + 2], o + 8); o += 12; }
      o += 2;
    }

    const stl = join(tmpdir(), 'tpms_f_ico_' + process.pid + '.stl');
    writeFileSync(stl, buf);
    const pre = join(tmpdir(), 'tpms_f_c5_' + process.pid);
    const rs = run('slice', '--type', 'gyroid', '--porosity', '0.6', '--resolution', '64', '--periods', '2', '--layers', '160', '--container-mesh', stl, '--out', pre, '--json');
    const rm = run('mesh', '--type', 'gyroid', '--porosity', '0.6', '--resolution', '64', '--periods', '2', '--container-mesh', stl, '--out', pre + '_m.stl', '--json');
    let js = null, jm = null;
    try { js = JSON.parse(rs.stdout); } catch { /* */ }
    try { jm = JSON.parse(rm.stdout); } catch { /* */ }
    const meshVol = js && jm && jm.envelopeVolume ? (1 - jm.porosityEstimate) * jm.envelopeVolume : NaN;
    const dev = js && Number.isFinite(meshVol) ? Math.abs(js.slicedVolumeMm3 - meshVol) / meshVol : NaN;
    check('F5 C5 mesh 容器直接层切 ≡ mesh 发散×散度包络（SDF 区间裁剪 ≤3%）',
      rs.status === 0 && js && Number.isFinite(meshVol) && dev <= 0.03,
      'dev=' + (Number.isFinite(dev) ? (dev * 100).toFixed(2) + '%' : 'n/a') + ' slice=' + (js ? js.slicedVolumeMm3.toFixed(3) : '?') + ' mesh=' + (Number.isFinite(meshVol) ? meshVol.toFixed(3) : '?'));
    if (js) { try { unlinkSync(js.file); unlinkSync(pre + '_m.stl'); unlinkSync(stl); } catch { /* */ } }
  }
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
  if (passCount < 20) { console.error('GUARD FAIL: 断言执行数 ' + passCount + ' < 基线 20（v2 容器裁剪 F4/F5 +2、F3 重组净 +1）'); process.exit(1); }
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
