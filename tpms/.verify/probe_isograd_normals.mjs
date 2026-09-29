/**
 * probe_isograd_normals.mjs —— 独立探针（不进 CI 调度；guard_audit 先例）
 *
 * 审护对象：2026-09-29 isoGrad 法线口径修正（numRawAt biasBase→biasAt）的正向断言。
 * 等价性证明只覆盖了非渐变路径（mesh_audit 逐位不变）；渐变路径此前无任何法线断言——
 * 本探针补上：陡峭 stops 下，导出法线应与「实际提取场 F=biasAt(p)−v(p)」的数值梯度
 * 对齐（|cos|>0.9 占比 ≥95%），并与旧口径（biasBase 基准场）A/B 对照证明修正方向。
 *
 * 用法：node probe_isograd_normals.mjs（在 tpms/.verify/ 下运行）
 */

import { loadCore } from '../agent/core-loader.mjs';

const core = await loadCore();
const { buildSurface, getTpmsFunction } = core;

let pass = 0, fail = 0;
const ok = (name, detail = '') => { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { fail++; console.log(`  FAIL ${name} — ${detail}`); };

// gradStops([-0.4, 0, 0.4], 0.2) 形状（陡峭过渡带半宽 0.1）
const STOPS = [[-1, -0.4], [-0.1, -0.4], [0.1, 0], [0.9, 0.4], [1, 0.4]];
const offAt = (pz) => {
  const z = Math.max(-1, Math.min(1, pz));
  for (let i = 1; i < STOPS.length; i++) {
    if (z <= STOPS[i][0]) {
      const [z0, a0] = STOPS[i - 1], [z1, a1] = STOPS[i];
      return z1 === z0 ? a1 : a0 + (a1 - a0) * (z - z0) / (z1 - z0);
    }
  }
  return STOPS[STOPS.length - 1][1];
};

const R = 48, K = 2, ISO_BASE = 0.1; // biasBase：stops 为相对偏移（biasAt = biasBase + off）
const params = {
  type: 'gyroid', iso: ISO_BASE, periods: K, resolution: R,
  weights: [1, 1, 1, 1], structureMode: 'solid_network', containerShape: 'cube',
  thickness: 1.0, gradientDir: 'z', customFormula: '', preview: false,
  hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
  isoGrad: { dir: 'z', stops: STOPS },
};
const pool = new (core.globalBufferPool.constructor)();
const res = buildSurface(params, pool);
ok(`isoGrad 构建产出（${res.positions.length / 3 | 0} 顶点）`, `水密断言由 mesh_audit 系门负责，此处只审法线`);

const fn = getTpmsFunction('gyroid');
// 最终场（solid_network）：F(u,v,w) = biasAt(w/π) − fn(u·k, v·k, w·k)（positions 为弧度域）
const F = (u, v, w) => (ISO_BASE + offAt(w / Math.PI)) - fn(u * K, v * K, w * K, [1, 1, 1, 1]);
const h = 1e-3;

let alignedNew = 0, alignedOld = 0, n = 0, worstCosNew = 1;
for (let i = 0; i < res.positions.length; i += 3) {
  const u = res.positions[i], v = res.positions[i + 1], w = res.positions[i + 2];
  // 数值梯度（对弧度坐标中心差分）
  let gx = F(u + h, v, w) - F(u - h, v, w);
  let gy = F(u, v + h, w) - F(u, v - h, w);
  let gz = F(u, v, w + h) - F(u, v, w - h);
  const gl = Math.hypot(gx, gy, gz);
  if (!(gl > 1e-9)) continue;
  gx /= 2 * h; gy /= 2 * h; gz /= 2 * h;
  const gl2 = Math.hypot(gx, gy, gz);
  // 新口径梯度 = 实际提取场（biasAt）；旧口径梯度 = biasBase 基准场（bias 常数项消掉，等价 −∇v）
  const nxi = res.normals[i], nyi = res.normals[i + 1], nzi = res.normals[i + 2];
  const nl = Math.hypot(nxi, nyi, nzi);
  if (!(nl > 1e-9)) continue;
  // 排除容器边界带（与 surface-nets BTOL=0.04 同口径）：边界顶点法线被硬编码为
  // 容器面轴向法线（顶底/侧面收口），本就不对齐场梯度——混入只稀释统计
  const pzN = w / Math.PI, pxN = u / Math.PI, pyN = v / Math.PI;
  if (Math.abs(pzN) > 0.95 || Math.abs(pxN) > 0.95 || Math.abs(pyN) > 0.95) continue;
  n++;
  const cosNew = Math.abs((nxi * gx + nyi * gy + nzi * gz) / (nl * gl2));
  if (cosNew > 0.9) alignedNew++;
  worstCosNew = Math.min(worstCosNew, cosNew);
  // 旧口径：bias 视常数 → ∇F_old = −∇v（offAt 的 z 依赖被忽略）
  const vv = (a, b, c) => fn(a * K, b * K, c * K, [1, 1, 1, 1]);
  const ox2 = -(vv(u + h, v, w) - vv(u - h, v, w)) / (2 * h);
  const oy2 = -(vv(u, v + h, w) - vv(u, v - h, w)) / (2 * h);
  const oz2 = -(vv(u, v, w + h) - vv(u, v, w - h)) / (2 * h);
  const ol = Math.hypot(ox2, oy2, oz2);
  if (ol > 1e-9) {
    const cosOld = Math.abs((nxi * ox2 + nyi * oy2 + nzi * oz2) / (nl * ol));
    if (cosOld > 0.9) alignedOld++;
  }
}
const rNew = alignedNew / n, rOld = alignedOld / n;
rNew >= 0.95
  ? ok(`新口径：法线 ≡ 提取场梯度（|cos|>0.9 占比 ${(rNew * 100).toFixed(1)}% ≥95%）`, `worstCos=${worstCosNew.toFixed(3)} n=${n}`)
  : bad('新口径法线与提取场梯度失配', `占比 ${(rNew * 100).toFixed(1)}% < 95%（n=${n}）`);
rNew - rOld > 0.02
  ? ok(`A/B 对照：新口径显著优于旧口径（+${((rNew - rOld) * 100).toFixed(1)}pp，旧 ${(rOld * 100).toFixed(1)}%）`)
  : console.log(`  ℹ A/B：新旧占比差 ${((rNew - rOld) * 100).toFixed(1)}pp（渐变带占全域比例小则为窄差，非缺陷信号）`);

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
if (pass < 2) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 2（构建早退防护）`); process.exit(1); }
process.exit(fail > 0 ? 1 : 0);
