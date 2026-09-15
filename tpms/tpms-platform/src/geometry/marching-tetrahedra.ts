/**
 * marching-tetrahedra.ts —— Marching Tetrahedra 等值面提取器（radial-grad STL 解锁战役，2026-09-15）
 *
 * 定位：radial-grad M(r) 构型的专用 STL 提取路径（论文 export_stl.py 用 Marching Cubes 的
 * 自研等价物——MT 零外部查表依赖、16 case 几何可枚举验证）。背景：surface-nets 顶点插值
 * 对场不光滑点（|P| 折痕 / max 尖点）结构性非流形（K=1 均 nm=992/152、max 裁剪 nm=1200
 * 三轮实测），MC/MT 的 cell 内 corner 二值化 + 查表式连接对不光滑场免疫（论文 62GB 工程
 * 同款场跑 MC watertight 的机理）。
 *
 * 算法：
 *   - 节点网格 (R+1)³，phys 域 [−1,1]；
 *   - 每 cell 按主对角 (0,7) 一致分解为 6 四面体（全网格同一切分 ⇒ 相邻 cell 共享面上
 *     三角剖分一致，无裂纹）；
 *   - 每 tet：4 corner 值 v<iso 为 inside（严格不等式——恰等值 corner 归 outside，
 *     线性场边界插值仍精确落位，论文半格方案的等价机理）；16 case 枚举：
 *     0/4 穿越无面；1/3 穿越单三角；2/2 穿越四边形（固定对角剖分保确定性）；
 *   - 边穿越点线性插值，全局边（节点对 minmax key）顶点缓存去重 ⇒ 水密；
 *   - 面取向：法向指离 inside（v<iso 固相内侧 → 外向空气侧），由穿越边序推导；
 *     下游 orientConsistently（发散体积符号）兜底全局一致。
 */

export interface MtResult {
  positions: Float32Array;
  indices: Uint32Array;
  triCount: number;
  /** 面积加权累积顶点法线（取向已由定向规则统一——法线朝场增大侧=空气侧） */
  normals: Float32Array;
}

/** 一致 6-tet 分解（corner 位序：bit0=x+、bit1=y+、bit2=z+；主对角 0-7） */
const TETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 7, 1, 3],
  [0, 7, 3, 2],
  [0, 7, 2, 6],
  [0, 7, 6, 4],
  [0, 7, 4, 5],
  [0, 7, 5, 1],
];
/** tet 内 6 条边（局部 corner 对） */
const TET_EDGES: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

/**
 * Marching Tetrahedra 提取。
 * @param field 标量场（phys 域 [−1,1]；v < iso 为固相内侧）
 * @param R     每轴 cell 数（节点网格 (R+1)³）
 * @param iso   等值（默认 0）
 */
