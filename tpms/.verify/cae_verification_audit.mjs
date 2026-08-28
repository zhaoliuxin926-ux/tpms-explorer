/**
 * cae_verification_audit.mjs —— 门禁 19：CAE 仿真验证链审计（纯 Node）
 *
 * A. 求解脚本语法合法性（python ast 解析；abaqus 方言 py2 兼容子集）
 * B. 脚本内容完备性：Abaqus（noGUI/JobFromInputFile/RF/σpl/E 拟合）+
 *    OpenFOAM（simpleFoam/controlDict/flowRatePatch/wallShearStress/Darcy 公式）
 * C. 脚本 ↔ 导出器交叉核对：runner 期望的节点集/patch 名与 buildAbaqusInp/
 *    buildOpenfoamPolyMesh 实际输出 100% 匹配（CAE 解析器前置要求）
 * D. 导出网格格式规范：INP 节点/单元行字段数；polyMesh 五件套 FoamFile 头 +
 *    边界文件 3 patch + 面点索引在界内
 * E. ZIP 打包完整性：验证包 6 文件齐备
 * F. 理论-仿真对比矩阵模板字段完备
 *
 * 运行：node cae_verification_audit.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_verif_audit_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_verif_audit_entry.ts');
  writeFileSync(entry, [
    `export { buildVerificationSuite } from ${JSON.stringify(join(PLATFORM, 'src/export/verification-suite.ts'))};`,
    `export { buildVoxelModel } from ${JSON.stringify(join(PLATFORM, 'src/export/voxel-model.ts'))};`,
    `export { buildAbaqusInp } from ${JSON.stringify(join(PLATFORM, 'src/export/abaqus-inp-exporter.ts'))};`,
    `export { buildOpenfoamPolyMesh } from ${JSON.stringify(join(PLATFORM, 'src/export/openfoam-polymesh-exporter.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildVerificationSuite, buildVoxelModel, buildAbaqusInp, buildOpenfoamPolyMesh } = await import(pathToFileURL(BUNDLE));

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const suite = buildVerificationSuite({ type: 'gyroid', solidCount: 2000, voidCount: 2096 });
const R = 16;
const model = buildVoxelModel({
  type: 'gyroid', periods: 1, weights: [1, 1, 1, 1], structureMode: 'solid_network',
  containerShape: 'cube', thickness: 1.0, targetPorosity: 0.5, iso: 0, customFormula: '',
}, R);
const inp = buildAbaqusInp(model, { youngModulusMPa: 110000, poisson: 0.34, nominalStrain: 0.05, specimenSizeMm: 1 }).text;
const pm = buildOpenfoamPolyMesh(model, 1);

// ── A. 脚本语法合法性 ──
console.log('\n[A] 求解脚本语法（python ast 解析）');
{
  const scripts = [['abaqus_auto_runner.py', suite['abaqus_auto_runner.py']], ['openfoam_auto_runner.py', suite['openfoam_auto_runner.py']]];
  const tmpPy = join(tmpdir(), 'cae_verif_script.py');
  for (const [name, text] of scripts) {
    writeFileSync(tmpPy, text);
    const res = spawnSync('python', ['-c', `import ast; ast.parse(open(r'${tmpPy.replace(/\\/g, '/')}').read()); print('OK')`], { encoding: 'utf8' });
    check(`${name}: ast.parse 通过`, res.stdout.trim() === 'OK', res.stderr.slice(0, 120));
  }
}

// ── B. 脚本内容完备性 ──
console.log('\n[B] 求解脚本内容完备性');
{
  const abq = suite['abaqus_auto_runner.py'];
  check('Abaqus: noGUI 用法 + JobFromInputFile 提交', abq.includes('noGUI=abaqus_auto_runner.py') && abq.includes('JobFromInputFile'));
  check('Abaqus: NSET_TOP 反力提取 + 曲线 CSV', abq.includes("NSET_TOP") && abq.includes('strain,stress_MPa'));
  check('Abaqus: E_FEM 线性拟合 + sigma_peak + sigma_pl(5~25%)', abq.includes('e_fem') && abq.includes('sigma_peak') && abq.includes('sigma_pl'));
  const of = suite['openfoam_auto_runner.py'];
  check('OpenFOAM: simpleFoam + controlDict 构建', of.includes('simpleFoam') && of.includes('controlDict'));
  check('OpenFOAM: flowRatePatch + wallShearStress 后处理', of.includes('flowRatePatch') && of.includes('wallShearStress'));
  check('OpenFOAM: Darcy 公式 κ = Q·μ·L/(A·Δp)', of.includes('kappa = q * mu * args.L / (args.A * args.dp)'));
}

// ── C. 脚本 ↔ 导出器交叉核对 ──
console.log('\n[C] runner 期望 ↔ 导出器输出交叉核对');
{
  const abq = suite['abaqus_auto_runner.py'];
  for (const nset of ['NSET_TOP', 'NSET_BOTTOM']) {
    check(`Abaqus runner 依赖节点集 ${nset} 存在于 INP`, inp.includes(`*NSET, NSET=${nset}`));
  }
  const of = suite['openfoam_auto_runner.py'];
  const bm = pm.files['constant/polyMesh/boundary'];
  for (const patch of ['inlet', 'outlet', 'wall']) {
    check(`OpenFOAM runner 依赖 patch ${patch} 存在于 boundary`, new RegExp(`^\\s{4}${patch}$`, 'm').test(bm));
    check(`OpenFOAM runner 的 0/U 边界含 ${patch}`, new RegExp(`\\b${patch}\\s+\\{`).test(of));
  }
}

// ── D. 导出网格格式规范（CAE 解析器前置要求）──
console.log('\n[D] 导出网格 CAE 解析规范');
{
  // INP：数据行字段
  const nodeSec = inp.split('*NODE\n')[1].split('*')[0].trim().split('\n');
  check('INP 节点行 4 字段（id, x, y, z）', nodeSec.every((ln) => ln.split(',').length === 4));
  const elemSec = inp.split('*ELEMENT, TYPE=C3D8, ELSET=ESOLID\n')[1].split('*')[0].trim().split('\n');
  check('INP 单元行 9 字段（id + 8 节点）', elemSec.every((ln) => ln.split(',').length === 9));
  check('INP 步定义含 *STATIC + *BOUNDARY + *END STEP', inp.includes('*STATIC') && inp.includes('*BOUNDARY') && inp.includes('*END STEP'));

  // polyMesh：FoamFile 头 + 面点索引在界内
  const nPoints = Number(pm.files['constant/polyMesh/points'].match(/\n(\d+)\n\(/)[1]);
  const facesM = pm.files['constant/polyMesh/faces'].match(/\(\n([\s\S]*)\n\)/)[1];
  let idxOK = true;
  for (const ln of facesM.trim().split('\n')) {
    for (const id of ln.trim().replace(/^\(|\)$/g, '').split(' ').map(Number)) {
      if (!(id >= 0 && id < nPoints)) idxOK = false;
    }
  }
  check(`polyMesh 面点索引全部在界内（points=${nPoints}）`, idxOK);
  const ofClass = ['points:vectorField', 'faces:faceList', 'owner:labelList', 'neighbour:labelList', 'boundary:polyBoundaryMesh'];
  check('五件套 FoamFile class/object 声明齐全', ofClass.every((pair) => {
    const [obj, cls] = pair.split(':');
    return pm.files[`constant/polyMesh/${obj}`].includes(`class       ${cls};`) && pm.files[`constant/polyMesh/${obj}`].includes(`object      ${obj};`);
  }));
}

// ── E. ZIP 打包完整性 ──
console.log('\n[E] 验证包 ZIP 完整性');
{
  const names = Object.keys(suite);
  const expected = ['abaqus_auto_runner.py', 'openfoam_auto_runner.py', 'run_abaqus.sh', 'run_openfoam.sh', 'comparison_template.csv', 'README.md'];
  check('6 文件齐备', expected.every((f) => names.includes(f)), names.join(','));
  check('壳脚本引用 runner 文件名', suite['run_abaqus.sh'].includes('abaqus_auto_runner.py') && suite['run_openfoam.sh'].includes('openfoam_auto_runner.py'));
}

// ── F. 对比矩阵模板 ──
console.log('\n[F] 理论-仿真对比矩阵模板');
{
  const tpl = suite['comparison_template.csv'];
  const fields = ['E_FEM', 'sigma_peak', 'sigma_pl', 'kappa', 'wss_avg', 'sea', 'f1_Hz'];
  check('7 项指标字段齐备（力学/流体/冲击/模态）', fields.every((f) => tpl.includes(f)));
  check('验收口径声明（≤15% 解析代理 PASS）', tpl.includes('PASS <= 15%'));
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (failCount > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
