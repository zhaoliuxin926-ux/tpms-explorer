/**
 * 二进制 STL 导出器
 * 同网格下体积仅为 ASCII 的约 1/5–1/10，切片软件加载更快。
 */
import { downloadBlob } from './download';

/**
 * 生成二进制 STL 字节流（与下载解耦，供 .verify/parity_math.mjs 直接断言）。
 *
 * 缠绕定向（2026-09-05 根治）：全局定向传播——共享边相邻三角绕向必然相反，
 * 发散体积符号统一外向，封闭流形上 misoriented 由构造归零。此前逐三角按
 * 顶点法线独立判向会把局部一致的缠绕打碎（实测恶化 ~5×），已废弃。
 * 法线行始终写归一化几何法线（与缠绕严格自洽，Abaqus/COMSOL 重建实体依赖此约定）。
 *
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              使导出模型总宽 = cellSize mm（1 period = 1 mm）。默认 1 保持旧行为。
 * @param normals 已废弃（保留签名兼容）：定向改由 orientConsistently 全局传播保证
 */
export function buildBinarySTL(
  positions: Float32Array,
  indices: Uint32Array,
  scale = 1,
  normals?: Float32Array
): ArrayBuffer {
  void normals;
  const triCount = indices.length / 3;
  const headerSize = 80;
  const triSize = 50; // 12(float3 normal) + 12(float3 v0) + 12(float3 v1) + 12(float3 v2) + 2(uint16 attr)
  const buf = new ArrayBuffer(headerSize + 4 + triCount * triSize);
  const dv = new DataView(buf);

  // header：写入单位与参数提示（C 样式截断到 80 字节）
  const header = 'TPMS Explorer binary STL; units=mm; 1 period = 1 mm';
  for (let i = 0; i < header.length && i < headerSize; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(headerSize, triCount, true);

  const oriented = orientConsistently(positions, indices);

  let offset = headerSize + 4;
  for (let t = 0; t < triCount; t++) {
    let i0 = oriented[t * 3] * 3;
    let i1 = oriented[t * 3 + 1] * 3;
    let i2 = oriented[t * 3 + 2] * 3;

    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    let cx = ay * bz - az * by;
    let cy = az * bx - ax * bz;
    let cz = ax * by - ay * bx;

    const clen = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
    dv.setFloat32(offset, cx / clen, true); offset += 4;
    dv.setFloat32(offset, cy / clen, true); offset += 4;
    dv.setFloat32(offset, cz / clen, true); offset += 4;

    // v0
    dv.setFloat32(offset, positions[i0] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i0 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i0 + 2] * scale, true); offset += 4;
    // v1
    dv.setFloat32(offset, positions[i1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i1 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i1 + 2] * scale, true); offset += 4;
    // v2
    dv.setFloat32(offset, positions[i2] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i2 + 1] * scale, true); offset += 4;
    dv.setFloat32(offset, positions[i2 + 2] * scale, true); offset += 4;
    // attribute byte count
    dv.setUint16(offset, 0, true); offset += 2;
  }
  return buf;
}

/**
 * @param scale wc → mm 缩放因子（core/units 的 wcToMmFactor），
 *              使导出模型总宽 = cellSize mm（1 period = 1 mm）。默认 1 保持旧行为。
 * @param normals 可选顶点法线，用于缠绕定向（见 buildBinarySTL）
 */
export function exportBinarySTL(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1,
  normals?: Float32Array
): void {
  const buf = buildBinarySTL(positions, indices, scale, normals);
  downloadBlob(new Blob([buf], { type: 'model/stl' }), filename);
}

/**
 * CFD Multi-Patch ASCII STL（OpenFOAM-ready）
 *
 * 按三角面片质心与定向几何法线把网格分入四个 boundary patch：
 *   · inlet : c_z ≤ z_min+ε 且 n_z < −0.7（底面强外向 → 流动入口候选）
 *   · outlet: c_z ≥ z_max−ε 且 n_z > 0.7（顶面强外向 → 出口候选）
 *   · sides : 贴 x/y 边界裁剪面的面片（侧壁周期/对称边界候选）
 *   · wall  : 其余内部多孔曲面
 * ε = 对应轴包围盒跨度的 1%（含绝对下限）。注意这里是固相网格，
 * OpenFOAM 以补集为流动域时出入口语义需按物理朝向复核——本函数忠实执行
 * 几何分类规则，不做方向臆断。
 *
 * 输出标准多 solid ASCII STL（`solid <name> … endsolid <name>` 四区块），
 * snappyHexMesh / surfaceConvert 可直接读取分块命名边界。
 */
export type CfdPatchName = 'inlet' | 'outlet' | 'sides' | 'wall';
/**
 * 全局定向传播（2026-09-05 缠绕翻转根治）。
 *
 * 此前逐三角独立地以「顶点法线 vs 几何法线点积」判向翻转：顶点法线场在
 * 封盖扇心/边界层区不可靠，独立判向会把本局部一致的缠绕打碎——R96 gyroid
 * 实测 misoriented 边 4536 → 翻转后 23571（恶化 ~5×）。
 *
 * 实现：①无向边登记（恰 2 入射）→ ②三角邻接图 BFS 二着色（共享边原始
 * 方向相同者异色，即需翻转；着色只依赖原始拓扑，无中途状态过期）→
 * ③应用翻转 → ④发散体积为负则整体再翻（统一外向法线约定）。
 * 封闭流形（网格管线保证 open=nm=0）上 misoriented 由构造归零。
 */
