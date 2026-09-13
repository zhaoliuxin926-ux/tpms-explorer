/**
 * mesh-container.ts —— C5 任意解剖流形 STL 保形容器（v9.0 旗舰）
 *
 * 管线：STL 解析 → 水密/流形自检（fail-closed）→ 归一化到 [-1,1]（留 5% margin）
 *   → 扫描线奇偶符号（逐 y 行沿 +x 与三角形求交，区间奇偶=内外）
 *   → BVH 最近三角形距离（AABB 树中位分裂 + Ericson 点-三角最近点）
 *   → SDF：外部 >0、内部 <0（与解析容器 boundAt 同号约定，surface-nets 直接融合）
 *
 * 语义（C5 立项定案）：
 *   - SDF 是光滑连续场，surface-nets 侧 smax(f, sdf) 零面自然弯贴壁面闭合——
 *     无孔口环（8c 封盖不触发）、dAx 层由 5% margin 保证 sdf>0；
 *   - Newton 投影在 mesh 模式下由 surface-nets 跳过（投影目标是 TPMS 场会破坏贴合），
 *     贴合精度 = 场直接提取精度（半格 + 网格离散），门禁 44 断言对齐；
 *   - domain.scale 给出 mm/单位 换算（输出 STL 以同尺度恢复解剖域物理尺寸）。
 */

export interface MeshCheck {
  tris: number;
  verts: number;
  openEdges: number;
  nonManifoldEdges: number;
  misorientedEdges: number;
  watertight: boolean;
}

export interface MeshDomain {
  /** mm / 归一化单位（归一化 phys 域 × scale = 原始 mm） */
  scale: number;
  cx: number;
  cy: number;
  cz: number;
}

export interface MeshSDFResult {
  sdf: Float32Array;
  n: number;
  domain: MeshDomain;
  check: MeshCheck;
}

/** STL 解析（binary + ASCII 自动识别）+ 顶点焊接（STL 是面汤：同坐标顶点量化合并恢复共享索引） */
export function parseSTL(buffer: ArrayBuffer): { positions: Float32Array; indices: Uint32Array } {
  const raw = parseSTLRaw(buffer);
  return weld(raw.positions, raw.indices);
}

