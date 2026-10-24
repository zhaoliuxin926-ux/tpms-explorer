/**
 * mesh-audit.ts —— 网格索引空间水密审计（单一真源，2026-10-24 实用性审查 #7 提炼）
 *
 * 三硬指标：开放边 / 非流形边 / 退化面，任一非零即判网格表示不可靠——不交付。
 * 消费方：agent CLI（tpms.mjs 经 core-loader 桥，solve/mesh/verify/scenario 水密门）
 * 与 UI 导出门（main.ts handleExport——网页与 CLI 同一口径拒产，不再只查结果非空）。
 * 与 .verify/mesh_audit.mjs 审计同源；从 agent/tpms.mjs 原位提炼，算法逐行保真。
 */

export interface MeshAuditOptions {
  /** 退化判据模式（radial-grad MT 管线解锁，2026-09-15）：'absolute'（默认，|cross|²≤1e-18，
   * surface-nets 管线历史契约）| 'shape'（尺度无关 area/max_edge²<1e-12——manifold_audit
   * 2026-09-11 先例判据：等边微楔片是相切带的真实离散几何计为合法，针形仍拦） */
  degenMode?: 'absolute' | 'shape';
}

export interface MeshAuditResult {
  triCount: number;
  degenTris: number;
  openEdges: number;
  nonManifoldEdges: number;
  misorientedEdges: number;
}

export function auditMeshIndices(
  positions: Float32Array | Float64Array | number[],
  indices: Uint32Array | Uint16Array | number[],
  opts?: MeshAuditOptions,
): MeshAuditResult {
  const triCount = indices.length / 3;
  const vertCount = positions.length / 3;
  const KM = vertCount + 1;
  const shapeMode = opts?.degenMode === 'shape';
  const edgeKeys = new Float64Array(triCount * 3);
  let n = 0, degenTris = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i0 === i2) { degenTris++; continue; }
    edgeKeys[n++] = (i0 < i1 ? i0 * KM + i1 : i1 * KM + i0) * 2 + (i0 < i1 ? 0 : 1);
    edgeKeys[n++] = (i1 < i2 ? i1 * KM + i2 : i2 * KM + i1) * 2 + (i1 < i2 ? 0 : 1);
    edgeKeys[n++] = (i2 < i0 ? i2 * KM + i0 : i0 * KM + i2) * 2 + (i2 < i0 ? 0 : 1);
    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p1] - positions[p0], ay = positions[p1 + 1] - positions[p0 + 1], az = positions[p1 + 2] - positions[p0 + 2];
    const bx = positions[p2] - positions[p0], by = positions[p2 + 1] - positions[p0 + 1], bz = positions[p2 + 2] - positions[p0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (shapeMode) {
      const maxE2 = Math.max(ax * ax + ay * ay + az * az, bx * bx + by * by + bz * bz,
        (positions[p1] - positions[p2]) ** 2 + (positions[p1 + 1] - positions[p2 + 1]) ** 2 + (positions[p1 + 2] - positions[p2 + 2]) ** 2);
      if (maxE2 > 0 && (cx * cx + cy * cy + cz * cz) / (4 * maxE2) < 1e-24) degenTris++;
    } else if (cx * cx + cy * cy + cz * cz <= 1e-18) degenTris++;
  }
  const edges = edgeKeys.subarray(0, n);
  edges.sort(); // TypedArray 数值排序
  let openEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0;
  for (let i = 0; i < n; ) {
    const undKey = Math.floor(edges[i] / 2);
    let ab = 0, ba = 0; // ab = min→max 计数，ba = max→min 计数
    while (i < n && Math.floor(edges[i] / 2) === undKey) {
      if (edges[i] % 2 === 0) ab++; else ba++;
      i++;
    }
    const total = ab + ba;
    if (total === 1) openEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (ab === 0 || ba === 0) misorientedEdges++; // total==2 但两三角同向
  }
  return { triCount, degenTris, openEdges, nonManifoldEdges, misorientedEdges };
}
