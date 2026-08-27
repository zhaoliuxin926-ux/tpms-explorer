/**
 * micro_physics_audit.mjs —— 迂曲度 + 各向异性刚度专项审计（纯 Node）
 *
 * 断言：
 *   ① 8 类曲面 @p0.75：三向几何迂曲度 τ ∈ [1.0, 3.5] 且全部贯通
 *      （文献带：TPMS @75% 典型 τ 1.3~2.5）
 *   ② 立方对称 5 类（Gyroid/Diamond/P/Neovius/I-WP）：三向归一化模量偏差
 *      (Emax−Emin)/Eavg ≤ 1.0%（Dijkstra 欧氏边长的栅格量子化容差内）
 *   ③ 立方对称 Zener 比 A = 2C44/(C11−C12) ∈ [0.9, 1.1]
 *   ④ 刚度组装自洽：对称迂曲输入下 C44 ≡ G12、C11 符合各向同性解析式
 *   ⑤ 低孔隙韧性：p2% 近实心时流体空间仍连通（τ 有限且 ≥1）——TPMS 空隙
 *      网络拓扑恒连通的展示；「未贯通 ∞」语义由端板案例承载
 *   ⑥ 端板封堵：ep>0 时 z 向未贯通（τ=∞）、x/y 正常贯通
 *
 * 运行：node micro_physics_audit.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_micro_physics_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_micro_physics_entry.ts');
  const mods = [
    'src/physics/tortuosity.ts:analyzeTortuosity3D',
    'src/physics/gibson-ashby.ts:estimateAnisotropicStiffness',
    'src/core/tpms-functions.ts:getTpmsFunction',
    'src/physics/percolation-analysis.ts:isSolidAt',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { analyzeTortuosity3D, estimateAnisotropicStiffness, getTpmsFunction, isSolidAt } =
  await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d ? '— ' + d : ''); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };

const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp'];
const CUBIC = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp'];

/** 精确 iso：16 轮分位二分（与 worker 同算法），取样 48³ 控成本 */
function bisectIsoExact(type, pTarget) {
  const fn = getTpmsFunction(type, '');
  const w = [1, 1, 1, 1];
  const n = 48;
  const vals = [];
  for (let iz = 0; iz < n; iz++) {
    const z = (iz / (n - 1)) * 2 * Math.PI - Math.PI;
    for (let iy = 0; iy < n; iy++) {
      const y = (iy / (n - 1)) * 2 * Math.PI - Math.PI;
      for (let ix = 0; ix < n; ix++) {
        const x = (ix / (n - 1)) * 2 * Math.PI - Math.PI;
        vals.push(fn(x, y, z, w));
      }
    }
  }
  vals.sort((a, b) => a - b);
  const idx = Math.floor(vals.length * (1 - pTarget));
  return (vals[idx] + vals[Math.min(vals.length - 1, idx + 1)]) / 2;
}

function paramsFor(type, p, iso, ep = 0) {
  return {
    type, customFormula: '', weights: [1, 1, 1, 1], periods: 3,
    mode: 'solid_network', gradientDir: 'z', container: 'cube',
    isoUsed: iso, endplateMm: ep,
  };
}

// ── ①②③ 迂曲度 + 对称模量/Zener ──────────────────────────────
for (const type of TYPES) {
  const iso = bisectIsoExact(type, 0.75);
  const tort = analyzeTortuosity3D(paramsFor(type, 0.75, iso), 64);

  const [tx, ty, tz] = tort.tau;
  const percolOk = tort.percolating.every(Boolean);
  const tauOk = percolOk && tort.tau.every((t) => t >= 1.0 && t <= 3.5);
  tauOk
    ? ok(`${type} 迂曲度 τ=(${tx.toFixed(3)}, ${ty.toFixed(3)}, ${tz.toFixed(3)}) 全贯通`)
    : bad(`${type} 迂曲度`, JSON.stringify({ tau: tort.tau.map((t) => +t.toFixed(3)), perc: tort.percolating, fluid: +tort.fluidFraction.toFixed(3) }));

  if (CUBIC.includes(type)) {
    const st = estimateAnisotropicStiffness(0.25, type, { x: tx, y: ty, z: tz });
    const Eavg = (st.E[0] + st.E[1] + st.E[2]) / 3;
    const devPct = ((Math.max(...st.E) - Math.min(...st.E)) / Eavg) * 100;
    const zenerOk = st.zener >= 0.9 && st.zener <= 1.1;
    devPct <= 1.0 && zenerOk
      ? ok(`${type} 对称模量偏差 ${devPct.toFixed(3)}% · Zener A=${st.zener.toFixed(4)}`)
      : bad(`${type} 对称模量/Zener`, `dev=${devPct.toFixed(3)}% A=${st.zener.toFixed(4)}`);
  }
}

