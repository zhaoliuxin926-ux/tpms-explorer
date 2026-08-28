/**
 * Micro-CT 体素重构与制造偏差分析（v4.0 阶段 V）
 *
 * 管线：CT 体素栈（灰度或已二值化）→ Otsu 自动阈值 → 固/空二值场 →
 * 精确欧氏距离变换（3D EDT，Felzenszwalb & Huttenlocher 可分离抛物线包络法）
 * → 有符号距离场 SDF_scan(x)（固相内为正）→ 与名义 CAD 顶点求 Δd 制造偏差。
 *
 * 偏差符号约定：Δd = SDF_scan(名义顶点)
 *   Δd > 0：名义面位于打印固相内部 → 材料过剩（过充，红）
 *   Δd < 0：名义面位于孔隙侧 → 材料不足（欠肉，蓝）
 *   |Δd|  ：到实际打印表面的法向距离（体素单位 × 体素尺寸 = mm）
 *
 * 演示数据集 generateDemoCT：名义 TPMS 体素场 + 受控制造缺陷模型
 * （均匀正偏置 + 表面粗糙噪声 + 场梯度阈值漂移），供无 CT 数据时全流程演示。
 * 诚实边界：体素分辨率受 CT 扫描分辨率限制（演示集 40³）。
 */

import type { TpmType } from '../types';
import { getTpmsFunction } from '../core/tpms-functions';
import { sampleCoolWarmInto } from './vertex-coloring';

export interface CTScanData {
  R: number;                 // 体素分辨率/轴
  voxelMm: number;           // 体素物理尺寸（mm）
  binary: Uint8Array;        // R³，1 = 固相
  threshold: number;         // Otsu 阈值（0~255 灰度域）
}

/** Otsu 自动阈值：256 级灰度直方图的最大类间方差 */
export function otsuThreshold(values: Uint8Array | number[]): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.min(255, Math.max(0, values[i] | 0))]++;
  const total = values.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

// ── 精确 3D EDT（F&H 抛物线包络，可分离三趟）──

/** 一维平方距离变换：f 为输入（INF=非特征），输出同长度平方距离 */
function dt1d(f: Float64Array, out: Float64Array): void {
  const n = f.length;
  const v = new Int32Array(n);            // 包络抛物线位置
  const z = new Float64Array(n + 1);      // 包络边界
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (!Number.isFinite(f[q])) continue;
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * 精确欧氏距离变换（到最近特征体素的欧氏距离，体素单位）。
 * @param feature 特征掩码（1 = 特征体素，如固相表面或固相全体）
 */
export function exactEDT(feature: Uint8Array, R: number): Float64Array {
  const size = R * R * R;
  const INF = 1e20;
  const dist = new Float64Array(size);
  const f = new Float64Array(R);
  const d = new Float64Array(R);
  // 初始化：特征体素 0，其余 INF
  for (let i = 0; i < size; i++) dist[i] = feature[i] ? 0 : INF;
  // x 趟
  for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) {
    const base = iy * R + iz * R * R;
    for (let ix = 0; ix < R; ix++) f[ix] = dist[base + ix];
    dt1d(f, d);
    for (let ix = 0; ix < R; ix++) dist[base + ix] = d[ix];
  }
  // y 趟
  for (let iz = 0; iz < R; iz++) for (let ix = 0; ix < R; ix++) {
    for (let iy = 0; iy < R; iy++) f[iy] = dist[ix + iy * R + iz * R * R];
    dt1d(f, d);
    for (let iy = 0; iy < R; iy++) dist[ix + iy * R + iz * R * R] = d[iy];
  }
  // z 趟
  for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
    for (let iz = 0; iz < R; iz++) f[iz] = dist[ix + iy * R + iz * R * R];
    dt1d(f, d);
    for (let iz = 0; iz < R; iz++) dist[ix + iy * R + iz * R * R] = d[iz];
  }
  // 平方距离 → 距离
  for (let i = 0; i < size; i++) dist[i] = Math.sqrt(dist[i]);
  return dist;
}

export interface CTReconstruction {
  scan: CTScanData;
  threshold: number;
  /** 有符号距离场（体素单位；固相内为正） */
  sdf: Float64Array;
}

/**
 * 体素栈 → Otsu 二值化 → SDF（固相内为正，到最近表面的欧氏距离）。
 * @param gray 灰度体素栈（0~255）；已二值化时给 binaryOnly
 */
export function reconstructFromGray(gray: Uint8Array, R: number, voxelMm: number): CTReconstruction {
  const threshold = otsuThreshold(gray);
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) binary[i] = gray[i] >= threshold ? 1 : 0;
  return finalize(binary, R, voxelMm, threshold);
}

export function reconstructFromBinary(binary: Uint8Array, R: number, voxelMm: number): CTReconstruction {
  return finalize(binary, R, voxelMm, 0);
}

function finalize(binary: Uint8Array, R: number, voxelMm: number, threshold: number): CTReconstruction {
  // dSolid：到固相的距离；dVoid：到孔隙的距离
  const dSolid = exactEDT(binary, R);
  const inv = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) inv[i] = binary[i] ? 0 : 1;
  const dVoid = exactEDT(inv, R);
  const sdf = new Float64Array(binary.length);
  for (let i = 0; i < binary.length; i++) sdf[i] = binary[i] ? dVoid[i] : -dSolid[i];
  // 体素单位 → mm
  for (let i = 0; i < sdf.length; i++) sdf[i] *= voxelMm;
  return { scan: { R, voxelMm, binary, threshold }, threshold, sdf };
}

