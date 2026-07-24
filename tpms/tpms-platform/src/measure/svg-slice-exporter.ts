/**
 * SVG 二维剖面矢量化导出
 * 利用 clipPlane 与重建后的三角网格相交，提取截面轮廓线并输出高精度 SVG。
 */

import * as THREE from 'three';

const EPS = 1e-5;
const SVG_PADDING = 20;
const SVG_SIZE = 800;

interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** 主入口：将当前 slice 平面与几何体交线导出为 SVG 字符串 */
export function exportSliceSVG(
  geometry: THREE.BufferGeometry,
  plane: THREE.Plane,
  metadata?: { type: string; slice: number; iso: number },
): string {
  const segments = sliceGeometry(geometry, plane);
  if (segments.length === 0) return '';

  // 投影到 2D（构建平面局部坐标系）
  const { project, min, max } = buildProjection(plane, segments);

  // 合并相近端点并建立邻接表
  const paths = connectSegments(segments, project);

  // 计算缩放与平移以适配 SVG 画布
  const rangeX = max.x - min.x || 1;
  const rangeY = max.y - min.y || 1;
  const scale = (SVG_SIZE - 2 * SVG_PADDING) / Math.max(rangeX, rangeY);
  const offsetX = SVG_PADDING + (SVG_SIZE - 2 * SVG_PADDING - rangeX * scale) / 2 - min.x * scale;
  const offsetY = SVG_PADDING + (SVG_SIZE - 2 * SVG_PADDING - rangeY * scale) / 2 - min.y * scale;

  const toSvg = (p: THREE.Vector2) => `${(p.x * scale + offsetX).toFixed(2)},${(SVG_SIZE - (p.y * scale + offsetY)).toFixed(2)}`;

  let pathData = '';
  for (const path of paths) {
    if (path.length < 2) continue;
    pathData += `M ${toSvg(path[0])}`;
    for (let i = 1; i < path.length; i++) {
      pathData += ` L ${toSvg(path[i])}`;
    }
    // 若首尾相接则闭合
    const first = path[0];
    const last = path[path.length - 1];
    if (first.distanceTo(last) < EPS) pathData += ' Z';
    pathData += '\n';
  }

  const metaComment = metadata
    ? `<!-- TPMS Slice: type=${metadata.type}, slice=${metadata.slice}%, iso=${metadata.iso.toFixed(4)} -->\n`
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}">\n` +
    `${metaComment}` +
    `<rect width="100%" height="100%" fill="#ffffff"/>\n` +
    `<path d="\n${pathData}" fill="none" stroke="#0f172a" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>\n` +
    `</svg>`
  );
}

/** 遍历几何体所有三角形，提取与平面的交线段 */
function sliceGeometry(geometry: THREE.BufferGeometry, plane: THREE.Plane): Segment[] {
  const posAttr = geometry.attributes.position;
  const indexAttr = geometry.index;
  const segments: Segment[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  const addSeg = (p1: THREE.Vector3, p2: THREE.Vector3) => {
    segments.push({ a: p1.clone(), b: p2.clone() });
  };

  const processTri = (i0: number, i1: number, i2: number) => {
    a.fromBufferAttribute(posAttr, i0);
    b.fromBufferAttribute(posAttr, i1);
    c.fromBufferAttribute(posAttr, i2);

    const da = plane.distanceToPoint(a);
    const db = plane.distanceToPoint(b);
    const dc = plane.distanceToPoint(c);

    const onPlane = [Math.abs(da) < EPS, Math.abs(db) < EPS, Math.abs(dc) < EPS];

    // 收集交点（去重）
    const pts: THREE.Vector3[] = [];
    const pushPt = (p: THREE.Vector3) => {
      if (pts.length === 0 || pts[pts.length - 1].distanceTo(p) > EPS) pts.push(p);
    };

    const edge = (p1: THREE.Vector3, p2: THREE.Vector3, d1: number, d2: number) => {
      if (onPlane[0] && onPlane[1]) {
        pushPt(p1);
        pushPt(p2);
      } else if (onPlane[0]) {
        pushPt(p1);
      } else if (onPlane[1]) {
        pushPt(p2);
      } else if (d1 * d2 < 0) {
        const t = d1 / (d1 - d2);
        pushPt(new THREE.Vector3().lerpVectors(p1, p2, t));
      }
    };

    edge(a, b, da, db);
    edge(b, c, db, dc);
    edge(c, a, dc, da);

    if (pts.length >= 2) {
      addSeg(pts[0], pts[1]);
    }
  };

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      processTri(indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2));
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      processTri(i, i + 1, i + 2);
    }
  }

  return segments;
}

