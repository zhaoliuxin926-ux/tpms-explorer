/**
 * probe_region.mjs —— 径向双族分区构型探针（独立运行不进 CI，matlab_script_smoke 先例）
 *
 * 断言四组：
 *   A. 退化锚（场级字节等价）：rSplit=1 ⟹ 组合场 ≡ max(fA, clip)；rSplit=0 ⟹ ≡ max(fB, clip)。
 *      提取器确定性 ⟹ 场等价即 STL 字节等价（CLI 交付走同一 marchingTetrahedra 路径）。
 *   B. regionWeight 解析锚：端点/中点/单调性/smoothstep 公式值。
 *   C. 过渡带连续性：带内相邻采样 |Δv| 有界（C1 权重 ⟺ 无跳变）。
 *   D. 同号不变性：过渡带内 vA·vB>0 的采样点组合场必同号（无额外零面机理）。
 *
 * CLI 可产域实测（2026-09-17）：gyroid/diamond k4 R48 矩阵 8/8 watertight
 *（r∈{0,0.4,0.5,0.55,0.7,1}×b∈{0.15,0.2,0.3,0.45,0.6}，open/nm/degen 全 0——
 * surface-nets 同参数 nm 20~52 拒产，MT cell corner 二值化免疫，radial-grad 先例同机理）。
 * 复跑：node tpms/.verify/probe_region.mjs
 */
import { loadCore } from '../agent/core-loader.mjs';

const core = await loadCore();
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

const K4 = 4 * Math.PI;
const fA = core.getTpmsFunction('gyroid');   // 外区
const fB = core.getTpmsFunction('diamond');  // 内区
const wts = [1, 1, 1, 1];
const rb = 1 - 0.5 / 48;

const combo = (X, Y, Z, rS, bl) => {
  const s = core.regionWeight(Math.hypot(X, Y), rS, bl);
  const v = s * fA(X * K4, Y * K4, Z * K4, wts) + (1 - s) * fB(X * K4, Y * K4, Z * K4, wts);
  return Math.max(v, Math.abs(X) - rb, Math.abs(Y) - rb, Math.abs(Z) - rb);
};
const clipA = (X, Y, Z) => Math.max(fA(X * K4, Y * K4, Z * K4, wts), Math.abs(X) - rb, Math.abs(Y) - rb, Math.abs(Z) - rb);
const clipB = (X, Y, Z) => Math.max(fB(X * K4, Y * K4, Z * K4, wts), Math.abs(X) - rb, Math.abs(Y) - rb, Math.abs(Z) - rb);

console.log('A. 退化锚（场级字节等价 → 确定性提取器 ⟹ STL 字节等价）');
{
  let maxD1 = 0, maxD0 = 0;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) for (let k = 0; k <= 40; k++) {
    const X = -1 + 2 * i / 40, Y = -1 + 2 * j / 40, Z = -1 + 2 * k / 40;
    maxD1 = Math.max(maxD1, Math.abs(combo(X, Y, Z, 1, 0.15) - clipA(X, Y, Z)));
    maxD0 = Math.max(maxD0, Math.abs(combo(X, Y, Z, 0, 0.15) - clipB(X, Y, Z)));
  }
  check(`rSplit=1 ⟹ 纯外族 gyroid+clip（max|Δ|=${maxD1.toExponential(2)}）`, maxD1 === 0);
  check(`rSplit=0 ⟹ 纯内族 diamond+clip（max|Δ|=${maxD0.toExponential(2)}）`, maxD0 === 0);
}

console.log('B. regionWeight 解析锚');
{
  const w = core.regionWeight;
  check('端点 rSplit≥1 ⟹ 恒 1', w(0.3, 1, 0.15) === 1 && w(0.9, 1, 0.15) === 1);
  check('端点 rSplit≤0 ⟹ 恒 0', w(0.1, 0, 0.15) === 0 && w(0.9, 0, 0.15) === 0);
  check('带起点 s=0 / 带终点 s=1', w(0.5 - 0.075, 0.55, 0.15) === 0 && w(0.55 + 0.075, 0.55, 0.15) === 1);
  check('带中点 s≈0.5（smoothstep(0.5)=0.5；浮点容差）', Math.abs(w(0.55, 0.55, 0.15) - 0.5) < 1e-12);
  let mono = true;
  for (let i = 1; i <= 100; i++) if (w(-1 + 2 * i / 100, 0.55, 0.15) < w(-1 + 2 * (i - 1) / 100, 0.55, 0.15)) mono = false;
  check('全域单调不减', mono);
  // smoothstep 公式值：t=0.25 ⟹ 3t²−2t³ = 0.15625；r1 = 带起点 + 0.25·b = 0.475 + 0.0375
  check('smoothstep 公式值（t=0.25 ⟹ 0.15625）', Math.abs(w(0.475 + 0.25 * 0.15, 0.55, 0.15) - 0.15625) < 1e-12);
}

console.log('C. 过渡带连续性（C1 权重 ⟺ 无跳变）');
{
  let maxStep = 0;
  const N = 4000;
  for (let i = 1; i <= N; i++) {
    const r1 = 0.475 + (0.15 * i) / N;   // 过渡带 [0.475, 0.625] 内
    const v1 = combo(r1, 0, 0.31, 0.55, 0.15);
    const v0 = combo(r1 - 0.15 / N, 0, 0.31, 0.55, 0.15);
    maxStep = Math.max(maxStep, Math.abs(v1 - v0));
  }
  // 场值 O(1) 量级下，步长 0.15/4000 的相邻差应 ≪ 0.01
  check(`带内相邻采样差 max=${maxStep.toExponential(2)} < 0.01`, maxStep < 0.01);
}

console.log('D. 同号不变性（无额外零面机理；clip 裁剪激活区与两族场近零点除外）');
{
  let sampled = 0, violated = 0;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) for (let k = 0; k <= 24; k++) {
    const X = -1 + 2 * i / 24, Y = -1 + 2 * j / 24, Z = -1 + 2 * k / 24;
    const r1 = Math.hypot(X, Y);
    if (r1 <= 0.475 || r1 >= 0.625) continue;         // 限过渡带内
    if (Math.abs(X) > rb || Math.abs(Y) > rb || Math.abs(Z) > rb) continue;  // clip 激活点跳过（边界裁剪语义）
    const a = fA(X * K4, Y * K4, Z * K4, wts), b = fB(X * K4, Y * K4, Z * K4, wts);
    if (Math.abs(a) < 1e-9 || Math.abs(b) < 1e-9) continue;  // 两族场近零点（零面上符号无定义）
    if (a * b <= 0) continue;
    sampled++;
    const s = core.regionWeight(r1, 0.55, 0.15);
    const v = s * a + (1 - s) * b;                     // 混合场本体（不含 clip max）
    if (v * a <= 0 || v * b <= 0) violated++;
  }
  check(`采样 ${sampled} 点同号违反 ${violated}（须 0）`, sampled > 500 && violated === 0);
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);
