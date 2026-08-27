/**
 * 全工程唯一的物理单位换算源（ SCALE 统一，2026-07-26 P2-2）。
 *
 * 关键事实：Surface Nets 输出的顶点坐标域恒为 wc ∈ [-π, π]。
 * 周期数 k（state.cellSize，1~5）不扩展坐标域，而是通过频率 sin(k·x) 编码。
 *
 * 物理约定：1 period = 1 mm，即 k 个周期的模型总宽 = k mm。
 * 因此 wc → mm 的缩放因子 = cellSize / (2π)：
 *   总宽 wc 跨度 2π × cellSize/(2π) = cellSize mm ✓
 *
 * 渲染/测量/导出（STL/VTK/物理指标）必须引用本模块，禁止再手写 0.33 或
 * cellSize/(2π) 字面量，防止两套比例尺漂移（历史上 caliper 用 ÷0.33 把
 * 弧度值当 mm、metrics 用 cellSize/(2π)，跨面板读数不可比）。
 */

/** wc → 屏幕显示空间的视觉缩放（与 main.ts 中 mesh.scale 保持一致） */
export const DISPLAY_SCALE = 0.33;

/**
 * wc 坐标 → 物理毫米的换算因子。
 * @param cellSize 周期数（state.cellSize）
 * @returns 每单位 wc 对应的毫米数
 */
export function wcToMmFactor(cellSize: number): number {
  return cellSize / (2 * Math.PI);
}

/**
 * 网格分辨率的「每周期格数」系数。
 * I-WP / F-RD / Neovius 的公式含 cos(2kx) 与 cos³ 积项，特征空间频率高于
 * 基频曲面（谐波至 2k~3k）；相同 R 下每特征周期的格数减少，弦切离散误差
 * 显著放大（IWP@R61 实测 −17%、Neovius −7%）。因此这三类曲面的分辨率
 * 密度加倍补偿。分辨率全局上限 96（BufferPool 容量 N³≤1M ⇒ R≤99，留余量）。
 */
export function resolutionPerPeriod(type: string, structureMode?: string, gradientDir?: string): number {
  if (type === 'iwp' || type === 'frd' || type === 'neovius') return 28;
  // 梯度壳非 z 向：壁厚尺度 [0.1,1.5]·t 全程变化，亚格化区域大（raw 实测 −10.6%），密度加倍补偿
  if (structureMode === 'gradient_shell' && gradientDir && gradientDir !== 'z') return 28;
  return 14;
}
