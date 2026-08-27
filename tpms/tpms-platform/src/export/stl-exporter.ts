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

/**
 * CFD Multi-Patch ASCII STL（OpenFOAM-ready）
 *
 * 按三角面片质心与定向几何法线把网格分入四个 boundary patch：
 *   · inlet : c_z ≤ z_min+ε 且 n_z < −0.7（底面强外向 → 流动入口候选）
 *   · outlet: c_z ≥ z_max−ε 且 n_z > 0.7（顶面强外向 → 出口候选）
 *   · sides : 贴 x/y 边界裁剪面的面片（侧壁周期/对称边界候选）
 *   · wall  : 其余内部多孔曲面
 * ε = 对应轴包围盒跨度的 1%（含绝对下限）。注意这里是固相网格，
 * OpenFOAM 以补集为流动域时出入口语义需按物理朝向复核——本函数忠实执行
 * 几何分类规则，不做方向臆断。
 *
 * 输出标准多 solid ASCII STL（`solid <name> … endsolid <name>` 四区块），
 * snappyHexMesh / surfaceConvert 可直接读取分块命名边界。
 */
export type CfdPatchName = 'inlet' | 'outlet' | 'sides' | 'wall';
const PATCH_ORDER: readonly CfdPatchName[] = ['inlet', 'outlet', 'sides', 'wall'];

export function buildMultiSolidSTL(
  positions: Float32Array,
  indices: Uint32Array,
  scale = 1,
  normals?: Float32Array,
): string {
  const triCount = indices.length / 3;

  // 包围盒（缩放后 mm 域）
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * scale, y = positions[i + 1] * scale, z = positions[i + 2] * scale;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const epsX = Math.max((xmax - xmin) * 0.01, scale * 1e-3);
  const epsY = Math.max((ymax - ymin) * 0.01, scale * 1e-3);
  const epsZ = Math.max((zmax - zmin) * 0.01, scale * 1e-3);

  const chunks: Record<CfdPatchName, string[]> = { inlet: [], outlet: [], sides: [], wall: [] };
  const fmt = (v: number): string => v.toFixed(6);

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
    let gx = ay * bz - az * by;
    let gy = az * bx - ax * bz;
    let gz = ax * by - ay * bx;

    if (normals) {
      // 与 binary 导出同一缠绕定向约定：几何法线与顶点解析法线反向则交换 v1/v2
      const nx = normals[i0] + normals[i1] + normals[i2];
      const ny = normals[i0 + 1] + normals[i1 + 1] + normals[i2 + 1];
      const nz = normals[i0 + 2] + normals[i1 + 2] + normals[i2 + 2];
      if (nx * gx + ny * gy + nz * gz < 0) {
        const tmp = i1; i1 = i2; i2 = tmp;
        gx = -gx; gy = -gy; gz = -gz;
      }
    }
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = gx / gl, ny = gy / gl, nz = gz / gl;

    const cx = (positions[i0] + positions[i1] + positions[i2]) / 3 * scale;
    const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3 * scale;
    const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3 * scale;

    let patch: CfdPatchName = 'wall';
    if (cz <= zmin + epsZ && nz < -0.7) patch = 'inlet';
    else if (cz >= zmax - epsZ && nz > 0.7) patch = 'outlet';
    else if (cx <= xmin + epsX || cx >= xmax - epsX || cy <= ymin + epsY || cy >= ymax - epsY) patch = 'sides';

    const lines = chunks[patch];
    lines.push(
      ` facet normal ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}\n`,
      '  outer loop\n',
      `   vertex ${fmt(positions[i0] * scale)} ${fmt(positions[i0 + 1] * scale)} ${fmt(positions[i0 + 2] * scale)}\n`,
      `   vertex ${fmt(positions[i1] * scale)} ${fmt(positions[i1 + 1] * scale)} ${fmt(positions[i1 + 2] * scale)}\n`,
      `   vertex ${fmt(positions[i2] * scale)} ${fmt(positions[i2 + 1] * scale)} ${fmt(positions[i2 + 2] * scale)}\n`,
      '  endloop\n',
      ' endfacet\n',
    );
  }

  let out = '';
  for (const name of PATCH_ORDER) {
    out += `solid ${name}\n${chunks[name].join('')}endsolid ${name}\n`;
  }
  return out;
}

/** Multi-solid ASCII STL 下载（mm 缩放与 binary 入口一致）。 */
export function exportMultiSolidSTL(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1,
  normals?: Float32Array,
): void {
  const text = buildMultiSolidSTL(positions, indices, scale, normals);
  downloadBlob(new Blob([text], { type: 'model/stl' }), filename);
}
