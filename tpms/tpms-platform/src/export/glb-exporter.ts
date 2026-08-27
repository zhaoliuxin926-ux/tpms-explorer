/**
 * 彩色二进制 GLB（glTF 2.0）导出器
 *
 * 手写 glTF 2.0 二进制容器：12B header + JSON chunk（4 字节对齐，空格填充）
 * + BIN chunk（4 字节对齐，\0 填充）。BufferView/Accessor 按规范排布：
 *   POSITION  FLOAT32 vec3（必须带 min/max）
 *   NORMAL    FLOAT32 vec3
 *   COLOR_0   FLOAT32 vec3（可选——顶点着色开启时序列化）
 *   indices   UNSIGNED_INT scalar，mode=4 TRIANGLES
 *
 * 坐标与尺度：POSITION 直接写 wc × wcToMmFactor = 毫米数值
 * （1 TPMS period = 1 mm，与 STL/3MF 导出同口径）；glTF 无单位字段，
 * 语义单位记录于 asset.extras.units。
 *
 * 零依赖：不使用 three.js 的 GLTFExporter（其输出含多余扩展与 KHR 材质，
 * 无法保证顶点色数值的逐字节可审计性）。
 */

import { downloadBlob } from './download';

export interface GlbMeshData {
  positions: Float32Array;
  normals?: Float32Array;
  indices: Uint32Array;
  /** 顶点颜色（Float32 ×3/顶点，值域 [0,1]）；缺省则不写 COLOR_0 */
  colors?: Float32Array | null;
  /** wc → mm 缩放（与 STL 导出共用 wcToMmFactor） */
  scale?: number;
  /** 额外 asset 元信息（写入 extras） */
  meta?: Record<string, unknown>;
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * 构建二进制 GLB（ArrayBuffer）。
 * 顶点坐标先按 scale 缩放为毫米；COLOR_0 存在时材质 vertexColors=true。
 */
export function buildGLB(data: GlbMeshData): ArrayBuffer {
  const scale = data.scale ?? 1;
  const vertCount = data.positions.length / 3;
  const hasColor = !!data.colors && data.colors.length === vertCount * 3;

  // 顶点缩放（mm）
  const pos = new Float32Array(data.positions.length);
  for (let i = 0; i < data.positions.length; i++) pos[i] = data.positions[i] * scale;

  // POSITION min/max（glTF 规范要求 accessor 带 min/max）
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let d = 0; d < 3; d++) {
      const v = pos[i + d];
      if (v < min[d]) min[d] = v;
      if (v > max[d]) max[d] = v;
    }
  }

  // ── BIN chunk 布局（bufferView 依序紧排）─────────────────────
  const views: { offset: number; length: number }[] = [];
  let binSize = 0;
  const pushView = (byteLength: number): number => {
    const offset = binSize;
    binSize += align4(byteLength);
    views.push({ offset, length: byteLength });
    return views.length - 1;
  };

  const posView = pushView(pos.byteLength);
  const nrmView = data.normals ? pushView(data.normals.byteLength) : -1;
  const colView = hasColor ? pushView(data.colors!.byteLength) : -1;
  const idxView = pushView(data.indices.byteLength);

  const bin = new ArrayBuffer(binSize);
  const u8 = new Uint8Array(bin);
  u8.set(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength), views[posView].offset);
  if (data.normals && nrmView >= 0) u8.set(new Uint8Array(data.normals.buffer, data.normals.byteOffset, data.normals.byteLength), views[nrmView].offset);
  if (hasColor && colView >= 0) u8.set(new Uint8Array(data.colors!.buffer, data.colors!.byteOffset, data.colors!.byteLength), views[colView].offset);
  u8.set(new Uint8Array(data.indices.buffer, data.indices.byteOffset, data.indices.byteLength), views[idxView].offset);

  // ── JSON chunk ───────────────────────────────────────────────
  const accessors: unknown[] = [];
  const meshes = [{
    name: 'tpms',
    primitives: [{
      attributes: { POSITION: 0, ...(data.normals ? { NORMAL: 1 } : {}), ...(hasColor ? { COLOR_0: 2 } : {}) },
      indices: hasColor ? 3 : 2,
      mode: 4,
      material: 0,
    }],
  }];
  accessors.push({
    bufferView: posView, componentType: 5126, count: vertCount, type: 'VEC3',
    min, max,
  });
  if (data.normals) accessors.push({ bufferView: nrmView, componentType: 5126, count: vertCount, type: 'VEC3' });
  if (hasColor) accessors.push({ bufferView: colView, componentType: 5126, count: vertCount, type: 'VEC3' });
  accessors.push({
    bufferView: idxView, componentType: 5125, count: data.indices.length, type: 'SCALAR',
  });

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'TPMS Explorer (glb-exporter.ts)',
      extras: { units: 'millimeter', ...(data.meta ?? {}) },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'TPMS', mesh: 0 }],
    meshes,
    materials: [{
      name: 'tpms-material',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
      ...(hasColor ? { vertexColors: true } : {}),
      doubleSided: false,
    }],
    accessors,
    bufferViews: views.map((v) => ({ buffer: 0, byteOffset: v.offset, byteLength: v.length })),
    buffers: [{ byteLength: binSize }],
  };

  let jsonText = JSON.stringify(gltf);
  while (jsonText.length % 4 !== 0) jsonText += ' ';
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPad = align4(jsonBytes.length) - jsonBytes.length;
  const totalLength = 12 + 8 + jsonBytes.length + jsonPad + 8 + binSize;

  // ── 容器 ─────────────────────────────────────────────────────
  const out = new ArrayBuffer(totalLength);
  const dv = new DataView(out);
  const ou8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);        // magic 'glTF'
  dv.setUint32(4, 2, true);                 // version
  dv.setUint32(8, totalLength, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);       // 'JSON'
  ou8.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) ou8[20 + jsonBytes.length + i] = 0x20;
  const binChunkOff = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binChunkOff, binSize, true);
  dv.setUint32(binChunkOff + 4, 0x004e4942, true);   // 'BIN\0'
  ou8.set(u8, binChunkOff + 8);
  return out;
}

/** GLB 下载（mm 缩放与 STL 导出同口径） */
export function exportGLB(
  positions: Float32Array,
  normals: Float32Array | undefined,
  indices: Uint32Array,
  colors: Float32Array | null | undefined,
  filename: string,
  scale = 1,
  meta?: Record<string, unknown>,
): void {
  const buf = buildGLB({ positions, normals, indices, colors, scale, meta });
  downloadBlob(new Blob([buf], { type: 'model/gltf-binary' }), filename);
}