export interface DeviationStats {
  maxPositive: number;    // 最大正偏差（过充，mm）
  maxNegative: number;    // 最大负偏差（欠肉，mm）
  rms: number;            // RMS 制造误差（mm）
  mean: number;
  count: number;
}

export function deviationStats(deviations: number[]): DeviationStats {
  let mx = -Infinity, mn = Infinity, sum = 0, sum2 = 0;
  for (const d of deviations) {
    if (d > mx) mx = d;
    if (d < mn) mn = d;
    sum += d; sum2 += d * d;
  }
  const n = deviations.length || 1;
  return { maxPositive: mx, maxNegative: mn, rms: Math.sqrt(sum2 / n), mean: sum / n, count: deviations.length };
}

/**
 * 名义 CAD 顶点 → 实际打印表面偏差（SDF 最近邻采样，体素尺寸 ≪ 特征尺寸时无插值损失）。
 * 返回逐顶点偏差数组 + 统计。
 */
export function sampleDeviation(recon: CTReconstruction, positions: Float32Array, vertCount: number): { deviations: number[]; stats: DeviationStats } {
  const { R } = recon.scan;
  // 体素网格恒覆盖名义 wc 域 ±π：ix = floor((wx + π)·R/(2π))
  const deviations: number[] = [];
  const out = -recon.scan.voxelMm;   // 域外顶点按「无材料」处理
  for (let i = 0; i < vertCount; i++) {
    const ix = Math.floor(((positions[i * 3] + Math.PI) * R) / (2 * Math.PI));
    const iy = Math.floor(((positions[i * 3 + 1] + Math.PI) * R) / (2 * Math.PI));
    const iz = Math.floor(((positions[i * 3 + 2] + Math.PI) * R) / (2 * Math.PI));
    if (ix < 0 || iy < 0 || iz < 0 || ix >= R || iy >= R || iz >= R) { deviations.push(out); continue; }
    deviations.push(recon.sdf[ix + iy * R + iz * R * R]);
  }
  return { deviations, stats: deviationStats(deviations) };
}

/** 偏差 → Blue(欠) - White(贴合) - Red(过) 顶点色 */
export function deviationColors(deviations: number[], maxAbs: number): Float32Array {
  const colors = new Float32Array(deviations.length * 3);
  const scale = maxAbs > 0 ? 0.5 / maxAbs : 0;
  for (let i = 0; i < deviations.length; i++) {
    // 0.5 = 贴合（白），>0.5 过充（红），<0.5 欠肉（蓝）
    sampleCoolWarmInto(0.5 + deviations[i] * scale, colors, i * 3);
  }
  return colors;
}

export interface DemoCTOptions {
  type: TpmType;
  periods: number;
  structureMode: 'solid_network' | 'shell';
  /** 名义等值（solid_network：二分 bias；shell：tEff/2 —— 与 WorkerResponse.isoUsed 同源） */
  iso: number;
  /** CT 体素分辨率/轴（40~64） */
  R: number;
  /** 试样物理总宽（mm），体素尺寸 = width/R */
  widthMm: number;
  /** 均匀尺寸偏置（mm；+ 过充 = 固相面向孔隙侧平移） */
  biasMm: number;
  /** 表面粗糙噪声幅值（体素单位） */
  roughness: number;
}

/**
 * 演示 CT 数据集：名义 TPMS 场 + 受控制造缺陷
 * （biasMm 均匀过充偏置 + roughness 高斯表面噪声 + z 向层间灰度漂移），
 * 经 reconstructFromGray 全管线（Otsu → SDF）返回。
 * 偏置的 wc 换算：mm = wc·(widthMm/(2π)) ⇒ wc 偏置 = biasMm·2π/widthMm。
 */
export function generateDemoCT(opts: DemoCTOptions): CTReconstruction {
  const { R } = opts;
  const k = opts.periods;
  const tpmFn = getTpmsFunction(opts.type, '', { k, t: 1, iso: opts.iso });
  const gray = new Uint8Array(R * R * R);
  let seed = 424242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const voxelWc = (2 * Math.PI) / R;
  const biasWc = (opts.biasMm * 2 * Math.PI) / opts.widthMm;
  const driftAmp = 6;   // z 向层间灰度漂移（CT 环状伪影演示，幅度受控不淹没双峰结构）
  for (let iz = 0; iz < R; iz++) {
    const wz = -Math.PI + (iz + 0.5) * voxelWc;
    const drift = driftAmp * Math.sin(iz * 0.7);
    for (let iy = 0; iy < R; iy++) {
      const wy = -Math.PI + (iy + 0.5) * voxelWc;
      for (let ix = 0; ix < R; ix++) {
        const wx = -Math.PI + (ix + 0.5) * voxelWc;
        const v = tpmFn(wx * k, wy * k, wz * k, [1, 1, 1, 1]);
        // 制造缺陷（分类语义）：名义等值面向孔隙侧平移 biasWc = 过充。
        // solid_network: solid ⟺ v − bias < iso；shell: solid ⟺ |v − bias| > tHalf。
        // 双峰灰度（固相亮/孔隙暗）——单峰分布会让 Otsu 偏离等值面（0.5mm 假偏差根因）
        const noisy = v + gauss() * opts.roughness * voxelWc - biasWc;
        const solid = opts.structureMode === 'shell'
          ? Math.abs(noisy) > opts.iso   // shell: iso = tEff/2
          : noisy < opts.iso;
        const base = solid ? 190 + drift : 40 + drift * 0.5;
        gray[ix + iy * R + iz * R * R] = Math.max(0, Math.min(255, Math.round(base + gauss() * 10)));
      }
    }
  }
  const voxelMm = opts.widthMm / R;
  return reconstructFromGray(gray, R, voxelMm);
}
