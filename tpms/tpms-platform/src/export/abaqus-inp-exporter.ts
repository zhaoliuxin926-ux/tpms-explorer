/**
 * Abaqus INP 体网格导出器（v3.0 阶段 III）
 *
 * 直接从 TPMS 体素模型生成 C3D8（8 节点六面体线性单元）体网格：
 *   · 节点 = 固相体素触及的栅格角点（去重，1 基编号，mm 尺度）
 *   · 单元 = 固相体素（轴对齐正六面体，Jacobian 恒正 = h³，ratio 1.0）
 *   · 节点集：NSET_BOTTOM / NSET_TOP / NSET_PBC_X0..Z1（仅含被固相单元引用的节点，
 *     PBC 均质化方程可直接引用）
 *   · 材料 + 单轴压缩载荷步模板（mm-N-MPa 单位制）
 * 诚实边界：体素级网格的表面呈阶梯状（非贴体），适用于均质化/正分析预研；
 * 高保真贴体网格需等值面重建 + 体网格化（后续架构）。
 */

import type { VoxelModel } from './voxel-model';
import { downloadText } from './download';

export interface AbaqusExportOptions {
  /** 弹性模量（MPa，mm-N-MPa 单位制；BASE_MODULUS 为 GPa 需 ×1000） */
  youngModulusMPa: number;
  /** 泊松比 */
  poisson: number;
  /** 单轴压缩名义应变（TOP 面位移 / L） */
  nominalStrain: number;
  /** 试样总宽 L（mm） */
  specimenSizeMm: number;
}

