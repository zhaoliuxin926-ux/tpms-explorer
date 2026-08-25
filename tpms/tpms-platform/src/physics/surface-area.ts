/**
 * 物理尺寸缩放后的表面积、包围体积与比表面积计算
 *
 * Surface Nets 输出的顶点坐标实际范围为 [-π, π]（wc 空间，半幅 = π），
 * 而非 [-1, 1]。
 * 设计意图：假设 1 period = 1 mm，即把 wc 半幅 π 映射到物理半幅 cellSize/2 mm。
 * 因此坐标到 mm 的缩放因子为 cellSize / (2 * Math.PI)，：
 *   面积缩放 = (cellSize / (2 * Math.PI))²
 *   体积缩放 = (cellSize / (2 * Math.PI))³
 */
import {
  computeSurfaceArea as rawComputeSurfaceArea,
} from '../geometry/mesh-utils';
import { wcToMmFactor } from '../core/units';

/**
 * 计算物理缩放后的总表面积。
 * @param positions 顶点坐标数组（Surface Nets 输出的 [-π, π] wc 空间）
 * @param indices   三角面索引数组
 * @param cellSize  单元数量（periods），决定物理总尺寸 mm
 * @returns         总面积（mm²）
 */
export function computeSurfaceArea(positions: Float32Array, indices: Uint32Array, cellSize: number): number {
  const rawArea = rawComputeSurfaceArea(positions, indices);
  const scale = wcToMmFactor(cellSize);
  return rawArea * scale * scale;
}

/**
 * 计算理论包络体积（容器体积），而非网格固体体积。
 * @param cellSize       单元数量（periods），决定物理总尺寸 mm
 * @param containerShape 容器形状：'cube' | 'cylinder'
 * @returns              包络体积（mm³）
 */
export function computeEnvelopeVolume(cellSize: number, containerShape: string): number {
  if (containerShape === 'cylinder') {
    return (Math.PI * Math.pow(cellSize, 3)) / 4;
  }
  return Math.pow(cellSize, 3);
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
