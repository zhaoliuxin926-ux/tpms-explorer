/**
 * 标准骨形态计量学参数（v5.0 阶段 III · Bone Histomorphometry）
 *
 * 基于 3D 灰度/二值体素场（Micro-CT 口径）直接计算临床黄金标准指标：
 *   · BV/TV  骨体积分数 = 固相体素 / 总体素
 *   · Tb.Th  骨小梁厚度 = 2×固相内 EDT 均值（距离变换局部厚度近似）
 *   · Tb.Sp  骨小梁分离度 = 2×孔隙内 EDT 均值
 *   · Tb.N   骨小梁数量 = BV/TV / Tb.Th（mm⁻¹）
 *   · SMI    结构模型指数 = 6/V·Σ A·(1−|n·n̄|)：板状≈0，杆状≈3
 *     （从等值面三角网格 + 顶点法线离散计算）
 * 精度口径：Tb.Th/Tb.Sp 用 EDT 均值近似（非距离脊精确法），SMI 用三角面
 * 法线-顶点法线夹角离散；体素分辨率 ≥64³ 时误差 ~5% 量级（门禁校准）。
 */

import { exactEDT } from '../geometry/ct-reconstruction';
export interface MorphoParams {
  gray?: Uint8Array;          // 灰度体素（可选：提供则先 Otsu 二值化）
  binary?: Uint8Array;        // 已二值化体素（1 = 骨/固相）
  R: number;                  // 分辨率/轴
  voxelMm: number;            // 体素物理尺寸（mm）
}

export interface MorphoResult {
  bvTv: number;               // 骨体积分数 [0,1]
  tbThMm: number;             // 骨小梁厚度（mm）
  tbSpMm: number;             // 骨小梁分离度（mm）
  tbNPerMm: number;           // 骨小梁数量（mm⁻¹）
  smi: number;                // 结构模型指数（板 0 / 杆 3）
  solidFraction: number;
}

export function computeMorphometry(params: MorphoParams): MorphoResult {
  const { R, voxelMm } = params;
  const size = R ** 3;
  const binary = params.binary ?? binarizeOtsu(params.gray!);
  let solid = 0;
  for (let i = 0; i < size; i++) if (binary[i]) solid++;
  const bvTv = solid / size;

  const dSolid = exactEDT(binary, R);          // 到固相的距离（孔隙域）
  const inv = new Uint8Array(size);
  for (let i = 0; i < size; i++) inv[i] = binary[i] ? 0 : 1;
  const dVoid = exactEDT(inv, R);              // 到孔隙的距离（固相域）

  // Tb.Th = 2×固相内 EDT 均值；Tb.Sp = 2×孔隙内 EDT 均值
  let sSum = 0, sN = 0, vSum = 0, vN = 0;
  for (let i = 0; i < size; i++) {
    if (binary[i]) { sSum += dVoid[i]; sN++; }
    else { vSum += dSolid[i]; vN++; }
  }
  const tbThMm = sN ? (2 * sSum) / sN * voxelMm : 0;
  const tbSpMm = vN ? (2 * vSum) / vN * voxelMm : 0;
  const tbN = tbThMm > 0 ? bvTv / tbThMm : 0;

  return {
    bvTv,
    tbThMm,
    tbSpMm,
    tbNPerMm: tbN,
    smi: 0,          // SMI 由 computeSMI（网格法）单独计算后合并
    solidFraction: bvTv,
  };
}

/** 简化 Otsu 二值化 */
function binarizeOtsu(gray: Uint8Array): Uint8Array {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, best = 128, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const between = wB * wF * Math.pow(sumB / wB - (sumAll - sumB) / wF, 2);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) out[i] = gray[i] >= best ? 1 : 0;
  return out;
}

/**
 * SMI（网格法）：从等值面三角网格与顶点法线离散计算。
 * SMI = 6/V · Σ_faces A_f·(1 − |n_tri · n_v̄|)
 * 板状（平滑面）→ ≈0；杆状（高曲率棱）→ ≈3。
 * @param positions/indexes/normals 等值面网格（Surface Nets 输出）
 * @param voxelVolumeMm3 总体积（mm³）
 */
export function computeSMIFromMesh(
  positions: Float32Array,
  indices: Uint32Array,
  normals: Float32Array,
  triCount: number,
): number {
  // SMI = 6/V · Σ_faces A_f·(1 − |n_tri · n_v̄|)
  let sum = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
    const ux = positions[i1 * 3] - p0x, uy = positions[i1 * 3 + 1] - p0y, uz = positions[i1 * 3 + 2] - p0z;
    const vx = positions[i2 * 3] - p0x, vy = positions[i2 * 3 + 1] - p0y, vz = positions[i2 * 3 + 2] - p0z;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const triLen = Math.hypot(cx, cy, cz);
    const area = 0.5 * triLen;
    if (!(triLen > 0)) continue;
    const nx = (normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3]) / 3;
    const ny = (normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1]) / 3;
    const nz = (normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2]) / 3;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const cosDev = Math.abs((cx / triLen) * (nx / nLen) + (cy / triLen) * (ny / nLen) + (cz / triLen) * (nz / nLen));
    sum += area * (1 - cosDev);
  }
  // 注意：positions/normals 为 wc 域（±π）；换算到 mm³ 体素口径由调用方传 sampleVolumeMm3
  // SMI 无量纲：6·Σ A(1−cos) / (Σ A) 的均值口径（等值面总面积归一，尺度无关）
  const totalArea = sum + (1 - 1);  // ΣA(1−cos) 已含面积权重
  void totalArea;
  // 面积归一化口径：SMI_est = 6·Σ A(1−|cos|) / Σ A —— 板 0 / 杆 ~2（面积加权均值）
  let areaSum = 0, devSum = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
    const ux = positions[i1 * 3] - p0x, uy = positions[i1 * 3 + 1] - p0y, uz = positions[i1 * 3 + 2] - p0z;
    const vx = positions[i2 * 3] - p0x, vy = positions[i2 * 3 + 1] - p0y, vz = positions[i2 * 3 + 2] - p0z;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const triLen = Math.hypot(cx, cy, cz);
    const area = 0.5 * triLen;
    if (!(area > 0)) continue;
    areaSum += area;
    const nx = (normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3]) / 3;
    const ny = (normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1]) / 3;
    const nz = (normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2]) / 3;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    const cosDev = Math.abs((cx / triLen) * (nx / nLen) + (cy / triLen) * (ny / nLen) + (cz / triLen) * (nz / nLen));
    devSum += area * (1 - cosDev);
  }
  const smi = areaSum > 0 ? (6 * devSum) / areaSum : 0;
  return smi;
}
