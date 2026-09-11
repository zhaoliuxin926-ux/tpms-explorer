// run_ci_suite.mjs —— 一键 CI 套件调度器（Task 6 → 2026-09-06 并行化）
//
// 调度：41 门全部自包含（各门自带服务/临时 bundle 名互不碰撞），按并发池执行；
//       结果按原序汇报。并发度 CI_JOBS 可调（默认 4；18 核机器实测安全）。
// 用法：
//   cd tpms/tpms-platform && npm run test:all
//   （等价于 node ../.verify/run_ci_suite.mjs）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const WIN32 = process.platform === 'win32';

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', rst: '\x1b[0m' }
  : { b: '', dim: '', red: '', grn: '', ylw: '', cyn: '', rst: '' };

// ── 部署门禁：产物缺失时提前失败并给出修法 ──
if (!existsSync(path.join(DEPLOYED, 'index.html'))) {
  console.error(`${C.red}✗ 缺少部署产物 docs/platform/index.html${C.rst}`);
  console.error(`  先执行: cd tpms/tpms-platform && npm run build`);
  console.error(`  再拷贝 dist/* → docs/platform/（删除 assets/*.map）`);
  process.exit(2);
}

// ── 端口兜底清扫（win32）：门自清；中途崩死留下孤儿监听时按端口强杀（仅 LISTENING 态）──
function sweepPorts(ports) {
  if (!WIN32) return;
  let out = '';
  try {
    out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  } catch { return; }
  const pids = new Set();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 5 && cols[3] === 'LISTENING' && /^\d+$/.test(cols[4])
      && ports.some((pt) => cols[1].endsWith(':' + pt))) pids.add(cols[4]);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      console.log(`${C.ylw}[清扫] 强杀孤儿服务进程 PID ${pid}${C.rst}`);
    } catch { /* 已自行退出则忽略 */ }
  }
}

// 最重单门实测 ~253s（数字孪生）；默认 30min——run54 实证 runner 高峰期系统性变慢
//（重门 306-569s 可膨胀至 1200s+），1200s 上限会误伤真跑的门
const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS) || 1_800_000;

function runStep(name, script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(HERE, script)], {
      cwd: HERE,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const grab = (d) => {
      const s = d.toString();
      tail += s;
      process.stdout.write(s);
    };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    let settled = false;
    const finish = (ok, extra, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (extra) tail += `\n[runStep] ${extra}`;
      // 汇总行兼容两种格式："RESULT: X PASS / Y FAIL" 与 "PASS X / Y"
      const m = tail.match(/RESULT:\s*(\d+)\s*PASS\s*\/\s*(\d+)\s*FAIL/) || tail.match(/PASS (\d+) \/ (\d+)/);
      const summary = m ? `${m[1]} PASS / ${m[2]} FAIL` : (ok ? 'exit=0' : `exit=${code ?? 'n/a'}`);
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(ok
        ? `${C.grn}${C.b}✓ ${name} — ${summary}（${dur}s）${C.rst}`
        : `${C.red}${C.b}✗ ${name} — ${summary}（${dur}s）${C.rst}`);
      resolve(ok);
    };
    p.on('close', (code) => finish(code === 0, null, code));
    p.on('error', (err) => finish(false, `spawn 失败: ${err && err.message || err}`));
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch { /* 已退出 */ }
      finish(false, `门超时（${STEP_TIMEOUT_MS / 1000}s）强杀`);
    }, STEP_TIMEOUT_MS);
  });
}

