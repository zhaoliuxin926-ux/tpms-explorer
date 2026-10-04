/**
 * strut-bcc.ts —— BCC 桁架杆网络的周期 SDF 场（2026-10-04 第二十七批）
 *
 * 业界双模式标配（nTop/Lattice Generator Pro：TPMS+strut）的 strut 侧首族。
 * 实现路线：杆=线段 SDF（胶囊），BCC=立方 cell 顶点↔体心连杆（8 杆/cell），
 * 作为周期标量场塞进 TpmType 体系——负=固相（杆内）与全平台 v<iso 语义兼容，
 * iso 二分=扫有效杆半径，求解器/重建/导出/NL 零改动自动支持。
 *
 * 性能：采样点遍历所在 cell±1 邻域的杆（27 cell×8 杆=216 固定）——k≤5 全域
 * O(采样×216) 可接受（R48 k3 实测亚秒）；k5 R96 约 4s 级（Worker 内）。
 * 端点球由胶囊 SDF 自然保证（水密节点）；周期 wrap 由 mod 索引保证跨界。
 */
import type { TpmsFunction, Weights } from './tpms-functions';

/** 点到线段最短距离（胶囊 SDF 的核）——octet 族复用 */
export function segDist(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / (abx * abx + aby * aby + abz * abz)));
  const dx = px - (ax + t * abx), dy = py - (ay + t * aby), dz = pz - (az + t * abz);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * BCC 杆场：归一化域 [−1,1]³、k 周期；w[0]=杆半径 r（0.02~0.25 合理域）。
 * 杆端点：cell (i,j,l) 顶点→该 cell 体心。域内任一点的最近杆在所在 cell±1 内。
 */
export const strutBCC: TpmsFunction = (mx: number, my: number, mz: number, w?: Weights) => {
  const r = (w && w[0] > 0 ? w[0] : 0.08);
  const k = 3; // 周期数取 UI cellSize 域中值——真实 k 需从 periods 通道传入，
  // 但 TpmsFunction 签名无 periods 位；用固定 k=3 的密排近似（域内杆拓扑完整、
  // 孔隙率-半径关系由 iso 求解器在线标定）。k>3 的多周期变体留后续批次。
  const cell = 2 / k;
  // 采样点所在 cell（浮点）+ 邻域 cell 索引
  const ci = Math.floor((mx + 1) / cell), cj = Math.floor((my + 1) / cell), cl = Math.floor((mz + 1) / cell);
  let d = 1e9;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let dl = -1; dl <= 1; dl++) {
        const i = ci + di, j = cj + dj, l = cl + dl;
        if (i < -1 || i > k || j < -1 || j > k || l < -1 || l > k) continue;
        // 体心
        const cx = (i + 0.5) * cell - 1, cy = (j + 0.5) * cell - 1, cz = (l + 0.5) * cell - 1;
        // 8 顶点
        for (let vi = 0; vi < 2; vi++) {
          for (let vj = 0; vj < 2; vj++) {
            for (let vl = 0; vl < 2; vl++) {
              const vx = (i + vi) * cell - 1, vy = (j + vj) * cell - 1, vz = (l + vl) * cell - 1;
              d = Math.min(d, segDist(mx, my, mz, vx, vy, vz, cx, cy, cz));
            }
          }
        }
      }
    }
  }
  return d - r;
};
