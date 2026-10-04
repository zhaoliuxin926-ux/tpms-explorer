/**
 * strut-octet.ts —— Octet（FCC）桁架杆网络周期 SDF 场（2026-10-04 第二十八批）
 *
 * 与 BCC（弯曲主导，E∝ρ²~ρ³）对照的拉伸主导构型（Deshpande-Fleck octet truss，
 * E∝ρ）——两类桁架并列给出 strut 侧的力学谱。节点：cell 角顶点 8 + 面心 6；
 * 杆：角↔相邻面心（每角 3 条 → 24/共享=12 杆/cell）+ 面心↔面心（面内对角，
 * 12 条/共享=6 杆/cell）——完整 octet 拓扑。与 strut-bcc 同款：负=固相、
 * k=3 固定周期、邻域局部化、胶囊端球水密；TpmsFunction 签名兼容。
 */
import type { TpmsFunction, Weights } from './tpms-functions';
import { segDist } from './strut-bcc';

export const strutOctet: TpmsFunction = (mx: number, my: number, mz: number, w?: Weights) => {
  const r = (w && w[0] > 0 ? w[0] : 0.08);
  const cell = 2; // mx 域单位 cell——cell 数自动=外部 k（与 strut-bcc 同款坐标域修正）
  const ci = Math.floor((mx + 1) / cell), cj = Math.floor((my + 1) / cell), cl = Math.floor((mz + 1) / cell);
  let d = 1e9;
  // 面心偏移（6 面：(½,½,0)(½,0,½)(0,½,½) 各正负）
  const FC: ReadonlyArray<readonly [number, number, number]> = [
    [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
  ];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dl = -1; dl <= 1; dl++) {
        const i = ci + di, j = cj + dj, l = cl + dl;
        // 该 cell 的 8 角
        const corners: number[][] = [];
        for (let vi = 0; vi < 2; vi++) for (let vj = 0; vj < 2; vj++) for (let vl = 0; vl < 2; vl++) {
          corners.push([(i + vi) * cell - 1, (j + vj) * cell - 1, (l + vl) * cell - 1]);
        }
        // 该 cell 的 6 面心（3 轴向各 2：本面 + 后面/侧面归属由 (1-fc) 偏移去重）
        const faces: number[][] = [];
        for (const [fx, fy, fz] of FC) {
          faces.push([(i + fx) * cell - 1, (j + fy) * cell - 1, (l + fz) * cell - 1]);
          faces.push([(i + 1 - fx) * cell - 1, (j + 1 - fy) * cell - 1, (l + 1 - fz) * cell - 1]);
        }
        // 角↔面心：相邻判定（面心在某轴上位于角所在半格）
        for (const c of corners) {
          for (const f of faces) {
            const near = (Math.abs(f[0] - c[0]) <= 0.501 * cell && Math.abs(f[1] - c[1]) <= 0.501 * cell && Math.abs(f[2] - c[2]) <= 0.501 * cell)
              && (Math.abs(f[0] - c[0]) + Math.abs(f[1] - c[1]) + Math.abs(f[2] - c[2]) < 0.75 * cell + 1e-9);
            if (near) d = Math.min(d, segDist(mx, my, mz, c[0], c[1], c[2], f[0], f[1], f[2]));
          }
        }
        // 面心↔面心（同轴向成对面，如 (½,½,0) 与同 z 的 4 个面心在 xy 面内）：
        // 仅连同一 cell 内不同轴向的面心对（距离 = cell/√2）
        for (let a = 0; a < faces.length; a++) {
          for (let b = a + 1; b < faces.length; b++) {
            const dx = faces[a][0] - faces[b][0], dy = faces[a][1] - faces[b][1], dz = faces[a][2] - faces[b][2];
            const dist2 = dx * dx + dy * dy + dz * dz;
            if (Math.abs(dist2 - 0.5 * cell * cell) < 1e-9) {
              d = Math.min(d, segDist(mx, my, mz, faces[a][0], faces[a][1], faces[a][2], faces[b][0], faces[b][1], faces[b][2]));
            }
          }
        }
      }
    }
  }
  return d - r;
};