function weld(positions: Float32Array, indices: Uint32Array): { positions: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const out: number[] = [];
  const newIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const p = indices[i] * 3;
    const key = `${Math.round(positions[p] * 1e5)},${Math.round(positions[p + 1] * 1e5)},${Math.round(positions[p + 2] * 1e5)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = out.length / 3;
      out.push(positions[p], positions[p + 1], positions[p + 2]);
      map.set(key, id);
    }
    newIdx[i] = id;
  }
  return { positions: Float32Array.from(out), indices: newIdx };
}

function parseSTLRaw(buffer: ArrayBuffer): { positions: Float32Array; indices: Uint32Array } {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const head = String.fromCharCode(...bytes.slice(0, 5));
  const isAscii = head === 'solid' && /\bfacet\b|\bendsolid\b/.test(new TextDecoder().decode(bytes.slice(0, 512)));
  if (!isAscii) {
    if (buffer.byteLength < 84) throw new Error('binary STL 过短（<84 字节头）');
    const triCount = view.getUint32(80, true);
    if (84 + triCount * 50 !== buffer.byteLength) {
      throw new Error(`binary STL 长度不匹配：84+${triCount}×50 ≠ ${buffer.byteLength}`);
    }
    const positions = new Float32Array(triCount * 9);
    const indices = new Uint32Array(triCount * 3);
    let off = 84;
    for (let t = 0; t < triCount; t++) {
      off += 12; // 文件法线不信任（由缠绕重算）
      for (let v = 0; v < 3; v++) {
        positions[t * 9 + v * 3] = view.getFloat32(off, true);
        positions[t * 9 + v * 3 + 1] = view.getFloat32(off + 4, true);
        positions[t * 9 + v * 3 + 2] = view.getFloat32(off + 8, true);
        off += 12;
      }
      indices[t * 3] = t * 3; indices[t * 3 + 1] = t * 3 + 1; indices[t * 3 + 2] = t * 3 + 2;
      off += 2;
    }
    return { positions, indices };
  }
  const txt = new TextDecoder().decode(bytes);
  const vtx: number[][] = [];
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('vertex')) continue;
    const p = s.split(/\s+/);
    vtx.push([Number(p[1]), Number(p[2]), Number(p[3])]);
  }
  if (vtx.length === 0 || vtx.length % 3 !== 0) throw new Error(`ASCII STL vertex 行数异常：${vtx.length}`);
  const triCount = vtx.length / 3;
  const positions = new Float32Array(vtx.length * 3);
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < vtx.length; i++) {
    positions[i * 3] = vtx[i][0]; positions[i * 3 + 1] = vtx[i][1]; positions[i * 3 + 2] = vtx[i][2];
    indices[i] = i;
  }
  return { positions, indices };
}

/** 水密/流形自检（无向边配对：正反各一次=一致；单次=开放；≥2 次=非流形） */
export function checkMesh(indices: Uint32Array): MeshCheck {
  let maxV = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > maxV) maxV = indices[i];
  const KM = maxV + 1;
  const em = new Map<number, [number, number]>();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const key = a < b ? a * KM + b : b * KM + a;
      const rec = em.get(key) ?? [0, 0];
      if (a < b) rec[0]++; else rec[1]++;
      em.set(key, rec);
    }
  }
  let open = 0, nm = 0, miso = 0;
  for (const [, [f, b]] of em) {
    if (f === 1 && b === 1) continue;
    if (f + b === 1) open++; else nm++;
    miso++;
  }
  return { tris: indices.length / 3, verts: maxV + 1, openEdges: open, nonManifoldEdges: nm, misorientedEdges: miso, watertight: open === 0 && nm === 0 };
}

/** Ericson 点-三角形最近点 */
export function closestPtTriangle(px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
  out: Float64Array): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; } // B 顶点区（Ericson：d4 ≤ d3）
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = ax + v * abx + w * acx; out[1] = ay + v * aby + w * acy; out[2] = az + v * abz + w * acz;
}

const _cp = new Float64Array(3);

/** STL → 归一化 [-1,1] 体素 SDF（N = resolution+1）。精度 = BVH 精确最近点 + 扫描线奇偶。 */
export function computeMeshSDF(stlBuffer: ArrayBuffer, n: number): MeshSDFResult {
  const { positions, indices } = parseSTL(stlBuffer);
  const check = checkMesh(indices);
  if (!check.watertight) {
    throw new Error(`容器网格非水密（开放边 ${check.openEdges} / 非流形边 ${check.nonManifoldEdges}）——保形填充要求封闭流形输入，fail-closed 拒绝`);
  }
  // 定向自愈：发散体积为负整体翻转（扫描线奇偶不依赖外向，规范输入利于下游诊断）
  let vol6 = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  if (vol6 < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
    }
  }
  let ax = Infinity, ay = Infinity, az = Infinity, bx = -Infinity, by = -Infinity, bz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    ax = Math.min(ax, positions[i]); ay = Math.min(ay, positions[i + 1]); az = Math.min(az, positions[i + 2]);
    bx = Math.max(bx, positions[i]); by = Math.max(by, positions[i + 1]); bz = Math.max(bz, positions[i + 2]);
  }
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
  const halfMax = Math.max(bx - ax, by - ay, bz - az) / 2;
  if (!(halfMax > 0)) throw new Error('容器网格退化（零包围盒）');
  const scale = halfMax / 0.95;
  const P = positions.slice();
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (P[i] - cx) / scale; P[i + 1] = (P[i + 1] - cy) / scale; P[i + 2] = (P[i + 2] - cz) / scale;
  }
  const pt = (i: number) => (i / (n - 1)) * 2 - 1;

  // ── 均匀网格桶最近点（替代手写 BVH：无递归/无区间编码，结构可靠）──
  const GRID = 24;
  const step = 2 / GRID;
  const buckets = new Map<number, number[]>();
  const bkey = (a: number, b: number, c: number) => ((a * GRID + b) * GRID + c);
  for (let t = 0; t < indices.length / 3; t++) {
    let ax = Infinity, ay = Infinity, az = Infinity, bx = -Infinity, by = -Infinity, bz = -Infinity;
    for (let v = 0; v < 3; v++) {
      const p3 = indices[t * 3 + v] * 3;
      ax = Math.min(ax, P[p3]); ay = Math.min(ay, P[p3 + 1]); az = Math.min(az, P[p3 + 2]);
      bx = Math.max(bx, P[p3]); by = Math.max(by, P[p3 + 1]); bz = Math.max(bz, P[p3 + 2]);
    }
    const gxa = Math.max(0, Math.floor((ax + 1) / step)), gxb = Math.min(GRID - 1, Math.floor((bx + 1) / step));
    const gya = Math.max(0, Math.floor((ay + 1) / step)), gyb = Math.min(GRID - 1, Math.floor((by + 1) / step));
    const gza = Math.max(0, Math.floor((az + 1) / step)), gzb = Math.min(GRID - 1, Math.floor((bz + 1) / step));
    for (let ga = gxa; ga <= gxb; ga++) for (let gb = gya; gb <= gyb; gb++) for (let gc = gza; gc <= gzb; gc++) {
      const k = bkey(ga, gb, gc);
      const arr = buckets.get(k);
      if (arr) arr.push(t); else buckets.set(k, [t]);
    }
  }
  const distTo = (px: number, py: number, pz: number): number => {
    let best = Infinity;
    const gxa = Math.max(0, Math.min(GRID - 1, Math.floor((px + 1) / step)));
    const gya = Math.max(0, Math.min(GRID - 1, Math.floor((py + 1) / step)));
    const gza = Math.max(0, Math.min(GRID - 1, Math.floor((pz + 1) / step)));
    for (let ring = 0; ring < GRID * 2; ring++) {
      // 环半径 ring 的桶域扫描；环距下界 (ring - 1) * step ≥ best 时可停
      if (ring > 0 && (ring - 1) * step >= best) break;
      const lo = Math.max(0, gxa - ring), hi = Math.min(GRID - 1, gxa + ring);
      const loY = Math.max(0, gya - ring), hiY = Math.min(GRID - 1, gya + ring);
      const loZ = Math.max(0, gza - ring), hiZ = Math.min(GRID - 1, gza + ring);
      for (let ga = lo; ga <= hi; ga++) {
        for (let gb = loY; gb <= hiY; gb++) {
          for (let gc = loZ; gc <= hiZ; gc++) {
            if (ring > 0 && Math.max(Math.abs(ga - gxa), Math.abs(gb - gya), Math.abs(gc - gza)) !== ring) continue;
            const arr = buckets.get(bkey(ga, gb, gc));
            if (!arr) continue;
            for (const t of arr) {
              closestPtTriangle(px, py, pz,
                P[indices[t * 3] * 3], P[indices[t * 3] * 3 + 1], P[indices[t * 3] * 3 + 2],
                P[indices[t * 3 + 1] * 3], P[indices[t * 3 + 1] * 3 + 1], P[indices[t * 3 + 1] * 3 + 2],
                P[indices[t * 3 + 2] * 3], P[indices[t * 3 + 2] * 3 + 1], P[indices[t * 3 + 2] * 3 + 2], _cp);
              const dx = px - _cp[0], dy = py - _cp[1], dz = pz - _cp[2];
              const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dd < best) best = dd;
            }
          }
        }
      }
      if (best < Infinity && best <= ring * step) break;
    }
    return best;
  };


  const sdf = new Float32Array(n * n * n);
  const hits: number[] = [];
  for (let k = 0; k < n; k++) {
    const z = pt(k);
    const zB = k * n * n;
    for (let j = 0; j < n; j++) {
      const y = pt(j);
      const yB = zB + j * n;
      // 行射线沿 +x：收集全部三角形交点（(y,z) 投影重心判定 + 平面解 x）
      hits.length = 0;
      for (let t = 0; t < indices.length / 3; t++) {
        const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
        const ay = P[a + 1], az2 = P[a + 2];
        const e1y = P[b + 1] - ay, e1z = P[b + 2] - az2;
        const e2y = P[c + 1] - ay, e2z = P[c + 2] - az2;
        const py = y - ay, pz = z - az2;
        const det = e1y * e2z - e1z * e2y;
        if (Math.abs(det) < 1e-12) continue; // 投影退化（边平行射线或薄片）
        const u = (py * e2z - pz * e2y) / det;
        const v = (e1y * pz - e1z * py) / det;
        if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
        // 平面法线（交点 x 由平面方程解出：n·(P−A)=0 → x = A_x − (n_y·py + n_z·pz)/n_x）
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy;
        if (Math.abs(nx) < 1e-14) continue; // 刀片/平行：对穿越计数零贡献（加权法天然正确）
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const x = P[a] - (ny * py + nz * pz) / nx;
        hits.push({ x, w: nx > 0 ? -1 : 1 }); // 沿 +x：遇外向面=离开内部（-1），内向面=进入（+1）
      }
      hits.sort((p, q) => p.x - q.x);
      for (let i = 0; i < n; i++) {
        const x = pt(i);
        let wsum = 0;
        for (const h of hits) { if (h.x < x) wsum += h.w; else break; }
        const inside = wsum !== 0;
        const d = distTo(x, y, z);
        sdf[yB + i] = inside ? -d : d;
      }
    }
  }
  return { sdf, n, domain: { scale, cx, cy, cz }, check };
}
