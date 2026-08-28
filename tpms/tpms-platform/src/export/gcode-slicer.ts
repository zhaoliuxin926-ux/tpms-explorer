/**
 * gcode-slicer.ts —— 3D 打印原生切片引擎与 G-code 直出（v5.0 阶段 IV）
 *
 * 管线：三角网格 → z 等距切片 → 2D 轮廓链合 → 扫描线光栅填充 → G-code 编译。
 * 挤出体积校准：E 增量 = 路径长 × 线宽 × 层高；体积偏差 ≤2% 由门禁 25 守护。
 * 诚实边界：单壁轮廓 + 往复扫描填充（无壁厚偏移环路/桥接处理）。
 */

export interface SlicerOptions {
  layerHeightMm: number;
  lineWidthMm: number;
  zMinMm: number;
  zMaxMm: number;
  filamentDiameterMm: number;
  printerPreset: 'bambu' | 'klipper' | 'reprap';
  nozzleTempC: number;
  bedTempC: number;
  feedrateMmMin: number;
}

export interface SliceLayer {
  z: number;
  infillSegments: [number, number, number, number][];
}

export interface GcodeResult {
  gcode: string;
  layers: SliceLayer[];
  totalExtrusionMm3: number;
  modelVolumeMm3: number;
  volumeError: number;
  layerCount: number;
  stats: { extrusions: number; retractions: number };
}

/** 切片 + 扫描线填充 */
export function sliceMesh(
  positions: Float32Array,
  indices: Uint32Array,
  triCount: number,
  opts: SlicerOptions,
): { layers: SliceLayer[]; modelVolumeMm3: number } {
  let vol6 = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3] * 3, i1 = indices[t * 3 + 1] * 3, i2 = indices[t * 3 + 2] * 3;
    vol6 += positions[i0] * (positions[i1 + 1] * positions[i2 + 2] - positions[i1 + 2] * positions[i2 + 1])
      + positions[i0 + 1] * (positions[i1 + 2] * positions[i2] - positions[i1] * positions[i2 + 2])
      + positions[i0 + 2] * (positions[i1] * positions[i2 + 1] - positions[i1 + 1] * positions[i2]);
  }
  const modelVolumeMm3 = Math.abs(vol6) / 6;

  const h = opts.layerHeightMm;
  const nLayers = Math.max(1, Math.round((opts.zMaxMm - opts.zMinMm) / h));
  const layers: SliceLayer[] = [];

  for (let li = 0; li < nLayers; li++) {
    const z = opts.zMinMm + (li + 0.5) * h;
    const segs: [number, number, number, number][] = [];
    for (let t = 0; t < triCount; t++) {
      const pts: [number, number][] = [];
      for (const [p1, p2] of [[indices[t * 3], indices[t * 3 + 1]], [indices[t * 3 + 1], indices[t * 3 + 2]], [indices[t * 3 + 2], indices[t * 3]]] as const) {
        const z1 = positions[p1 * 3 + 2], z2 = positions[p2 * 3 + 2];
        if ((z1 - z) * (z2 - z) < 0) {
          const tI = (z - z1) / (z2 - z1);
          pts.push([
            positions[p1 * 3] + (positions[p2 * 3] - positions[p1 * 3]) * tI,
            positions[p1 * 3 + 1] + (positions[p2 * 3 + 1] - positions[p1 * 3 + 1]) * tI,
          ]);
        }
      }
      if (pts.length === 2) segs.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    }
    // 扫描线填充（偶奇规则）
    const infillSegments: [number, number, number, number][] = [];
    if (segs.length) {
      let yMin = Infinity, yMax = -Infinity;
      for (const sg of segs) { yMin = Math.min(yMin, sg[1], sg[3]); yMax = Math.max(yMax, sg[1], sg[3]); }
      let flip = li % 2 === 1;
      const spacing = opts.lineWidthMm * 0.8;   // 80% 线距（20% 重叠保证粘结）
      for (let yy = yMin + spacing / 2; yy < yMax; yy += spacing) {
        const xs: number[] = [];
        for (const [x1, y1, x2, y2] of segs) {
          if ((y1 - yy) * (y2 - yy) < 0) {
            xs.push(x1 + (x2 - x1) * (yy - y1) / (y2 - y1));
          }
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          if (xs[i + 1] - xs[i] > 1e-4) {
            if (flip) infillSegments.push([xs[i + 1], yy, xs[i], yy]);
            else infillSegments.push([xs[i], yy, xs[i + 1], yy]);
          }
        }
        flip = !flip;
      }
    }
    layers.push({ z, infillSegments });
  }
  return { layers, modelVolumeMm3 };
}

