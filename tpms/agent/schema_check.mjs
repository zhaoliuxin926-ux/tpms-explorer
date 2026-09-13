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
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
schema.tools?.length === 5 && ['tpms_list', 'tpms_estimate', 'tpms_mesh', 'tpms_scenario', 'tpms_design_verify'].every((n) => tool(n))
  ? ok('schema 含五工具') : bad('schema 工具清单');
for (const n of ['tpms_estimate', 'tpms_mesh', 'tpms_scenario', 'tpms_design_verify']) {
  const t = tool(n);
  t.parameters.additionalProperties === false && Array.isArray(t.parameters.required)
    ? ok(`${n} additionalProperties=false + required 声明`) : bad(`${n} 参数结构`);
}

// ── 2/3. schema 属性约束 ↔ CLI 行为对拍 ──
const props = tool('tpms_mesh').parameters.properties;
const typeEnum = JSON.stringify(props.type.enum.slice().sort());
const j = (out) => { try { return JSON.parse(out); } catch { return null; } };

// 合法边界通过
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd'];
for (const [label, args, check] of [
  ['resolution 下限 48 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut())], (r) => r.status === 0],
  ['resolution 96 通过', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut())], (r) => r.status === 0],
  ['hybrid × shell 模式参数层拒绝 [exit2]', ['--type', 'gyroid', '--porosity', '0.6', '--resolution', '48', '--hybrid', 'diamond', '--mode', 'shell', '--out', join(tmpOut())], (r) => r.status === 2 && (r.stderr || '').includes('solid_network')],
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
// dprime/cdd 例外（2026-09-10/11 实测）：p0.6 R48 薄壁自触（nm 18252）、R96 可产
//（dprime 偏差 0.13pp / cdd 0.16pp）——与 frd/fks/fky 同族钉住。
for (const ty of TYPES) {
  if (ty === 'dprime' || ty === 'cdd') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    const r48Ok = r48.status === 3 && (r48.stderr || '').includes('水密门')
      && (() => { try { return JSON.parse(r48.stdout).lastAuditCounts?.nonManifoldEdges === 18252; } catch { return false; } })();
    r48Ok
      ? ok(`type enum 值 ${ty} R48 已登记 fail-closed（薄壁自触 nm=18252 数值钉住，红队 B F3）`)
      : bad(`type enum ${ty} R48 行为漂移`, `exit=${r48.status}`);
    const r96 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok(`type enum 值 ${ty} 可构建（R96）`) : bad(`type enum ${ty} R96`, (r96.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'fcky') {
    // 红队 B F2：fcky「R48/R96 可产（偏差 0.26pp）」宣称补双钉（此前落默认分支只钉 R48）
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 0 ? ok(`type enum 值 fcky R48 可构建（比 fky/fks 更健壮锚点）`) : bad(`type enum fcky R48`, (r48.stderr || '').slice(-60));
    const r96 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '96', '--out', join(tmpOut()), '--json');
    r96.status === 0 ? ok(`type enum 值 fcky 可构建（R96，BENCHMARKS 宣称同步钉）`) : bad(`type enum fcky R96`, (r96.stderr || '').slice(-60));
    continue;
  }
  if (ty === 'fcks') {
    const r48 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '48', '--out', join(tmpOut()), '--json');
    r48.status === 3 && (r48.stderr || '').includes('水密门')
      ? ok(`type enum 值 ${ty} R48 已登记 fail-closed（谐波 3× 薄壁自触）`)
      : bad(`type enum ${ty} R48 行为漂移`, `exit=${r48.status}`);
    // 【2026-09-10 修正钉】索引池 6M→9M + pushTri 守卫修复后：R120 可产（nm=0，dev 0.35pp，
    // ~22s）——推翻「预注册曲面无实用可产分辨率」旧裁决（其依据 R128 ">36 分钟"实为
    // 索引池溢出 NaN 死循环）。
    // 【2026-09-11 再修正】R128 端到端仅 ~14s（k6）/~9s（k2）——**性能不是瓶颈**；
    // k6 R128 仍 fail-closed（nm 4896，薄壁自触），但 **k2 R128 水密可产**（nm=0，dev 0.13pp，
    // ~9s）——与 gprime/lidinoid 同族「降周期数避坑」。可产域 = R120 k6 ∪ R128 k2。
    const r120 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '120', '--out', join(tmpOut()), '--json');
    r120.status === 0 ? ok(`type enum 值 ${ty} R120 可构建（修正钉：p0.6 可产锚点）`) : bad(`type enum ${ty} R120`, (r120.stderr || '').slice(-60));
    // 红队 B F3：tools.schema 宣称「R120 p0.5/0.6/0.7 均 nm=0」——补 p0.5/p0.7 两端钉（p0.6 上行已钉）
    for (const pEdge of ['0.5', '0.7']) {
      const rE = run('mesh', '--type', ty, '--porosity', pEdge, '--resolution', '120', '--out', join(tmpOut()), '--json');
      rE.status === 0 ? ok(`type enum 值 ${ty} R120 p${pEdge} 可构建（宣称带端点钉，红队 B F3）`) : bad(`type enum ${ty} R120 p${pEdge}`, (rE.stderr || '').slice(-60));
    }
    const r128k2 = run('mesh', '--type', ty, '--porosity', '0.6', '--periods', '2', '--resolution', '128', '--out', join(tmpOut()), '--json');
    r128k2.status === 0 ? ok(`type enum 值 ${ty} R128 k2 可构建（降周期数避坑锚点，2026-09-11）`) : bad(`type enum ${ty} R128 k2`, (r128k2.stderr || '').slice(-60));
    const r128k6 = run('mesh', '--type', ty, '--porosity', '0.6', '--resolution', '128', '--out', join(tmpOut()), '--json');
    r128k6.status === 3 && (r128k6.stderr || '').includes('水密门')
      ? ok(`type enum 值 ${ty} R128 k6 已登记 fail-closed（薄壁自触 nm 4896）`)
      : bad(`type enum ${ty} R128 k6 行为漂移`, `exit=${r128k6.status}`);
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
  const rHuge = run('mesh', '--type', 'gyroid', '--porosity', '0.65', '--resolution', '48', '--iso-grad', '-100,100@0.4', '--out', join(tmpOut()));
  rHuge.status === 2 && (rHuge.stderr || '').includes('[-1.5, 1.5]')
    ? ok('iso-grad 幅值越界被拒 [exit2]') : bad('iso-grad 幅值守卫', `exit=${rHuge.status}`);
}

