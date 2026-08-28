/**
 * 主应力张量迹线引导的各向异性空间场调制（v3.0 阶段 IV · 仿生骨小梁机理）
 *
 * 物理语义：外载荷决定空间应力张量场 σ(x)；TPMS 单胞在主应力方向上拉伸
 * （各向异性度规 S = diag(1/α, 1, 1)，α>1 时晶胞沿最大主应力方向伸长），
 * 壳模式高应力侧孔隙板收窄（固相致密化）C(x) = C0·(1 − β·σvm(x))——
 * 高应力区相对密度提升，与骨小梁 Wolff 定律的力学诱导生长同构。
 *
 * 预设工况（归一化坐标 px,py,pz ∈ [−1,1]，vm 归一到 [0,1]）：
 *   bending    三点弯曲梁（z 向高度场）：σxx = pz（纯弯，主方向恒 x）
 *   cantilever 悬臂梁（x=+1 端部载荷）：σxx = (1−px)·pz/2（弯矩随距离衰减）
 *   torsion    扭转（z 轴）：τxz = −py/√2, τyz = px/√2（圣维南扭转近似）
 *
 * 特征分解：3×3 对称 Jacobi 旋转（解析预设下矩阵接近对角，3~5 次扫描收敛）。
 */

import type { StressConfig, StressPreset } from '../types';

export type { StressConfig, StressPreset };

export const DEFAULT_STRESS: StressConfig = { preset: 'none', strength: 0.5, anisotropy: 1.6 };

/** 对称 3×3（行主序 [xx,xy,xz, yy,yz, zz]）→ 特征值 + 特征向量（列） */
export function eigenSym3(xx: number, xy: number, xz: number, yy: number, yz: number, zz: number): {
  values: [number, number, number];
  vectors: [number, number, number][];
} {
  // a[i][j] 工作副本；v 单位矩阵
  const a = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 12; sweep++) {
    // 非对角最大元素
    let p = 0, q = 1, maxOff = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > maxOff) { p = 0; q = 2; maxOff = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > maxOff) { p = 1; q = 2; maxOff = Math.abs(a[1][2]); }
    if (maxOff < 1e-14) break;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const theta = (aqq - app) / (2 * apq);
    const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    // 旋转更新
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  const values: [number, number, number] = [a[0][0], a[1][1], a[2][2]];
  const vectors: [number, number, number][] = [
    [v[0][0], v[1][0], v[2][0]],
    [v[0][1], v[1][1], v[2][1]],
    [v[0][2], v[1][2], v[2][2]],
  ];
  return { values, vectors };
}

export interface StressSample {
  /** σ 六分量（行主序） */
  xx: number; xy: number; xz: number; yy: number; yz: number; zz: number;
  /** 归一化 von Mises [0,1] */
  vm: number;
}

/** 解析应力张量预设（归一化物理坐标） */
export function stressAt(cfg: StressConfig, px: number, py: number, pz: number): StressSample {
  switch (cfg.preset) {
    case 'bending': {
      const sxx = pz;
      return { xx: sxx, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0, vm: Math.abs(sxx) };
    }
    case 'cantilever': {
      const sxx = ((1 - px) * pz) / 2;
      const txz = 0.25 * (1 - px * px) * (1 - pz * pz);
      return { xx: sxx, xy: 0, xz: txz, yy: 0, yz: 0, zz: 0, vm: Math.min(1, Math.sqrt(sxx * sxx + 3 * txz * txz)) };
    }
    case 'torsion': {
      const txz = -py / Math.SQRT2;
      const tyz = px / Math.SQRT2;
      return { xx: 0, xy: 0, xz: txz, yy: 0, yz: tyz, zz: 0, vm: Math.min(1, Math.sqrt(3 * (txz * txz + tyz * tyz))) };
    }
    default:
      return { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0, vm: 0 };
  }
}

/**
 * 局部主轴坐标变换：q' = Rᵀ·S·R·q（S = diag(1/α, 1, 1)，v1 = |σ| 最大主方向）。
 * 返回 [q'x, q'y, q'z]；preset none 时恒等。
 */
export function transformByStress(cfg: StressConfig, mx: number, my: number, mz: number): [number, number, number] {
  if (cfg.preset === 'none' || cfg.anisotropy === 1) return [mx, my, mz];
  const s = stressAt(cfg, mx / Math.PI, my / Math.PI, mz / Math.PI);
  const { values, vectors } = eigenSym3(s.xx, s.xy, s.xz, s.yy, s.yz, s.zz);
  // |σ| 最大的主方向（拉伸/压缩主迹线）
  let iMax = 0;
  if (Math.abs(values[1]) > Math.abs(values[iMax])) iMax = 1;
  if (Math.abs(values[2]) > Math.abs(values[iMax])) iMax = 2;
  const v1 = vectors[iMax];
  // q 在主轴系下的分量
  const u1 = v1[0] * mx + v1[1] * my + v1[2] * mz;
  // 正交基补全（任选与 v1 最不平行的坐标轴做 Gram-Schmidt）
  const ref = Math.abs(v1[0]) < 0.7 ? [1, 0, 0] : [0, 1, 0];
  let w0: [number, number, number] = [ref[0] - (ref[0] * v1[0] + ref[1] * v1[1] + ref[2] * v1[2]) * v1[0],
    ref[1] - (ref[0] * v1[0] + ref[1] * v1[1] + ref[2] * v1[2]) * v1[1],
    ref[2] - (ref[0] * v1[0] + ref[1] * v1[1] + ref[2] * v1[2]) * v1[2]];
  const wn = Math.hypot(w0[0], w0[1], w0[2]) || 1;
  w0 = [w0[0] / wn, w0[1] / wn, w0[2] / wn];
  const u2 = w0[0] * mx + w0[1] * my + w0[2] * mz;
  const v2: [number, number, number] = [v1[1] * w0[2] - v1[2] * w0[1], v1[2] * w0[0] - v1[0] * w0[2], v1[0] * w0[1] - v1[1] * w0[0]];
  const u3 = v2[0] * mx + v2[1] * my + v2[2] * mz;
  // 主方向压缩采样频率 ⇒ 晶胞沿 v1 伸长 α
  return [u1 / cfg.anisotropy, u2, u3];
}

/**
 * 壳模式孔隙板宽度自适应因子：1 − β·vm（下限 0.1）。
 * 【语义定案】shell 的 tEff 是「孔隙板宽度」（solid ⟺ |dv| > t/2）——
 * 高应力侧收窄孔隙板 ⇒ 固相壁致密化（相对密度与 vm 正相关，Wolff 定律）。
 * 首版 1 + β·vm 方向反了（高应力区孔隙更大），由 hierarchical_audit E 段
 * 单调性断言红测抓获。
 */
export function stressThicknessScale(cfg: StressConfig, px: number, py: number, pz: number): number {
  if (cfg.preset === 'none' || cfg.strength <= 0) return 1;
  return Math.max(0.1, 1 - cfg.strength * stressAt(cfg, px, py, pz).vm);
}

/** UI/导出共用的预设标签 */
export const STRESS_PRESET_LABELS: Record<StressPreset, string> = {
  none: '无（各向同性）',
  bending: '三点弯曲梁',
  cantilever: '悬臂梁',
  torsion: '扭转',
};
