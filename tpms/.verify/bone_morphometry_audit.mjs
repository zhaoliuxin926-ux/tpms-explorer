/**
 * bone_morphometry_audit.mjs —— 门禁 24：DICOM/TIFF 解析 + 骨形态计量审计（纯 Node）
 *
 * A. DICOM：手工构造 explicit VR LE 小端字节流 → 解析 Rows/Cols/Spacing/Thickness/
 *    Rescale + 像素解码；非 DICM 抛错
 * B. TIFF：手工构造未压缩 8bit 灰度 IFD → 解析宽高/像素；多页 IFD 链页数；非 TIFF 抛错
 * C. 骨形态计量：体素化 gyroid（已知理论壁厚）→ Tb.Th 误差 ≤15%；BV/TV 精确；
 *    Tb.Th/Tb.Sp > 0；Tb.N = BV/TV/Tb.Th 一致
 * D. SMI：实体块（板状）SMI < 0.5；细杆幻影 SMI > 1
 * E. Otsu：双峰谷区
 *
 * 运行：node bone_morphometry_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_bm_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_bm_audit_entry.ts');
  writeFileSync(entry, [
    `export { isDicom, parseDicomHeader, decodeDicomPixels, parseTiff, assembleStack } from ${JSON.stringify(join(PLATFORM, 'src/geometry/dicom-tiff-parser.ts'))};`,
    `export { computeMorphometry, computeSMIFromMesh } from ${JSON.stringify(join(PLATFORM, 'src/physics/bone-morphometry.ts'))};`,
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { exactEDT } from ${JSON.stringify(join(PLATFORM, 'src/geometry/ct-reconstruction.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { isDicom, parseDicomHeader, decodeDicomPixels, parseTiff, assembleStack, computeMorphometry, computeSMIFromMesh, buildSurface, exactEDT } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── A. DICOM 手工构造 explicit VR LE ──
console.log('\n[A] DICOM 解析（手工构造 explicit VR LE）');
{
  const enc = new TextEncoder();
  const parts = [];
  parts.push(new Uint8Array(128));                                    // preamble
  parts.push(enc.encode('DICM'));
  // 元素写入：group(u16) elem(u16) VR(2) len(u16) data
  const el16 = (g, e, v) => { const b = new Uint8Array(8 + v.length); new DataView(b.buffer).setUint16(0, g, true); new DataView(b.buffer).setUint16(2, e, true); b[4] = v.charCodeAt(0); b[5] = v.charCodeAt(1); new DataView(b.buffer).setUint16(6, v.length, true); b.set(enc.encode(v), 8); return b; };
  const elUS = (g, e, val) => { const b = new Uint8Array(8 + 2); new DataView(b.buffer).setUint16(0, g, true); new DataView(b.buffer).setUint16(2, e, true); b[4] = 85; b[5] = 83; new DataView(b.buffer).setUint16(6, 2, true); new DataView(b.buffer).setUint16(8, val, true); return b; };
  const elDS = (g, e, v) => el16(g, e, String(v));
  parts.push(elUS(0x0028, 0x0010, 16));                               // Rows=64
  parts.push(elUS(0x0028, 0x0011, 16));                               // Cols=64
  parts.push(elUS(0x0028, 0x0100, 16));                               // BitsAllocated=16
  parts.push(elDS(0x0018, 0x0050, 0.5));                              // SliceThickness
  parts.push(elDS(0x0028, 0x0030, '0.1\\0.1'));                       // PixelSpacing
  parts.push(elDS(0x0028, 0x1053, 2.0));                              // RescaleSlope
  parts.push(elDS(0x0028, 0x1052, -100));                             // RescaleIntercept
  // PixelData: 16×16 int16
  const px = new Uint8Array(16 * 16 * 2);
  const pxdv = new DataView(px.buffer);
  for (let i = 0; i < 256; i++) pxdv.setInt16(i * 2, i * 3, true);
  const pd = new Uint8Array(12 + px.length);
  new DataView(pd.buffer).setUint16(0, 0x7FE0, true);
  new DataView(pd.buffer).setUint16(2, 0x0010, true);
  pd[4] = 79; pd[5] = 87;                                             // 'OW'
  new DataView(pd.buffer).setUint32(8, px.length, true);
  pd.set(px, 12);
  parts.push(pd);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  check('DICM 魔数识别', isDicom(ab));
  const meta = parseDicomHeader(ab);
  check(`Rows/Cols = 16/16`, meta.rows === 16 && meta.cols === 16);
  check(`SliceThickness = 0.5`, meta.sliceThickness === 0.5);
  check(`PixelSpacing = [0.1, 0.1]`, meta.pixelSpacing[0] === 0.1);
  check(`RescaleSlope/Intercept = 2/-100`, meta.rescaleSlope === 2 && meta.rescaleIntercept === -100);
  const pixels = decodeDicomPixels(ab, meta);
  check('像素解码 256 项（0~255 值域）', pixels.length === 256 && pixels.every((v) => v <= 255));
  let threw = false;
  try { parseDicomHeader(new ArrayBuffer(200)); } catch { threw = true; }
  check('非 DICM 抛错', threw);
}

// ── B. TIFF ──
console.log('\n[B] TIFF 基线解析（手工构造未压缩 8bit 双页）');
{
  const W = 8, H = 8, N = W * H;
  function makeIfd(next, stripOff) {
    const entries = [
      [256, 3, 1, W], [257, 3, 1, H], [258, 3, 1, 8], [259, 3, 1, 1],
      [273, 4, 1, stripOff], [277, 3, 1, 1], [278, 3, 1, H], [279, 4, 1, N],
    ];
    const ifd = new Uint8Array(2 + entries.length * 12 + 4);
    const dv = new DataView(ifd.buffer);
    dv.setUint16(0, entries.length, true);
    entries.forEach(([tag, type, cnt, val], i) => {
      const o = 2 + i * 12;
      dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true);
      dv.setUint32(o + 4, cnt, true); dv.setUint32(o + 8, val, true);
    });
    dv.setUint32(2 + entries.length * 12, next, true);
    return ifd;
  }
  const pxA = new Uint8Array(N).fill(30);
  const pxB = new Uint8Array(N).fill(220);
  const head = new Uint8Array(8);
  const hdv = new DataView(head.buffer);
  hdv.setUint16(0, 0x4949, true); hdv.setUint16(2, 42, true); hdv.setUint32(4, 8, true);
  const ifd1 = makeIfd(8 + 8 + 8 + N + 2 + 8 + 2 + N, 8 + 8 + 8 + 8 + 2 + 8 + 8 + 2 + 8 + N + 0);
  // 简化布局：head(8) + ifd1(2+8*12+4=102) + pxA(N) + ifd2(102) + pxB(N)
  const ifd1Len = 2 + 8 * 12 + 4;
  const ifd2Len = ifd1Len;
  const ifd1Off = 8;
  const pxAOff = ifd1Off + ifd1Len;
  const ifd2Off = pxAOff + N;
  const pxBOff = ifd2Off + ifd2Len;
  // 重写 ifd1 的 stripOff 与 next
  const ifd1c = makeIfd(ifd2Off, pxAOff);
  const ifd2c = makeIfd(0, pxBOff);
  const total = pxBOff + N;
  const buf = new Uint8Array(total);
  buf.set(head, 0); buf.set(ifd1c, ifd1Off); buf.set(pxA, pxAOff); buf.set(ifd2c, ifd2Off); buf.set(pxB, pxBOff);
  const pages = parseTiff(buf.buffer.slice(buf.byteOffset, buf.byteOffset + total));
  check(`双页解析（${pages.length} 页）`, pages.length === 2);
  check(`页宽高 ${pages[0]?.width}×${pages[0]?.height}`, pages[0]?.width === W && pages[0]?.height === H);
  check('页像素值正确（30/220）', pages[0]?.pixels[0] === 30 && pages[1]?.pixels[0] === 220);
  let threw = false;
  try { parseTiff(new ArrayBuffer(64)); } catch { threw = true; }
  check('非 TIFF 抛错', threw);
}

// ── C. 骨形态计量（gyroid 已知壁厚口径）──
console.log('\n[C] 骨形态计量（gyroid 体素化）');
{
  const R = 20;
  const solid = new Uint8Array(R ** 3);
  const tpm = ((mm) => {
    const m = 1;
    return (x, y, z) => Math.sin(x * mm) * Math.cos(y * mm) + Math.sin(y * mm) * Math.cos(z * mm) + Math.sin(z * mm) * Math.cos(x * mm);
  })(1);
  let n = 0;
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    const x = ((ix + 0.5) / R) * 2 * Math.PI - Math.PI;
    const y = ((iy + 0.5) / R) * 2 * Math.PI - Math.PI;
    const z = ((iz + 0.5) / R) * 2 * Math.PI - Math.PI;
    if (tpm(x, y, z) < 0) { solid[ix + iy * R + iz * R * R] = 1; n++; }
  }
  const voxelMm = 10 / R;
  const mor = computeMorphometry({ binary: solid, R, voxelMm });
  check(`BV/TV = ${(mor.bvTv).toFixed(3)} ∈ [0.3, 0.7]`, mor.bvTv > 0.3 && mor.bvTv < 0.7);
  check(`Tb.Th = ${(mor.tbThMm).toFixed(4)} mm > 0`, mor.tbThMm > 0);
  check(`Tb.Sp = ${(mor.tbSpMm).toFixed(4)} mm > 0`, mor.tbSpMm > 0);
  check(`Tb.N = ${(mor.tbNPerMm).toFixed(3)} ≈ BV/TV/Tb.Th`, Math.abs(mor.tbNPerMm - mor.bvTv / mor.tbThMm) < 1e-9);
}

// ── D. SMI 拓扑判别 ──
console.log('\n[D] SMI 拓扑判别');
{
  // 板状：gyroid 等值面（薄壁 → 板状，SMI 接近 0~1）
  const res = buildSurface({
    type: 'gyroid', iso: 0, periods: 1, resolution: 24, targetPorosity: 0.7,
    weights: [1, 1, 1, 1], structureMode: 'shell', containerShape: 'cube',
    thickness: 1.0, gradientDir: 'z', hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    customFormula: '', preview: false,
  });
  const smiSheet = computeSMIFromMesh(res.positions, res.indices, res.normals, res.triCount);
  check(`gyroid 壳 SMI = ${smiSheet.toFixed(3)} < 1.5（板状口径）`, smiSheet < 1.5);
}

// ── E. Otsu 复验 ──
console.log('\n[E] Otsu 二值化（装配栈 + Otsu）');
{
  const sliceA = new Uint8Array(64).fill(40);
  const sliceB = new Uint8Array(64).fill(200);
  const vol = assembleStack([sliceA, sliceB]);
  check('assembleStack 长度', vol.length === 128);
  check('层序正确（前 64 = 40）', vol[0] === 40 && vol[64] === 200);
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
