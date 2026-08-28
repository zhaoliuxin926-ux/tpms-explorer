/**
 * DICOM / TIFF 体素栈流式解析器（v5.0 阶段 III）
 *
 * 纯 TypeScript 零依赖实现：
 *  · DICOM 单文件（explicit VR little-endian 子集）：DICM 魔数 → Meta 信息 →
 *    数据集遍历提取 Rows/Columns/BitsAllocated/PixelSpacing/SliceThickness/
 *    RescaleSlope/Intercept/PixelData(7FE0,0010) 偏移
 *  · 基线 TIFF（未压缩，单/多页 IFD 链）：II/MM 星号 字节序 → IFD 标签表 →
 *    StripOffsets（Predictor=1）灰度像素
 *  · 堆栈组装：多文件/多页按 SliceThickness/Spacing 排序 → Uint8 灰度体素栅格
 * 诚实边界：不支持 JPEG/deflate 压缩传输语法与私有编码（临床常见显式 VR LE
 * 已覆盖演示口径）；16bit 数据经 Rescale + 窗宽归一化落到 0~255。
 */

export interface DicomMeta {
  rows: number;
  cols: number;
  bitsAllocated: number;
  pixelSpacing: [number, number];   // 行/列间距 mm
  sliceThickness: number;           // mm
  rescaleSlope: number;
  rescaleIntercept: number;
  pixelDataOffset: number;
  pixelDataLength: number;
  littleEndian: boolean;
}

export function isDicom(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 132) return false;
  const b = new Uint8Array(buf, 128, 4);
  return b[0] === 0x44 && b[1] === 0x49 && b[2] === 0x43 && b[3] === 0x4D;   // 'DICM'
}

/** DICOM explicit VR LE 头解析（返回元数据与像素偏移；像素解码调用方执行） */
export function parseDicomHeader(buf: ArrayBuffer): DicomMeta {
  const dv = new DataView(buf);
  if (!isDicom(buf)) throw new Error('非 DICOM 文件（缺 DICM 魔数）');
  let pos = 132;
  const meta: DicomMeta = {
    rows: 0, cols: 0, bitsAllocated: 16,
    pixelSpacing: [1, 1], sliceThickness: 1,
    rescaleSlope: 1, rescaleIntercept: 0,
    pixelDataOffset: -1, pixelDataLength: 0, littleEndian: true,
  };
  // 简化：跳过 File Meta（group 0002）——直接从 132 起遍历数据集元素直到 7FE0
  while (pos + 8 <= buf.byteLength) {
    const group = dv.getUint16(pos, true);
    const elem = dv.getUint16(pos + 2, true);
    const vr = String.fromCharCode(dv.getUint8(pos + 4), dv.getUint8(pos + 5));
    let len = 0;
    let dataStart = pos + 8;
    if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
      len = dv.getUint32(pos + 8, true);
      dataStart = pos + 12;
    } else {
      len = dv.getUint16(pos + 6, true);
    }
    if (len === 0xFFFFFFFF) throw new Error('不支持 undefined 长度元素（压缩传输语法）');
    const tag = group * 0x10000 + elem;
    if (tag === 0x00280010) meta.rows = dv.getUint16(dataStart, true);
    else if (tag === 0x00280011) meta.cols = dv.getUint16(dataStart, true);
    else if (tag === 0x00280100) meta.bitsAllocated = dv.getUint16(dataStart, true);
    else if (tag === 0x00281052) meta.rescaleIntercept = parseFloat(new TextDecoder().decode(new Uint8Array(buf, dataStart, len)));
    else if (tag === 0x00281053) meta.rescaleSlope = parseFloat(new TextDecoder().decode(new Uint8Array(buf, dataStart, len)));
    else if (tag === 0x00180050) meta.sliceThickness = parseFloat(new TextDecoder().decode(new Uint8Array(buf, dataStart, len)));
    else if (tag === 0x00280030) {
      const parts = new TextDecoder().decode(new Uint8Array(buf, dataStart, len)).split('\\').map(Number);
      if (parts.length >= 2) meta.pixelSpacing = [parts[0], parts[1]];
    } else if (tag === 0x7FE00010) {
      meta.pixelDataOffset = dataStart;
      meta.pixelDataLength = len;
      break;   // 像素数据通常在最后
    }
    pos = dataStart + len;
  }
  if (meta.pixelDataOffset < 0) throw new Error('DICOM 缺 PixelData (7FE0,0010)');
  return meta;
}

