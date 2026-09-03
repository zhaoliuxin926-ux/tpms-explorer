// selftest.mjs —— Agent CLI 自检（M0 数学层 + M1 几何闭环）
//
// 断言策略（防"恒真断言"与循环论证）：
//  1. 常数独立复刻：C1/C2/基体模量按源码文献注释硬编码在测试里，对拍 CLI 输出
//  2. 模型不变量：标度律 E∝ρ̄²、退化极限 ρ̄→1 → E=C1/σ=C2（不依赖具体常数取值）
//  3. 权威公式对拍：Schwarz P = cos x + cos y + cos z 逐点 1e-12
//  4. 拒绝语义：非法类型/越界孔隙率必须非零退出（不臆造文化）
//  5. 几何闭环（M1）：水密三硬指标 + STL 独立读回复核（字节级边配对，不复用 CLI 内建自检）
//
// 运行: node selftest.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tpms.mjs');

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS', n); };
const bad = (n, i = '') => { fail++; console.log('FAIL', n, i); };
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const est = (...args) => JSON.parse(run('estimate', ...args, '--json').stdout);

// ── 1. estimate：常数独立复刻（文献注释值硬编码：gyroid C1=0.38, C2=0.3, tc4 E=110 σ=880）──
const j = est('--type', 'gyroid', '--porosity', '0.65', '--material', 'tc4');
near(j.E_over_Es, 0.38 * 0.35 * 0.35) ? ok('E*/Es 独立复刻 0.38·0.35²') : bad('E*/Es', String(j.E_over_Es));
near(j.youngsModulusGPa, 0.38 * 0.35 * 0.35 * 110) ? ok('E* GPa = E*/Es × 110') : bad('E*GPa', String(j.youngsModulusGPa));
near(j.sigma_over_sigmas, 0.3 * Math.pow(0.35, 1.5)) ? ok('σ*/σs 独立复刻 0.3·0.35^1.5') : bad('σ*/σs', String(j.sigma_over_sigmas));
near(j.yieldStrengthMPa, 0.3 * Math.pow(0.35, 1.5) * 880) ? ok('σ* MPa = σ*/σs × 880') : bad('σ*MPa', String(j.yieldStrengthMPa));

// ── 2. 标度律不变量：E(ρ̄₁)/E(ρ̄₂) = (ρ̄₁/ρ̄₂)²，与常数取值无关 ──
const ra = est('--type', 'diamond', '--porosity', '0.5');
const rb = est('--type', 'diamond', '--porosity', '0.8');
near(ra.E_over_Es / rb.E_over_Es, Math.pow(0.5 / 0.2, 2)) ? ok('标度律 E∝ρ̄²（diamond 0.5 vs 0.8）') : bad('标度律', `${ra.E_over_Es}/${rb.E_over_Es}`);

// ── 3. 退化极限：ρ̄→1 时 E*/Es→C1、σ*/σs→C2（schwarz: C1=0.35, C2=0.3）──
const rf = est('--type', 'schwarz', '--porosity', '0');
near(rf.E_over_Es, 0.35) && near(rf.sigma_over_sigmas, 0.3) ? ok('ρ̄=1 退化为 C1/C2 常数') : bad('退化极限', `${rf.E_over_Es}/${rf.sigma_over_sigmas}`);

// ── 4. 百分数口径：65 == 0.65（与平台 computePhysicsMetrics 同口径）──
const rp = est('--type', 'gyroid', '--porosity', '65');
near(rp.E_over_Es, j.E_over_Es) ? ok('百分数口径 65 ≡ 0.65') : bad('百分数口径', String(rp.E_over_Es));

// ── 5. Schwarz P 权威公式逐点对拍（经同一 core bundle 的 getTpmsFunction）──
const { loadCore } = await import('./core-loader.mjs');
const core = await loadCore();
const W = [1, 1, 1, 1];
const fs = core.getTpmsFunction('schwarz');
let p5 = true;
for (const [x, y, z] of [[0.3, 0.7, 1.1], [-1.2, 0.4, 2.0], [2.5, 2.5, 2.5]]) {
  if (!near(fs(x, y, z, W), Math.cos(x) + Math.cos(y) + Math.cos(z), 1e-12)) p5 = false;
}
p5 ? ok('Schwarz P = cos x + cos y + cos z（3 点 1e-12）') : bad('Schwarz P 对拍');

// ── 6. list：8 内置曲面 + 材料表字段完整 ──
const rl = JSON.parse(run('list', '--json').stdout);
rl.types.length === 8 && rl.types.every((t) => t.C1 > 0 && t.anisotropy > 1) && rl.materials.tc4.modulusGPa === 110
  ? ok('list 含 8 曲面且常数/材料表完整') : bad('list', JSON.stringify(rl.types?.length));

