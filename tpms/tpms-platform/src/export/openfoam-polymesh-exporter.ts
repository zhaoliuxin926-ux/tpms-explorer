/**
 * OpenFOAM 原生 polyMesh 导出器（v3.0 阶段 III）
 *
 * 从 TPMS 体素模型的【孔隙（流体）域】直接生成 constant/polyMesh/ 五件套
 * （points / faces / owner / neighbour / boundary），打包为 STORED ZIP——
 * 解压到 OpenFOAM case 的 constant/polyMesh/ 即可 blockMesh 级直通求解，
 * 跳过 snappyHexMesh 的易错布尔剖分。
 *
 * 拓扑契约（OpenFOAM 规范）：
 *   · 内部面 owner < neighbour，面法线（右手法则）由 owner 指向 neighbour
 *   · 边界面 neighbour 省略，faces 列表中边界'面按 patch 连续排列，
 *     boundary 文件以 startFace/nFaces 描述（inlet, outlet, wall 顺序）
 *   · wall = 固相界面 + x/y 侧边界；inlet = z−；outlet = z+
 * 诚实边界：体素级阶梯界面（同 Abaqus 导出口径）；运行前需在 case 中提供
 * 0/ 场与 controlDict，本包只承载几何。
 */

import type { VoxelModel } from './voxel-model';

export interface PolyMeshBuild {
  files: Record<string, string>;
  stats: { points: number; faces: number; internalFaces: number; boundaryFaces: number; cells: number; patches: Record<string, number> };
}

