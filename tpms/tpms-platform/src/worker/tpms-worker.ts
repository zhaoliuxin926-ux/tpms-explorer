import { buildSurface } from '../geometry/surface-nets';
import { globalBufferPool } from '../geometry/buffer-pool';
import type { WorkerRequest, WorkerResponse } from '../types';

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  const t0 = performance.now();
  try {
    globalBufferPool.reset();
    const result = buildSurface(params, globalBufferPool);
    if (import.meta.env?.DEV) {
      console.log('[Worker]', {
        type: params.type,
        mode: params.structureMode,
        R: params.resolution,
        porosity: params.targetPorosity,
        vertCount: result.vertCount,
        triCount: result.triCount,
        isoUsed: result.isoUsed,
        porosityEstimate: result.porosityEstimate,
      });
    }
    const response: WorkerResponse = {
      id,
      type: 'result',
      positions: result.positions,
      normals: result.normals,
      indices: result.indices,
      colors: result.colors,
      vertCount: result.vertCount,
      triCount: result.triCount,
      porosityEstimate: result.porosityEstimate,
      isoUsed: result.isoUsed,
      resolution: params.resolution,
      surfaceArea: result.surfaceArea,
      envelopeVolume: result.envelopeVolume,
      svRatio: result.svRatio,
      meshSolidFraction: result.meshSolidFraction,
      nmEdgeCount: result.nmEdgeCount,
      buildTimeMs: performance.now() - t0,
    };
    // Transferable 零拷贝传输
    const transferables: ArrayBuffer[] = [];
    if (response.positions) transferables.push(response.positions.buffer as ArrayBuffer);
    if (response.normals) transferables.push(response.normals.buffer as ArrayBuffer);
    if (response.indices) transferables.push(response.indices.buffer as ArrayBuffer);
    if (response.colors) transferables.push(response.colors.buffer as ArrayBuffer);
    // @ts-expect-error Worker postMessage signature mismatch in DOM typings
    self.postMessage(response, transferables);
  } catch (err) {
    const response: WorkerResponse = {
      id,
      type: 'error',
      vertCount: 0,
      triCount: 0,
      porosityEstimate: 0,
      isoUsed: 0,
      resolution: 0,
      buildTimeMs: performance.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
