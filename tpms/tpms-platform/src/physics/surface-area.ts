/**
 * 物理尺寸缩放后的表面积、包围体积与比表面积计算
 *
 * Surface Nets 输出的顶点坐标实际范围为 [-π, π]（wc 空间，半幅 = π），
 * 而非 [-1, 1]。
 * 设计意图（legacy）：1 period = 1 mm，即把 wc 半幅 π 映射到物理半幅 cellSize/2 mm。
 * 因此坐标到 mm 的缩放因子为 cellSize / (2 * Math.PI)：
 *   面积缩放 = 因子²
 *   体积缩放 = 因子³
 * 批六（2026-10-25 UI 独立尺寸）：因子由调用方显式传入（effectiveMmFactor——
 * 显式总宽优先，legacy 回落），本模块不再自行从 cellSize 推导。
 */
import {
  computeSurfaceArea as rawComputeSurfaceArea,
} from '../geometry/mesh-utils';

/**
 * 计算物理缩放后的总表面积。
 * @param positions 顶点坐标数组（Surface Nets 输出的 [-π, π] wc 空间）
 * @param indices   三角面索引数组
 * @param mmPerWc   wc→mm 缩放因子（effectiveMmFactor 产出；总宽=2π·因子）
 * @returns         总面积（mm²）
 */
export function computeSurfaceArea(positions: Float32Array, indices: Uint32Array, mmPerWc: number): number {
  const rawArea = rawComputeSurfaceArea(positions, indices);
  return rawArea * mmPerWc * mmPerWc;
}

/**
 * 计算理论包络体积（容器体积），而非网格固体体积。
 * @param mmPerWc        wc→mm 缩放因子（总宽 mm = 2π·因子）
 * @param containerShape 容器形状：'cube' | 'cylinder'
 * @returns              包络体积（mm³）
 */
export function computeEnvelopeVolume(mmPerWc: number, containerShape: string): number {
  const widthMm = 2 * Math.PI * mmPerWc;
  if (containerShape === 'cylinder') {
    return (Math.PI * Math.pow(widthMm, 3)) / 4;
  }
  return Math.pow(widthMm, 3);
}

/**
 * 计算比表面积 Sv = A / V（使用物理缩放后的面积与理论包络体积）。
 * @param surfaceArea    物理表面积（mm²）
 * @param envelopeVolume 物理包络体积（mm³）
 * @returns              比表面积（mm⁻¹）
 */
export function computeSvRatio(surfaceArea: number, envelopeVolume: number): number {
  return envelopeVolume > 0 ? surfaceArea / envelopeVolume : 0;
}
