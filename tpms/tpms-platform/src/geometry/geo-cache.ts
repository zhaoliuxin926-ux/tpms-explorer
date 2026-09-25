import type { AppState } from '../types';

/** Geometry 结果 LRU 缓存：参数回退时瞬间恢复 */
export interface GeoCacheEntry {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertCount: number;
  faceCount: number;
  /** Worker-side observables needed to restore stats on a cache hit. */
  porosityEstimate: number;
  meshSolidFraction: number | null;
  isoUsed: number;
  surfaceArea?: number;
  envelopeVolume?: number;
}

export const geoCache = new Map<string, GeoCacheEntry>();
/** 条数上限（历史契约）；再叠加字节预算防 HD 网格把内存吃满 */
export const MAX_GEO_CACHE = 12;
/** 12 条 R96 HD 网格可达数百 MB——按字节淘汰，至少保留 1 条（当前几何） */
export const MAX_GEO_CACHE_BYTES = 256 * 1024 * 1024;

function entryBytes(e: GeoCacheEntry): number {
  return e.positions.byteLength + e.normals.byteLength + e.indices.byteLength;
}

function totalBytes(): number {
  let n = 0;
  for (const e of geoCache.values()) n += entryBytes(e);
  return n;
}

/** LRU 写入 + 条数/字节双预算淘汰（调用方勿再手写 size 淘汰） */
export function geoCacheSet(key: string, entry: GeoCacheEntry): void {
  geoCache.delete(key);
  geoCache.set(key, entry);
  while (geoCache.size > 1 && (geoCache.size > MAX_GEO_CACHE || totalBytes() > MAX_GEO_CACHE_BYTES)) {
    const oldest = geoCache.keys().next().value;
    if (oldest === undefined) break;
    geoCache.delete(oldest);
  }
}

/** 命中后移到队尾（纯 LRU 刷新，不改内容） */
export function geoCacheTouch(key: string): void {
  const e = geoCache.get(key);
  if (!e) return;
  geoCache.delete(key);
  geoCache.set(key, e);
}

export function cacheKey(s: Readonly<AppState>, R: number): string {
  const m = s.manifold;
  return `${s.type}|${s.model}|${s.cellSize}|${R}|${s.porosity}|${s.structureMode}|${s.containerShape}|${s.thickness}|${s.gradientDir}|${s.isoGrad.enabled ? `IG${s.isoGrad.hard}/${s.isoGrad.soft}b${s.isoGrad.band}` : ''}|${s.hybrid.enabled ? `H${s.hybrid.typeB}@${s.hybrid.axis}c${s.hybrid.blendCenter}w${s.hybrid.blendWidth}f${s.hybrid.blendFunction}` : ''}|${s.customFormula}|${s.weights.join(',')}|EP${s.endplateMm}|M${m.kind}r${m.radius}s${m.scale}a${m.axis}|${s.stress.preset !== 'none' ? `SD${s.stress.preset}s${s.stress.strength}a${s.stress.anisotropy}` : ''}|${s.hierarchical.enabled ? `HR${s.hierarchical.microType}n${s.hierarchical.frequency}l${s.hierarchical.amplitude}` : ''}|${s.neural.enabled ? `NR${s.neural.z.map((v) => v.toFixed(2)).join(',')}` : ''}`;
}