// ── 7. 拒绝语义：非法输入必须非零退出（不臆造）──
run('estimate', '--type', 'nope', '--porosity', '0.5').status !== 0 ? ok('非法曲面类型被拒绝') : bad('非法类型未拒绝');
run('estimate', '--type', 'gyroid', '--porosity', '105').status !== 0 ? ok('越界孔隙率被拒绝（105→1.05）') : bad('越界孔隙率未拒绝');
run('estimate', '--type', 'gyroid', '--porosity', '-5').status !== 0 ? ok('负孔隙率被拒绝') : bad('负孔隙率未拒绝');
run('estimate', '--type', 'gyroid', '--porosity', 'abc').status !== 0 ? ok('非数字孔隙率被拒绝') : bad('非数字未拒绝');
run('estimate', '--type', 'gyroid', '--porosity', '0.5', '--material', 'unobtainium').status !== 0 ? ok('非法材料被拒绝') : bad('非法材料未拒绝');

// ── 8. 参数解析边角（对抗审查 D 节修复回归）──
const req = JSON.parse(run('estimate', '--type=gyroid', '--porosity=0.65', '--json').stdout);
near(req.E_over_Es, j.E_over_Es) ? ok('--key=value 形式可用') : bad('= 形式', String(req.E_over_Es));
run('estimate', '--type=gyroid', '--porosity=-0.5').status !== 0 ? ok('= 形式负值仍被拒绝') : bad('= 形式负值未拒绝');
run('--json', 'list').status === 0 ? ok('前置 flag 不吞命令字（--json list）') : bad('前置 flag 吞命令字');
run('estimate', '--json', 'extra', '--type', 'gyroid', '--porosity', '0.5').status !== 0 ? ok('多余位置参数被拒绝') : bad('多余位置参数未拒绝');

// ── 9. M1 几何闭环：mesh 命令 ──
// 9a. 水密硬门 + STL 落盘（R=48 gyroid，低成本案例）
const stlPath = join(tmpdir(), `tpms_selftest_m1_${process.pid}.stl`);
rmSync(stlPath, { force: true });
const rm1 = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--out', stlPath, '--json');
const j1 = JSON.parse(rm1.stdout || '{}');
rm1.status === 0 ? ok('mesh 退出码 0（水密门内建通过）') : bad('mesh 失败', rm1.stderr?.slice(-200));
existsSync(stlPath) ? ok('STL 文件已产出') : bad('STL 未产出', stlPath);
// 9b. STL 独立读回复核：解析 binary STL，字节级顶点配对数开放边（不复用 CLI 自检代码路径）
try {
  const buf = readFileSync(stlPath);
  const header = buf.toString('latin1', 0, 80);
  const n = buf.readUInt32LE(80);
  header.startsWith('TPMS Explorer binary STL; units=mm') ? ok('STL 头含 units=mm 单位声明') : bad('STL 头', header.slice(0, 40));
  n === j1.triCount ? ok(`STL 三角数 = 报告值（${n}）`) : bad('三角数不符', `${n} vs ${j1.triCount}`);
  const edges = new Map(); // 无向边（字节级顶点配对）→ [正向, 反向]；定长 hex key 防 0x7C 分隔符碰撞
  for (let t = 0; t < n; t++) {
    const base = 84 + t * 50 + 12; // 跳过 header+数量+法线
    const vs = [0, 12, 24].map((o) => buf.toString('latin1', base + o, base + o + 12).split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); // 顶点定长 hex
    for (const [i, j2] of [[0, 1], [1, 2], [2, 0]]) {
      const fwd = vs[i] < vs[j2];
      const k = fwd ? vs[i] + vs[j2] : vs[j2] + vs[i];
      let rec = edges.get(k);
      if (!rec) { rec = [0, 0]; edges.set(k, rec); }
      rec[fwd ? 0 : 1]++;
    }
  }
  let open = 0;
  for (const [, [a, b]] of edges) if (a + b === 1) open++;
  open === 0 ? ok('STL 独立读复核对账：开放边 = 0（字节级）') : bad('STL 读回开放边', String(open));
} catch (e) { bad('STL 读回复核异常', String(e)); }
// 9c. 高分辨率孔隙率收敛（口径：体素二分 vs 网格实测的离散差随 R 收敛；R96 实测 ~1.0pp，取 3pp 带）
const rm2 = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '96', '--out', join(tmpdir(), `tpms_selftest_m1b_${process.pid}.stl`), '--json');
const j2 = JSON.parse(rm2.stdout || '{}');
rm2.status === 0 && j2.porosityDeviation <= 0.03 ? ok(`R96 孔隙率收敛 ≤3pp（实测 ${(j2.porosityDeviation * 100).toFixed(2)}pp）`) : bad('R96 收敛', String(j2.porosityDeviation));
// 9d. mesh 参数防呆
run('mesh', '--type', 'gyroid', '--porosity', '0.5', '--resolution', '20').status !== 0 ? ok('mesh 低于分辨率下限被拒绝') : bad('分辨率下限未拒绝');
run('mesh', '--type', 'gyroid', '--porosity', '0.5', '--periods', '0').status !== 0 ? ok('mesh 非法周期被拒绝') : bad('周期下限未拒绝');
run('mesh', '--type', 'gyroid', '--porosity', '0.02').status !== 0 ? ok('mesh 越界孔隙率被拒绝（近全实心）') : bad('mesh 孔隙率下限未拒绝');
rmSync(stlPath, { force: true });

console.log(`\nSELFTEST ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
