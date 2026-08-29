/**
 * neural_implicit_audit.mjs —— 门禁 32：隐式神经场（SIREN/INR）审计（纯 Node）
 *
 * A. 蒸馏保真度：5 专家 vs 解析教师场 RMSE（16³ 细网格）
 * B. 精确周期性：Fourier 特征输入 ⇒ F(x+2π) ≡ F(x)（跨周期水密的构造保证）
 * C. Lipschitz 连续性：谱范数乘积界（幂迭代）有限 + 采样 FD 梯度上界不超过乘积界
 * D. 潜在空间插值：混合权重归一 + 插值路径 Lipschitz（z 连续 ⇒ 场连续）
 * E. 网格集成：锚点态 + 流形中点态经 buildSurface 全水密 + 非退化
 * F. 防御性：非法潜在码（NaN/长度错）显式抛错不静默
 * G. 同源静态：求值器零依赖（仅类型/权重导入）+ 权重文件为生成器锚定产物
 *
 * 运行：node neural_implicit_audit.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// ── rolldown 打包（surface-nets 全管线 + 神经求值器 + 教师场）──
const BUNDLE = join(tmpdir(), 'tpms_neural_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_neural_audit_entry.ts');
  writeFileSync(entry, [
    `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
    `export { createNeuralField, sanitizeLatent, mixtureWeights, expertLipschitzBound, expertGradientSup, expertCount, NEURAL_EXPERT_NAMES } from ${JSON.stringify(join(PLATFORM, 'src/core/neural-implicit-field.ts'))};`,
    `export { TPMS_FUNCTIONS } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildSurface, createNeuralField, sanitizeLatent, mixtureWeights, expertLipschitzBound, expertGradientSup, NEURAL_EXPERT_NAMES, TPMS_FUNCTIONS } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 教师场（与 gen_neural_weights.mjs 同口径：峰值归一化）──
const MICRO = 0.35;
function teacherAt(kind, x, y, z) {
  let v;
  if (kind === 'trabecular') {
    v = TPMS_FUNCTIONS.gyroid(x, y, z, [1, 1, 1, 0]) + MICRO * TPMS_FUNCTIONS.gyroid(3 * x, 3 * y, 3 * z, [1, 1, 1, 0]);
  } else {
    const w = kind === 'diamond' ? [1, 1, 1, 1] : kind === 'lidinoid' ? [1, 1, 0, 0] : [1, 1, 1, 0];
    v = TPMS_FUNCTIONS[kind](x, y, z, w);
  }
  return v;
}
// 教师峰值（12³ 粗扫，与生成器同口径）
const TEACHER_SCALE = {};
{
  const G = 12;
  for (const kind of NEURAL_EXPERT_NAMES) {
    let m = 0;
    for (let iz = 0; iz < G; iz++) for (let iy = 0; iy < G; iy++) for (let ix = 0; ix < G; ix++) {
      const v = teacherAt(kind, -Math.PI + ix / (G - 1) * 2 * Math.PI, -Math.PI + iy / (G - 1) * 2 * Math.PI, -Math.PI + iz / (G - 1) * 2 * Math.PI);
      if (Math.abs(v) > m) m = Math.abs(v);
    }
    TEACHER_SCALE[kind] = m;
  }
}

// ── A. 蒸馏保真度 ──
console.log('\n[A] 蒸馏保真度（RMSE vs 解析教师，16³）');
{
  const GE = 16;
  const RMSE_TOL = { gyroid: 0.03, diamond: 0.03, lidinoid: 0.05, schwarz: 0.03, trabecular: 0.10 };
  const rmseAll = [];
  for (let ei = 0; ei < NEURAL_EXPERT_NAMES.length; ei++) {
    const kind = NEURAL_EXPERT_NAMES[ei];
    const fn = createNeuralField(Array.from({ length: 8 }, (_, j) => (ei === 0 ? 3 : j % 2 === 0 ? 3 : (Math.floor(ei / 2) % 2 === 0 ? 3 : -3))));
    // 锚点码由 mixtureWeights 锚定：直接取第 ei 个锚点等价形式——为保持审计独立性，
    // 用最近专家快路径断言（混合 softmax 在锚点处该专家权重 >0.999）
    const anchorZ = [[3,3,3,3,3,3,3,3],[3,-3,3,-3,3,-3,3,-3],[3,3,-3,-3,3,3,-3,-3],[3,-3,-3,3,3,-3,-3,3],[3,3,3,3,-3,-3,-3,-3]][ei];
    const fnA = createNeuralField(anchorZ);
    const mix = mixtureWeights(anchorZ);
    check(`${kind} 锚点混合权重主导 ${mix[ei].toFixed(6)} > 0.999`, mix[ei] > 0.999);
    let se = 0, cnt = 0;
    for (let iz = 0; iz < GE; iz++) for (let iy = 0; iy < GE; iy++) for (let ix = 0; ix < GE; ix++) {
      const x = -Math.PI + ix / (GE - 1) * 2 * Math.PI;
      const y = -Math.PI + iy / (GE - 1) * 2 * Math.PI;
      const z = -Math.PI + iz / (GE - 1) * 2 * Math.PI;
      const pred = fnA(x, y, z);
      const tv = teacherAt(kind, x, y, z) / TEACHER_SCALE[kind];
      se += (pred - tv) ** 2; cnt++;
    }
    const rmse = Math.sqrt(se / cnt);
    rmseAll.push(rmse);
    check(`${kind} RMSE ${rmse.toFixed(4)} ≤ ${RMSE_TOL[kind]}`, rmse <= RMSE_TOL[kind]);
  }
}

// ── B. 精确周期性 ──
console.log('\n[B] 精确 2π 周期性（水密构造保证）');
{
  const fn = createNeuralField([3, 0, 3, 0, 3, 0, 3, 0]);
  let maxDev = 0;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 500; i++) {
    const x = (rnd() * 2 - 1) * 7, y = (rnd() * 2 - 1) * 7, z = (rnd() * 2 - 1) * 7;
    const d = Math.abs(fn(x + 2 * Math.PI, y, z) - fn(x, y, z))
      + Math.abs(fn(x, y + 2 * Math.PI, z) - fn(x, y, z))
      + Math.abs(fn(x, y, z + 2 * Math.PI) - fn(x, y, z));
    if (d > maxDev) maxDev = d;
  }
  check(`500 随机点周期偏差 max ${maxDev.toExponential(2)} ≤ 1e-12`, maxDev <= 1e-12);
}

// ── C. Lipschitz 连续性 ──
console.log('\n[C] Lipschitz 乘积界 vs 采样梯度上界');
{
  for (let ei = 0; ei < NEURAL_EXPERT_NAMES.length; ei++) {
    const L = expertLipschitzBound(ei);
    check(`${NEURAL_EXPERT_NAMES[ei]} 谱乘积界 ${L.toFixed(2)} 有限且 < 1e4`, Number.isFinite(L) && L > 0 && L < 1e4);
    const { sup } = expertGradientSup(ei, Math.PI, 20);
    check(`${NEURAL_EXPERT_NAMES[ei]} 采样梯度上界 ${sup.toFixed(3)} ≤ 乘积界 ×1.05`, sup <= L * 1.05);
  }
}

// ── D. 潜在空间插值连续性 ──
console.log('\n[D] 潜在流形插值（混合权重归一 + 路径 Lipschitz）');
{
  // 归一性：随机 z
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let maxSumDev = 0;
  for (let i = 0; i < 50; i++) {
    const z = Array.from({ length: 8 }, () => (rnd() * 2 - 1) * 3);
    const m = mixtureWeights(z);
    const s = m.reduce((a, b) => a + b, 0);
    maxSumDev = Math.max(maxSumDev, Math.abs(s - 1));
    if (m.some((p) => p < 0 || !Number.isFinite(p))) { maxSumDev = 99; break; }
  }
  check(`50 随机 z 混合权重归一（max |Σ−1| ${maxSumDev.toExponential(1)} ≤ 1e-12）`, maxSumDev <= 1e-12);

  // 路径连续性：gyroid 锚点 → diamond 锚点直线，场差/步长有界
  const z0 = [3, 3, 3, 3, 3, 3, 3, 3];
  const z1 = [3, -3, 3, -3, 3, -3, 3, -3];
  const fnT = (t) => createNeuralField(z0.map((a, i) => a + (z1[i] - a) * t));
  const x = 0.83, y = -0.41, z = 1.27;
  const STEPS = 40;
  let maxSlope = 0;
  let prev = fnT(0)(x, y, z);
  let finiteAll = true;
  for (let s = 1; s <= STEPS; s++) {
    const f = fnT(s / STEPS)(x, y, z);
    if (!Number.isFinite(f)) finiteAll = false;
    maxSlope = Math.max(maxSlope, Math.abs(f - prev) / (1 / STEPS));
    prev = f;
  }
  check(`插值路径全有限`, finiteAll);
  // 实测标定（σ=2 混合带宽）：5 探针 × 60 步最大斜率 4.39（峰值出现在专家决策边界，
  // 属混合解码的真实物理）；阈 6.0 = 实测 ×1.37 裕量，断言有界性而非具体斜率
  check(`路径 Lipschitz 斜率 ${maxSlope.toFixed(3)} ≤ 6.0（z 单位）`, maxSlope <= 6.0);

  // 端点一致性：t=0/1 与单专家锚点场一致（快路径恒等）
  const fEnd = fnT(1)(x, y, z);
  const fAnchor = createNeuralField(z1)(x, y, z);
  check(`插值终点 = 目标锚点场（Δ ${Math.abs(fEnd - fAnchor).toExponential(1)} ≤ 1e-12）`, Math.abs(fEnd - fAnchor) <= 1e-12);
}

// ── E. 网格集成（水密 + 非退化）──
console.log('\n[E] buildSurface 集成（锚点态 + 流形中点态）');
{
  // 独立开放边计数
  const countOpen = (indices) => {
    const m = new Map();
    const key = (a, b) => a < b ? a * 4294967296 + b : b * 4294967296 + a;
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i], indices[i + 1], indices[i + 2]];
      for (let e = 0; e < 3; e++) {
        const k = key(t[e], t[(e + 1) % 3]);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const c of m.values()) if (c === 1) open++;
    return open;
  };

  const CASES = [
    ['锚点 gyroid', [3, 3, 3, 3, 3, 3, 3, 3]],
    ['锚点 trabecular', [3, 3, 3, 3, -3, -3, -3, -3]],
    ['流形中点 gyroid↔diamond', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['流形中点 schwarz↔trabecular', [3, 0, 0, 3, 0, -3, -3, 0]],
  ];
  for (const [label, z] of CASES) {
    const res = buildSurface({
      type: 'gyroid', iso: 0, periods: 2, resolution: 20, targetPorosity: 0.7,
      weights: [1, 1, 1, 0], structureMode: 'solid_network', containerShape: 'cube',
      thickness: 1, gradientDir: 'z', customFormula: '',
      hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
      preview: false,
      neural: { enabled: true, z },
    });
    const open = countOpen(res.indices ?? new Uint32Array(0));
    const solid = res.meshSolidFraction ?? 0;
    check(`${label}：水密 open=${open} = 0`, open === 0);
    check(`${label}：非退化（顶点 ${res.vertCount} > 0 · 固相分数 ${solid.toFixed(3)} ∈ (0.02, 0.9)）`,
      res.vertCount > 0 && solid > 0.02 && solid < 0.9);
    check(`${label}：孔隙率二分收敛（目标 70% 实测 ${(100 - solid * 100).toFixed(1)}%，偏差 ≤ 10pp）`,
      Math.abs(100 - solid * 100 - 70) <= 10);
  }
}

// ── F. 防御性 ──
console.log('\n[F] 非法潜在码显式拒绝');
{
  let threw = 0;
  for (const bad of [NaN, Infinity]) {
    try { sanitizeLatent([3, 3, 3, 3, 3, 3, bad, 3]); } catch { threw++; }
  }
  try { sanitizeLatent([1, 2, 3]); } catch { threw++; }
  check(`NaN/Inf/长度错误 3 例全部抛错（实际 ${threw}）`, threw === 3);
  let clampedOk = false;
  try { const z = sanitizeLatent([99, -99, 0.5, 0, 0, 0, 0, 0]); clampedOk = z[0] === 3 && z[1] === -3; } catch { /* no */ }
  check(`越界值钳制到 ±3`, clampedOk);
  let neuralThrew = false;
  try { createNeuralField('bad'); } catch { neuralThrew = true; }
  check(`createNeuralField 非法输入抛错`, neuralThrew);
}

// ── G. 同源静态 ──
console.log('\n[G] 零依赖静态 + 生成器锚定');
{
  const src = readFileSync(join(PLATFORM, 'src/core/neural-implicit-field.ts'), 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const bad = imports.filter((p) => !p.endsWith('neural-implicit-weights') && !p.includes('types'));
  check(`求值器仅依赖权重/类型模块（实际 imports: ${imports.join(', ') || '无'}）`, bad.length === 0);
  const weightsSrc = readFileSync(join(PLATFORM, 'src/core/neural-implicit-weights.ts'), 'utf8');
  check('权重文件为生成器锚定产物（头注含 gen_neural_weights）', weightsSrc.includes('gen_neural_weights.mjs'));
  check('权重文件记录蒸馏终评 RMSE', weightsSrc.includes('终评 RMSE'));
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
