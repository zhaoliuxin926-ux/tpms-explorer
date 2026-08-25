/**
 * 导出 VTK PolyData (.vtk) — 三角网格格式，ParaView 直接可读
 */
import { downloadBlob } from './download';

/**
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              与 STL 同约定（模型总宽 = cellSize mm）。默认 1 保持旧行为。
 */
export function exportVTK(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1
): void {
  const vertCount = positions.length / 3;
  const triCount = indices.length / 3;

  const parts: string[] = [
    '# vtk DataFile Version 3.0\n',
    'TPMS Structure\n',
    'ASCII\n',
    'DATASET POLYDATA\n',
    `POINTS ${vertCount} float\n`,
  ];

  // 顶点坐标：预估容量减少扩容，避免百万次字符串重建
  const pointsBuf: string[] = new Array(vertCount);
  for (let v = 0; v < vertCount; v++) {
    const i = v * 3;
    pointsBuf[v] = `${(positions[i]! * scale).toFixed(6)} ${(positions[i + 1]! * scale).toFixed(6)} ${(positions[i + 2]! * scale).toFixed(6)}\n`;
  }
  parts.push(pointsBuf.join(''));

  parts.push(`POLYGONS ${triCount} ${triCount * 4}\n`);

  const cellsBuf: string[] = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    cellsBuf[t] = `3 ${indices[i]} ${indices[i + 1]} ${indices[i + 2]}\n`;
  }
  parts.push(cellsBuf.join(''));

  downloadBlob(new Blob([parts.join('')], { type: 'application/vnd.vtk' }), filename);
}

/**
 * 导出 VTI (VTK ImageData) — 体素场格式，含隐函数标量场
 */
export function exportVTI(
  field: Float32Array,
  dimensions: [number, number, number],
  filename: string
): void {
  const [nx, ny, nz] = dimensions;
  const numPoints = nx * ny * nz;

  const parts: string[] = [
    '<?xml version="1.0"?>\n',
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">\n',
    `  <ImageData WholeExtent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}" Origin="-1 -1 -1" Spacing="${2 / (nx - 1)} ${2 / (ny - 1)} ${2 / (nz - 1)}">\n`,
    `    <Piece Extent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}">\n`,
    '      <PointData Scalars="tpms">\n',
    '        <DataArray type="Float32" Name="tpms" format="ascii">\n',
  ];

  // 体素场：每 6 个一行，用数组 push 避免大体积字符串重建
  const dataBuf: string[] = new Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    dataBuf[i] = (i > 0 && i % 6 === 0) ? `\n${field[i]!.toFixed(4)} ` : `${field[i]!.toFixed(4)} `;
  }
  parts.push(dataBuf.join(''));
  parts.push('\n');

  parts.push('        </DataArray>\n');
  parts.push('      </PointData>\n');
  parts.push('    </Piece>\n');
  parts.push('  </ImageData>\n');
  parts.push('</VTKFile>');

  downloadBlob(new Blob([parts.join('')], { type: 'application/xml' }), filename);
}
