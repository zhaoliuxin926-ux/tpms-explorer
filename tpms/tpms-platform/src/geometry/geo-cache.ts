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
export const MAX_GEO_CACHE = 12;

export function cacheKey(s: Readonly<AppState>, R: number): string {
  const m = s.manifold;
  return `${s.type}|${s.model}|${s.cellSize}|${R}|${s.porosity}|${s.structureMode}|${s.containerShape}|${s.thickness}|${s.gradientDir}|${s.isoGrad.enabled ? `IG${s.isoGrad.hard}/${s.isoGrad.soft}b${s.isoGrad.band}` : ''}|${s.hybrid.enabled ? `H${s.hybrid.typeB}@${s.hybrid.axis}c${s.hybrid.blendCenter}w${s.hybrid.blendWidth}f${s.hybrid.blendFunction}` : ''}|${s.customFormula}|${s.weights.join(',')}|EP${s.endplateMm}|M${m.kind}r${m.radius}s${m.scale}a${m.axis}|${s.stress.preset !== 'none' ? `SD${s.stress.preset}s${s.stress.strength}a${s.stress.anisotropy}` : ''}|${s.hierarchical.enabled ? `HR${s.hierarchical.microType}n${s.hierarchical.frequency}l${s.hierarchical.amplitude}` : ''}|${s.neural.enabled ? `NR${s.neural.z.map((v) => v.toFixed(2)).join(',')}` : ''}`;
}
