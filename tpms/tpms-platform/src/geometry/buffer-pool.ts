/**
 * TypedArray 缓冲池 (Buffer Pool)
 * 消除频繁 new Float32Array / Uint32Array 导致的 GC 开销。
 * 采用固定容量策略：预先分配最大可能尺寸，重建时复用同一块内存。
 */

/** 缓冲池配置 */
const MAX_VERTICES = 1_500_000;   // R=88 时约 ~120 万顶点，留 25% 余量
const MAX_INDICES = 6_000_000;    // 每个顶点约 4-5 个三角面索引
const MAX_FIELDS = 1_000_000;     // N³ 场值 (89³ ≈ 704K)

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
    this.positions = new Float32Array(MAX_VERTICES * 3);
    this.normals = new Float32Array(MAX_VERTICES * 3);
    this.indices = new Uint32Array(MAX_INDICES);
    this.field = new Float32Array(MAX_FIELDS);
    this.boundArr = new Float32Array(MAX_FIELDS);
    this.insideV = new Float32Array(MAX_FIELDS);
    this.cellVert = new Int32Array(MAX_FIELDS);
    this.smoothA = new Float32Array(MAX_VERTICES * 3);
    this.smoothB = new Float32Array(MAX_VERTICES * 3);
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