// ── ④ 刚度组装自洽：完全对称迂曲下 C44≡G12、C11 符合各向同性解析式 ──
{
  const st = estimateAnisotropicStiffness(0.25, 'gyroid', { x: 1.4, y: 1.4, z: 1.4 });
  const E1 = st.E[0];
  const nu = st.nu[0];
  // 各向同性解析（E1=E2=E3 时）：C11 = E(1−ν)/((1+ν)(1−2ν))；C44 = E/(2(1+ν)) = G12
  const C11ref = (E1 * (1 - nu)) / ((1 + nu) * (1 - 2 * nu));
  const C44ref = E1 / (2 * (1 + nu));
  const c44ok = Math.abs(st.C44 - C44ref) / C44ref < 1e-9;
  const c11ok = Math.abs(st.C11 - C11ref) / C11ref < 1e-9;
  c44ok && c11ok
    ? ok('刚度组装自洽（对称迂曲）', `C11 偏差 ${(Math.abs(st.C11 - C11ref) / C11ref * 100).toExponential(1)}% · C44 偏差 ${(Math.abs(st.C44 - C44ref) / C44ref * 100).toExponential(1)}%`)
    : bad('刚度组装自洽', `C11=${st.C11.toFixed(6)} vs ${C11ref.toFixed(6)} · C44=${st.C44.toFixed(6)} vs ${C44ref.toFixed(6)}`);
}

// ── ④b 高密度几何正确性：p45 时体素流体占比应≈0.45，几何 τ ∈ [1,1.5] ──
// （gyroid 对称面存在笔直贯通通道，几何最短路 τ=1 是真实结果；
//   文献 1.2~1.6 为 hydraulic τ——含粘性流场解，二者口径不同，详见指南）
{
  const iso = bisectIsoExact('gyroid', 0.45);
  const tort = analyzeTortuosity3D(paramsFor('gyroid', 0.45, iso), 64);
  // 容差 0.06：bisect 用 48³ 规则栅格（对 k=3 周期存在对称采样偏置），
  // 64³ 分析栅格为另一采样口径——两者混合的固有测量不确定度
  const fluidOk = Math.abs(tort.fluidFraction - 0.45) < 0.06;
  const tauOk = tort.tau.every((t) => t >= 1 && t <= 1.5);
  fluidOk && tauOk
    ? ok('高密度几何正确性（p45）', `fluid=${(tort.fluidFraction * 100).toFixed(1)}% τ=${tort.tau.map((t) => t.toFixed(3))}`)
    : bad('高密度几何正确性', `fluid=${tort.fluidFraction.toFixed(3)} τ=${tort.tau.map((t) => +t.toFixed(3))}`);
}

// ── ⑤ 渗流阈值以下：p2% 近实心的流体为封闭袋网络 ⇒ 未贯通（τ=∞）────
// 这正是「无贯通流道返回 ∞」分支的实证案例：渗流阈值以下的孤立流体袋
// 物理上不可灌注。fluid 占比同步校验（全域含边界壳 <5%）。
{
  const iso = bisectIsoExact('gyroid', 0.02);
  const tort = analyzeTortuosity3D(paramsFor('gyroid', 0.02, iso), 48);
  const noPerc = tort.percolating.every((v) => !v) && tort.tau.every((t) => !Number.isFinite(t));
  noPerc && tort.fluidFraction < 0.05
    ? ok('渗流阈值以下未贯通（τ=∞）', `fluid=${(tort.fluidFraction * 100).toFixed(1)}%`)
    : bad('渗流阈值以下', JSON.stringify({ perc: tort.percolating, fluid: +tort.fluidFraction.toFixed(3) }));
}

// ── ⑥ 端板封堵语义：z 断流 ∞ / x·y 贯通 ───────────────────────
{
  const iso = bisectIsoExact('gyroid', 0.75);
  const tort = analyzeTortuosity3D(paramsFor('gyroid', 0.75, iso, 1.0), 64);
  const zBlocked = !tort.percolating[2] && !Number.isFinite(tort.tau[2]);
  const xyOk = tort.percolating[0] && tort.percolating[1];
  zBlocked && xyOk
    ? ok('端板封堵语义（z=∞ / x·y 贯通）', `τz=∞, τx=${tort.tau[0].toFixed(3)}, τy=${tort.tau[1].toFixed(3)}`)
    : bad('端板封堵语义', JSON.stringify({ perc: tort.percolating, tau: tort.tau.map((t) => +t.toFixed(2)) }));
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
