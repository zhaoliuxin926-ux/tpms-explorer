/**
 * meshcont-worker.ts —— C5 mesh 容器 SDF 计算 Worker（v9.0 待命边界激活 · B+ 协议 v2）
 *
 * 主线程曾同步执行 computeMeshSDF（61s@12288 三角 N=65），大体量解剖 STL 上传时
 * UI 分钟级冻结。本 Worker 承接上传路径的 HD 档预热计算，Transferable 零拷贝回传。
 *
 * 协议 v2（B+ 专项 2026-09-13）：
 *   请求：postMessage({ ab: ArrayBuffer, n: number, id: number })
 *   进度：{ ok: true, id, progress: (k+1)/n }（每 z 切片一报，最终消息前多次）
 *   成功：{ ok: true, id, sdf, domain, check, volumePhys }（sdf transfer）
 *   失败：{ ok: false, id, error: string }（非水密等 fail-closed 结构化拒绝）
 * 消费方按 progress 字段区分进度与最终消息（最终消息无 progress 字段）。
 */
import { computeMeshSDF } from '../geometry/mesh-container';

self.onmessage = (ev: MessageEvent) => {
  const { ab, n, id } = ev.data as { ab: ArrayBuffer; n: number; id: number };
  try {
    const r = computeMeshSDF(ab, n, (frac) => {
      (self as unknown as Worker).postMessage({ ok: true, id, progress: frac });
    });
    (self as unknown as Worker).postMessage(
      { ok: true, id, sdf: r.sdf, domain: r.domain, check: r.check, volumePhys: r.volumePhys },
      [r.sdf.buffer],
    );
  } catch (e) {
    (self as unknown as Worker).postMessage({
      ok: false, id, error: e instanceof Error ? e.message : String(e),
    });
  }
};
