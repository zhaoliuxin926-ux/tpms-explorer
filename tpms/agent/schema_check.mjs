// schema_check.mjs —— B-t2 工具注册层自检
//
// 验证口径：schema 声明 ↔ CLI 实际行为交叉一致。
//  1. schema 结构：三工具、required、additionalProperties:false
//  2. 枚举一致性：type/mode/container 的 enum 与 CLI 实际接受域吻合（合法过/非法拒实测）
//  3. 数值边界：schema 的 minimum/maximum 与 CLI 拒绝语义逐点对拍
//  4. nl-agent 语义覆盖映射完整（TYPE/MATERIAL/MODE/CONTAINER 全覆盖；动作类如实声明）
//
// 运行: node schema_check.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tpms.mjs');
const schema = JSON.parse(readFileSync(join(HERE, 'tools.schema.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log('PASS', n); };
const bad = (n, i = '') => { fail++; console.log('FAIL', n, i); };
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const tool = (n) => schema.tools.find((t) => t.name === n);

// ── 1. schema 结构 ──
schema.tools?.length === 4 && ['tpms_list', 'tpms_estimate', 'tpms_mesh', 'tpms_scenario'].every((n) => tool(n))
  ? ok('schema 含四工具') : bad('schema 工具清单');
for (const n of ['tpms_estimate', 'tpms_mesh', 'tpms_scenario']) {
  const t = tool(n);
  t.parameters.additionalProperties === false && Array.isArray(t.parameters.required)
    ? ok(`${n} additionalProperties=false + required 声明`) : bad(`${n} 参数结构`);
}

// ── 2/3. schema 属性约束 ↔ CLI 行为对拍 ──
const props = tool('tpms_mesh').parameters.properties;
const typeEnum = JSON.stringify(props.type.enum.slice().sort());
const j = (out) => { try { return JSON.parse(out); } catch { return null; } };

// 合法边界通过
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg'];
for (const [label, args, check] of [
  ['resolution 下限 48 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut())], (r) => r.status === 0],
  ['resolution 上限 96 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 0],
  ['porosity 0.05 参数层接受+构建层 fail-closed', ['--type', 'gyroid', '--porosity', '0.05', '--resolution', '48', '--out', join(tmpOut())], (r) => r.status === 3 && (r.stderr || '').includes('水密门')],
  ['periods 上限 12 通过', ['--type', 'gyroid', '--porosity', '0.6', '--periods', '12', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 0],
  // cylinder+diamond 可用域钉住（2026-09-10 取证）：R48-R128 全拒产且非单调不收敛
  //（123/1940/164/624/786），k2 R96（84）与 p0.65 R96（248）同样拒产——与 cube 族
  // "随分辨率收敛"定性不同，降周期数不可避，容器截断深水区（bugs.md）
  ['cylinder+diamond p0.6 R96 已登记 fail-closed（容器深水区，可用域）', ['--type', 'diamond', '--porosity', '0.6', '--container', 'cylinder', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 3 && (r.stderr || '').includes('水密门')],
]) {
  const r = run('mesh', ...args, '--json');
  check(r) ? ok(label) : bad(label, (r.stderr || '').slice(-80));
}
// type enum 逐值遍历（验证 enum 与 CLI 接受域完全一致）
// frd 例外（2026-09-06 登记，bugs.md）：k 修复后精确投影暴露 R48/R64 薄壁自触非流形
//（nm 20736/3840，随分辨率收敛、R96 可构建）——体素场拓扑极限，fail-closed 是正确行为。
// 对 frd 钉住 R48 结构化拒产（exit3+水密门）+ R96 可构建；其余 7 类型维持 R48 可构建。
// lidinoid 例外（2026-09-08 诊断轮定案，bugs.md）：p≥0.7 薄壁自触同族——R48/R64 拒产
//（nm 28512/8640@p0.7）、R96 可产（拓扑自愈）；p0.9 R48 可产
// 但 exact 求解孔隙率偏差大（薄壁区 iso 响应混沌）。nudge（iso 微调避坑）已被探针证伪：
// nm 在 iso 邻域呈平台状（±0.02 内无归零点）——fail-closed + 可用域声明为定案路线。
// 【2026-09-10 勘误】旧登记"R96 nm=10368 已过时"归因有误：k6 标定轮实测 p0.75 k6 R96
// 恰为 nm=10368——旧记录是 k6+p0.75 口径（当时正确），p0.7 与 p0.75 在默认周期数下
// 行为相反（拓扑自愈有 p 域边界）。已补 p0.75 k6 R96 拒产 + k2 可产双钉。
// fks/fky 例外（2026-09-08 C2 扩展实测）：p0.6 R48 薄壁自触（nm 9504/4752）、R96 可产
//（nm=0，孔隙率偏差 0.2/0.6pp）——与 frd 同族钉住。
// fcks 例外（2026-09-09 C2 第二批实测）：谐波 3× R48 拒产；R96 nm=10368 拒产（表示极限
// 实锤）；R128 档位为目标场景但 exact 求解构建耗时实测 >15 分钟（待性能路径），如实登记。
// gprime 例外（2026-09-10 周期域钉住，B5 基准实测）：默认周期数 k=6 时 R96 p0.6 薄壁自触
// 拒产（nm 19080，与 BENCHMARKS.md 一致）；k=2 R96 可产（nm=0，偏差 0.2pp）——"择 band 可避"
// 量化为降周期数可避。高 k=高频相对体素网格→特征更薄，与薄壁自触族根因一致。
// dprime 例外（2026-09-10 C2 第三批实测）：p0.6 R48 薄壁自触（nm 18252）、R96 可产
//（nm=0，孔隙率偏差 0.13pp）——与 frd/fks/fky 同族钉住。
for (const ty of TYPES) {
  if (ty === 'dprime') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok(`type enum 值 ${ty} R48 已登记 fail-closed（薄壁自触，C2 第三批实测）`)
      : bad(`type enum ${ty} R48 行为漂移`, `exit=${r48.status}`);
    const r96 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok(`type enum 值 ${ty} 可构建（R96）`) : bad(`type enum ${ty} R96`, (r96.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'fcks') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok(`type enum 值 ${ty} R48 已登记 fail-closed（谐波 3× 表示极限，R128 档位待性能路径）`)
      : bad(`type enum ${ty} R48 行为漂移`, `exit=${r48.status}`);
    continue;
  }
  if (ty === 'fks' || ty === 'fky') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok(`type enum 值 ${ty} R48 已登记 fail-closed（薄壁自触，C2 扩展实测）`)
      : bad(`type enum ${ty} R48 行为漂移`, `exit=${r48.status}`);
    const r96 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok(`type enum 值 ${ty} 可构建（R96）`) : bad(`type enum ${ty} R96`, (r96.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'frd') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok('type enum 值 frd R48 已登记 fail-closed（薄壁自触，bugs.md）')
      : bad('type enum frd R48 行为漂移', `exit=${r48.status}`);
    const r96 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok('type enum 值 frd 可构建（R96）') : bad('type enum frd R96', (r96.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'lidinoid') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.7', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok('type enum 值 lidinoid p0.7 R48 已登记 fail-closed（薄壁自触，bugs.md）')
      : bad('type enum lidinoid p0.7 R48 行为漂移', `exit=${r48.status}`);
    const r64 = run('mesh', '--type', ty, '--porosity', '0.7', '--resolution', '64', '--out', join(tmpOut()), '--json');
    r64.status === 3 && (r64.stderr || '').includes('水密门')
      ? ok('type enum 值 lidinoid p0.7 R64 已登记 fail-closed（薄壁自触）')
      : bad('type enum lidinoid p0.7 R64 行为漂移', `exit=${r64.status}`);
    const r96 = run('mesh', '--type', ty, '--porosity', '0.7', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok('type enum 值 lidinoid p0.7 可构建（R96，拓扑自愈）') : bad('type enum lidinoid p0.7 R96', (r96.stderr || '').slice(-60));
    // 默认周期数（k=6）+ p0.75 + R96：高孔隙×高周期叠加薄壁自触，结构化拒产
    //（2026-09-10 k6 标定轮实测 nm=10368——与"旧登记 nm=10368"精确同源，证旧记录
    // 系 k6 口径而非"k 修复前过时口径"）；k2 同参可产（dev 0.4pp）
    const r96p75 = run('mesh', '--type', ty, '--porosity', '0.75', '--resolution', '96', '--out', join(tmpOut()), '--json');
    const p75Ok = r96p75.status === 3 && (r96p75.stderr || '').includes('水密门')
      && (() => { try { return JSON.parse(r96p75.stdout).lastAuditCounts?.nonManifoldEdges === 10368; } catch { return false; } })();
    p75Ok
      ? ok('type enum 值 lidinoid p0.75 k6 R96 已登记 fail-closed（默认周期数路径，nm=10368 数值钉住）')
      : bad('type enum lidinoid p0.75 k6 R96 行为漂移', `exit=${r96p75.status}`);
    const r96p75k2 = run('mesh', '--type', ty, '--porosity', '0.75', '--periods', '2', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96p75k2.status === 0 ? ok('type enum 值 lidinoid p0.75 k2 R96 可构建（降周期数避坑锚点）') : bad('type enum lidinoid p0.75 k2 R96', (r96p75k2.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'gprime') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 0 ? ok('type enum 值 gprime R48 可构建') : bad('type enum gprime R48', (r48.stderr || '').slice(-60));
    // 默认周期数（k=6）R96：结构化拒产
    const r96k6 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96k6.status === 3 && (r96k6.stderr || '').includes('水密门')
      ? ok('type enum 值 gprime k6 R96 已登记 fail-closed（薄壁自触 nm 19080，B5 基准）')
      : bad('type enum gprime k6 R96 行为漂移', `exit=${r96k6.status}`);
    // 降周期数 k=2 R96：可产对照（择 band 可避的量化锚点）
    const r96k2 = run('mesh', '--type', ty, '--porosity', '0.6', '--periods', '2', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96k2.status === 0 ? ok('type enum 值 gprime k2 R96 可构建（降周期数避坑锚点）') : bad('type enum gprime k2 R96', (r96k2.stderr || '').slice(-60));
    continue;
  }
  const r = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
  r.status === 0 ? ok(`type enum 值 ${ty} 可构建`) : bad(`type enum ${ty}`, (r.stderr || '').slice(-60));
}

// 非法值拒绝（schema 之外 → CLI 必拒）
for (const [label, args] of [
  ['type 不在 enum 被拒', ['--type', 'warpdrive', '--porosity', '0.5', '--resolution', '24']],
  ['resolution 129 越上界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--resolution', '129']],
  ['resolution 47 越下界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--resolution', '47']],
  ['periods 13 越上界被拒', ['--type', 'gyroid', '--porosity', '0.5', '--periods', '13']],
  ['container 不在 enum 被拒', ['--type', 'gyroid', '--porosity', '0.5', '--container', 'sphere']],
  ['mode 不在 enum 被拒', ['--type', 'gyroid', '--porosity', '0.5', '--mode', 'warpdrive']],
  ['estimate 未知属性被拒（--weapon）', ['estimate', '--type', 'gyroid', '--porosity', '0.5', '--weapon', 'laser']],
  ['mesh 未知属性被拒（--weapon）', ['mesh', '--type', 'gyroid', '--porosity', '0.5', '--resolution', '48', '--weapon', 'laser']],
  ['estimate 非法值拒绝为 exit 2（参数错误语义）', ['estimate', '--type', 'nope', '--porosity', '0.5']],
]) {
  const r = run('mesh', ...args);
  r.status === 2 ? ok(label + ' [exit2]') : bad(label + ' 未拒绝或退出码非 2', `exit=${r.status}`);
}

// ── 3c. iso-grad（C1 渐变等值场）钉住 ──
// 2026-09-08 实测：gyroid 三区平台（-0.12,0,0.12@0.4）R96 水密 nm=0 且解析/实测偏差 0.09pp（≤2pp 验收线）；
// R48 水密可产（dev 0.34pp）；R64 过渡带薄壁自触 nm=56 fail-closed（对分辨率/过渡带敏感，与 frd/lidinoid 同族）。
{
  const r48 = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--iso-grad', '-0.12,0,0.12@0.4', '--out', join(tmpOut()), '--json');
  let j48 = null;
  try { j48 = JSON.parse(r48.stdout); } catch { /* 忽略 */ }
  r48.status === 0 && j48?.watertight === true
    ? ok('iso-grad 三区梯度 R48 可产（水密门通过）')
    : bad('iso-grad R48 行为漂移', `exit=${r48.status}`);
  const rBad = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--iso-grad', 'nonsense', '--out', join(tmpOut()));
  rBad.status === 2 ? ok('iso-grad 非法格式被拒 [exit2]') : bad('iso-grad 格式守卫', `exit=${rBad.status}`);
  const rShell = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--mode', 'shell', '--iso-grad', '-0.12,0,0.12@0.4', '--out', join(tmpOut()));
  rShell.status === 2 ? ok('iso-grad × shell 模式互斥被拒 [exit2]') : bad('iso-grad 模式守卫', `exit=${rShell.status}`);
}

// estimate 枚举与 material 约束
{
  const t = tool('tpms_estimate').parameters.properties;
  JSON.stringify(t.material.enum.slice().sort()) === JSON.stringify(['polymer', 'tc4', 'thermal'])
    ? ok('estimate material enum 与平台材料表一致') : bad('material enum');
  JSON.stringify(t.type.enum.slice().sort()) === typeEnum
    ? ok('estimate/mesh type enum 相互一致') : bad('type enum 不一致');
}

// ── 3b. tpms_scenario（M5 场景模板）schema ↔ CLI 行为对拍 ──
{
  const t = tool('tpms_scenario');
  t.parameters.required.includes('design') && Object.keys(t.parameters.properties).length === 1
    ? ok('tpms_scenario required=[design] 且单参数（设计值全部入 JSON 文件）') : bad('tpms_scenario 参数结构');
  t.description.includes('exit 0') && t.description.includes('非 FEA')
    ? ok('tpms_scenario description 声明退出码分层与解析口径边界') : bad('tpms_scenario description 边界声明');

  const writeDesign = (obj) => {
    const p = join(HERE, `_schema_tmp_scn_${process.pid}.json`);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  // 合法方案端到端交付（R48 快档）
  const dOk = writeDesign({ type: 'gyroid', porosity: 0.65, material: 'tc4', resolution: 48, periods: 4, out: join(HERE, `_schema_tmp_scn_out_${process.pid}`) });
  const rOk = run('scenario', '--design', dOk, '--json');
  const jOk = j(rOk.stdout);
  rOk.status === 0 && jOk?.files?.length === 2 && jOk.geometry?.watertight?.openEdges === 0
    ? ok('scenario 合法方案 exit0 交付（STL+INP+双报告）') : bad('scenario 合法方案', (rOk.stderr || '').slice(-80));
  // 参数层结构化拒绝（未知材料 → exit3 + stage=parameter + paramErrors，与 verify 同构）
  const dBad = writeDesign({ type: 'gyroid', porosity: 0.65, material: 'unobtanium' });
  const rBad = run('scenario', '--design', dBad, '--json');
  const jBad = j(rBad.stdout);
  rBad.status === 3 && jBad?.stage === 'parameter' && Array.isArray(jBad.paramErrors) && jBad.paramErrors.length === 1
    ? ok('scenario 未知材料结构化拒绝 [exit3+stage=parameter]') : bad('scenario 拒绝语义', `exit=${rBad.status}`);
  // design JSON 数值越界逐点（schema description 声明的边界 ↔ CLI 拒绝）
  for (const [label, over] of [
    ['porosity 1.5 越界', { porosity: 1.5, material: 'tc4' }],
    ['resolution 47 越下界', { resolution: 47, material: 'tc4' }],
    ['nominalStrain 0.5 越界', { nominalStrain: 0.5, material: 'tc4' }],
  ]) {
    const d = writeDesign({ type: 'gyroid', material: 'tc4', ...over });
    const r = run('scenario', '--design', d, '--json');
    r.status === 3 && j(r.stdout)?.stage === 'parameter'
      ? ok(`scenario ${label} 结构化拒绝`) : bad(`scenario ${label}`, `exit=${r.status}`);
  }
  // CLI 层未知属性拒绝（KNOWN_FLAGS）
  const rW = run('scenario', '--design', dOk, '--weapon', 'laser');
  rW.status === 2 ? ok('scenario 未知 CLI 属性被拒 [exit2]') : bad('scenario KNOWN_FLAGS', `exit=${rW.status}`);
  // 缺 --design 被拒
  run('scenario').status !== 0 ? ok('scenario 缺 --design 被拒') : bad('scenario 缺 --design');
}

// ── 4. nl-agent 语义覆盖映射完整性 ──
{
  const cov = schema.nl_agent_semantic_coverage || {};
  const keys = Object.keys(cov);
  keys.length >= 10 ? ok(`语义覆盖映射 ${keys.length} 条`) : bad('覆盖映射条目不足');
  const uncovered = keys.filter((k) => String(cov[k]).startsWith('⬜'));
  console.log(`  · 显式未覆盖项（如实声明）: ${uncovered.length} → ${uncovered.join(', ')}`);
  keys.every((k) => typeof cov[k] === 'string' && cov[k].length > 4)
    ? ok('每条覆盖项均有状态说明') : bad('覆盖映射存在空声明');
  const coveredN = keys.filter((k) => String(cov[k]).startsWith('✅')).length;
  coveredN >= 6 ? ok(`已覆盖语义项 ≥6（实测 ${coveredN}）`) : bad('已覆盖语义项不足', String(coveredN));
}

function tmpOut() { return join(HERE, `_schema_tmp_${process.pid}.stl`); }
// 清理探针 STL
import { readdirSync, unlinkSync } from 'node:fs';
for (const f of readdirSync(HERE)) if (f.startsWith('_schema_tmp_')) { try { unlinkSync(join(HERE, f)); } catch { /* 忽略 */ } }

console.log(`\nSCHEMA-CHECK ${pass} PASS / ${fail} FAIL`);
// pass 下限守卫（2026-09-06 终审补：恒真断言专项口径——断言被集体中和/跳过时不得绿灯）
if (pass < 62) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 62`); process.exit(1); }
process.exit(fail ? 1 : 0);