/** 构建平面局部 2D 投影坐标系，返回投影函数与包围盒 */
function buildProjection(
  plane: THREE.Plane,
  segments: Segment[],
): {
  project: (v: THREE.Vector3) => THREE.Vector2;
  min: THREE.Vector2;
  max: THREE.Vector2;
} {
  const n = plane.normal.clone();
  // 选择投影主平面（避免法向量与主轴平行时的退化）
  let u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.x) > 0.9) u.set(0, 1, 0);
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  u.crossVectors(v, n).normalize();

  const project = (p: THREE.Vector3) => new THREE.Vector2(p.dot(u), p.dot(v));

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of segments) {
    const pa = project(s.a);
    const pb = project(s.b);
    minX = Math.min(minX, pa.x, pb.x);
    minY = Math.min(minY, pa.y, pb.y);
    maxX = Math.max(maxX, pa.x, pb.x);
    maxY = Math.max(maxY, pa.y, pb.y);
  }

  return {
    project,
    min: new THREE.Vector2(minX, minY),
    max: new THREE.Vector2(maxX, maxY),
  };
}

/** 将线段通过端点匹配连接成连续路径 */
function connectSegments(segments: Segment[], project: (v: THREE.Vector3) => THREE.Vector2): THREE.Vector2[][] {
  if (segments.length === 0) return [];

  // 扁平化所有端点为 2D 点（保留与原始线段的映射）
  type Pt = { x: number; y: number; segIdx: number; isA: boolean };
  const pts: Pt[] = [];
  for (let i = 0; i < segments.length; i++) {
    const pa = project(segments[i].a);
    const pb = project(segments[i].b);
    pts.push({ x: pa.x, y: pa.y, segIdx: i, isA: true });
    pts.push({ x: pb.x, y: pb.y, segIdx: i, isA: false });
  }

  // 基于 epsilon 聚类端点，赋予全局节点 ID
  const nodeId: number[] = new Array(pts.length).fill(-1);
  let nextId = 0;
  for (let i = 0; i < pts.length; i++) {
    if (nodeId[i] !== -1) continue;
    nodeId[i] = nextId;
    for (let j = i + 1; j < pts.length; j++) {
      if (nodeId[j] !== -1) continue;
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      if (dx * dx + dy * dy < EPS * EPS) {
        nodeId[j] = nextId;
      }
    }
    nextId++;
  }

  // 建立无向图邻接表
  const adj: Map<number, number[]> = new Map();
  const addEdge = (u: number, v: number) => {
    if (!adj.has(u)) adj.set(u, []);
    if (!adj.has(v)) adj.set(v, []);
    adj.get(u)!.push(v);
    adj.get(v)!.push(u);
  };

  for (let i = 0; i < segments.length; i++) {
    const idA = nodeId[i * 2];
    const idB = nodeId[i * 2 + 1];
    addEdge(idA, idB);
  }

  // DFS 提取路径
  const visited = new Set<string>();
  const paths: THREE.Vector2[][] = [];

  const nodePos = (id: number) => {
    // 取该聚类第一个点的坐标
    const idx = nodeId.indexOf(id);
    return new THREE.Vector2(pts[idx].x, pts[idx].y);
  };

  for (let start = 0; start < nextId; start++) {
    const neighbors = adj.get(start);
    if (!neighbors || neighbors.length === 0) continue;

    // 若该节点还有未访问的边，则启动一条新路径
    while (true) {
      const nextUnvisited = neighbors.find((n) => !visited.has(`${Math.min(start, n)}-${Math.max(start, n)}`));
      if (nextUnvisited === undefined) break;

      const path: THREE.Vector2[] = [nodePos(start)];
      let prev = start;
      let curr = nextUnvisited;

      while (true) {
        const edgeKey = `${Math.min(prev, curr)}-${Math.max(prev, curr)}`;
        if (visited.has(edgeKey)) break;
        visited.add(edgeKey);
        path.push(nodePos(curr));

        const nbrs = adj.get(curr)!;
        const nxt = nbrs.find((n) => !visited.has(`${Math.min(curr, n)}-${Math.max(curr, n)}`));
        if (nxt === undefined || nxt === start) {
          if (nxt === start) path.push(nodePos(start));
          break;
        }
        prev = curr;
        curr = nxt;
      }

      if (path.length >= 2) paths.push(path);
    }
  }

  return paths;
}
