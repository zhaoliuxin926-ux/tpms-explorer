/**
 * 孔隙率解析求解（A2 exact 路径，与 CLI tpms.mjs 同源数学）。
 *
 * 方法对标 RegionTPMS：在解析曲面 MC 积分求 iso*，使解析孔隙率=目标；
 * 网格实测割线校正由调用方在 build 之后做（补偿 surface-nets 体积损耗）。
 * 确定性：固定种子 LCG，同参数 iso* 逐位一致。
 *
 * 口径：porAnalytic 仅 solid_network（f < bias）。shell/gradient_shell 仍走
 * surface-nets 体素分位二分（与历史 UI 一致）；CLI exact 对 shell 也用本公式，
 * 属近似——两边 shell 路径均不宣称 exact。
 */

let _lcg = 0x9e3779b9;

/** 重置确定性 LCG（每次求解前调用） */
export function resetPorosityRng(): void {
  _lcg = 0x9e3779b9;
}

function rnd(): number {
  _lcg = (_lcg * 1664525 + 1013904223) >>> 0;
  return _lcg / 4294967296;
}

export interface IsoGradStops {
  dir: 'z';
  stops: [number, number][];
}

type TpmsFn = (x: number, y: number, z: number, w: number[] | readonly number[]) => number;

/**
 * 解析孔隙率（solid_network：f < iso 的体积份额的补）。
 * isoGrad 可选：z 向分段线性 bias，与 surface-nets biasAt 同语义。
 */
export function porAnalytic(
  f: TpmsFn,
  iso: number,
  W: number[] | readonly number[] = [1, 1, 1, 1],
  N = 200_000,
  isoGrad?: IsoGradStops | null,
): number {
  let biasAt: (px: number, py: number, pz: number) => number = () => iso;
  if (isoGrad) {
    const stops = isoGrad.stops;
    biasAt = (_px, _py, pz) => {
      let off: number;
      if (pz <= stops[0][0]) off = stops[0][1];
      else if (pz >= stops[stops.length - 1][0]) off = stops[stops.length - 1][1];
      else {
        let i = 0;
        while (i < stops.length - 2 && pz > stops[i + 1][0]) i++;
        const [x0, y0] = stops[i];
        const [x1, y1] = stops[i + 1];
        off = y0 + ((y1 - y0) * (pz - x0)) / (x1 - x0);
      }
      return iso + off;
    };
  }
  let solid = 0;
  for (let i = 0; i < N; i++) {
    const px = (rnd() * 2 - 1) * Math.PI;
    const py = (rnd() * 2 - 1) * Math.PI;
    const pz = (rnd() * 2 - 1) * Math.PI;
    if (f(px, py, pz, W) < biasAt(px / Math.PI, py / Math.PI, pz / Math.PI)) solid++;
  }
  return 1 - solid / N;
}

/** 解析求根 iso* + 数值斜率 d(por)/d(iso)（供网格割线校正）。 */
export function solveIsoAnalytic(
  f: TpmsFn,
  target: number,
  W: number[] | readonly number[] = [1, 1, 1, 1],
  isoGrad?: IsoGradStops | null,
): { iso: number; slope: number } {
  resetPorosityRng();
  const MC_BISECT_N = 60_000;
  let lo = -1.6;
  let hi = 1.6;
  for (let it = 0; it < 34; it++) {
    const mid = (lo + hi) / 2;
    if (porAnalytic(f, mid, W, MC_BISECT_N, isoGrad) > target) lo = mid;
    else hi = mid;
  }
  const iso = (lo + hi) / 2;
  const d = 0.02;
  const slope =
    (porAnalytic(f, iso + d, W, 40_000, isoGrad) - porAnalytic(f, iso - d, W, 40_000, isoGrad)) / (2 * d);
  return { iso, slope };
}

/**
 * 网格割线校正：buildOnce(iso) → 实测 → 斜率一步；变差则回退。
 * 调用方负责在最终 iso 上再 build 一次（或复用 improved 结果）。
 */
export function secantCorrectPorosity(
  _f: TpmsFn,
  target: number,
  initialIso: number,
  slope: number,
  buildOnce: (iso: number) => { porosityEstimate: number },
  _W: number[] | readonly number[] = [1, 1, 1, 1],
): { iso: number; porosityEstimate: number; improved: boolean; trace: { iso: number; est: number }[] } {
  resetPorosityRng();
  let cur = initialIso;
  const res = buildOnce(cur);
  let est = res.porosityEstimate;
  const trace = [{ iso: cur, est }];
  if (Math.abs(est - target) > 0.005 && Number.isFinite(slope) && Math.abs(slope) > 1e-6) {
    let next = cur + (target - est) / slope;
    next = Math.max(-1.6, Math.min(1.6, next - cur > 0.35 ? cur + 0.35 : next < cur - 0.35 ? cur - 0.35 : next));
    const res2 = buildOnce(next);
    if (Math.abs(res2.porosityEstimate - target) < Math.abs(est - target)) {
      est = res2.porosityEstimate;
      trace.push({ iso: next, est });
      cur = next;
      return { iso: cur, porosityEstimate: est, improved: true, trace };
    }
  }
  return { iso: cur, porosityEstimate: est, improved: false, trace };
}
