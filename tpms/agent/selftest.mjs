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
import { readFileSync, rmSync, existsSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
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

// ── 6. list：20 内置曲面（C2 第一批 +5、第二批 +1、第三批 +4、第四批 +1、第五批 +1）+ 材料表字段完整 ──
const rl = JSON.parse(run('list', '--json').stdout);
rl.types.length === 20 && rl.types.every((t) => t.C1 > 0 && t.anisotropy > 1) && rl.materials.tc4.modulusGPa === 110
  ? ok('list 含 20 曲面且常数/材料表完整') : bad('list', JSON.stringify(rl.types?.length));

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
  let open = 0, miso = 0;
  for (const [, [a, b]] of edges) {
    if (a + b === 1) open++;
    else if ((a === 0) !== (b === 0)) miso++; // 两三角同向 = 定向错
  }
  open === 0 ? ok('STL 独立读复核对账：开放边 = 0（字节级）') : bad('STL 读回开放边', String(open));
  // A1 定向根治断言：stl-exporter 全局定向传播后，有向错边必须为 0
  miso === 0 ? ok('STL 全局定向一致：misoriented = 0（字节级有向配对）') : bad('STL misoriented', String(miso));
} catch (e) { bad('STL 读回复核异常', String(e)); }
// 9c. A2 精确求解器：解析积分求根 + 一轮割线（确定性种子）
// R96 验收 ≤1pp（实测最差 0.26pp）；solver 默认 exact
const m1bPath = join(tmpdir(), `tpms_selftest_m1b_${process.pid}.stl`);
const rm2 = run('mesh', '--type', 'diamond', '--porosity', '0.65', '--resolution', '96', '--out', m1bPath, '--json');
const j2 = JSON.parse(rm2.stdout || '{}');
rm2.status === 0 && j2.porosityDeviation <= 0.01 ? ok(`exact 求解器 R96 孔隙率 ≤1pp（实测 ${(j2.porosityDeviation * 100).toFixed(2)}pp）`) : bad('R96 收敛', String(j2.porosityDeviation));
j2.solver === 'exact' ? ok('默认求解器 = exact') : bad('solver 默认值', String(j2.solver));
// 9d. mesh 参数防呆
run('mesh', '--type', 'gyroid', '--porosity', '0.5', '--resolution', '20').status !== 0 ? ok('mesh 低于分辨率下限被拒绝') : bad('分辨率下限未拒绝');
run('mesh', '--type', 'gyroid', '--porosity', '0.5', '--periods', '0').status !== 0 ? ok('mesh 非法周期被拒绝') : bad('周期下限未拒绝');
run('mesh', '--type', 'gyroid', '--porosity', '0.02').status !== 0 ? ok('mesh 越界孔隙率被拒绝（近全实心）') : bad('mesh 孔隙率下限未拒绝');
rmSync(stlPath, { force: true });

