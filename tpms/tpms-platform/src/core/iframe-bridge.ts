/**
 * iframe-bridge.ts — 双壳 postMessage 桥（2026-11-11 方向 B1）
 *
 * 拓扑：harness.html（主壳）内嵌 index.html（工程壳）iframe，同源同部署。
 * 协议：请求-回执（id 配对），消息形 { __tpmsBridge: true, type, id, payload }。
 *
 * 安全与治理（回应设计自查题——哪一面缺失会让 E5 预算在双壳间被绕过）：
 *   1. 服务端（工程壳）仅在**被嵌入**（window.parent !== window）且
 *      **同源**（event.origin === location.origin）时开桥——跨源/独立打开零暴露；
 *   2. **重活滑动窗 cap**：apply(periods³)/verify(512) 计入 60s 滚动窗口
 *      Σ ≤ 4096——绕过 harness 侧 Per-Prompt Run 预算直发 postMessage 的通道
 *      在执行面被独立拦截（执行面自守，不信任调用方预算）；
 *   3. 回执只发给请求方 source，不广播。
 *
 * harness 侧工具经桥驱动工程壳内**同一套** agentMeshExec/agentVerifyExec
 * （src/main.ts 的 buildAgentTools 同源执行体）——双壳工具行为单源。
 */

export const BRIDGE = {
  MARK: '__tpmsBridge',
  /** 重活滑动窗（对齐 E5 预算口径） */
  CAP_BUDGET: 4096,
  CAP_WINDOW_MS: 60_000,
  /** 单请求默认超时（verify 体素审计 + 重建在内） */
  REQ_TIMEOUT_MS: 180_000,
} as const;

export type BridgeRequest = { type: 'apply' | 'verify' | 'get-state'; payload?: unknown };

/** 工程壳侧桥服务端：wireHarnessBridge 传入各 type 的执行体 */
export function serveBridge(handlers: {
  apply: (args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; verifyFail?: boolean; heavy?: number }>;
  verify: (args: Record<string, unknown>) => Promise<{ ok: boolean; summary: string; verifyFail?: boolean; heavy?: number }>;
  'get-state': () => { ok: boolean; summary: string };
}): void {
  const heavyLog: Array<{ t: number; c: number }> = [];
  window.addEventListener('message', (e: MessageEvent) => {
    if (window.parent === window) return;                 // 未被嵌入不开桥
    if (e.origin !== location.origin || !e.source) return; // 同源唯一
    const d = e.data as { __tpmsBridge?: boolean; type?: string; id?: number; payload?: unknown } | null;
    if (!d || d.__tpmsBridge !== true || typeof d.type !== 'string' || typeof d.id !== 'number') return;
    const reply = (ok: boolean, payload: unknown) => {
      (e.source as Window).postMessage({ __tpmsBridge: true, id: d.id, ok, payload }, e.origin);
    };
    void (async () => {
      try {
        if (d.type === 'get-state') { reply(true, handlers['get-state']()); return; }
        const args = (d.payload ?? {}) as Record<string, unknown>;
        const fn = d.type === 'apply' ? handlers.apply : d.type === 'verify' ? handlers.verify : null;
        if (!fn) { reply(false, `未知桥类型 ${d.type}`); return; }
        // 重活滑动窗 cap（执行面自守）
        const cost = d.type === 'verify' ? 512 : Math.pow(Number(args.periods ?? 3), 3);
        const now = Date.now();
        while (heavyLog.length && now - heavyLog[0].t > BRIDGE.CAP_WINDOW_MS) heavyLog.shift();
        const used = heavyLog.reduce((s, x) => s + x.c, 0);
        if (used + cost > BRIDGE.CAP_BUDGET) {
          reply(false, `桥预算窗口超限（Σ=${used}+${cost} > ${BRIDGE.CAP_BUDGET}/${BRIDGE.CAP_WINDOW_MS / 1000}s，E5 执行面自守）`);
          return;
        }
        heavyLog.push({ t: now, c: cost });
        const res = await fn(args);
        reply(true, res);
      } catch (err) {
        reply(false, `桥执行异常：${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });
}

/** harness 侧桥客户端 */
export class BridgeClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private frame: () => HTMLIFrameElement | null;
  constructor(frame: () => HTMLIFrameElement | null) { this.frame = frame; }

  attach(): void {
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const src = this.frame()?.contentWindow;
      if (!src || e.source !== src) return;
      const d = e.data as { __tpmsBridge?: boolean; id?: number; ok?: boolean; payload?: unknown } | null;
      if (!d || d.__tpmsBridge !== true || typeof d.id !== 'number') return;
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      if (d.ok) p.resolve(d.payload);
      else p.reject(new Error(String(d.payload ?? '桥请求失败')));
    });
  }

  request(type: BridgeRequest['type'], payload?: unknown, timeoutMs: number = BRIDGE.REQ_TIMEOUT_MS): Promise<{ ok: boolean; summary: string; verifyFail?: boolean }> {
    const frame = this.frame();
    const win = frame?.contentWindow;
    if (!win) return Promise.resolve({ ok: false, summary: '画布坞 iframe 未就绪' });
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => { this.pending.delete(id); reject(new Error(`桥请求 ${type} 超时（${timeoutMs / 1000}s）`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { window.clearTimeout(t); resolve(v as { ok: boolean; summary: string }); }, reject: (e) => { window.clearTimeout(t); reject(e); } });
      win.postMessage({ __tpmsBridge: true, type, id, payload }, location.origin);
    });
  }
}
