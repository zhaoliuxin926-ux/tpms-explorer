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

/** A newer request superseded a request that was being awaited. */
export class WorkerRequestSupersededError extends Error {
  constructor() {
    super('Worker request superseded by a newer build');
    this.name = 'WorkerRequestSupersededError';
  }
}

/** A worker request did not produce a response within the caller deadline. */
export class WorkerRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Worker request timed out after ${timeoutMs} ms`);
    this.name = 'WorkerRequestTimeoutError';
  }
}

/** The worker reported a cancelled request. */
export class WorkerRequestCancelledError extends Error {
  constructor(message = 'Worker request cancelled') {
    super(message);
    this.name = 'WorkerRequestCancelledError';
  }
}

interface PendingRequest {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WorkerBridge {
  private worker: Worker;
  private currentId = 0;
  private onResult?: (res: WorkerResponse) => void;
  private onError?: (err: string) => void;
  private resultListeners: ((res: WorkerResponse) => void)[] = [];
  /** Promise consumers keyed by request id. Latest-frame semantics allow at most one live entry. */
  private pending = new Map<number, PendingRequest>();
  /** Prevent duplicate error/messageerror delivery for one failed worker request. */
  private runtimeFailureActive = false;

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      // 过期帧丢弃：只接受最近一次请求的回复（最新帧判定）。
      // 正常情况下旧 pending 已在 beginRequest() 中拒绝；这个分支只是
      // 防御性兜底，避免一个异常 worker 仍让 Promise 永久悬挂。
      if (res.id !== this.currentId) {
        const stale = this.pending.get(res.id);
        if (stale) this.settleReject(res.id, new WorkerRequestSupersededError());
        return;
      }

      if (res.type === 'result') {
        this.settleResolve(res.id, res);
        this.onResult?.(res);
        this.notifyResultListeners(res);
      } else if (res.type === 'error') {
        const message = res.error || 'Worker error';
        this.settleReject(res.id, new Error(message));
        this.onError?.(message);
        // Legacy listeners used by older callers must also be released on an
        // error; otherwise a failed sweep waits forever for a result that can
        // never arrive.
        this.notifyResultListeners(res);
      } else if (res.type === 'cancelled') {
        this.settleReject(res.id, new WorkerRequestCancelledError(res.error || undefined));
        this.notifyResultListeners(res);
      }
    };
    this.worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.handleRuntimeFailure(event.message || 'Worker runtime error');
    };
    this.worker.onmessageerror = (event: MessageEvent) => {
      event.preventDefault();
      this.handleRuntimeFailure('Worker response could not be deserialized');
    };
  }

  /**
   * 提交计算请求。自动使之前所有 pending 请求过期（只保留最新帧）。
   * 返回本次请求 id，便于调用方在需要时做关联。
   */
  build(params: BuildParams): number {
    const id = this.beginRequest();
    this.worker.postMessage({ id, type: 'build', params });
    return id;
  }

  /**
   * Submit a build and await its response. The Promise always settles on a
   * result, worker error, cancellation, supersession, or timeout. Existing
   * fire-and-forget callers can continue using build() unchanged.
   */
  buildAndWait(params: BuildParams, timeoutMs = 60_000): Promise<WorkerResponse> {
    const id = this.beginRequest();
    const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 60_000;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        const timeoutError = new WorkerRequestTimeoutError(deadline);
        this.settleReject(id, timeoutError);
        // A timed-out worker may still finish its synchronous computation and
        // emit a late response. Advance the generation so that response can
        // never be mistaken for a subsequent build.
        if (id === this.currentId) {
          this.currentId++;
          this.runtimeFailureActive = true;
        }
        this.notifyResultListeners({
          id,
          type: 'cancelled',
          vertCount: 0,
          triCount: 0,
          porosityEstimate: 0,
          isoUsed: 0,
          resolution: 0,
          buildTimeMs: 0,
          error: timeoutError.message,
        });
      }, deadline);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, type: 'build', params });
      } catch (err) {
        this.settleReject(id, asError(err));
      }
    });
  }

  /** The id assigned to the most recently submitted request. */
  get latestRequestId(): number {
    return this.currentId;
  }

  /**
   * Invalidate the current request before an asynchronous pre-processing step
   * (for example WebGPU field evaluation). This closes the small window in
   * which an older worker response could otherwise settle a waiting caller
   * before the replacement request is posted.
   */
  invalidate(): void {
    // Ignore runtime events emitted by the request being invalidated. The
    // next build() / buildAndWait() starts a fresh runtime-error window.
    this.runtimeFailureActive = true;
    const supersededId = this.currentId;
    this.currentId++;
    const error = new WorkerRequestSupersededError();
    for (const pendingId of this.pending.keys()) this.settleReject(pendingId, error);
    this.notifyCancelledListeners(supersededId, error.message);
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
    this.runtimeFailureActive = true;
    const terminatedId = this.currentId;
    this.currentId++;
    const error = new WorkerRequestCancelledError('Worker terminated');
    for (const id of this.pending.keys()) this.settleReject(id, error);
    this.notifyCancelledListeners(terminatedId, error.message);
    this.worker.terminate();
  }

  /** Start a request and reject any older Promise request under latest-frame semantics. */
  private beginRequest(): number {
    this.runtimeFailureActive = false;
    const id = ++this.currentId;
    const superseded = new WorkerRequestSupersededError();
    for (const pendingId of this.pending.keys()) this.settleReject(pendingId, superseded);
    this.notifyCancelledListeners(id - 1, superseded.message);
    return id;
  }

  private settleResolve(id: number, response: WorkerResponse): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  private settleReject(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  /** Drain the legacy one-shot listeners for both success and failure paths. */
  private notifyResultListeners(response: WorkerResponse): void {
    const listeners = this.resultListeners.splice(0);
    for (const listener of listeners) {
      try {
        listener(response);
      } catch {
        // Listener failures must not prevent the remaining waiters from being
        // released. The normal application listener is intentionally tiny.
      }
    }
  }

  private notifyCancelledListeners(id: number, message: string): void {
    if (this.resultListeners.length === 0) return;
    this.notifyResultListeners({
      id,
      type: 'cancelled',
      vertCount: 0,
      triCount: 0,
      porosityEstimate: 0,
      isoUsed: 0,
      resolution: 0,
      buildTimeMs: 0,
      error: message,
    });
  }

  /** Fail the active request once when the Worker itself crashes or cannot deserialize a message. */
  private handleRuntimeFailure(message: string): void {
    if (this.runtimeFailureActive) return;
    this.runtimeFailureActive = true;
    const failedId = this.currentId;
    const error = new Error(message);
    for (const id of this.pending.keys()) this.settleReject(id, error);
    // Invalidate any late response emitted after the runtime failure.
    this.currentId++;
    this.onError?.(message);
    this.notifyResultListeners({
      id: failedId,
      type: 'error',
      vertCount: 0,
      triCount: 0,
      porosityEstimate: 0,
      isoUsed: 0,
      resolution: 0,
      buildTimeMs: 0,
      error: message,
    });
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