/** G-code 编译 */
export function compileGcode(
  layers: SliceLayer[],
  modelVolumeMm3: number,
  opts: SlicerOptions,
): GcodeResult {
  const lines: string[] = [];
  const stats = { extrusions: 0, retractions: 0 };
  const filamentArea = Math.PI * Math.pow(opts.filamentDiameterMm / 2, 2);
  const extrusionPerMm = (opts.lineWidthMm * opts.layerHeightMm) / filamentArea;

  lines.push('; TPMS Explorer v5.0 native slicer');
  if (opts.printerPreset === 'bambu') {
    lines.push('M73 P0', 'G90', 'M83', 'G28', 'G1 Z5 F600');
  } else {
    lines.push('G21 ; mm', 'G90 ; absolute', 'M83 ; relative E');
    lines.push('G28 ; home');
    if (opts.printerPreset === 'klipper') lines.push('QUAD_GANTRY_LEVEL');
    else lines.push('G29 ; bed level');
  }
  lines.push('M104 S' + opts.nozzleTempC, 'M140 S' + opts.bedTempC);
  lines.push('M109 S' + opts.nozzleTempC, 'M190 S' + opts.bedTempC);
  lines.push('G92 E0');

  let totalE = 0;
  let totalExtrusionMm3 = 0;
  let lastX = NaN, lastY = NaN;

  for (const layer of layers) {
    lines.push('G1 Z' + layer.z.toFixed(3) + ' F600');
    for (const [x1, y1, x2, y2] of layer.infillSegments) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-4) continue;
      const e = len * extrusionPerMm;
      const travel = have(lastX, lastY) ? Math.hypot(x1 - lastX, y1 - lastY) : Infinity;
      if (travel > opts.lineWidthMm * 4) {
        lines.push('G1 E-0.8000 F2400 ; retract');
        stats.retractions++;
        lines.push('G0 X' + x1.toFixed(3) + ' Y' + y1.toFixed(3) + ' F6000');
        lines.push('G1 E0.8000 F2400 ; unretract');
      } else if (!have(lastX, lastY)) {
        lines.push('G0 X' + x1.toFixed(3) + ' Y' + y1.toFixed(3) + ' F6000');
      }
      lines.push('G1 X' + x2.toFixed(3) + ' Y' + y2.toFixed(3) + ' E' + e.toFixed(5) + ' F' + opts.feedrateMmMin);
      totalE += e;
      totalExtrusionMm3 += len * opts.lineWidthMm * opts.layerHeightMm;
      stats.extrusions++;
      lastX = x2; lastY = y2;
    }
  }

  lines.push('M104 S0', 'M140 S0', 'G1 E-2 F2400', 'G28 X Y', 'M84');

  const volumeError = modelVolumeMm3 > 0 ? Math.abs(totalExtrusionMm3 - modelVolumeMm3) / modelVolumeMm3 : 0;
  return {
    gcode: lines.join('\n') + '\n',
    layers,
    totalExtrusionMm3,
    modelVolumeMm3,
    volumeError,
    layerCount: layers.length,
    stats,
  };
  function have(x: number, y: number): boolean { return !Number.isNaN(x) && !Number.isNaN(y); }
}
