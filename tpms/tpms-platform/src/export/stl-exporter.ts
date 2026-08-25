/**
 * 二进制 STL 导出器
 * 同网格下体积仅为 ASCII 的约 1/5–1/10，切片软件加载更快。
 */
import { downloadBlob } from './download';

/**
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              使导出模型总宽 = cellSize mm（1 period = 1 mm）。默认 1 保持旧行为。
 */
export function exportBinarySTL(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1
): void {
  const triCount = indices.length / 3;
  const headerSize = 80;
  const triSize = 50; // 12(float3 normal) + 12(float3 v0) + 12(float3 v1) + 12(float3 v2) + 2(uint16 attr)
  const buf = new ArrayBuffer(headerSize + 4 + triCount * triSize);
  const dv = new DataView(buf);

  // 80-byte header (留空)
  for (let i = 0; i < headerSize; i++) dv.setUint8(i, 0);
  dv.setUint32(headerSize, triCount, true);

  let offset = headerSize + 4;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    // 法线（零，由切片软件自动计算）
    dv.setFloat32(offset, 0, true); offset += 4;
    dv.setFloat32(offset, 0, true); offset += 4;
    dv.setFloat32(offset, 0, true); offset += 4;

    // v0
    dv.setFloat32(offset, positions[i0] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i0 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i0 + 2] * scale, true); offset += 4;
    // v1
    dv.setFloat32(offset, positions[i1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i1 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i1 + 2] * scale, true); offset += 4;
    // v2
    dv.setFloat32(offset, positions[i2] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i2 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i2 + 2] * scale, true); offset += 4;
    // attribute byte count
    dv.setUint16(offset, 0, true); offset += 2;
  }

  downloadBlob(new Blob([buf], { type: 'model/stl' }), filename);
}
