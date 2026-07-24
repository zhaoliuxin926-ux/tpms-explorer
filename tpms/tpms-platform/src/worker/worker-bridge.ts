/**
 * Worker 通信桥
 *
 * 取消语义说明：Surface Nets 在 Worker 内是同步 CPU 密集计算，
 * 无法被外部"中途打断"。因此本桥采用"最新帧判定"——只接受
 * 最近一次 build() 的结果，更早的过期帧（快速拖动滑块产生的
 * 中间计算结果）直接丢弃，不触发回调、不应用几何。这等价于
 * 真正的"取消上一次计算"，且避免旧帧几何被逐个渲染造成的抖动。
 */
import type { BuildParams, WorkerResponse } from '../types';

export class WorkerBridge {
  private worker: Worker;
  private currentId = 0;
  private onResult?: (res: WorkerResponse) => void;
  private onError?: (err: string) => void;
  private resultListeners: ((res: WorkerResponse) => void)[] = [];

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      // 过期帧丢弃：只接受最近一次请求的回复（最新帧判定）
      if (res.id !== this.currentId) return;
      if (res.type === 'result') {
        this.onResult?.(res);
        // 通知一次性监听器并清空（防止 sweep 等场景内存泄漏）
        const listeners = this.resultListeners.splice(0);
        for (const listener of listeners) listener(res);
      } else if (res.type === 'error') {
        this.onError?.(res.error || 'Worker error');
      }
    };
  }

  /**
   * 提交计算请求。自动使之前所有 pending 请求过期（只保留最新帧）。
   * 返回本次请求 id，便于调用方在需要时做关联。
   */
  build(params: BuildParams): number {
    const id = ++this.currentId;
    this.worker.postMessage({ id, type: 'build', params });
    return id;
  }

  setCallbacks(onResult: (res: WorkerResponse) => void, onError: (err: string) => void): void {
    this.onResult = onResult;
    this.onError = onError;
  }

  /** 添加一次性结果监听器 */
  addResultListener(listener: (res: WorkerResponse) => void): void {
    this.resultListeners.push(listener);
  }

  /** 移除结果监听器 */
  removeResultListener(listener: (res: WorkerResponse) => void): void {
    const idx = this.resultListeners.indexOf(listener);
    if (idx >= 0) this.resultListeners.splice(idx, 1);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
