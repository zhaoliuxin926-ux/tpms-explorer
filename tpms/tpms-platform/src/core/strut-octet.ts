/**
 * strut-octet.ts —— Octet（FCC）桁架杆网络周期 SDF 场（2026-10-04 第二十八批；
 * 2026-10-11 G1 尺度契约 + G2 拓扑修正）
 *
 * 与 BCC（弯曲主导，E∝ρ²~ρ³）对照的拉伸主导构型（Deshpande-Fleck octet truss，
 * E∝ρ）——两类桁架并列给出 strut 侧的力学谱。节点：cell 角顶点 8 + 面心 6；
 * 杆（FCC 最近邻键，24 杆/cell）：角↔面心（每角 12 邻接面心，12 杆/cell）+
 * 面心↔面心（面内对角，12 条/共享=12 杆/cell）——完整 octet 拓扑。
 *
 * 【G2（2026-10-11）】旧版角↔面心邻接附带了错误的 Manhattan 条件（真邻接
 * 恰为 1·cell 而阈值写 0.75·cell）→角杆全部漏发、角节点悬浮（被 schwarz
 * 提取场掩盖不可见，G3 修复后暴露）。正确判定=逐轴 |Δ|≤½cell+eps（面心
 * 恰一轴同坐标、两轴差 ½cell，单条件即精确选出 12 个真邻接）。
 *
 * 【G1 尺度契约】同 strut-bcc：cell=2π（一 TPMS 周期，k 个/cell 域）、
 * 杆半径 r=w[0]·π（半胞分数，默认 0.25=1/8 胞宽）。
 * 与 strut-bcc 同款：负=固相、邻域局部化、胶囊端球水密；TpmsFunction 签名兼容。
 */
import type { TpmsFunction, Weights } from './tpms-functions';
import { segDist } from './strut-bcc';

export const strutOctet: TpmsFunction = (mx: number, my: number, mz: number, w?: Weights) => {
  const cell = 2 * Math.PI; // 一晶胞 = 一 TPMS 周期（域 [−πk,πk] 内恰 k 个 cell）
  const r = (w && w[0] > 0 ? w[0] : 0.25) * cell / 2; // 杆半径 = w[0]·半胞（默认 1/8 胞宽）
  const ci = Math.floor(mx / cell), cj = Math.floor(my / cell), cl = Math.floor(mz / cell);
  // 面心偏移（6 面：(½,½,0)(½,0,½)(0,½,½) 各正负）
  const FC: ReadonlyArray<readonly [number, number, number]> = [
    [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
  ];
  const rodDistOfCell = (i: number, j: number, l: number) => {
    // 该 cell 的 8 角
    const corners: number[][] = [];
    for (let vi = 0; vi < 2; vi++) for (let vj = 0; vj < 2; vj++) for (let vl = 0; vl < 2; vl++) {
      corners.push([(i + vi) * cell, (j + vj) * cell, (l + vl) * cell]);
    }
    // 该 cell 的 6 面心（3 轴向各 2：正负侧由 (1-fc) 偏移覆盖）
    const faces: number[][] = [];
    for (const [fx, fy, fz] of FC) {
      faces.push([(i + fx) * cell, (j + fy) * cell, (l + fz) * cell]);
      faces.push([(i + 1 - fx) * cell, (j + 1 - fy) * cell, (l + 1 - fz) * cell]);
    }
    let dm = 1e9;
    // 角↔面心：FCC 最近邻判定=逐轴 |Δ| ≤ ½cell+eps（面心恰一轴与角同坐标、
    // 两轴差 ½cell → 每角 12 个真邻接；多余的 Manhattan 条件曾全灭角杆，G2）
    for (const c of corners) {
      for (const f of faces) {
        if (Math.abs(f[0] - c[0]) <= 0.501 * cell && Math.abs(f[1] - c[1]) <= 0.501 * cell && Math.abs(f[2] - c[2]) <= 0.501 * cell) {
          dm = Math.min(dm, segDist(mx, my, mz, c[0], c[1], c[2], f[0], f[1], f[2]));
        }
      }
    }
    // 面心↔面心（不同轴向面心对，距离 = cell/√2）
    for (let a = 0; a < faces.length; a++) {
      for (let b = a + 1; b < faces.length; b++) {
        const dx = faces[a][0] - faces[b][0], dy = faces[a][1] - faces[b][1], dz = faces[a][2] - faces[b][2];
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (Math.abs(dist2 - 0.5 * cell * cell) < 1e-6) {
          dm = Math.min(dm, segDist(mx, my, mz, faces[a][0], faces[a][1], faces[a][2], faces[b][0], faces[b][1], faces[b][2]));
        }
      }
    }
    return dm;
  };
  // AABB 剪枝：本 cell 的杆全落在其闭合 AABB 内（角↔面心/面心对均不越界），邻 cell
  // 仅当 AABB 距离可能改进当前 d 时才遍历（octet 每查询 27×63 杆对 → 剪枝后均值级）
  let d = rodDistOfCell(ci, cj, cl);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dl = -1; dl <= 1; dl++) {
        if (!di && !dj && !dl) continue;
        const i = ci + di, j = cj + dj, l = cl + dl;
        const bx = Math.max(i * cell - mx, 0, mx - (i + 1) * cell);
        const by = Math.max(j * cell - my, 0, my - (j + 1) * cell);
        const bz = Math.max(l * cell - mz, 0, mz - (l + 1) * cell);
        if (bx * bx + by * by + bz * bz >= d * d) continue; // 杆 ⊆ AABB：不可能改进 d
        d = Math.min(d, rodDistOfCell(i, j, l));
      }
    }
  }
  return d - r;
};
