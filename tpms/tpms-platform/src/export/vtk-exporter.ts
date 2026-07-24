/**
 * 导出 VTK PolyData (.vtk) — 三角网格格式，ParaView 直接可读
 */
import { downloadBlob } from './download';

export function exportVTK(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string
): void {
  const vertCount = positions.length / 3;
  const triCount = indices.length / 3;

  let header = '# vtk DataFile Version 3.0\n';
  header += 'TPMS Structure\n';
  header += 'ASCII\n';
  header += 'DATASET POLYDATA\n';
  header += `POINTS ${vertCount} float\n`;

  let pointsStr = '';
  for (let i = 0; i < positions.length; i += 3) {
    pointsStr += `${positions[i].toFixed(6)} ${positions[i + 1].toFixed(6)} ${positions[i + 2].toFixed(6)}\n`;
  }

  header += pointsStr;
  header += `POLYGONS ${triCount} ${triCount * 4}\n`;

  let cellsStr = '';
  for (let t = 0; t < triCount; t++) {
    cellsStr += `3 ${indices[t * 3]} ${indices[t * 3 + 1]} ${indices[t * 3 + 2]}\n`;
  }
  header += cellsStr;

  downloadBlob(new Blob([header], { type: 'application/vnd.vtk' }), filename);
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

  let xml = '<?xml version="1.0"?>\n';
  xml += '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">\n';
  xml += `  <ImageData WholeExtent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}" Origin="-1 -1 -1" Spacing="${2 / (nx - 1)} ${2 / (ny - 1)} ${2 / (nz - 1)}">\n`;
  xml += `    <Piece Extent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}">\n`;
  xml += '      <PointData Scalars="tpms">\n';
  xml += '        <DataArray type="Float32" Name="tpms" format="ascii">\n';

  let dataStr = '';
  for (let i = 0; i < numPoints; i++) {
    dataStr += field[i].toFixed(4) + ' ';
    if ((i + 1) % 6 === 0) dataStr += '\n';
  }
  xml += dataStr + '\n';
  xml += '        </DataArray>\n';
  xml += '      </PointData>\n';
  xml += '    </Piece>\n';
  xml += '  </ImageData>\n';
  xml += '</VTKFile>';

  downloadBlob(new Blob([xml], { type: 'application/xml' }), filename);
}