export function marchingTetrahedra(
  field: (x: number, y: number, z: number) => number,
  R: number,
  iso = 0,
): MtResult {
  if (!Number.isInteger(R) || R < 2 || R > 256) throw new Error(`MT 分辨率须 2~256 整数（收到 ${R}）`);
  const N = R + 1;
  // 节点场缓存（tet 遍历内每节点最多被 8 cell × 6 tet 复用，预计算 (R+1)³ 一次）
  const vals = new Float64Array(N * N * N);
  const nodeCoord = (i: number) => (i / R) * 2 - 1;
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        vals[(k * N + j) * N + i] = field(nodeCoord(i), nodeCoord(j), nodeCoord(k));
      }
    }
  }
  // corner 值 iso 正则化（η=3e-3）：贴角 tet（corner 值极近 iso）是微针三角的根源——
  // t 钳制是"退化配置上硬拽"（贴角扇伴生针三角）；正则化让配置本身不退化。量级链条
  //（2026-09-15 定案）：η=3e-3 ⟹ t≥η/Δv≥1e-3（Δv≲3）⟹ 针高≥1e-3·格 ⟹ 面积≥~1e-7
  // > auditMeshIndices 阈值 5e-10；等值面位移 η/|∇v|≈24nm 物理量级，几何无损
  {
    const ETA = 3e-3;
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      vals[i] = v < iso ? Math.min(v, iso - ETA) : Math.max(v, iso + ETA);
    }
  }
  const val = (ci: number, cj: number, ck: number, c: number) => {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    return vals[((ck + dz) * N + (cj + dy)) * N + (ci + dx)];
  };
  const posArr: number[] = [];
  const idxArr: number[] = [];
  const vcache = new Map<number, number>();
  // 节点 idx max = N³ ≤ 257³ ≈ 1.7e7 < 2²⁵ ⇒ key = lo·2²⁵ + hi 始终 < 2⁵⁰（float64 精确）
  const KEY_MUL = 33554432;
  /** 全局节点边 → 共享顶点 id（线性插值穿越点） */
  const vertOnEdge = (ga: number, gb: number, va: number, vb: number): number => {
    const key = ga < gb ? ga * KEY_MUL + gb : gb * KEY_MUL + ga;
    let id = vcache.get(key);
    if (id === undefined) {
      const t = (iso - va) / (vb - va);
      const xa = ga % N, xb = gb % N;
      const ya = Math.floor(ga / N) % N, yb = Math.floor(gb / N) % N;
      const za = Math.floor(ga / (N * N)), zb = Math.floor(gb / (N * N));
      posArr.push(
        nodeCoord(xa) + t * (nodeCoord(xb) - nodeCoord(xa)),
        nodeCoord(ya) + t * (nodeCoord(yb) - nodeCoord(ya)),
        nodeCoord(za) + t * (nodeCoord(zb) - nodeCoord(za)),
      );
      id = posArr.length / 3 - 1;
      vcache.set(key, id);
    }
    return id;
  };

  for (let ck = 0; ck < R; ck++) {
    for (let cj = 0; cj < R; cj++) {
      for (let ci = 0; ci < R; ci++) {
        const cellNode = (c: number) => {
          const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
          return ((ck + dz) * N + (cj + dy)) * N + (ci + dx);
        };
        for (const tet of TETS) {
          const g = tet.map(cellNode);
          const v = tet.map((c) => val(ci, cj, ck, c));
          const inside = v.map((x) => x < iso);
          const nIn = inside.filter(Boolean).length;
          if (nIn === 0 || nIn === 4) continue;
          // 收集 6 边中的穿越边（一端 inside 一端 outside），端点 (gi, vi)
          const cut: Array<[number, number]> = [];
          for (const [a, b] of TET_EDGES) {
            if (inside[a] !== inside[b]) cut.push(inside[a] ? [a, b] : [b, a]); // [inside 端, outside 端]
          }
          const e = (tetCornerLocal: number) => g[tetCornerLocal];
          const vids = cut.map(([a, b]) => vertOnEdge(e(a), e(b), v[a], v[b]));
          // 定向参考向量：首条穿越边 in→out 的 corner 坐标差（与场梯度同侧——v 由 <iso 增至 >iso）
          const c0 = cut[0][0], c1 = cut[0][1];
          const dx = nodeCoord((g[c1] % N)) - nodeCoord((g[c0] % N));
          const dy = nodeCoord(Math.floor(g[c1] / N) % N) - nodeCoord(Math.floor(g[c0] / N) % N);
          const dz = nodeCoord(Math.floor(g[c1] / (N * N))) - nodeCoord(Math.floor(g[c0] / (N * N)));
          const orient = (a: number, b: number, c: number): [number, number, number] => {
            const ux = posArr[b * 3] - posArr[a * 3], uy = posArr[b * 3 + 1] - posArr[a * 3 + 1], uz = posArr[b * 3 + 2] - posArr[a * 3 + 2];
            const wx = posArr[c * 3] - posArr[a * 3], wy = posArr[c * 3 + 1] - posArr[a * 3 + 1], wz = posArr[c * 3 + 2] - posArr[a * 3 + 2];
            const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
            return nx * dx + ny * dy + nz * dz >= 0 ? [a, b, c] : [a, c, b];
          };
          if (cut.length === 3) {
            const tri = orient(vids[0], vids[1], vids[2]);
            idxArr.push(tri[0], tri[1], tri[2]);
          } else if (cut.length === 4) {
            // 四边形绕圈序：穿越边按共享 corner 链接成 4-环——TET_EDGES 固定枚举序在部分
            // in/out 分布下是蝴蝶序（自交三角化 → 边错配 open 爆炸，球锚实测 open=19992）
            const ring = [0];
            const used = new Set([0]);
            while (ring.length < 4) {
              const last = cut[ring[ring.length - 1]];
              const nxt = cut.findIndex((c2, i) => !used.has(i)
                && (c2[0] === last[0] || c2[1] === last[0] || c2[0] === last[1] || c2[1] === last[1]));
              ring.push(nxt);
              used.add(nxt);
            }
            const q = ring.map((i) => vids[i]);
            const t1 = orient(q[0], q[1], q[2]);
            const t2 = orient(q[0], q[2], q[3]);
            idxArr.push(t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]);
          }
          // cut 长度只能是 3 或 4（nIn∈1..3 的四面体拓扑事实）
          else throw new Error(`MT 内部错误：穿越边数 ${cut.length}（拓扑不可能）`);
        }
      }
    }
  }
  const positions = Float32Array.from(posArr);
  const indices = Uint32Array.from(idxArr);
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ux = positions[i1] - positions[i0], uy = positions[i1 + 1] - positions[i0 + 1], uz = positions[i1 + 2] - positions[i0 + 2];
    const wx = positions[i2] - positions[i0], wy = positions[i2 + 1] - positions[i0 + 1], wz = positions[i2 + 2] - positions[i0 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    for (const i3 of [i0, i1, i2]) { normals[i3] += nx; normals[i3 + 1] += ny; normals[i3 + 2] += nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return { positions, indices, triCount: indices.length / 3, normals };
}
