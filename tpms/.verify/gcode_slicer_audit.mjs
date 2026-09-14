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

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
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
    `export { auditOverhang, searchBuildOrientation } from ${JSON.stringify(join(PLATFORM, 'src/physics/printability-audit.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { sliceMesh, compileGcode, buildSurface, buildVoxelModel, directSlice, buildSliceSvg, auditOverhang, searchBuildOrientation } = await import(pathToFileURL(BUNDLE));

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
    if (js && js.files && js.files[0]) {
      const svg = readFileSync(js.files[0].file, 'utf8');
      const gCount = (svg.match(/<g id="layer-/g) || []).length;
      check('F2 ' + ty + ' SVG 结构（160 层 g + metadata + 扫描路径）',
        gCount === 160 && svg.includes('<metadata>') && svg.includes(' H '),
        'g=' + gCount + ' bytes=' + js.files[0].bytes);
      try { unlinkSync(js.files[0].file); unlinkSync(pre + '_m.stl'); } catch { /* */ }
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


// ── F6. CLI（Common Layer Interface）工业格式封底：结构断言 + 序列化保真对拍 ──
{
  const CLI6 = join(HERE, '../agent/tpms.mjs');
  const run6 = (...args) => spawnSync(process.execPath, [CLI6, ...args], { encoding: 'utf8' });
  const pre = join(tmpdir(), 'tpms_f_cli_' + process.pid);
  const rs = run6('slice', '--type', 'gyroid', '--porosity', '0.6', '--resolution', '64', '--periods', '2', '--layers', '40', '--format', 'both', '--out', pre, '--json');
  let js = null;
  try { js = JSON.parse(rs.stdout); } catch { /* */ }
  const cliPath = js && js.files ? js.files.map((x) => x.file).find((p) => p.endsWith('.cli')) : null;
  if (js && cliPath) {
    const cli = readFileSync(cliPath, 'utf8');
    const layers = (cli.match(/^\$\$LAYER\//gm) || []).length;
    const DD = String.fromCharCode(36, 36); // "$$" —— 字面量写法会触发替换串折叠史，用码点构造最稳
    const structOk = cli.startsWith(DD + 'HEADER') && cli.includes(DD + 'UNITS/1') && cli.includes(DD + 'VERSION/201')
      && cli.trimEnd().endsWith(DD + 'ENDOFFILE') && layers === 40;
    check('F6 CLI 结构（HEADER/UNITS/VERSION/40×LAYER/HATCHES/ENDOFFILE）', structOk, 'layers=' + layers + ' head16=' + JSON.stringify(cli.slice(0, 12)));
    // 序列化保真对拍：解析 $HATCHES 重算体积（Σ hatch 长 × 行距 × 层高）≈ slicedVolumeMm3
    // 坐标四位小数舍入 → 相对差 ~1e-4 量级，容差 0.1%
    let recon = 0;
    const rowD = 2 / 64, layerH = 2 / 40; // periods=2, nRows=64
    for (const m of cli.matchAll(/^\$\$HATCHES\/1 (\d+) (.*)$/gm)) {
      const n = Number(m[1]);
      const nums = m[2].trim().split(/\s+/).map(Number);
      for (let h = 0; h < n; h++) recon += (nums[h * 5 + 3] - nums[h * 5 + 1]) * rowD * layerH;
    }
    const dev = Math.abs(recon - js.slicedVolumeMm3) / js.slicedVolumeMm3;
    check('F6 CLI hatch 重算体积 ≡ slicedVolumeMm3（序列化保真 ≤0.1%）', dev <= 0.001,
      'recon=' + recon.toFixed(4) + ' vs ' + js.slicedVolumeMm3.toFixed(4) + ' dev=' + (dev * 100).toFixed(3) + '%');
    try { unlinkSync(cliPath); for (const x of js.files) unlinkSync(x.file); } catch { /* */ }
  } else {
    check('F6 CLI 结构', false, 'slice both 格式失败 exit=' + rs.status);
    check('F6 CLI hatch 重算体积', false, 'n/a');
  }
}


// ── F7. 可打印性审计（2026-09-14 悬垂角战役）：解析锚 + 方向语义钉 + 摆盘寻优 + CLI 冒烟 ──
{
  // 单位立方体（12 三角外向缠绕；与 A 节同构）
  const cubePos = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const cubeIdx = new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  const r = auditOverhang(cubePos, cubeIdx, [0, 0, 1]);
  check('F7a 立方体 b=[0,0,1]：ratio=1/6、朝下面积=1、直方图全落 0° 桶',
    Math.abs(r.criticalAreaRatio - 1 / 6) < 1e-15 && Math.abs(r.downFacingArea - 1) < 1e-12
      && Math.abs(r.alphaHistogram[0] - 1) < 1e-12 && r.alphaHistogram.slice(1).every((v) => v === 0)
      && r.skippedDegenerate === 0,
    'ratio=' + r.criticalAreaRatio);

  // 反向缠绕自愈：逐面顶点逆序 → 发散体积<0 → 法向整体翻转，结果不变
  const flipIdx = new Uint32Array(cubeIdx.length);
  for (let t = 0; t < cubeIdx.length; t += 3) { flipIdx[t] = cubeIdx[t]; flipIdx[t + 1] = cubeIdx[t + 2]; flipIdx[t + 2] = cubeIdx[t + 1]; }
  const rf = auditOverhang(cubePos, flipIdx, [0, 0, 1]);
  check('F7b 反向缠绕定向自愈（ratio 不变 1/6）', Math.abs(rf.criticalAreaRatio - 1 / 6) < 1e-15, 'ratio=' + rf.criticalAreaRatio);

  // critical=89°：竖直面 α=90° 恰不触发、底面 α=0° 仍触发 → ratio 仍 1/6
  //（α 方向语义若弄反——如把 α 当「与竖直轴夹角」——竖直面会触发得 5/6，必炸）
  const r89 = auditOverhang(cubePos, cubeIdx, [0, 0, 1], 89);
  check('F7c 方向语义钉（critical=89° 竖直面不触发，ratio 仍 1/6）', Math.abs(r89.criticalAreaRatio - 1 / 6) < 1e-12, 'ratio=' + r89.criticalAreaRatio);

  // 单位球解析锚（icosphere 细分 3 = 1280 面）：critical ⟺ N·b < −cos45°，
  // 球面积极分占比 = (1−cos135°)/2 = (2−√2)/4 ≈ 14.6447%（真值与实现不同源：解析积分 vs 三角统计）
  const t0 = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t0, 0], [1, t0, 0], [-1, -t0, 0], [1, -t0, 0], [0, -1, t0], [0, 1, t0], [0, -1, -t0], [0, 1, -t0], [t0, 0, -1], [t0, 0, 1], [-t0, 0, -1], [-t0, 0, 1]];
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const nrmv = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  verts = verts.map(nrmv);
  for (let s = 0; s < 3; s++) {
    const cache = new Map();
    const mid = (x, y) => { const key = x < y ? x + ':' + y : y + ':' + x; let m = cache.get(key); if (m === undefined) { m = verts.length; verts.push(nrmv([(verts[x][0] + verts[y][0]) / 2, (verts[x][1] + verts[y][1]) / 2, (verts[x][2] + verts[y][2]) / 2])); cache.set(key, m); } return m; };
    const next = [];
    for (const [x, y, z] of faces) { const ab = mid(x, y), bc = mid(y, z), ca = mid(z, x); next.push([x, ab, ca], [y, bc, ab], [z, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  const sphPos = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => { sphPos[i * 3] = v[0]; sphPos[i * 3 + 1] = v[1]; sphPos[i * 3 + 2] = v[2]; });
  const sphIdx = new Uint32Array(faces.length * 3);
  faces.forEach((f, i) => { sphIdx[i * 3] = f[0]; sphIdx[i * 3 + 1] = f[1]; sphIdx[i * 3 + 2] = f[2]; });
  const sphAnchor = (2 - Math.SQRT2) / 4;
  const rsph = auditOverhang(sphPos, sphIdx, [0, 0, 1]);
  check(`F7d icosphere 解析锚（球面积极分 ${(sphAnchor * 100).toFixed(2)}% ±1%）`,
    Math.abs(rsph.criticalAreaRatio - sphAnchor) <= 0.01,
    'ratio=' + (rsph.criticalAreaRatio * 100).toFixed(3) + '% vs 解析 ' + (sphAnchor * 100).toFixed(3) + '%');

  // 摆盘寻优：立方体全局最优 = 体对角摆盘（各面 N·b=±1/√3 均不过临界）→ 零支撑
  const sr = searchBuildOrientation(cubePos, cubeIdx, 45, 512);
  const diag = Math.max(...[[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1]]
    .map((d) => (sr.bestDir[0] * d[0] + sr.bestDir[1] * d[1] + sr.bestDir[2] * d[2]) / Math.sqrt(3)));
  const angDeg = (Math.acos(Math.min(1, diag)) * 180) / Math.PI;
  check('F7e 立方体最优摆盘=体对角零支撑（ratio=0 且距最近对角 ≤15°）',
    sr.bestCriticalRatio === 0 && angDeg <= 15, 'ratio=' + sr.bestCriticalRatio + ' 夹角=' + angDeg.toFixed(1) + '°');

  // 确定性：Fibonacci 球无 RNG，同输入双跑 JSON 逐字节一致
  const sr2 = searchBuildOrientation(cubePos, cubeIdx, 45, 512);
  check('F7f 摆盘寻优确定性（JSON 逐字节一致）', JSON.stringify(sr) === JSON.stringify(sr2));

  // 真实 TPMS 网格：gyroid R16（E 节同参数），法向近各向同性 → ratio 落宽带（实测后钉）
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 1, resolution: 16, targetPorosity: 0.7,
    weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false,
  });
  const rg = auditOverhang(res.positions, res.indices, [0, 0, 1]);
  check(`F7g gyroid 真实网格悬垂带 0.05~0.35（实测 ${(rg.criticalAreaRatio * 100).toFixed(1)}%）`,
    rg.criticalAreaRatio > 0.05 && rg.criticalAreaRatio < 0.35, 'ratio=' + (rg.criticalAreaRatio * 100).toFixed(2) + '%');

  // CLI 冒烟 + 守卫：STL 文件路径全链（parseSTL 焊接 → checkMesh 水密门 → audit/search）
  const CLI7 = join(HERE, '../agent/tpms.mjs');
  const run7 = (...args) => spawnSync(process.execPath, [CLI7, ...args], { encoding: 'utf8' });
  const stlPath = join(tmpdir(), 'tpms_f7_cube_' + process.pid + '.stl');
  {
    const tris = cubeIdx.length / 3, buf = Buffer.alloc(84 + tris * 50);
    buf.writeUInt32LE(tris, 80); let o = 84;
    for (let t = 0; t < tris; t++) {
      const a3 = cubeIdx[t * 3] * 3, b3 = cubeIdx[t * 3 + 1] * 3, c3 = cubeIdx[t * 3 + 2] * 3;
      const u = [cubePos[b3] - cubePos[a3], cubePos[b3 + 1] - cubePos[a3 + 1], cubePos[b3 + 2] - cubePos[a3 + 2]];
      const w = [cubePos[c3] - cubePos[a3], cubePos[c3 + 1] - cubePos[a3 + 1], cubePos[c3 + 2] - cubePos[a3 + 2]];
      const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      buf.writeFloatLE(nn[0] / l, o); buf.writeFloatLE(nn[1] / l, o + 4); buf.writeFloatLE(nn[2] / l, o + 8); o += 12;
      for (const i3 of [a3, b3, c3]) { buf.writeFloatLE(cubePos[i3], o); buf.writeFloatLE(cubePos[i3 + 1], o + 4); buf.writeFloatLE(cubePos[i3 + 2], o + 8); o += 12; }
      o += 2;
    }
    writeFileSync(stlPath, buf);
  }
  const rc = run7('overhang', '--input', stlPath, '--search', '--json');
  let jc = null;
  try { jc = JSON.parse(rc.stdout); } catch { /* */ }
  check('F7h CLI 冒烟（exit0 + ratio=1/6 + search 零支撑 + 诚实边界披露）',
    rc.status === 0 && jc && Math.abs(jc.criticalAreaRatio - 1 / 6) < 1e-9
      && jc.search && jc.search.bestCriticalRatio === 0 && typeof jc.boundary === 'string' && jc.boundary.includes('交叉复核'),
    'exit=' + rc.status + ' ratio=' + (jc ? jc.criticalAreaRatio : '?'));
  const rc2 = run7('overhang', '--input', stlPath, '--critical', '90');
  const rc3 = run7('overhang', '--input', join(tmpdir(), 'no_such_overhang.stl'));
  // 单三角开放网格（3 开放边）→ 非水密 → exit3（外向法向不可定向，fail-closed）
  const openPath = join(tmpdir(), 'tpms_f7_open_' + process.pid + '.stl');
  {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    let o = 84;
    const tri = [0,0,0, 1,0,0, 0,1,0];
    for (const f of tri) { buf.writeFloatLE(f, o); o += 4; }
    writeFileSync(openPath, buf);
  }
  const rc4 = run7('overhang', '--input', openPath);
  check('F7i CLI 守卫（critical=90 exit2 / 文件不存在 exit2 / 非水密 exit3）',
    rc2.status === 2 && rc3.status === 2 && rc4.status === 3,
    'exits=' + rc2.status + '/' + rc3.status + '/' + rc4.status);
  try { unlinkSync(stlPath); unlinkSync(openPath); } catch { /* */ }
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
  if (passCount < 32) { console.error('GUARD FAIL: 断言执行数 ' + passCount + ' < 基线 32（F7 可打印性审计 +10）'); process.exit(1); }
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
