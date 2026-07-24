/**
 * 网格几何计算工具
 * 提供三角网格的表面积、包围体积及比表面积等核心指标计算。
 */

/**
 * 用海伦公式计算所有三角面的总面积。
 * @param positions 顶点坐标数组（每 3 个连续值为一个顶点的 x, y, z）
 * @param indices   三角面索引数组（每 3 个连续值为一个三角面的顶点索引）
 * @returns         总面积（单位与坐标一致）
 */
export function computeSurfaceArea(positions: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];

    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];

    // 叉积模长 = 2 * 三角形面积
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;

    area += Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }
  return area;
}

/**
 * 用四面体求和法计算封闭网格的包围体积。
 * 每个三角面与原点构成一个四面体，带符号体积之和即为网格包围体积。
 * 要求网格封闭且法线朝外；若输入不封闭，结果可能不准确。
 * @param positions 顶点坐标数组
 * @param indices   三角面索引数组
 * @returns         包围体积（单位与坐标一致）
 */
export function computeEnvelopeVolume(positions: Float32Array, indices: Uint32Array): number {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const x0 = positions[i0], y0 = positions[i0 + 1], z0 = positions[i0 + 2];
    const x1 = positions[i1], y1 = positions[i1 + 1], z1 = positions[i1 + 2];
    const x2 = positions[i2], y2 = positions[i2 + 1], z2 = positions[i2 + 2];

    // 行列式 det([v0, v1, v2]) / 6
    vol += (
      x0 * (y1 * z2 - y2 * z1) -
      y0 * (x1 * z2 - x2 * z1) +
      z0 * (x1 * y2 - x2 * y1)
    ) / 6;
  }
  return Math.abs(vol);
}

/**
 * 计算比表面积 Sv = A / V。
 * @param surfaceArea    表面积
 * @param envelopeVolume 包围体积
 * @returns              比表面积；体积为 0 时返回 0
 */
export function computeSvRatio(surfaceArea: number, envelopeVolume: number): number {
  return envelopeVolume > 0 ? surfaceArea / envelopeVolume : 0;
}