/** 手写 STORED ZIP（CRC32 表格法，零依赖；3MF 导出器同款算法独立实现） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 打包 STORED ZIP（返回 Blob 兼容的 Uint8Array） */
export function buildStoredZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const lh = new Uint8Array(30 + nameB.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version
    lv.setUint16(6, 0, true);           // flags
    lv.setUint16(8, 0, true);           // stored
    lv.setUint16(10, 0, true); lv.setUint16(12, 0, true);   // time/date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameB.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameB, 30);
    chunks.push(lh, e.data);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    central.push(ch);
    offset += lh.length + size;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const totalLen = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const FOAM_HEAD = (cls: string, obj: string) =>
  `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    object      ${obj};\n}\n`;

export function buildOpenfoamPolyMesh(model: VoxelModel, specimenSizeMm: number): PolyMeshBuild {
  const { R, solid, hWc } = model;
  const scale = specimenSizeMm / (2 * Math.PI);
  const h = hWc * scale;

  // 1. 流体（空隙）体素 → 紧凑 cell id
  const cellId = new Int32Array(R * R * R).fill(-1);
  let nCells = 0;
  const cellVoxel = new Int32Array(R * R * R);
  for (let i = 0; i < R * R * R; i++) {
    if (!solid[i]) { cellId[i] = nCells; cellVoxel[nCells++] = i; }
  }
  const voxelOf = (i: number): [number, number, number] => {
    const iz = Math.floor(i / (R * R));
    const iy = Math.floor((i % (R * R)) / R);
    return [i % R, iy, iz];
  };

  // 2. 面生成：跨界面对（含域边界面）
  interface FaceDef { pts: [number, number, number][]; owner: number; neighbour: number; patch: number }
  // patch: 0=inlet(z−) 1=outlet(z+) 2=wall
  const faces: FaceDef[] = [];
  const inBounds = (x: number, y: number, z: number) => x >= 0 && x < R && y >= 0 && y < R && z >= 0 && z < R;
  const vox = (x: number, y: number, z: number) => solid[x + y * R + z * R * R];
  const cellOf = (x: number, y: number, z: number) => cellId[x + y * R + z * R * R];
  const centerOf = (cell: number): [number, number, number] => {
    const [vx, vy, vz] = voxelOf(cellVoxel[cell]);
    return [vx + 0.5, vy + 0.5, vz + 0.5];
  };

  // 逐轴生成：d=0(x),1(y),2(z)；cross (i,j) 为另外两轴
  for (let d = 0; d < 3; d++) {
    const [a1, a2] = d === 0 ? [1, 2] : d === 1 ? [0, 2] : [0, 1];
    for (let p = 0; p <= R; p++) {
      for (let j = 0; j < R; j++) {
        for (let i = 0; i < R; i++) {
          // 体素对：跨面两层
          const c1 = [0, 0, 0], c2 = [0, 0, 0];
          c1[d] = p - 1; c2[d] = p;
          c1[a1] = i; c1[a2] = j;
          c2[a1] = i; c2[a2] = j;
          const in1 = inBounds(c1[0], c1[1], c1[2]);
          const in2 = inBounds(c2[0], c2[1], c2[2]);
          const s1 = in1 ? vox(c1[0], c1[1], c1[2]) : -1;   // -1 = 域外
          const s2 = in2 ? vox(c2[0], c2[1], c2[2]) : -1;
          const isFluid1 = in1 && s1 === 0;
          const isFluid2 = in2 && s2 === 0;
          // 无流体侧参与的面一律不生成（固-固 / 外-外 / 固-外）；双流体 ⇒ 内部面
          if (!isFluid1 && !isFluid2) continue;
          // 面四角点（节点层坐标）
          const pts: [number, number, number][] = [];
          const setPt = (coords: [number, number, number]) => pts.push(coords);
          if (d === 0) { setPt([p, i, j]); setPt([p, i + 1, j]); setPt([p, i + 1, j + 1]); setPt([p, i, j + 1]); }
          else if (d === 1) { setPt([i, p, j]); setPt([i, p, j + 1]); setPt([i + 1, p, j + 1]); setPt([i + 1, p, j]); }
          else { setPt([i, j, p]); setPt([i + 1, j, p]); setPt([i + 1, j + 1, p]); setPt([i, j + 1, p]); }
          // 面中心与法向（该点序的右手法线）
          const fc: [number, number, number] = [
            (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4,
            (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4,
            (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4,
          ];
          const e1: [number, number, number] = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
          const e2: [number, number, number] = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
          const gn: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const ownerCell = isFluid1 ? cellOf(c1[0], c1[1], c1[2]) : cellOf(c2[0], c2[1], c2[2]);
          const neighCell = isFluid1 && isFluid2 ? cellOf(c2[0], c2[1], c2[2]) : -1;
          const oc = centerOf(ownerCell);
          const outward = (fc[0] - oc[0]) * gn[0] + (fc[1] - oc[1]) * gn[1] + (fc[2] - oc[2]) * gn[2] >= 0;
          const ordered = outward ? pts : [pts[0], pts[3], pts[2], pts[1]];
          // patch 判定（边界面才有）
          let patch = 2;
          if (!(isFluid1 && isFluid2)) {
            if (d === 2 && p === 0) patch = 0;
            else if (d === 2 && p === R) patch = 1;
          }
          faces.push({ pts: ordered, owner: ownerCell, neighbour: neighCell, patch });
        }
      }
    }
  }

  // 3. 排序：内部面 → inlet → outlet → wall
  const internal = faces.filter((f) => f.neighbour >= 0);
  const bIn = faces.filter((f) => f.neighbour < 0 && f.patch === 0);
  const bOut = faces.filter((f) => f.neighbour < 0 && f.patch === 1);
  const bWall = faces.filter((f) => f.neighbour < 0 && f.patch === 2);
  const ordered = [...internal, ...bIn, ...bOut, ...bWall];

  // 4. 节点去重（首触序紧凑 id）
  const nodeId = new Map<string, number>();
  const points: [number, number, number][] = [];
  const pid = (c: [number, number, number]) => {
    const k = `${c[0]},${c[1]},${c[2]}`;
    let id = nodeId.get(k);
    if (id === undefined) {
      id = points.length;
      points.push([(c[0] - R / 2) * h, (c[1] - R / 2) * h, (c[2] - R / 2) * h]);
      nodeId.set(k, id);
    }
    return id;
  };

  const faceLines: string[] = [];
  const ownerLines: string[] = [];
  const neighLines: string[] = [];
  let nInternal = 0;
  const patchRanges: Record<string, { start: number; n: number }> = { inlet: { start: -1, n: 0 }, outlet: { start: -1, n: 0 }, wall: { start: -1, n: 0 } };
  ordered.forEach((f, fi) => {
    faceLines.push(`(${f.pts.map(pid).join(' ')})`);
    ownerLines.push(String(f.owner));
    if (f.neighbour >= 0) { neighLines.push(String(f.neighbour)); nInternal++; }
    else {
      const name = f.patch === 0 ? 'inlet' : f.patch === 1 ? 'outlet' : 'wall';
      if (patchRanges[name].start < 0) patchRanges[name].start = fi;
      patchRanges[name].n++;
    }
  });

  const files: Record<string, string> = {};
  files['constant/polyMesh/points'] = FOAM_HEAD('vectorField', 'points')
    + `\n${points.length}\n(\n` + points.map((p) => `(${p.map((v) => v.toFixed(6)).join(' ')})`).join('\n') + '\n)\n';
  files['constant/polyMesh/faces'] = FOAM_HEAD('faceList', 'faces')
    + `\n${ordered.length}\n(\n` + faceLines.join('\n') + '\n)\n';
  files['constant/polyMesh/owner'] = FOAM_HEAD('labelList', 'owner')
    + `\n${ordered.length}\n(\n` + ownerLines.join('\n') + '\n)\n';
  files['constant/polyMesh/neighbour'] = FOAM_HEAD('labelList', 'neighbour')
    + `\n${nInternal}\n(\n` + neighLines.join('\n') + '\n)\n';
  const bEntries = (['inlet', 'outlet', 'wall'] as const).map((name) => {
    const r = patchRanges[name];
    return `    ${name}\n    {\n        type            patch;\n        nFaces          ${r.n};\n        startFace       ${Math.max(0, r.start)};\n    }`;
  }).join('\n');
  files['constant/polyMesh/boundary'] = FOAM_HEAD('polyBoundaryMesh', 'boundary')
    + `\n3\n(\n${bEntries}\n)\n`;

  return {
    files,
    stats: {
      points: points.length,
      faces: ordered.length,
      internalFaces: nInternal,
      boundaryFaces: ordered.length - nInternal,
      cells: nCells,
      patches: { inlet: patchRanges.inlet.n, outlet: patchRanges.outlet.n, wall: patchRanges.wall.n },
    },
  };
}

export function exportOpenfoamPolyMesh(model: VoxelModel, specimenSizeMm: number, filename: string, downloadBlobFn: (blob: Blob, name: string) => void): void {
  const build = buildOpenfoamPolyMesh(model, specimenSizeMm);
  const enc = new TextEncoder();
  const entries = Object.entries(build.files).map(([name, text]) => ({ name, data: enc.encode(text) }));
  const zip = buildStoredZip(entries);
  const blob = new Blob([zip as unknown as BlobPart], { type: 'application/zip' });
  downloadBlobFn(blob, filename);
}
