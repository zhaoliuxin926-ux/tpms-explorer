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

/** 进程内 iso* 记忆化：同 (f,target,W,grad) 在 UI 反复重建/导出时不再重跑 2M 次 MC */
const isoMemo = new Map<string, { iso: number; slope: number; band: [number, number]; clamped: boolean }>();
const ISO_MEMO_MAX = 64;

// 【2026-09-29 结构性防呆（红队 D footgun 收口）】key 强制掺函数实例身份：旧 key 只含
// cacheTag，跨族隔离完全依赖调用方传对 tag（现调用方已掺 type 无实害，但属约定而非
// 结构保证）。fnId 经 WeakMap 发号：内置族查表返回稳定引用 → 缓存行为不变；
// custom+dyn 闭包每次新建 → 退化为 miss（仅损失缓存，不损正确性）。
const fnIds = new WeakMap<TpmsFn, number>();
let fnIdNext = 1;
const fnId = (f: TpmsFn): number => {
  let id = fnIds.get(f);
  if (id === undefined) { id = fnIdNext++; fnIds.set(f, id); }
  return id;
};

/**
 * 族场值域估计：确定性粗网格采样（24³，域 [-π,π]³ 格心）→ [minV, maxV]，两侧外扩
 * pad（≥0.25 或 5% 值域宽）防格点间极值低估。供 exact 求根域自适应用。
 *
 * 【2026-10-02 对抗审查 C1】此前二分域硬编码 ±1.6，对场值域远超 ±1.6 的族
 * （neovius ±13、fcks ±5 等 11/24 族）可达孔隙率带被静默截断——dg 目标 85%
 * 实测 51.5% 仍 exit0 交付。改为按族场值域自适应后可达带=全域 [0,1]。
 */
export function fieldRange(
  f: TpmsFn,
  W: number[] | readonly number[] = [1, 1, 1, 1],
): { lo: number; hi: number } {
  let minV = Infinity;
  let maxV = -Infinity;
  const N = 24;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const v = f(
          -Math.PI + (2 * Math.PI * (i + 0.5)) / N,
          -Math.PI + (2 * Math.PI * (j + 0.5)) / N,
          -Math.PI + (2 * Math.PI * (k + 0.5)) / N,
          W,
        );
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  const pad = Math.max(0.25, (maxV - minV) * 0.05);
  return { lo: minV - pad, hi: maxV + pad };
}

/** 解析求根 iso* + 数值斜率 d(por)/d(iso)（供网格割线校正）。 */
export function solveIsoAnalytic(
  f: TpmsFn,
  target: number,
  W: number[] | readonly number[] = [1, 1, 1, 1],
  isoGrad?: IsoGradStops | null,
  cacheTag = '',
): { iso: number; slope: number; band: [number, number]; clamped: boolean } {
  // key = 函数身份 + cacheTag + target + W + grad：调用方忘掺 type 也不会跨族串 iso
  const key = `${fnId(f)}|${cacheTag}|${target.toFixed(8)}|${[...W].join(',')}|${isoGrad ? JSON.stringify(isoGrad.stops) : ''}`;
  const hit = isoMemo.get(key);
  if (hit) return hit;
  resetPorosityRng();
  const MC_BISECT_N = 60_000;
  const { lo: domLo, hi: domHi } = fieldRange(f, W);
  // isoGrad 在场时有效阈值为 iso+off(pz)（off ∈ ±1.5）——band 两侧外扩 max|off|，
  // 否则极端渐变 + target 近 0/1 时可达带被低估（复审 M-3）
  const gradPad = isoGrad ? Math.max(...isoGrad.stops.map((s) => Math.abs(s[1]))) : 0;
  let lo = domLo - gradPad;
  let hi = domHi + gradPad;
  for (let it = 0; it < 34; it++) {
    const mid = (lo + hi) / 2;
    if (porAnalytic(f, mid, W, MC_BISECT_N, isoGrad) > target) lo = mid;
    else hi = mid;
  }
  const iso = (lo + hi) / 2;
  // 卡界检测：目标落在可达带边缘（自适应全域下仅 target≈0/1 时可达）——供调用方披露
  const clamped = iso - lo < 1e-3 || hi - iso < 1e-3;
  const d = 0.02;
  const slope =
    (porAnalytic(f, iso + d, W, 40_000, isoGrad) - porAnalytic(f, iso - d, W, 40_000, isoGrad)) / (2 * d);
  const result = { iso, slope, band: [lo, hi] as [number, number], clamped };
  if (isoMemo.size >= ISO_MEMO_MAX) {
    const oldest = isoMemo.keys().next().value;
    if (oldest !== undefined) isoMemo.delete(oldest);
  }
  isoMemo.set(key, result);
  return result;
}

/**
 * 网格割线校正：buildOnce(iso) → 实测 → 斜率一步；变差则回退。
 * 调用方负责在最终 iso 上再 build 一次（或复用 improved 结果）。
 */
export function secantCorrectPorosity(
  f: TpmsFn,
  target: number,
  initialIso: number,
  slope: number,
  buildOnce: (iso: number) => { porosityEstimate: number },
  W: number[] | readonly number[] = [1, 1, 1, 1],
): { iso: number; porosityEstimate: number; improved: boolean; trace: { iso: number; est: number }[] } {
  resetPorosityRng();
  let cur = initialIso;
  const res = buildOnce(cur);
  let est = res.porosityEstimate;
  const trace = [{ iso: cur, est }];
  if (Math.abs(est - target) > 0.005 && Number.isFinite(slope) && Math.abs(slope) > 1e-6) {
    // 钳制域与求根域同源（C1：按族场值域而非硬编码 ±1.6）
    const { lo: bLo, hi: bHi } = fieldRange(f, W);
    let next = cur + (target - est) / slope;
    next = Math.max(bLo, Math.min(bHi, next - cur > 0.35 ? cur + 0.35 : next < cur - 0.35 ? cur - 0.35 : next));
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
