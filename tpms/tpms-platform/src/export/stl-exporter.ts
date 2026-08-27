/**
 * 二进制 STL 导出器
 * 同网格下体积仅为 ASCII 的约 1/5–1/10，切片软件加载更快。
 */
import { downloadBlob } from './download';

/**
 * 生成二进制 STL 字节流（与下载解耦，供 .verify/parity_math.mjs 直接断言）。
 *
 * 缠绕定向：Surface Nets 的 quad 顶点序按坐标轴固定排列，与局部梯度无关，
 * 约一半三角形的几何法线与场梯度反向。提供 normals（顶点解析法线）时，
 * 按顶点法线与几何法线点积符号翻转每个三角形的缠绕序，使 STL 整体定向一致；
 * 法线行始终写归一化几何法线（与缠绕严格自洽，Abaqus/COMSOL 重建实体依赖此约定）。
 *
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              使导出模型总宽 = cellSize mm（1 period = 1 mm）。默认 1 保持旧行为。
 * @param normals 可选顶点法线（Float32Array，每顶点 3 分量），仅用于缠绕翻转判定
 */
export function buildBinarySTL(
  positions: Float32Array,
  indices: Uint32Array,
  scale = 1,
  normals?: Float32Array
): ArrayBuffer {
  const triCount = indices.length / 3;
  const headerSize = 80;
  const triSize = 50; // 12(float3 normal) + 12(float3 v0) + 12(float3 v1) + 12(float3 v2) + 2(uint16 attr)
  const buf = new ArrayBuffer(headerSize + 4 + triCount * triSize);
  const dv = new DataView(buf);

  // header：写入单位与参数提示（C 样式截断到 80 字节）
  const header = 'TPMS Explorer binary STL; units=mm; 1 period = 1 mm';
  for (let i = 0; i < header.length && i < headerSize; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(headerSize, triCount, true);

  let offset = headerSize + 4;
  for (let t = 0; t < triCount; t++) {
    let i0 = indices[t * 3] * 3;
    let i1 = indices[t * 3 + 1] * 3;
    let i2 = indices[t * 3 + 2] * 3;

    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    let cx = ay * bz - az * by;
    let cy = az * bx - ax * bz;
    let cz = ax * by - ay * bx;

    if (normals) {
      // 三顶点法线平均 → 期望外向；几何法线与之反向则交换 v1/v2（缠绕翻转）
      const nx = normals[i0] + normals[i1] + normals[i2];
      const ny = normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1];
      const nz = normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2];
      if (nx * cx + ny * cy + nz * cz < 0) {
        const tmp = i1; i1 = i2; i2 = tmp;
        cx = -cx; cy = -cy; cz = -cz;
      }
    }

    const clen = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    dv.setFloat32(offset, cx / clen, true); offset += 4;
    dv.setFloat32(offset, cy / clen, true); offset += 4;
    dv.setFloat32(offset, cz / clen, true); offset += 4;

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
  return buf;
}

/**
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              使导出模型总宽 = cellSize mm（1 period = 1 mm）。默认 1 保持旧行为。
 * @param normals 可选顶点法线，用于缠绕定向（见 buildBinarySTL）
 */
export function exportBinarySTL(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1,
  normals?: Float32Array
): void {
  const buf = buildBinarySTL(positions, indices, scale, normals);
  downloadBlob(new Blob([buf], { type: 'model/stl' }), filename);
}
