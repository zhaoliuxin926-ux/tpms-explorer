/**
 * 导出 VTK PolyData (.vtk) — 三角网格格式，ParaView 直接可读
 */
import { downloadBlob } from './download';

/**
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              与 STL 同约定（模型总宽 = cellSize mm）。默认 1 保持旧行为。
 * @param normals 可选顶点法线：提供时按法线翻转三角形缠绕序（与 stl-exporter 同一约定），
 *                保证 ParaView 中面片定向一致。
 */
export function exportVTK(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1,
  normals?: Float32Array
): void {
  const vertCount = positions.length / 3;
  const triCount = indices.length / 3;

  const parts: string[] = [
    '# vtk DataFile Version 3.0\n',
    'TPMS Structure; units=mm; 1 period = 1 mm\n',
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
    let i0 = indices[t * 3]!, i1 = indices[t * 3 + 1]!, i2 = indices[t * 3 + 2]!;
    if (normals) {
      const nx = normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3];
      const ny = normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1];
      const nz = normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2];
      const ax = positions[i1 * 3] - positions[i0 * 3];
      const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
      const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
      const bx = positions[i2 * 3] - positions[i0 * 3];
      const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
      const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];
      if (nx * (ay * bz - az * by) + ny * (az * bx - ax * bz) + nz * (ax * by - ay * bx) < 0) {
        const tmp = i1; i1 = i2; i2 = tmp;
      }
    }
    cellsBuf[t] = `3 ${i0} ${i1} ${i2}\n`;
  }
  parts.push(cellsBuf.join(''));

  downloadBlob(new Blob([parts.join('')], { type: 'application/vnd.vtk' }), filename);
}

/**
 * 导出 VTI (VTK ImageData) — 体素场格式，含隐函数标量场
 * @param meta 元数据：写入 FieldData 供第三方 re-contour 对齐平台孔隙率——
 *             solid_network 等值面取 iso（二分结果），shell 类取 0（场已变换为 (v-b)²-(t/2)²）。
 *             Origin/Spacing 按 mm（1 period = 1 mm，模型总宽 = cellSize mm）。
 */
export function exportVTI(
  field: Float32Array,
  dimensions: [number, number, number],
  filename: string,
  meta?: { cellSizeMm: number; isoUsed: number | null; type: string; structureMode: string }
): void {
  const [nx, ny, nz] = dimensions;
  const numPoints = nx * ny * nz;
  const cellSize = meta?.cellSizeMm ?? 1;
  const origin = (-cellSize / 2).toFixed(6);
  const spacing = (cellSize / (nx - 1)).toFixed(6);

  const parts: string[] = [
    '<?xml version="1.0"?>\n',
    '<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">\n',
  ];
  // FieldData 位置/格式约束（VTK 9.x 实测）：
  //  1. 必须在 <ImageData> 内、<Piece> 外（放 VTKFile 直下读取时全部丢失）
  //  2. 数值 DataArray 必须带 format="ascii"
  //  3. String 类型按 VTK XML 规范仅支持 <Array> binary payload——字符串信息改走 XML 注释
  if (meta) {
    const isShell = meta.structureMode === 'shell' || meta.structureMode === 'gradient_shell';
    parts.push(
      `  <ImageData WholeExtent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}" Origin="${origin} ${origin} ${origin}" Spacing="${spacing} ${spacing} ${spacing}">\n`,
      `    <!-- tpmsType=${meta.type} structureMode=${meta.structureMode} cellSizeMm=${cellSize} isoUsed=${meta.isoUsed ?? 'NaN'} -->\n`,
      `    <!-- re-contour: ${isShell
        ? `此场为裸 TPMS 场 V；shell/gradient_shell 需先变换 F=(V)^2-(t/2)^2 再 contour 0（t/2=isoUsed）`
        : 'solid_network 直接 contour at isoUsed'} -->\n`,
      `    <FieldData>\n`,
      `      <DataArray type="Float64" Name="isoUsed" NumberOfTuples="1" format="ascii">${meta.isoUsed ?? 'NaN'}</DataArray>\n`,
      `      <DataArray type="Float64" Name="cellSizeMm" NumberOfTuples="1" format="ascii">${cellSize}</DataArray>\n`,
      `    </FieldData>\n`,
      `    <Piece Extent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}">\n`,
      '      <PointData Scalars="tpms">\n',
      '        <DataArray type="Float32" Name="tpms" format="ascii">\n',
    );
  } else {
    parts.push(
      `  <ImageData WholeExtent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}" Origin="${origin} ${origin} ${origin}" Spacing="${spacing} ${spacing} ${spacing}">\n`,
      `    <Piece Extent="0 ${nx - 1} 0 ${ny - 1} 0 ${nz - 1}">\n`,
      '      <PointData Scalars="tpms">\n',
      '        <DataArray type="Float32" Name="tpms" format="ascii">\n',
    );
  }

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