// estimate 枚举与 material 约束
{
  const t = tool('tpms_estimate').parameters.properties;
  JSON.stringify(t.material.enum.slice().sort()) === JSON.stringify(['polymer', 'tc4', 'thermal'])
    ? ok('estimate material enum 与平台材料表一致') : bad('material enum');
  JSON.stringify(t.type.enum.slice().sort()) === typeEnum
    ? ok('estimate/mesh type enum 相互一致') : bad('type enum 不一致');
  // 【红队 B】schema enum ≡ CLI BUILTIN_TYPES 交叉比对（第三份硬编码 TYPES 与两者对拍）
  const cliSrc = readFileSync(join(HERE, 'tpms.mjs'), 'utf8');
  const m = cliSrc.match(/const BUILTIN_TYPES = \[([^\]]+)\]/);
  const cliTypes = m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).sort() : [];
  JSON.stringify(cliTypes) === JSON.stringify(props.type.enum.slice().sort())
    ? ok('CLI BUILTIN_TYPES ≡ schema type enum') : bad('CLI/schema enum 不一致', `cli=${cliTypes.length} schema=${props.type.enum.length}`);
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

// ── 3d. tpms_design_verify（M3→M4 桥接）schema ↔ driver/llm-agent 对拍 ──
{
  const meshP = tool('tpms_mesh').parameters.properties;
  const dvP = tool('tpms_design_verify').parameters.properties;
  // 槽位枚举与 tpms_mesh 逐项一致（type/container/material 同源；mode 为 mesh 超集域）
  JSON.stringify(dvP.type.enum) === JSON.stringify(meshP.type.enum)
    ? ok('design_verify ≡ mesh type enum') : bad('design_verify/mesh type enum 不一致');
  JSON.stringify(dvP.container.enum) === JSON.stringify(meshP.container.enum)
    ? ok('design_verify ≡ mesh container enum') : bad('design_verify/mesh container enum 不一致');
  JSON.stringify(dvP.material.enum) === JSON.stringify(tool('tpms_estimate').parameters.properties.material.enum)
    ? ok('design_verify ≡ estimate material enum') : bad('design_verify/estimate material enum 不一致');
  // 闭环不变量：driver 修复菜单的 mode 域 ⊆ 初始槽位 mode 域（修复不得越出初始声明域）
  const drvSrc = readFileSync(join(HERE, 'tpms-driver.mjs'), 'utf8');
  const mRepair = drvSrc.match(/const TYPES = \[([^\]]+)\]/);
  const drvTypes = mRepair ? mRepair[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')) : [];
  JSON.stringify(drvTypes) === JSON.stringify(dvP.type.enum)
    ? ok('driver 修复菜单 TYPES ≡ schema type enum（跨实现静态哨兵）') : bad('driver/schema type enum 漂移', `drv=${drvTypes.length} schema=${dvP.type.enum.length}`);
  // 红队 C C-10：REPAIR_TOOL 非 type 槽位漂移曾无哨兵（porosity 口径分裂/mode 缺项正是发生地）——
  // driver REPAIR_TOOL.patches 与 tools.schema 初始槽位逐项静态对拍
  {
    const drvSrc2 = readFileSync(join(HERE, 'tpms-driver.mjs'), 'utf8');
    const rt = drvSrc2.match(/patches: \{[\s\S]*?\n        \},/);
    if (!rt) bad('REPAIR_TOOL.patches 静态提取失败');
    else {
      const rp = rt[0];
      // patches.type 可为内联枚举或 enum: TYPES 常量引用（后者已被上方 TYPES 哨兵覆盖）
      const rpType = /enum: TYPES\b/.test(rp)
        ? { 1: TYPES.join(',') } // 常量引用形态：等价对拍（TYPES 已 ≡ enum）
        : rp.match(/type: \{[^}]*enum: \[([^\]]*)\]/);
      const rpTypes = rpType ? rpType[1].split(',').map((x) => x.trim().replace(/'/g, '')) : [];
      JSON.stringify(rpTypes) === JSON.stringify(dvP.type.enum)
        ? ok('REPAIR_TOOL.patches.type ≡ schema type enum') : bad('REPAIR_TOOL type 漂移');
      /gradient_shell/.test(rp)
        ? ok('REPAIR_TOOL.patches.mode 含 gradient_shell（与初始槽位同域）') : bad('REPAIR_TOOL mode 缺 gradient_shell');
      /material: \{/.test(rp)
        ? ok('REPAIR_TOOL.patches.material 槽位在位') : bad('REPAIR_TOOL material 缺位');
      const rpP = rp.match(/porosity: \{[^}]*maximum: ([0-9.]+)/);
      rpP && Number(rpP[1]) >= 0.99
        ? ok('REPAIR_TOOL.patches.porosity 口径与初始槽位兼容（小数口径声明在位）', 'max=' + rpP[1]) : bad('REPAIR_TOOL porosity 口径', rpP ? 'max=' + rpP[1] : '未提取');
    }
    // schema_check 自身 TYPES 第三副本显式对拍（原仅 pass>=87 间接兜底）
    JSON.stringify(TYPES) === JSON.stringify(dvP.type.enum)
      ? ok('schema_check TYPES ≡ dv enum（第三副本显式对拍）') : bad('TYPES 第三副本漂移');
  }
  dvP.mode.enum.every((m) => meshP.mode.enum.includes(m))
    ? ok('design_verify mode enum ⊆ mesh（修复域不越初始声明域）') : bad('design_verify mode enum 越域');
  // llm-agent 桥接分支注册哨兵（工具名 ↔ runDesignVerify 分支共存）
  const agentSrc = readFileSync(join(HERE, 'llm-agent.mjs'), 'utf8');
  agentSrc.includes("'tpms_design_verify'") && agentSrc.includes('runDesignVerify') && agentSrc.includes('tpms-driver.mjs')
    ? ok('llm-agent 桥接分支注册（tpms_design_verify → tpms-driver）') : bad('llm-agent 桥接分支缺失');

  // 端到端（离线闭环回归：mock 槽位 + TPMS_ALLOW_MOCK_EXEC 逃生门 + 真实 verify 执行，temp cwd 不污染仓库）
  const work = mkdtempSync(join(tmpdir(), 'schema-bridge-'));
  const runAgent = (mockCalls, { extraEnv = {}, allow = true, dryRun = false } = {}) => {
    const env = { ...process.env, TPMS_MOCK_TOOLCALLS: JSON.stringify(mockCalls), ...extraEnv };
    if (allow) env.TPMS_ALLOW_MOCK_EXEC = '1'; else delete env.TPMS_ALLOW_MOCK_EXEC;
    const args = [join(HERE, 'llm-agent.mjs'), '--provider', 'mock'];
    if (dryRun) args.push('--dry-run');
    args.push('--json', 'e2e');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: work, timeout: 300_000, maxBuffer: 32 * 1024 * 1024, env });
    let out = null;
    try { out = JSON.parse(r.stdout ?? ''); } catch { /* 拒绝路径 stdout 空 */ }
    return { exit: r.status, out, stderr: r.stderr ?? '' };
  };
  const mkCall = (name, args) => ({ toolCalls: [{ function: { name, arguments: JSON.stringify(args) } }] });
  // 直通收敛：gyroid 0.65 R48（快档）→ exit 0 + verdict=pass + design JSON 落盘 + STL 交付
  {
    const r = runAgent(mkCall('tpms_design_verify', { type: 'gyroid', porosity: 0.65, resolution: 48 }));
    const d = r.out?.results?.[0]?.result;
    r.exit === 0 && d?.verdict === 'pass'
      ? ok('桥接端到端直通收敛（exit0+verdict=pass）') : bad('桥接端到端直通', `exit=${r.exit} verdict=${d?.verdict} ${(r.stderr || '').slice(-60)}`);
    existsBridgeDesign(work) ? ok('桥接 design JSON 确定性落盘（tpms-design-<type>.json）') : bad('桥接 design JSON 未落盘');
  }
  // 修复闭环：坏槽位 porosity 1.5（schema 放行、verify 参数层拒）+ mock 决策 patch 0.65 → 2 轮收敛
  {
    const decisions = [{ function: { name: 'apply_repair', arguments: JSON.stringify({ action: 'patch_design', patches: { porosity: 0.65 }, reason: 'porosity 1.5% 低于 5% 下界' }) } }];
    const r = runAgent(mkCall('tpms_design_verify', { type: 'gyroid', porosity: 1.5, resolution: 48 }), { extraEnv: { TPMS_DRIVER_MOCK_DECISIONS: JSON.stringify(decisions) } });
    const d = r.out?.results?.[0]?.result;
    r.exit === 0 && d?.verdict === 'pass' && d?.rounds === 2 && d?.history?.filter((h) => h.decision).length === 1
      ? ok('桥接端到端修复闭环（参数层拒→patch→2轮收敛，决策轨迹在案）') : bad('桥接端到端修复闭环', `exit=${r.exit} verdict=${d?.verdict} rounds=${d?.rounds}`);
  }
  // 越界槽位：porosity 120 → M3 拦截器拒绝（不执行闭环）
  {
    const r = runAgent(mkCall('tpms_design_verify', { type: 'gyroid', porosity: 120 }));
    r.exit === 2 && /拦截器|maximum/.test(r.stderr)
      ? ok('桥接越界槽位被拦截器拒绝 [exit2]') : bad('桥接越界槽位未拒', `exit=${r.exit}`);
  }
  // 红队 A-6 守卫保持：mock 无逃生门默认拒绝真实执行
  {
    const r = runAgent(mkCall('tpms_design_verify', { type: 'gyroid', porosity: 0.65 }), { allow: false });
    r.exit === 2 && /mock provider 仅限/.test(r.stderr)
      ? ok('mock 真实执行默认拒绝守卫保持（TPMS_ALLOW_MOCK_EXEC 显式逃生门）') : bad('mock 守卫失效', `exit=${r.exit}`);
  }
  rmSync(work, { recursive: true, force: true });
}

function existsBridgeDesign(work) {
  try { return readFileSync(join(work, 'tpms-design-gyroid.json'), 'utf8').includes('"gyroid"'); } catch { return false; }
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
// 【2026-09-12 桥接轮基线更新】72→87（tpms_design_verify 五工具 + 3d 节 9 断言 + 语义覆盖映射扩容）
if (pass < 87) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 87`); process.exit(1); }
process.exit(fail ? 1 : 0);