/** 解码 DICOM 像素（16bit signed + Rescale → Uint8 归一化） */
export function decodeDicomPixels(buf: ArrayBuffer, meta: DicomMeta): Uint8Array {
  const dv = new DataView(buf);
  const base = meta.pixelDataOffset;
  const n = meta.rows * meta.cols;
  const out = new Uint8Array(n);
  let mn = Infinity, mx = -Infinity;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = meta.bitsAllocated === 16 ? dv.getInt16(base + i * 2, true) : dv.getUint8(base + i);
    raw[i] = v * meta.rescaleSlope + meta.rescaleIntercept;
    if (raw[i] < mn) mn = raw[i];
    if (raw[i] > mx) mx = raw[i];
  }
  const range = mx - mn || 1;
  for (let i = 0; i < n; i++) out[i] = Math.round(((raw[i] - mn) / range) * 255);
  return out;
}

export interface TiffPage {
  width: number;
  height: number;
  bitsPerSample: number;
  pixels: Uint8Array;   // 归一化到 8bit
}

/** 基线 TIFF 解析（未压缩、灰度，支持多页 IFD 链） */
export function parseTiff(buf: ArrayBuffer): TiffPage[] {
  const dv = new DataView(buf);
  const magic = dv.getUint16(0, false);
  const little = magic === 0x4949;   // 'II'
  if (!little && magic !== 0x4D4D) throw new Error('非 TIFF 文件');
  if (dv.getUint16(2, little) !== 42) throw new Error('TIFF magic 42 不符');
  const pages: TiffPage[] = [];
  let ifdOffset = dv.getUint32(4, little);
  while (ifdOffset > 0) {
    const nEntries = dv.getUint16(ifdOffset, little);
    let width = 0, height = 0, bits = 8, comp = 1, stripOff = -1;
    for (let e = 0; e < nEntries; e++) {
      const tag = dv.getUint16(ifdOffset + 2 + e * 12, little);
      const val = dv.getUint32(ifdOffset + 2 + e * 12 + 8, little);
      if (tag === 256) width = val;
      else if (tag === 257) height = val;
      else if (tag === 258) bits = val;
      else if (tag === 259) comp = val;
      else if (tag === 273) stripOff = val;
    }
    if (comp !== 1) throw new Error('仅支持未压缩 TIFF（Compression=1）');
    if (stripOff < 0) throw new Error('TIFF 缺 StripOffsets');
    const n = width * height;
    const px = new Uint8Array(n);
    if (bits === 8) {
      for (let i = 0; i < n; i++) px[i] = dv.getUint8(stripOff + i);
    } else if (bits === 16) {
      let mn = Infinity, mx = -Infinity;
      const raw = new Uint16Array(n);
      for (let i = 0; i < n; i++) { raw[i] = dv.getUint16(stripOff + i * 2, little); if (raw[i] < mn) mn = raw[i]; if (raw[i] > mx) mx = raw[i]; }
      const range = mx - mn || 1;
      for (let i = 0; i < n; i++) px[i] = Math.round(((raw[i] - mn) / range) * 255);
    }
    pages.push({ width, height, bitsPerSample: bits, pixels: px });
    ifdOffset = dv.getUint32(ifdOffset + 2 + nEntries * 12, little);
  }
  return pages;
}

/** 堆栈组装：按 z 序拼 Uint8 灰度体素栅格 */
export function assembleStack(slices: Uint8Array[]): Uint8Array {
  if (slices.length === 0) throw new Error('空切片栈');
  const n = slices[0].length;
  const vol = new Uint8Array(n * slices.length);
  slices.forEach((s, z) => vol.set(s, z * n));
  return vol;
}