// ── 10. B-t4.0 solve 闭环自校正 ──
{
  const stlPath = join(tmpdir(), `tpms_selftest_solve_${process.pid}.stl`);
  // 10a. 收敛路径：diamond R48 tol 1pp → 3 轮内收敛（实测 0.05pp）且水密
  const r10a = run('solve', '--type', 'diamond', '--porosity', '0.65', '--resolution', '48', '--tolerance', '0.01', '--out', stlPath, '--json');
  let j10a = null;
  try { j10a = JSON.parse(r10a.stdout); } catch { /* 忽略 */ }
  r10a.status === 0 && j10a?.reachable === true && j10a.porosityDeviation <= 0.01 && j10a.watertight === true
    ? ok(`solve 收敛：diamond R48 偏差 ${(j10a.porosityDeviation * 100).toFixed(2)}pp ≤ 1pp（${j10a.rounds} 轮）`) : bad('solve 收敛', JSON.stringify(j10a?.trace || r10a.stderr || '').slice(-80));
  existsSync(stlPath) ? ok('solve 产出 STL') : bad('solve STL 未产出');
  // 10a+ 独立复核：solve 路径的 STL 同样过字节级有向配对（终审 4 节指出的循环论证残余修补）
  try {
    const bufS = readFileSync(stlPath);
    const nS = bufS.readUInt32LE(80);
    const hexS = (o) => bufS.toString('latin1', o, o + 12).split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const eS = new Map();
    for (let t = 0; t < nS; t++) {
      const base = 84 + t * 50 + 12;
      const vs = [0, 12, 24].map((o) => hexS(base + o));
      for (const [i, j2] of [[0, 1], [1, 2], [2, 0]]) {
        const fwd = vs[i] < vs[j2];
        const k = fwd ? vs[i] + vs[j2] : vs[j2] + vs[i];
        let rec = eS.get(k);
        if (!rec) { rec = [0, 0]; eS.set(k, rec); }
        rec[fwd ? 0 : 1]++;
      }
    }
    let openS = 0, misoS = 0;
    for (const [, [a, b]] of eS) { if (a + b === 1) openS++; else if ((a === 0) !== (b === 0)) misoS++; }
    openS === 0 && misoS === 0 ? ok('solve STL 独立读回复核：open=0 misoriented=0（字节级）') : bad('solve STL 读回', `open=${openS} miso=${misoS}`);
  } catch (e) { bad('solve STL 复核异常', String(e)); }
  // 10b.【k 修复后新现实】splitp R48 在 0.05pp 容差下 3 轮收敛（修复前 stall best=0.18pp 判不可达）
  const r10b = run('solve', '--type', 'splitp', '--porosity', '0.55', '--resolution', '48', '--tolerance', '0.0005', '--max-rounds', '4', '--json');
  let j10b = null;
  try { j10b = JSON.parse(r10b.stdout); } catch { /* 忽略 */ }
  r10b.status === 0 && j10b?.reachable === true && j10b.porosityDeviation <= 0.0005 && j10b.watertight === true
    ? ok(`splitp R48 0.05pp 容差收敛（实测 ${(j10b.porosityDeviation * 100).toFixed(3)}pp，k 修复前 stall@0.18pp）`) : bad('splitp 高精度收敛', JSON.stringify({ s: r10b.status, r: j10b?.reachable, d: j10b?.porosityDeviation }).slice(-100));
  // 10c. solve 参数防呆
  run('solve', '--type', 'gyroid', '--porosity', '0.5', '--tolerance', '0.5').status !== 0 ? ok('solve tolerance 越界被拒') : bad('solve tolerance 未拒绝');
  run('solve', '--type', 'gyroid', '--porosity', '0.5', '--max-rounds', '0').status !== 0 ? ok('solve max-rounds 越界被拒') : bad('solve max-rounds 未拒绝');
  try { unlinkSync(stlPath); } catch { /* 忽略 */ }
  try { unlinkSync(m1bPath); } catch { /* 忽略 */ }
}
// ── 11. B4.2 不可达判定轮次（显式用例）：高谐波族低分辨率 tol 不可达 → max-rounds 内 stall 判定 ──
{
  // 11a.【k 修复后】iwp R48 0.05pp 容差 3 轮收敛（修复前 stall best=23.1pp）
  const r11 = run('solve', '--type', 'iwp', '--porosity', '0.6', '--resolution', '48', '--tolerance', '0.0005', '--max-rounds', '5', '--json');
  let j11 = null;
  try { j11 = JSON.parse(r11.stdout); } catch { /* 忽略 */ }
  r11.status === 0 && j11?.reachable === true && j11.porosityDeviation <= 0.0005 && j11.watertight === true
    ? ok(`B4.2 iwp R48 0.05pp 容差收敛（${j11.rounds} 轮，k 修复前 stall@23.1pp）`) : bad('B4.2 iwp 收敛', JSON.stringify({ s: r11.status, r: j11?.reachable, d: j11?.porosityDeviation }).slice(-100));
  // 11b. 不可达诊断路径保底：极端容差 + 单轮 → max_rounds 结构化诊断（确定性）
  const r11b = run('solve', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--tolerance', '0.00005', '--max-rounds', '1', '--json');
  let j11b = null;
  try { j11b = JSON.parse(r11b.stdout); } catch { /* 忽略 */ }
  r11b.status === 3 && j11b?.reachable === false && j11b.unreachable?.reason === 'max_rounds' && Array.isArray(j11b.suggestions)
    ? ok('不可达诊断路径保底（max_rounds + suggestions 结构化）') : bad('不可达保底', JSON.stringify({ s: r11b.status, u: j11b?.unreachable?.reason }).slice(-100));
}
// ── 12. verify 命令回归守卫（此前零覆盖）──
{
  const dOk = join(tmpdir(), `tpms_selftest_vfy_ok_${process.pid}.json`);
  writeFileSync(dOk, JSON.stringify({ type: 'diamond', porosity: 0.65, resolution: 96, material: 'tc4', tolerance: 0.01 }));
  const rv = run('verify', '--design', dOk, '--json');
  let jv = null;
  try { jv = JSON.parse(rv.stdout); } catch { /* 忽略 */ }
  rv.status === 0 && jv?.verdict === 'pass' && jv?.attempts?.at(-1)?.checks?.water_tightness?.pass === true
    ? ok('verify 好方案 PASS（钻石 R96，升档闭环）') : bad('verify 好方案', (rv.stderr || '').slice(-80));
  const dBad = join(tmpdir(), `tpms_selftest_vfy_bad_${process.pid}.json`);
  writeFileSync(dBad, JSON.stringify({ type: 'gyroid', porosity: 1.5 }));
  const rb = run('verify', '--design', dBad, '--json');
  let jb = null;
  try { jb = JSON.parse(rb.stdout); } catch { /* 忽略 */ }
  rb.status === 3 && jb?.verdict === 'fail' && jb?.stage === 'parameter' && Array.isArray(jb.paramErrors)
    ? ok('verify 坏方案参数层结构化拒绝（exit3）') : bad('verify 坏方案', (rb.stderr || '').slice(-80));
  run('verify').status !== 0 ? ok('verify 缺 --design 被拒') : bad('verify 缺 --design 未拒绝');
  try { unlinkSync(dOk); unlinkSync(dBad); } catch { /* 忽略 */ }
}
// ── 13. scenario 命令回归守卫（M5 场景模板：一条指令 → STL+INP+验证报告）──
{
  const mk = (over) => join(tmpdir(), `tpms_selftest_scn_${process.pid}_${Math.random().toString(36).slice(2, 7)}.json`);
  const prefix = join(tmpdir(), `tpms_selftest_scn_out_${process.pid}`);
  const dGood = mk();
  writeFileSync(dGood, JSON.stringify({ type: 'gyroid', porosity: 0.65, material: 'tc4', resolution: 48, periods: 4, out: prefix }));
  const rs = run('scenario', '--design', dGood, '--json');
  let js = null;
  try { js = JSON.parse(rs.stdout); } catch { /* 忽略 */ }
  const exists = (p) => { try { return statSync(p).size > 0; } catch { return false; } };
  rs.status === 0 && js?.geometry?.watertight?.openEdges === 0 && js?.files?.length === 2
    && exists(prefix + '.stl') && exists(prefix + '.inp') && exists(prefix + '.report.md') && exists(prefix + '.report.json')
    ? ok('scenario 端到端交付（四件产出+水密+files 数据清单）') : bad('scenario 端到端', (rs.stderr || '').slice(-100));
  js?.mechanics?.youngsModulusGPa > 0 && js.mechanics.youngsModulusGPa < 110 && typeof js.mechanics.inLiteratureBand === 'boolean'
    ? ok('scenario 力学预测口径（0 < E* < 基体 + 文献带字段）') : bad('scenario 力学字段', JSON.stringify(js?.mechanics).slice(-80));
  js?.geometry?.meshPorosity > 0 && js.geometry.voxelPorosity > 0 && js.geometry.porosityTrace?.length >= 1
    ? ok('scenario 双口径孔隙率 + 求解 trace 可溯源') : bad('scenario 双口径', JSON.stringify(js?.geometry).slice(-80));
  const inp = readFileSync(prefix + '.inp', 'utf8');
  inp.includes('*NODE') && inp.includes('*ELEMENT, TYPE=C3D8') && inp.includes('*ELASTIC') && inp.includes('NSET_BOTTOM')
    ? ok('scenario INP 结构（NODE/C3D8/ELASTIC/压缩面集）') : bad('scenario INP 结构', inp.slice(0, 60));
  const mdText = readFileSync(prefix + '.report.md', 'utf8');
  mdText.includes('验证报告') && mdText.includes('边界与限制')
    ? ok('scenario 报告含诚实边界声明') : bad('scenario 报告边界', mdText.slice(0, 60));
  const dBad = mk();
  writeFileSync(dBad, JSON.stringify({ type: 'gyroid', porosity: 0.65, material: 'unobtanium' }));
  const rbad = run('scenario', '--design', dBad, '--json');
  let jbad = null;
  try { jbad = JSON.parse(rbad.stdout); } catch { /* 忽略 */ }
  rbad.status === 3 && jbad?.stage === 'parameter' && Array.isArray(jbad.paramErrors) && jbad.paramErrors.length === 1
    ? ok('scenario 未知材料结构化拒绝（exit3 + stage=parameter，与 verify 同构）') : bad('scenario 拒绝', (rbad.stderr || '').slice(-80));
  run('scenario').status !== 0 ? ok('scenario 缺 --design 被拒') : bad('scenario 缺 --design 未拒绝');
  try {
    unlinkSync(dGood); unlinkSync(dBad);
    for (const suf of ['.stl', '.inp', '.report.md', '.report.json']) unlinkSync(prefix + suf);
  } catch { /* 忽略 */ }
}
console.log(`\nSELFTEST ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