/** 体素模型 → Abaqus INP 文本。返回 { text, nodeCount, elemCount, setSizes } */
export function buildAbaqusInp(model: VoxelModel, opts: AbaqusExportOptions): {
  text: string; nodeCount: number; elemCount: number;
} {
  const { R, solid, hWc } = model;
  const scale = opts.specimenSizeMm / (2 * Math.PI);   // wc → mm（总宽 = specimenSizeMm）
  const h = hWc * scale;
  const N1 = R + 1;
  const idx3 = (x: number, y: number, z: number) => x + y * N1 + z * N1 * N1;

  // 1. 收集被固相单元引用的节点（排序后去重编号）
  const nodeUsed = new Uint8Array(N1 * N1 * N1);
  for (let iz = 0; iz < R; iz++) {
    for (let iy = 0; iy < R; iy++) {
      for (let ix = 0; ix < R; ix++) {
        if (!solid[ix + iy * R + iz * R * R]) continue;
        nodeUsed[idx3(ix, iy, iz)] = 1;
        nodeUsed[idx3(ix + 1, iy, iz)] = 1;
        nodeUsed[idx3(ix, iy + 1, iz)] = 1;
        nodeUsed[idx3(ix + 1, iy + 1, iz)] = 1;
        nodeUsed[idx3(ix, iy, iz + 1)] = 1;
        nodeUsed[idx3(ix + 1, iy, iz + 1)] = 1;
        nodeUsed[idx3(ix, iy + 1, iz + 1)] = 1;
        nodeUsed[idx3(ix + 1, iy + 1, iz + 1)] = 1;
      }
    }
  }
  // 1 基连续编号（Abaqus 惯例）
  const nodeId = new Int32Array(N1 * N1 * N1);
  const usedList: number[] = [];
  let nodeCount = 0;
  for (let i = 0; i < N1 * N1 * N1; i++) {
    if (nodeUsed[i]) { nodeCount++; nodeId[i] = nodeCount; usedList.push(i); }
  }

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push('*HEADING');
  push('TPMS lattice volumetric mesh (C3D8 voxel) - TPMS Explorer v3.0');
  push(`** solid voxels: voxels classified by implicit field (solid fraction ${(model.solidCount / (R * R * R)).toFixed(4)})`);
  push(`** units: mm, N, MPa; specimen size ${opts.specimenSizeMm.toFixed(3)} mm; voxel h = ${h.toExponential(4)} mm`);
  push('**');
  push('*NODE');
  for (const i of usedList) {
    const iz = Math.floor(i / (N1 * N1));
    const iy = Math.floor((i % (N1 * N1)) / N1);
    const ix = i % N1;
    push(`${nodeId[i]}, ${(ix * hWc - Math.PI) * scale}, ${(iy * hWc - Math.PI) * scale}, ${(iz * hWc - Math.PI) * scale}`);
  }

  push('*ELEMENT, TYPE=C3D8, ELSET=ESOLID');
  let elemCount = 0;
  const setBuf: Record<string, number[]> = { BOTTOM: [], TOP: [], PBC_X0: [], PBC_X1: [], PBC_Y0: [], PBC_Y1: [], PBC_Z0: [], PBC_Z1: [] };
  for (let iz = 0; iz < R; iz++) {
    for (let iy = 0; iy < R; iy++) {
      for (let ix = 0; ix < R; ix++) {
        if (!solid[ix + iy * R + iz * R * R]) continue;
        elemCount++;
        const n1 = nodeId[idx3(ix, iy, iz)];
        const n2 = nodeId[idx3(ix + 1, iy, iz)];
        const n3 = nodeId[idx3(ix + 1, iy + 1, iz)];
        const n4 = nodeId[idx3(ix, iy + 1, iz)];
        const n5 = nodeId[idx3(ix, iy, iz + 1)];
        const n6 = nodeId[idx3(ix + 1, iy, iz + 1)];
        const n7 = nodeId[idx3(ix + 1, iy + 1, iz + 1)];
        const n8 = nodeId[idx3(ix, iy + 1, iz + 1)];
        push(`${elemCount}, ${n1}, ${n2}, ${n3}, ${n4}, ${n5}, ${n6}, ${n7}, ${n8}`);
      }
    }
  }

  // 节点集（仅固相引用节点；面定义：BOTTOM=iz 最小层等）
  for (const i of usedList) {
    const iz = Math.floor(i / (N1 * N1));
    const iy = Math.floor((i % (N1 * N1)) / N1);
    const ix = i % N1;
    if (iz === 0) setBuf.BOTTOM.push(nodeId[i]);
    if (iz === R) setBuf.TOP.push(nodeId[i]);
    if (ix === 0) setBuf.PBC_X0.push(nodeId[i]);
    if (ix === R) setBuf.PBC_X1.push(nodeId[i]);
    if (iy === 0) setBuf.PBC_Y0.push(nodeId[i]);
    if (iy === R) setBuf.PBC_Y1.push(nodeId[i]);
    if (iz === 0) setBuf.PBC_Z0.push(nodeId[i]);
    if (iz === R) setBuf.PBC_Z1.push(nodeId[i]);
  }
  for (const [name, ids] of Object.entries(setBuf)) {
    if (ids.length === 0) continue;
    push(`*NSET, NSET=NSET_${name}`);
    for (let i = 0; i < ids.length; i += 8) {
      push(ids.slice(i, i + 8).join(', '));
    }
  }

  push('**');
  push('** PBC usage: couple NSET_PBC_X0/X1 (and Y/Z) with *EQUATION or a'
    + ' submodel of periodic MPC; edge/corner masters need dedicated sets in production workflows.');
  push('*SOLID SECTION, ELSET=ESOLID, MATERIAL=TPMS_MATRIX');
  push('*MATERIAL, NAME=TPMS_MATRIX');
  push('*ELASTIC');
  push(`${opts.youngModulusMPa}, ${opts.poisson}`);
  push('**');
  push('** Uniaxial compression along Z (bottom fixed, top displaced)');
  const disp = -(opts.nominalStrain * opts.specimenSizeMm);
  push('*STEP');
  push('*STATIC');
  push('*BOUNDARY');
  push('NSET_BOTTOM, 3, 3, 0.0');
  push('NSET_TOP, 3, 3, ' + disp.toFixed(6));
  push('*OUTPUT, FIELD');
  push('*ELEMENT OUTPUT');
  push('S, E');
  push('*NODE OUTPUT');
  push('U');
  push('*END STEP');

  return { text: lines.join('\n') + '\n', nodeCount, elemCount };
}

export function exportAbaqusInp(model: VoxelModel, opts: AbaqusExportOptions, filename: string): void {
  const { text } = buildAbaqusInp(model, opts);
  downloadText(text, filename, 'text/plain');
}
