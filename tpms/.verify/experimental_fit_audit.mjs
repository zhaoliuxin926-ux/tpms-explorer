/**
 * experimental_fit_audit.mjs —— 门禁 43：ISO 13314 标定与参数反演（v9.0 方向三）
 *
 * 「测试工具先行自校验」纪律：合成曲线的分段结构具有独立于被测实现的参考真值——
 *   E*、虚拟原点为解析值；Rp0.2/平台应力/εd/W 参考由本脚本在无噪解析曲线上以
 *   超细网格 + 二分求交独立计算（与模块的 400 段梯形/逐点扫描路径不同源，防自证）。
 *
 * 断言矩阵（20 项）：解析容错 ×8（分隔符自适应 ×3/表头+列名/乱序+重复折叠/非有限值
 * 过滤/单位换算闭环 1e-12）、Toe 补偿 ×2（虚拟原点 ±0.0005、锚定 (0,0)）、
 * ISO 特征 ×6（E* ≤1.5%、Rp0.2 ≤2%、第一峰值 ≤2%、平台应力 ≤1%、εd ±0.015、W ≤2%）、
 * 标定比 ×1、格式抗毒化 ×2（乱序 CSV 全链/噪声鲁棒复跑确定性）、基线守卫 ×1。
 *
 * 运行：node experimental_fit_audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_expfit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_expfit_entry.ts');
  const mods = [
    'src/physics/experimental-fit.ts:parseCurve,compensateToe,extractIso13314,fitExperimentalCurve,detectSeparator',
    'src/physics/gibson-ashby.ts:gibsonAshby',
  ];
  writeFileSync(entry, mods.map((m) => {
    const [f, names] = m.split(':');
    return `export { ${names} } from ${JSON.stringify(join(PLATFORM, f))};`;
  }).join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { parseCurve, compensateToe, extractIso13314, fitExperimentalCurve, detectSeparator, gibsonAshby } =
  await import(pathToFileURL(BUNDLE));

let pass = 0, fail = 0;
const ok = (n, d = '') => { pass++; console.log('PASS', n, d ? '— ' + d : ''); };
const bad = (n, d = '') => { fail++; console.log('FAIL', n, d ? '— ' + d : ''); };

// ── 1. 合成曲线发生器（分段解析 + mulberry32 确定性噪声）──
const E0 = 1200, PEAK = 45, PL = 36, EPS_PEAK = 0.06, EL_END = 0.035, PL_START = 0.08, DN_START = 0.45;
const TOE_K = E0 / 0.02; // 斜率在 ε=0.01 处与弹性段接续 → 解析虚拟原点 0.005
const EPS0_REF = 0.005;
function sigmaAnalytic(e) {
  if (e <= 0.01) return TOE_K * e * e;
  if (e <= EL_END) return TOE_K * 0.0001 + E0 * (e - 0.01);
  if (e <= EPS_PEAK) { // Hermite：(36,E0)→(45,0)
    const t = (e - EL_END) / (EPS_PEAK - EL_END);
    const p0 = 36, p1 = PEAK, m0 = E0 * (EPS_PEAK - EL_END), m1 = 0;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
  }
  if (e <= PL_START) { // (45,0)→(36,0)
    const t = (e - EPS_PEAK) / (PL_START - EPS_PEAK);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * PEAK + (-2 * t3 + 3 * t2) * PL;
  }
  if (e <= DN_START) { // 平台：正弦应力降振荡 + 微弱线性硬化
    const x = e - PL_START;
    return PL + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25);
  }
  const base = sigmaAnalytic(DN_START); // C⁰ 接续
  return base + 25 * (Math.exp(18 * (e - DN_START)) - 1);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry32(20260913);
const gauss = () => { const u = Math.max(1e-12, rng()), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const H = 0.001;
const strains = [], stresses = [];
for (let k = 0; k <= 500; k++) {
  strains.push(+(k * H).toFixed(9));
  stresses.push(sigmaAnalytic(strains[k]) + gauss() * 0.5);
}

// ── 2. 参考真值（无噪解析曲线 + 独立计算路径）──
const HREF = 2e-5;
const refStrain = [], refStress = [];
for (let e = 0; e <= 0.5; e += HREF) { refStrain.push(e); refStress.push(sigmaAnalytic(e)); }
const refInterp = (x) => {
  const i = Math.min(refStrain.length - 2, Math.max(0, Math.floor((x - refStrain[0]) / HREF)));
  const t = (x - refStrain[i]) / HREF;
  return refStress[i] + t * (refStress[i + 1] - refStress[i]);
};
// Rp0.2 参考：偏移线交点二分（弹性段 f>0，屈服段 f<0 的首个符号翻转）
function refRp02() {
  const f = (e) => refInterp(e) - E0 * (e - EPS0_REF - 0.002);
  let lo = EL_END, hi = EPS_PEAK;
  if (f(lo) < 0) { let e = lo; while (e > 0.01 && f(e) < 0) e -= HREF; lo = e; }
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) lo = m; else hi = m; }
  return refInterp((lo + hi) / 2);
}
const REF_RP = refRp02();
const REF_PLATEAU = (() => { // 细网格梯形（20000 段 vs 模块 400 段，独立路径）
  let s = 0; const n = 20000; const h = 0.2 / n;
  for (let i = 0; i < n; i++) s += (refInterp(0.2 + i * h) + refInterp(0.2 + (i + 1) * h)) / 2 * h;
  return s / 0.2;
})();
const REF_ED = (() => { // 细网格 η argmax
  let w = 0, best = -Infinity, ed = NaN;
  for (let i = 1; i < refStrain.length; i++) {
    w += (refStress[i - 1] + refStress[i]) / 2 * HREF;
    if (refStrain[i] > 0.02 && refStress[i] > 0) {
      const eta = w / refStress[i];
      if (eta > best) { best = eta; ed = refStrain[i]; }
    }
  }
  return ed;
})();
const REF_W = (() => { let s = 0; const n = 20000; const h = REF_ED / n; for (let i = 0; i < n; i++) s += (refInterp(i * h) + refInterp((i + 1) * h)) / 2 * h; return s; })();
const REF_PEAK_E = EPS_PEAK, REF_PEAK_S = PEAK;

console.log(`参考真值: Rp0.2=${REF_RP.toFixed(3)} σpl=${REF_PLATEAU.toFixed(3)} εd=${REF_ED.toFixed(4)} W=${REF_W.toFixed(3)}`);

// ── 3. 主链反演 ──
const parsed = parseCurve({ text: toCsv(strains, stresses) });
const comp = compensateToe(parsed.strain, parsed.stress);
const M = extractIso13314(comp.strain, comp.stress, comp.elasticModulus);
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// 4a. 原点补偿
rel(comp.originStrain, EPS0_REF) <= 0.0005 / EPS0_REF && Math.abs(comp.originStrain - EPS0_REF) <= 0.0005
  ? ok('虚拟原点恢复（注入解析值 0.005，±0.0005）', `ε0=${comp.originStrain.toFixed(5)}`)
  : bad('虚拟原点恢复', `ε0=${comp.originStrain.toFixed(5)}`);
comp.strain[0] === 0 && comp.stress[0] === 0
  ? ok('(0,0) 锚定') : bad('(0,0) 锚定');

// 4b. ISO 特征
rel(M.elasticModulusE, E0) <= 0.015
  ? ok('E* 恢复 ≤1.5%', `E*=${M.elasticModulusE.toFixed(1)}`)
  : bad('E* 恢复', `E*=${M.elasticModulusE.toFixed(1)} vs ${E0}`);
rel(M.proofStressRp02, REF_RP) <= 0.02
  ? ok('Rp0.2 恢复 ≤2%', `${M.proofStressRp02.toFixed(2)} vs ${REF_RP.toFixed(2)}`)
  : bad('Rp0.2 恢复', `${M.proofStressRp02.toFixed(2)} vs ${REF_RP.toFixed(2)}`);
rel(M.firstPeakStress, REF_PEAK_S) <= 0.02 && Math.abs(M.firstPeakStrain - REF_PEAK_E) <= 0.012
  ? ok('第一峰值恢复（幅值 ≤2%、位置 ±0.012——峰顶平坦区噪声极限）', `${M.firstPeakStress.toFixed(2)}@${M.firstPeakStrain.toFixed(3)}`)
  : bad('第一峰值恢复', `${M.firstPeakStress.toFixed(2)}@${M.firstPeakStrain.toFixed(3)}`);
rel(M.plateauStress, REF_PLATEAU) <= 0.01
  ? ok('平台应力 ≤1%', `${M.plateauStress.toFixed(3)} vs ${REF_PLATEAU.toFixed(3)}`)
  : bad('平台应力', `${M.plateauStress.toFixed(3)} vs ${REF_PLATEAU.toFixed(3)}`);
Math.abs(M.densificationStrain - REF_ED) <= 0.015
  ? ok('密实化应变 ±0.015', `εd=${M.densificationStrain.toFixed(4)} vs ${REF_ED.toFixed(4)}`)
  : bad('密实化应变', `εd=${M.densificationStrain.toFixed(4)} vs ${REF_ED.toFixed(4)}`);
rel(M.energyAbsorptionW, REF_W) <= 0.02
  ? ok('比吸能 W ≤2%', `${M.energyAbsorptionW.toFixed(3)} vs ${REF_W.toFixed(3)}`)
  : bad('比吸能 W', `${M.energyAbsorptionW.toFixed(3)} vs ${REF_W.toFixed(3)}`);
M.maxEfficiencyEta > 0 && Math.abs(M.maxEfficiencyEta - M.energyAbsorptionW / M.plateauStress) < 0.5
  ? ok('η_max 有效（W/σpl 同量级一致性）', `η=${M.maxEfficiencyEta.toFixed(3)}`)
  : bad('η_max 一致性', `η=${M.maxEfficiencyEta}`);

// ── 4c. 解析容错矩阵 ──
const jTsv = toCsv(strains, stresses, '\t');
const jSsv = toCsv(strains, stresses, ';');
detectSeparator(toCsv(strains, stresses)) === ',' && detectSeparator(jTsv) === '\t' && detectSeparator(jSsv) === ';'
  ? ok('分隔符自适应（, \\t ;）') : bad('分隔符自适应');
{
  const hdr = 'strain,stress\n' + toCsv(strains, stresses);
  const p = parseCurve({ text: hdr, columnX: 'strain', columnY: 'stress' });
  p.strain.length === parsed.strain.length && p.stress[10] === parsed.stress[10]
    ? ok('表头识别 + 列名映射') : bad('表头识别 + 列名映射');
}
{
  // 非有限值/注释/空行过滤
  const dirty = '# comment\n\n' + toCsv(strains.slice(0, 5), stresses.slice(0, 5)) + '\n,,\nnan,1.0\n0.5,inf\n' + toCsv(strains.slice(5), stresses.slice(5));
  const p = parseCurve({ text: dirty });
  p.strain.every(Number.isFinite) && p.stress.every(Number.isFinite) && p.strain.length === strains.length
    ? ok('非有限值/空 cell/注释行过滤') : bad('非有限值过滤', `n=${p.strain.length} 期望 ${strains.length}`);
}
{
  // 乱序行：奇偶反转变序后全链结果与有序版位级一致
  const shuf = [];
  for (let i = strains.length - 1; i >= 0; i--) shuf.push([strains[i], stresses[i]]);
  const p = parseCurve({ text: toCsvPairs(shuf) });
  const c2 = compensateToe(p.strain, p.stress);
  const M2 = extractIso13314(c2.strain, c2.stress, c2.elasticModulus);
  const same = Math.abs(M2.plateauStress - M.plateauStress) < 1e-9 && Math.abs(c2.originStrain - comp.originStrain) < 1e-12;
  same ? ok('乱序行排序还原（位级一致）') : bad('乱序行', `Δσpl=${Math.abs(M2.plateauStress - M.plateauStress)}`);
}
{
  // 重复应变行均值折叠
  const dup = [];
  for (let i = 0; i < strains.length; i++) { dup.push([strains[i], stresses[i]]); dup.push([strains[i], stresses[i] * 3]); }
  const p = parseCurve({ text: toCsvPairs(dup) });
  Math.abs(p.stress[100] - stresses[100] * 2) < 1e-9
    ? ok('重复横坐标均值折叠') : bad('重复折叠', `y=${p.stress[100]} 期望 ${stresses[100] * 2}`);
}
{
  // 单位换算闭环：位移-载荷 vs 应变-应力 ≤1e-12
  const L0 = 12, A0 = 100;
  const df = strains.map((e, i) => [e * L0, stresses[i] * A0]);
  const cA = compensateToe(parsed.strain, parsed.stress);
  const pB = parseCurve({ text: toCsvPairs(df), inputType: 'displacement-force', specimenDimensions: { lengthMm: L0, widthMm: 10, thicknessMm: 10 } });
  const cB = compensateToe(pB.strain, pB.stress);
  const MB = extractIso13314(cB.strain, cB.stress, cB.elasticModulus);
  const MA = extractIso13314(cA.strain, cA.stress, cA.elasticModulus);
  const dev = Math.max(
    rel(MB.plateauStress, MA.plateauStress), rel(MB.elasticModulusE, MA.elasticModulusE),
    Math.abs(MB.densificationStrain - MA.densificationStrain),
  );
  dev <= 1e-12 ? ok('单位换算闭环 ≤1e-12') : bad('单位换算闭环', `dev=${dev.toExponential(2)}`);
}
// 标定比
{
  const r = fitExperimentalCurve({ text: toCsv(strains, stresses) }, { dtPlateau: 61.2, gaPlateau: 28.8 });
  const dtOk = Math.abs(r.scaling.dtVsExpRatio - 61.2 / M.plateauStress) < 1e-12;
  const gaOk = Math.abs(r.scaling.gaVsExpRatio - 28.8 / M.plateauStress) < 1e-12;
  dtOk && gaOk ? ok('DT/GA 双向标定比（已知输入精确闭合）') : bad('标定比');
}
// GA 锚点联通（gibson-ashby 导入可用性——平台侧预测对接面）
{
  const { E_Es } = gibsonAshby(1 - 0.6, 'gyroid');
  E_Es > 0 && E_Es < 1 ? ok('Gibson-Ashby 对接面可用（E* 归一值 ∈(0,1)）', `E/Es=${E_Es.toFixed(4)}`) : bad('GA 对接面');
}
// 噪声确定性：同 seed 重跑曲线 → 平台应力位级一致
{
  const rng2 = mulberry32(20260913);
  const g2 = () => { const u = Math.max(1e-12, rng2()), v = rng2(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const st2 = strains.map((e) => sigmaAnalytic(e) + g2() * 0.5);
  const p2 = parseCurve({ text: toCsv(strains, st2) });
  const c2 = compensateToe(p2.strain, p2.stress);
  const M2 = extractIso13314(c2.strain, c2.stress, c2.elasticModulus);
  M2.plateauStress === M.plateauStress ? ok('同种子确定性（位级一致）') : bad('确定性', `Δ=${M2.plateauStress - M.plateauStress}`);
}

function toCsv(xs, ys, sep = ',') {
  const lines = [];
  for (let i = 0; i < xs.length; i++) lines.push(`${xs[i]}${sep}${ys[i]}`);
  return lines.join('\n');
}
function toCsvPairs(pairs, sep = ',') {
  return pairs.map(([x, y]) => `${x}${sep}${y}`).join('\n');
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 18) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 18（恒真/集体跳过防护）`); process.exit(1); }
process.exit(fail ? 1 : 0);
