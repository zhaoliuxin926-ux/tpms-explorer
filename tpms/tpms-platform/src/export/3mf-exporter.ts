/**
 * 3MF 增材制造格式导出器（3MF Consortium OPC 包）
 *
 * 结构：[Content_Types].xml + _rels/.rels + 3D/3dmodel.model 的标准 OPC ZIP 包。
 * ZIP 采用 STORED（无压缩）方法——3MF 规范要求消费者同时支持 stored 与 deflate，
 * 切片机/查看器兼容无虞；零第三方依赖（手写 CRC32 + local/central directory）。
 *
 * 语义：
 *   · <model unit="millimeter">：顶点直接写 wc × wcToMmFactor = 毫米
 *   · metadata：Title / Designer / Description / CreationDate /
 *     自定义 TPMS:Config（构型·模式·孔隙率）与 TPMS:EndplateMm（端板厚度，
 *     供切片机/下游识别致密实心层；3MF 允许消费者忽略未知 metadata）
 *   · 顶点/三角形与内部网格严格守恒（industrial_export_audit 断言）
 */

import { downloadBlob } from './download';

// ── CRC32（IEEE 802.3 多项式，ZIP 标准）──────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ThreeMfMeta {
  /** 构型标识（如 gyroid-solid_network-p75） */
  configName: string;
  /** 目标孔隙率（%） */
  porosity: number;
  /** 实心端板厚度 mm（0 = 无端板） */
  endplateMm: number;
  /** 结构模式 */
  structureMode: string;
}

/** ZIP STORED 条目组装（local header + data），返回 central directory 记录所需信息 */
interface ZipEntry { nameBytes: Uint8Array; data: Uint8Array; crc: number; offset: number }

/**
 * 构建 3MF 包（ArrayBuffer）。
 * @param positions 顶点（wc 域）
 * @param indices 三角形索引
 * @param scale wc → mm
 * @param meta 打印元数据
 */
export function build3MF(
  positions: Float32Array,
  indices: Uint32Array,
  scale: number,
  meta: ThreeMfMeta,
): ArrayBuffer {
  const fmt = (v: number): string => (Math.round(v * 1e6) / 1e6).toString();

  // ── 3D/3dmodel.model ─────────────────────────────────────────
  const vertCount = positions.length / 3;
  const triCount = indices.length / 3;
  const endplateLine = meta.endplateMm > 0
    ? `<metadata name="TPMS:EndplateMm">${meta.endplateMm}</metadata>\n`
    : '';
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  parts.push(`<metadata name="Title">${xmlEsc(`TPMS ${meta.configName}`)}</metadata>\n`);
  parts.push('<metadata name="Designer">TPMS Explorer</metadata>\n');
  parts.push(`<metadata name="Description">${xmlEsc(`Triply-Periodic Minimal Surface lattice; mode=${meta.structureMode}; target porosity=${meta.porosity}%${meta.endplateMm > 0 ? `; solid endplates ${meta.endplateMm} mm` : ''}`)}</metadata>\n`);
  parts.push(`<metadata name="TPMS:Config">${xmlEsc(meta.configName)}</metadata>\n`);
  parts.push(`<metadata name="TPMS:PorosityPct">${meta.porosity}</metadata>\n`);
  parts.push(endplateLine);
  parts.push('<resources>\n<object id="1" type="model"><mesh>\n<vertices>\n');
  for (let i = 0; i < positions.length; i += 3) {
    parts.push(`<vertex x="${fmt(positions[i] * scale)}" y="${fmt(positions[i + 1] * scale)}" z="${fmt(positions[i + 2] * scale)}"/>\n`);
  }
  parts.push('</vertices>\n<triangles>\n');
  for (let t = 0; t < indices.length; t += 3) {
    parts.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>\n`);
  }
  parts.push(`</triangles>\n</mesh></object>\n</resources>\n<build><item objectid="1"/></build>\n</model>\n`);
  const modelXml = parts.join('');
  // 数字守恒自检（构建期防呆：XML 计数与输入一致）
  const declaredVerts = (modelXml.match(/<vertex /g) || []).length;
  const declaredTris = (modelXml.match(/<triangle /g) || []).length;
  if (declaredVerts !== vertCount || declaredTris !== triCount) {
    throw new Error(`3MF 守恒校验失败：vertices ${declaredVerts}/${vertCount}, triangles ${declaredTris}/${triCount}`);
  }

  // ── ZIP 组装（STORED）────────────────────────────────────────
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const contentTypes = enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  const rels = enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  const model = enc.encode(modelXml);
  for (const [name, data] of [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels],
    ['3D/3dmodel.model', model],
  ] as const) {
    entries.push({ nameBytes: enc.encode(name), data, crc: crc32(data), offset: 0 });
  }

  let offset = 0;
  const chunks: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  for (const e of entries) {
    const lh = new ArrayBuffer(30 + e.nameBytes.length);
    const dv = new DataView(lh);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);            // version needed
    dv.setUint16(6, 0, true);             // flags
    dv.setUint16(8, 0, true);             // method = STORED
    dv.setUint16(10, 0, true);            // time
    dv.setUint16(12, 0, true);            // date
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, e.nameBytes.length, true);
    dv.setUint16(28, 0, true);            // extra len
    const lhu8 = new Uint8Array(lh);
    lhu8.set(e.nameBytes, 30);            // 文件名紧随 30B local header
    e.offset = offset;
    chunks.push(lhu8, e.data);
    offset += lh.byteLength + e.data.length;

    const ch = new ArrayBuffer(46 + e.nameBytes.length);
    const cdv = new DataView(ch);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, e.crc, true);
    cdv.setUint32(20, e.data.length, true);
    cdv.setUint32(24, e.data.length, true);
    cdv.setUint16(28, e.nameBytes.length, true);
    cdv.setUint32(42, e.offset, true);
    new Uint8Array(ch).set(e.nameBytes, 46);
    centrals.push(new Uint8Array(ch));
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new ArrayBuffer(22);
  const edv = new DataView(eocd);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let w = 0;
  for (const c of chunks) { out.set(c, w); w += c.length; }
  for (const c of centrals) { out.set(c, w); w += c.length; }
  out.set(new Uint8Array(eocd), w);
  return out.buffer;
}

/** 3MF 下载（mm 缩放与 STL 同口径） */
export function export3MF(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale: number,
  meta: ThreeMfMeta,
): void {
  const buf = build3MF(positions, indices, scale, meta);
  downloadBlob(new Blob([buf], { type: 'model/3mf' }), filename);
}
