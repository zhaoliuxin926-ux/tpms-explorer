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

const TWO_PI = 2 * Math.PI;
// 面心偏移（6 面：(½,½,0)(½,0,½)(0,½,½) 各正负）
const FC: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5],
];

/**
 * 预计算单位晶胞 [0,1]³ 内完整 FCC Octet 拓扑 36 条无分配边表：
 * 每条边 7 元组 [ax, ay, az, abx, aby, abz, invLenSq]，消除 2M 次 MC/体素查询时的堆分配与嵌套循环。
 */
const OCTET_UNIT_EDGES: Float64Array = (() => {
  const corners: Array<[number, number, number]> = [];
  for (let vi = 0; vi < 2; vi++) {
    for (let vj = 0; vj < 2; vj++) {
      for (let vl = 0; vl < 2; vl++) corners.push([vi, vj, vl]);
    }
  }
  const faces: Array<[number, number, number]> = [];
  for (const [fx, fy, fz] of FC) {
    faces.push([fx, fy, fz]);
    faces.push([1 - fx, 1 - fy, 1 - fz]);
  }
  const list: number[] = [];
  const pushEdge = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const lenSq = abx * abx + aby * aby + abz * abz;
    list.push(a[0], a[1], a[2], abx, aby, abz, 1 / lenSq);
  };
  for (const c of corners) {
    for (const f of faces) {
      if (Math.abs(f[0] - c[0]) <= 0.501 && Math.abs(f[1] - c[1]) <= 0.501 && Math.abs(f[2] - c[2]) <= 0.501) {
        pushEdge(c, f);
      }
    }
  }
  for (let a = 0; a < faces.length; a++) {
    for (let b = a + 1; b < faces.length; b++) {
      const dx = faces[a][0] - faces[b][0], dy = faces[a][1] - faces[b][1], dz = faces[a][2] - faces[b][2];
      if (Math.abs(dx * dx + dy * dy + dz * dz - 0.5) < 1e-6) {
        pushEdge(faces[a], faces[b]);
      }
    }
  }
  return Float64Array.from(list);
})();

const OCTET_EDGE_LEN = OCTET_UNIT_EDGES.length;

function rodDistSqInCell(ux: number, uy: number, uz: number, bestD2: number): number {
  let d2 = bestD2;
  for (let k = 0; k < OCTET_EDGE_LEN; k += 7) {
    const ax = OCTET_UNIT_EDGES[k], ay = OCTET_UNIT_EDGES[k + 1], az = OCTET_UNIT_EDGES[k + 2];
    const abx = OCTET_UNIT_EDGES[k + 3], aby = OCTET_UNIT_EDGES[k + 4], abz = OCTET_UNIT_EDGES[k + 5];
    const inv = OCTET_UNIT_EDGES[k + 6];
    const rawT = ((ux - ax) * abx + (uy - ay) * aby + (uz - az) * abz) * inv;
    const t = rawT <= 0 ? 0 : rawT >= 1 ? 1 : rawT;
    const dx = ux - (ax + t * abx);
    const dy = uy - (ay + t * aby);
    const dz = uz - (az + t * abz);
    const cur = dx * dx + dy * dy + dz * dz;
    if (cur < d2) d2 = cur;
  }
  return d2;
}

export const strutOctet: TpmsFunction = (mx: number, my: number, mz: number, w?: Weights) => {
  const r = (w && w[0] > 0 ? w[0] : 0.25) * Math.PI; // 杆半径 = w[0]·半胞（默认 1/8 胞宽）
  const qx = mx / TWO_PI, qy = my / TWO_PI, qz = mz / TWO_PI;
  const ci = Math.floor(qx), cj = Math.floor(qy), cl = Math.floor(qz);
  // AABB 剪枝（在归一化 [0,1] 晶胞空间计算 d²，末尾单次 sqrt 缩放，数学等价且零堆分配）
  let minD2 = rodDistSqInCell(qx - ci, qy - cj, qz - cl, 1e18);
  for (let di = -1; di <= 1; di++) {
    const i = ci + di;
    const bx = qx < i ? i - qx : qx > i + 1 ? qx - (i + 1) : 0;
    const bx2 = bx * bx;
    if (bx2 >= minD2) continue;
    for (let dj = -1; dj <= 1; dj++) {
      const j = cj + dj;
      const by = qy < j ? j - qy : qy > j + 1 ? qy - (j + 1) : 0;
      const bxy2 = bx2 + by * by;
      if (bxy2 >= minD2) continue;
      for (let dl = -1; dl <= 1; dl++) {
        if (!di && !dj && !dl) continue;
        const l = cl + dl;
        const bz = qz < l ? l - qz : qz > l + 1 ? qz - (l + 1) : 0;
        if (bxy2 + bz * bz >= minD2) continue;
        minD2 = rodDistSqInCell(qx - i, qy - j, qz - l, minD2);
      }
    }
  }
  return Math.sqrt(minD2) * TWO_PI - r;
};
