/**
 * 三维交互式 CAE 边界条件拾取器（v5.0 阶段 II）
 *
 * 纯几何核心：法向角区域生长（Normal-Angle Region Growing）——从种子三角形
 * 出发，沿共享边扩展到法向夹角 ≤ 阈值的相邻三角形（平面/柱面特征面提取）。
 * 面集 → 节点集映射守恒：节点集 = 面集顶点的并集（重编号无关）。
 *
 * UI 侧（main.ts）：THREE.Raycaster 拾取三角面 → 以本模块生长区域 →
 * 顶点着色高亮 + 图元（约束三角/压力箭头）→ 导出时注入 INP/FOAM。
 */

export interface BCSpec {
  name: string;                     // 集名（注入 INP *NSET / FOAM patch）
  kind: 'FIXED' | 'PRESSURE' | 'INLET' | 'OUTLET';
  faces: number[];                  // 三角面索引
  /** PRESSURE/INLET: 法向压强/速度值 */
  value?: number;
}

/** 三角形面法线（单位向量） */
export function faceNormal(positions: Float32Array, indices: Uint32Array, tri: number): [number, number, number] {
  const i0 = indices[tri * 3] * 3, i1 = indices[tri * 3 + 1] * 3, i2 = indices[tri * 3 + 2] * 3;
  const ux = positions[i1] - positions[i0], uy = positions[i1 + 1] - positions[i0 + 1], uz = positions[i1 + 2] - positions[i0 + 2];
  const vx = positions[i2] - positions[i0], vy = positions[i2 + 1] - positions[i0 + 1], vz = positions[i2 + 2] - positions[i0 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** 构建边 → [面对] 邻接表（无向边键 = min·K+max） */
export function buildEdgeAdjacency(indices: Uint32Array, triCount: number, vertCount: number): Map<number, number[]> {
  const K = vertCount + 1;
  const adj = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const lo = Math.min(u, v), hi = Math.max(u, v);
      const key = lo * K + hi;
      const arr = adj.get(key) ?? [];
      arr.push(t);
      adj.set(key, arr);
    }
  }
  return adj;
}

/**
 * 法向角区域生长：从种子面扩展到与已接受面共享边、且法向夹角 ≤ maxAngleDeg 的面。
 * 返回排序后的面索引数组。
 */
export function growRegion(
  positions: Float32Array,
  indices: Uint32Array,
  triCount: number,
  vertCount: number,
  seedTri: number,
  maxAngleDeg = 25,
): number[] {
  const cosThreshold = Math.cos((maxAngleDeg * Math.PI) / 180);
  const normals: number[][] = [];
  for (let t = 0; t < triCount; t++) normals.push(faceNormal(positions, indices, t));
  const adj = buildEdgeAdjacency(indices, triCount, vertCount);
  const K = vertCount + 1;

  const visited = new Set<number>([seedTri]);
  const queue = [seedTri];
  const out: number[] = [];
  while (queue.length) {
    const t = queue.shift()!;
    out.push(t);
    const tn = normals[t];
    for (let e = 0; e < 3; e++) {
      const a = indices[t * 3 + e], b = indices[t * 3 + (e + 1) % 3];
      const key = Math.min(a, b) * K + Math.max(a, b);
      for (const nt of adj.get(key) ?? []) {
        if (visited.has(nt) || nt === t) continue;
        const nn = normals[nt];
        const dot = tn[0] * nn[0] + tn[1] * nn[1] + tn[2] * nn[2];
        if (dot >= cosThreshold) { visited.add(nt); queue.push(nt); }
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** 面集 → 顶点节点集（去重排序）——映射守恒由构造保证 */
export function facesToNodes(indices: Uint32Array, faces: number[]): number[] {
  const s = new Set<number>();
  for (const f of faces) {
    s.add(indices[f * 3]); s.add(indices[f * 3 + 1]); s.add(indices[f * 3 + 2]);
  }
  return [...s].sort((a, b) => a - b);
}

/**
 * 将边界条件集注入 Abaqus INP 文本（在 *STEP 之前插入）。
 * FIXED → *NSET + *BOUNDARY；PRESSURE → *NSET + *DSLOAD（负法向压强）。
 */
export function injectAbaqusBCs(inp: string, bcs: { spec: BCSpec; nodes: number[] }[], L: number): string {
  const blocks: string[] = [];
  for (const { spec, nodes } of bcs) {
    const safe = spec.name.replace(/[^A-Za-z0-9_-]/g, '_');
    blocks.push(`*NSET, NSET=BC_${safe}`);
    for (let i = 0; i < nodes.length; i += 8) blocks.push(nodes.slice(i, i + 8).join(', '));
    if (spec.kind === 'FIXED') {
      blocks.push(`** FIXED: 全约束（u1=u2=u3=0）`);
      blocks.push(`*BOUNDARY\nBC_${safe}, 1, 3, 0.0`);
    } else if (spec.kind === 'PRESSURE') {
      blocks.push(`** PRESSURE: 法向压强（负 = 指向面内）`);
      blocks.push(`*DSLOAD\nBC_${safe}, P, ${-(spec.value ?? 1)}`);
    }
  }
  void L;
  const stepIdx = inp.indexOf('*STEP');
  if (stepIdx < 0) return inp + '\n' + blocks.join('\n');
  return inp.slice(0, stepIdx) + blocks.join('\n') + '\n' + inp.slice(stepIdx);
}

/**
 * 将边界集注入 OpenFOAM boundary 字典（INLET/OUTLET/PRESSURE → patch 条目）。
 * FD-Darcy/SimpleFoam 侧需配套 0/ 场（调用方负责），此处只注入 boundary 条目。
 */
export function injectFoamBCs(boundaryText: string, bcs: { spec: BCSpec; faceRange?: [number, number] }[]): string {
  if (bcs.length === 0) return boundaryText;
  // 解析现有 patch 计数（头部数字行）并加 bcs.length
  const countMatch = boundaryText.match(/\n(\d+)\n\(/);
  const oldCount = countMatch ? Number(countMatch[1]) : 3;
  const newCount = oldCount + bcs.length;
  let out = boundaryText.replace(/(\n)(\d+)(\n\()/, (_m, a, _num, b) => a + String(newCount) + b);
  // 追加新 patch 条目（插入结尾 ) 之前）
  const entries = bcs.map(({ spec, faceRange }) => {
    const type = spec.kind === 'OUTLET' ? 'patch' : 'wall';
    const nF = faceRange ? faceRange[1] - faceRange[0] : 0;
    const sF = faceRange ? faceRange[0] : 0;
    return '    ' + spec.name + '\n    {\n        type            ' + type + ';\n        nFaces          ' + nF + ';\n        startFace       ' + sF + ';\n    }';
  }).join('\n');
  const lastParen = out.lastIndexOf(')');
  out = out.slice(0, lastParen) + entries + '\n' + out.slice(lastParen);
  return out;
}
