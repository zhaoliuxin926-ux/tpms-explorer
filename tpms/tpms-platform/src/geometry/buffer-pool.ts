/**
 * TypedArray 缓冲池 (Buffer Pool)
 * 消除频繁 new Float32Array / Uint32Array 导致的 GC 开销。
 * 采用固定容量策略：预先分配最大可能尺寸，重建时复用同一块内存。
 */

/** 缓冲池配置 */
const MAX_VERTICES = 1_500_000;   // R=88 时约 ~120 万顶点，留 25% 余量
// 【2026-09-10 扩容 6M→9M】R128 档位扩容轮（C2 第二批）只扩了场缓冲，漏了索引池：
// fcks（表面积最大族）R119+ 需 6.17M 索引 > 6M，pushTri OOB 写静默截断后
// 边键数组 OOB 读 undefined → NaN 键 → NaN!==NaN 分组死循环
// （曾误登记为「fcks R128 单次构建 >36 分钟本质成本」，实为无限循环）。
// 9M 覆盖 3M 三角（fcks R128 实测 ~2.4M 三角），并在 pushTri 侧加显式容量守卫兜底。
const MAX_INDICES = 9_000_000;
const MAX_FIELDS = 2_500_000;     // N³ 场值 (89³ ≈ 704K)

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