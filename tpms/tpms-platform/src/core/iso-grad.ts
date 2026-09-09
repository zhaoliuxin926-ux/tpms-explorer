/**
 * C1 渐变等值场共享语义（CLI 与 UI 单一来源）
 * 分段线性 iso 偏移折线：零面连续 ⇒ 水密性天然保持（surface-nets biasAt 逐点消费）。
 */

export interface IsoGradSpec {
  dir: 'x' | 'y' | 'z';
  /** [phys 坐标(-1..1), iso 偏移] 折线点，坐标严格升序；端点外由消费方钳制 */
  stops: [number, number][];
}

/** n 平台等距中心 + 过渡带 half=band/2 线性过渡（z 域 [-1,1]）。
 *  例 values=[-0.1,0,0.1] band=0.4 → 平台 a0（z∈[-1,-0.2]）→ 过渡 → 平台 a1 → 过渡 → 平台 a2。
 *  折线点恒升序（边界钳制产生的相邻等值点无插值区间，无除零风险）。 */
export function gradStops(values: number[], band: number): [number, number][] {
  const n = values.length;
  const half = Math.max(0, Math.min(band / 2, 1 / (n - 1)));
  const stops: [number, number][] = [[-1, values[0]]];
  for (let i = 1; i < n; i++) {
    const c = -1 + (2 * i) / (n - 1);
    const lo = Math.max(-1, c - half), hi = Math.min(1, c + half);
    if (lo > stops[stops.length - 1][0]) stops.push([lo, values[i - 1]]);
    if (hi > stops[stops.length - 1][0]) stops.push([hi, values[i]]);
  }
  if (1 > stops[stops.length - 1][0]) stops.push([1, values[n - 1]]);
  return stops;
}

/** UI 三平台语义：底部偏移（偏实）/ 基准 0（目标孔隙率）/ 顶部偏移（偏疏）+ 过渡带 */
export function makeZGrad(bottom: number, top: number, band: number): IsoGradSpec {
  return { dir: 'z', stops: gradStops([bottom, 0, top], band) };
}