// ── 调度清单（[汇报名, 步骤名, 脚本]；顺序 = 历史顺序，执行 = 并发池）──
const SCHEDULE = [
  ['mesh_audit 几何质量门（30 案例）', '几何质量门', 'mesh_audit.mjs'],
  ['parity_math 数学同源（282 断言）', '数学同源', 'parity_math.mjs'],
  ['state_url_audit 状态隔离+分享恢复（门37）', '状态与分享审计', 'state_url_audit.mjs'],
  ['worker_bridge_audit Worker生命周期（门38，11断言）', 'Worker生命周期审计', 'worker_bridge_audit.mjs'],
  ['sim_export_check 仿真导出（CFD 分块 + 曲率健壮性）', '仿真导出校验', 'sim_export_check.mjs'],
  ['endplate_audit 端板专项（水密/满填/体积增量）', '端板审计', 'endplate_audit.mjs'],
  ['micro_physics_audit 迂曲度+各向异性刚度', '微物理审计', 'micro_physics_audit.mjs'],
  ['hybrid_audit 多相混合（水密/极限/双语言残差）', '混合审计', 'hybrid_audit.mjs'],
  ['industrial_export_audit 工业格式（GLB+3MF）', '工业格式审计', 'industrial_export_audit.mjs'],
  ['custom_equation_audit 自定义公式沙箱（AST+AD+代码生成）', '自定义公式审计', 'custom_equation_audit.mjs'],
  ['homogenization_audit RVE 均质化+方向模量', '均质化审计', 'homogenization_audit.mjs'],
  ['manifold_audit 非欧度规空间映射', '流形映射审计', 'manifold_audit.mjs'],
  ['redteam_matrix_audit 红队极端工况矩阵', '红队矩阵审计', 'redteam_matrix_audit.mjs'],
  ['webgpu_parity_audit WebGPU 数学同源（门13）', 'WebGPU 同源审计', 'webgpu_parity_audit.mjs'],
  ['periodic_rve_audit 周期性RVE/PBC（门14）', '周期RVE审计', 'periodic_rve_audit.mjs'],
  ['cae_mesh_audit Abaqus/OpenFOAM体网格（门15）', 'CAE体网格审计', 'cae_mesh_audit.mjs'],
  ['hierarchical_audit 多级分形+应力单调性（门16）', '分级TPMS审计', 'hierarchical_audit.mjs'],
  ['inverse_design_audit 逆向设计引擎（门17）', '逆向设计审计', 'inverse_design_audit.mjs'],
  ['poincare_metric_audit 庞加莱双曲映射（门18）', '庞加莱映射审计', 'poincare_metric_audit.mjs'],
  ['cae_verification_audit CAE验证链（门19）', 'CAE验证链审计', 'cae_verification_audit.mjs'],
  ['impact_modal_audit 冲击吸能与模态（门20）', '冲击模态审计', 'impact_modal_audit.mjs'],
  ['ct_reconstruction_audit CT重构偏差（门21）', 'CT重构审计', 'ct_reconstruction_audit.mjs'],
  ['native_cae_solver_audit 原生CAE求解器（门22）', '原生CAE审计', 'native_cae_solver_audit.mjs'],
  ['boundary_picker_audit 边界拾取器（门23）', '边界拾取审计', 'boundary_picker_audit.mjs'],
  ['bone_morphometry_audit DICOM与骨计量（门24）', '骨计量审计', 'bone_morphometry_audit.mjs'],
  ['gcode_slicer_audit G-code切片引擎（门25）', 'G-code切片审计', 'gcode_slicer_audit.mjs'],
  ['ml_pareto_audit ML代理Pareto（门26）', 'ML Pareto审计', 'ml_pareto_audit.mjs'],
  ['gpu_plasticity_audit WebGPU弹塑性大变形（门27）', '弹塑性审计', 'gpu_plasticity_audit.mjs'],
  ['digital_twin_compression_audit 数字孪生压溃失效（门28）', '数字孪生审计', 'digital_twin_compression_audit.mjs'],
  ['wasm_navier_stokes_audit Navier-Stokes微流体（门29）', '微流体审计', 'wasm_navier_stokes_audit.mjs'],
  ['lpbf_thermo_mechanical_audit LPBF热-力耦合（门30）', 'LPBF审计', 'lpbf_thermo_mechanical_audit.mjs'],
  ['nl_agent_audit 自然语言CAD代理（门31）', 'NL代理审计', 'nl_agent_audit.mjs'],
  ['neural_implicit_audit 隐式神经场SIREN（门32）', '神经场审计', 'neural_implicit_audit.mjs'],
  ['yield_surface_audit 多轴屈服包络面（门33）', '屈服面审计', 'yield_surface_audit.mjs'],
  ['phononic_bandgap_audit 声子能带与禁带（门34）', '声子能带审计', 'phononic_bandgap_audit.mjs'],
  ['tissue_growth_audit 组织长入反应扩散（门35）', '组织长入审计', 'tissue_growth_audit.mjs'],
  ['levelset_optimizer_audit 水平集拓扑优化（门36）', '水平集审计', 'levelset_optimizer_audit.mjs'],
  ['ui_jump_check 控制台分组导航（UI 重组回归）', '分组导航快检', 'ui_jump_check.mjs'],
  ['run_all UI 回归（6 套件）', 'UI 回归', 'run_all.mjs'],
  // 【2026-09-10 纳管】两者均有「不在调度→静默红数天」事故史（schema_check frd 漂移漏检一天、
  // selftest list 14→18 断言红两天无人发现）——手动纪律已证失效，转正进调度
  ['agent_selftest CLI 自检（parseArgs/list/拒绝语义）', 'CLI 自检', '../agent/selftest.mjs'],
  ['schema_check 契约与可用域（75 断言，2026-09-12 红队 B 补钉 +3）', 'Schema 契约', '../agent/schema_check.mjs'],
];

const JOBS = Math.max(1, Math.min(8, Number(process.env.CI_JOBS) || 4));

console.log(`${C.b}══════ TPMS 全量 CI 套件 ══════${C.rst} ${C.dim}${new Date().toLocaleString()} · 并发 ${JOBS}${C.rst}`);

const results = new Array(SCHEDULE.length);
try {
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= SCHEDULE.length) break;
      const [name, label, script] = SCHEDULE[i];
      results[i] = [name, await runStep(label, script)];
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
} finally {
  sweepPorts([4814, 8125, 4855]); // 无论成败，回收可能的孤儿服务
}

const failed = results.filter(([, ok]) => !ok);
const pad = Math.max(...results.map(([n]) => n.length));
console.log(`
${C.b}╔══════════════════════════════════════╗${C.rst}
${C.b}║          测 试 结 果 汇 总           ║${C.rst}
${C.b}╠══════════════════════════════════════╣${C.rst}
${results.map(([n, ok]) => `${ok ? '║ ✓' : '║ ✗'} ${n.padEnd(pad)}${ok ? '' : '  ← FAILED'}`).join('\n')}
${C.b}╠══════════════════════════════════════╣${C.rst}
${failed.length === 0
    ? `${C.grn}║ 全部通过 · ${results.length}/${results.length} 门通过${C.rst}`
    : `${C.red}║ 失败 ${failed.length}/${results.length}${C.rst}\n${failed.map(([n]) => `${C.red}║   ✗ ${n}${C.rst}`).join('\n')}`}
${C.b}╚══════════════════════════════════════╝${C.rst}
`);
process.exit(failed.length ? 1 : 0);
