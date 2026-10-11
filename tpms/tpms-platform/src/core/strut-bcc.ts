/**
 * strut-bcc.ts —— BCC 桁架杆网络的周期 SDF 场（2026-10-04 第二十七批；2026-10-11 G1 尺度契约修正）
 *
 * 业界双模式标配（nTop/Lattice Generator Pro：TPMS+strut）的 strut 侧首族。
 * 实现路线：杆=线段 SDF（胶囊），BCC=立方 cell 顶点↔体心连杆（8 杆/cell），
 * 作为周期标量场塞进 TpmsType 体系——负=固相（杆内）与全平台 v<iso 语义兼容，
 * iso 二分=扫有效杆半径，求解器/重建/导出/NL 零改动自动支持。
 *
 * 【G1 尺度契约（2026-10-11 定案）】surface-nets 度规域 mx∈[−πk,πk]（half=π，非早期
 * 误读的 [−k,k]）——cell 取一个 TPMS 周期 2π：域内恰 k 个 cell、边界与 cell 齐平、
 * 晶格常数=经典族周期=cellSize/k mm（跨出口一致）。旧口径 cell=2 的 cell 数=πk
 * （无理倍）→边界截断+周期性破坏+跨出口尺度错位，已废。
 * 杆半径：w[0]=半胞分数（r=w[0]·π），默认 0.25=1/8 胞宽细长比（k 无关）。
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

export const strutBCC: TpmsFunction = (mx: number, my: number, mz: number, w?: Weights) => {
  const cell = 2 * Math.PI; // 一晶胞 = 一 TPMS 周期（域 [−πk,πk] 内恰 k 个 cell）
  const r = (w && w[0] > 0 ? w[0] : 0.25) * cell / 2; // 杆半径 = w[0]·半胞（默认 1/8 胞宽）
  const ci = Math.floor(mx / cell), cj = Math.floor(my / cell), cl = Math.floor(mz / cell);
  let d = 1e9;
  // AABB 剪枝：本 cell 的杆全落在其闭合 AABB 内（角→体心），邻 cell 仅当 AABB 距离
  // 可能改进当前 d 时才遍历（对杆集合与场值零影响——R96 试样从不可用变分钟级）
  const rodDistOfCell = (i: number, j: number, l: number) => {
    const cx = (i + 0.5) * cell, cy = (j + 0.5) * cell, cz = (l + 0.5) * cell;
    let dm = 1e9;
    for (let vi = 0; vi < 2; vi++) {
      for (let vj = 0; vj < 2; vj++) {
        for (let vl = 0; vl < 2; vl++) {
          dm = Math.min(dm, segDist(mx, my, mz, (i + vi) * cell, (j + vj) * cell, (l + vl) * cell, cx, cy, cz));
        }
      }
    }
    return dm;
  };
  d = rodDistOfCell(ci, cj, cl);
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
