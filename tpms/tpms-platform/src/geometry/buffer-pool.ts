/**
 * TypedArray 缓冲池 (Buffer Pool)
 * 消除频繁 new Float32Array / Uint32Array 导致的 GC 开销。
 * 采用固定容量策略：预先分配最大可能尺寸，重建时复用同一块内存。
 */

/** 缓冲池配置 */
// 【2026-09-29 提帽 1.5M→2.2M】红队 D 定案的「R124 顶点池爆」角：顶点池按 N³ 预留，
// R124 N³=1.95M > 旧帽 1.5M → CLI 合法域 fail-closed。2.2M 覆盖产品最高档 R128
// （N³=2.15M），内存 2.2M×48B(4 缓冲×3 分量)≈106MB——仅 HD 导出踩满，交互档
// 由 surface-nets 侧 min(帽,N³) 段保证不预吃。池跨构建常驻：吃到过的容量会保持。
const MAX_VERTICES = 2_200_000;
// 【2026-09-29 提帽 9M→18M】cdd k10 R116 实测需求 9,000,003 距旧帽仅 3（fail-closed
// 抛错是既定护栏行为，但属产品域内假阴性）。18M=6M 三角（2× 余量），72MB 索引池
// 仅极端高频面+R116 档踩满；fcks R128 实测 ~2.4M 三角远低于此。
const MAX_INDICES = 18_000_000;
const MAX_FIELDS = 2_500_000;     // N³ 场值 (R128 N³=2.15M 已覆盖)

export class BufferPool {
  /** 顶点位置缓冲 */
  positions: Float32Array;
  /** 法线缓冲 */
  normals: Float32Array;
  /** 索引缓冲 */
  indices: Uint32Array;
  /** 场值缓冲 V */
  field: Float32Array;
  /** 边界场 boundArr */
  boundArr: Float32Array;
  /** 容器内排序后的 V 值（供二分 lower_bound） */
  insideV: Float32Array;
  /** Surface Nets cellVert */
  cellVert: Int32Array;
  /** Laplacian smoothing 工作数组 A */
  smoothA: Float32Array;
  /** Laplacian smoothing 工作数组 B */
  smoothB: Float32Array;

  /** 上次使用的有效长度，用于增量清零 */
  lastUsed = { field: 0, boundArr: 0, insideV: 0, cellVert: 0, positions: 0, indices: 0, smoothA: 0, smoothB: 0 };

  constructor() {
    // 全部按需扩容：R48 预览不必预吃 顶点池 72MB + 场缓冲 40MB。
    // 提取开始前 ensureVerts/ensureFields/ensureIndices 一次到位，
    // 之后 pushTri 等持有局部引用不再中途扩容。
    this.positions = new Float32Array(0);
    this.normals = new Float32Array(0);
    this.indices = new Uint32Array(0);
    this.field = new Float32Array(0);
    this.boundArr = new Float32Array(0);
    this.insideV = new Float32Array(0);
    this.cellVert = new Int32Array(0);
    this.smoothA = new Float32Array(0);
    this.smoothB = new Float32Array(0);
  }

  /** 场类缓冲按需扩容到至少 n 采样点（幂等；仅 buildSurface 开头调用） */
  ensureFields(n: number): void {
    if (this.field.length >= n) return;
    const cap = Math.min(MAX_FIELDS, Math.max(n, 1 << 16));
    this.field = new Float32Array(cap);
    this.boundArr = new Float32Array(cap);
    this.insideV = new Float32Array(cap);
    this.cellVert = new Int32Array(cap);
  }

  /** 顶点类缓冲扩容到至少 n 顶点（positions/normals/smoothA/B 同步） */
  ensureVerts(n: number): void {
    if (this.positions.length >= n * 3) return;
    const cap = Math.min(MAX_VERTICES, Math.max(n, 1 << 12));
    this.positions = new Float32Array(cap * 3);
    this.normals = new Float32Array(cap * 3);
    this.smoothA = new Float32Array(cap * 3);
    this.smoothB = new Float32Array(cap * 3);
  }

  /** 索引池扩容到至少 n 索引 */
  ensureIndices(n: number): void {
    if (this.indices.length >= n) return;
    const cap = Math.min(MAX_INDICES, Math.max(n, 1 << 14));
    this.indices = new Uint32Array(cap);
  }

  /**
   * 增量清零：只清零上次使用的部分，避免对整个 1.5M 顶点缓冲做 fill(0)
   */
  reset(): void {
    // 只清零上次实际使用的范围（比 fill 全量清零快 ~10x）
    if (this.lastUsed.cellVert > 0) this.cellVert.fill(-1, 0, this.lastUsed.cellVert);
    // 其余字段按需清零（surface-nets 中会用 subarray 覆盖写入，无需预清零）
    this.lastUsed = { field: 0, boundArr: 0, insideV: 0, cellVert: 0, positions: 0, indices: 0, smoothA: 0, smoothB: 0 };
  }
}

/** 全局单例缓冲池 */
export const globalBufferPool = new BufferPool();