function orientConsistently(positions: Float32Array, indices: Uint32Array): Uint32Array {
  const triCount = indices.length / 3;
  const out = indices.slice();
  if (triCount === 0) return out;
  const vertCount = positions.length / 3;

  const edgeMap = new Map<number, Array<{ t: number; rev: boolean }>>();
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t * 3 + e], b = indices[t * 3 + (e + 1) % 3];
      if (a === b) continue;
      const rev = a > b;
      const key = rev ? b * vertCount + a : a * vertCount + b;
      let rec = edgeMap.get(key);
      if (!rec) { rec = []; edgeMap.set(key, rec); }
      if (rec.length < 2) rec.push({ t, rev });
    }
  }

  const color = new Int8Array(triCount).fill(-1);
  const queue = new Int32Array(triCount);
  for (let seed = 0; seed < triCount; seed++) {
    if (color[seed] !== -1) continue;
    color[seed] = 0;
    let head = 0, tail = 0;
    queue[tail++] = seed;
    while (head < tail) {
      const t = queue[head++];
      for (let e = 0; e < 3; e++) {
        const a = indices[t * 3 + e], b = indices[t * 3 + (e + 1) % 3];
        if (a === b) continue;
        const key = a > b ? b * vertCount + a : a * vertCount + b;
        const rec = edgeMap.get(key);
        if (!rec || rec.length !== 2) continue;
        const other = rec[0].t === t ? rec[1] : rec[0];
        if (color[other.t] !== -1) continue;
        // 共享边上两三角原始方向相同 ⇒ 局部定向冲突 ⇒ 邻接三角需翻转
        color[other.t] = (other.rev === (a > b)) ? color[t] ^ 1 : color[t];
        queue[tail++] = other.t;
      }
    }
  }

  for (let t = 0; t < triCount; t++) {
    if (color[t] === 1) {
      const tmp = out[t * 3 + 1];
      out[t * 3 + 1] = out[t * 3 + 2];
      out[t * 3 + 2] = tmp;
    }
  }

  let vol6 = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = out[t * 3] * 3, i1 = out[t * 3 + 1] * 3, i2 = out[t * 3 + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  if (vol6 < 0) {
    for (let t = 0; t < triCount; t++) {
      const tmp = out[t * 3 + 1];
      out[t * 3 + 1] = out[t * 3 + 2];
      out[t * 3 + 2] = tmp;
    }
  }
  return out;
}

const PATCH_ORDER: readonly CfdPatchName[] = ['inlet', 'outlet', 'sides', 'wall'];

export function buildMultiSolidSTL(
  positions: Float32Array,
  indices: Uint32Array,
  scale = 1,
  normals?: Float32Array,
): string {
  void normals; // 定向改由 orientConsistently 全局传播保证（与 binary 同源）
  const triCount = indices.length / 3;

  // 包围盒（缩放后 mm 域）
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * scale, y = positions[i + 1] * scale, z = positions[i + 2] * scale;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const epsX = Math.max((xmax - xmin) * 0.01, scale * 1e-3);
  const epsY = Math.max((ymax - ymin) * 0.01, scale * 1e-3);
  const epsZ = Math.max((zmax - zmin) * 0.01, scale * 1e-3);

  const chunks: Record<CfdPatchName, string[]> = { inlet: [], outlet: [], sides: [], wall: [] };
  const fmt = (v: number): string => v.toFixed(6);

  const oriented = orientConsistently(positions, indices);

  for (let t = 0; t < triCount; t++) {
    let i0 = oriented[t * 3] * 3;
    let i1 = oriented[t * 3 + 1] * 3;
    let i2 = oriented[t * 3 + 2] * 3;

    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    let gx = ay * bz - az * by;
    let gy = az * bx - ax * bz;
    let gz = ax * by - ay * bx;

    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = gx / gl, ny = gy / gl, nz = gz / gl;

    const cx = (positions[i0] + positions[i1] + positions[i2]) / 3 * scale;
    const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3 * scale;
    const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3 * scale;

    let patch: CfdPatchName = 'wall';
    if (cz <= zmin + epsZ && nz < -0.7) patch = 'inlet';
    else if (cz >= zmax - epsZ && nz > 0.7) patch = 'outlet';
    else if (cx <= xmin + epsX || cx >= xmax - epsX || cy <= ymin + epsY || cy >= ymax - epsY) patch = 'sides';

    const lines = chunks[patch];
    lines.push(
      ` facet normal ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}\n`,
      '  outer loop\n',
      `   vertex ${fmt(positions[i0] * scale)} ${fmt(positions[i0 + 1] * scale)} ${fmt(positions[i0 + 2] * scale)}\n`,
      `   vertex ${fmt(positions[i1] * scale)} ${fmt(positions[i1 + 1] * scale)} ${fmt(positions[i1 + 2] * scale)}\n`,
      `   vertex ${fmt(positions[i2] * scale)} ${fmt(positions[i2 + 1] * scale)} ${fmt(positions[i2 + 2] * scale)}\n`,
      '  endloop\n',
      ' endfacet\n',
    );
  }

  let out = '';
  for (const name of PATCH_ORDER) {
    out += `solid ${name}\n${chunks[name].join('')}endsolid ${name}\n`;
  }
  return out;
}

/** Multi-solid ASCII STL 下载（mm 缩放与 binary 入口一致）。 */
export function exportMultiSolidSTL(
  positions: Float32Array,
  indices: Uint32Array,
  filename: string,
  scale = 1,
  normals?: Float32Array,
): void {
  const text = buildMultiSolidSTL(positions, indices, scale, normals);
  downloadBlob(new Blob([text], { type: 'model/stl' }), filename);
}
