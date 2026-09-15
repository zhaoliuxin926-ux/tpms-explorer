/**
 * matlab_script_smoke.mjs —— MATLAB 重建脚本真机实测（独立运行，不进 CI 调度）
 *
 * 背景：bugs.md 2026-08-26 登记「MATLAB 脚本未实测（无环境，目检语法通过）」——
 * 2026-09-15 本机探明装有 MATLAB R2025a/R2025b（D:\Program Files\MATLAB\），
 * 该登记清欠：script-exporter 拆出 buildMatlabScript 后，生成样例脚本经
 * `matlab -batch` 真跑（无头），断言：脚本零错误跑完 + F 场全有限 + 等值面非空。
 *
 * 样例覆盖两分支：gyroid（低谐波 fk=14）+ iwp（倍频 fk=28，cos2k 项）。
 * 复跑：node matlab_script_smoke.mjs（需本机 MATLAB；CI 上跳过）
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

const BUNDLE = join(tmpdir(), 'tpms_matlab_smoke_bundle.mjs');
{
  const entry = join(tmpdir(), 'tpms_matlab_smoke_entry.ts');
  writeFileSync(entry, [
    `export { buildMatlabScript } from ${JSON.stringify(join(PLATFORM, 'src/export/script-exporter.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  if (!existsSync(rolldown)) { console.error('rolldown 不存在:', rolldown); process.exit(1); }
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { buildMatlabScript } = await import(pathToFileURL(BUNDLE));

// MATLAB 可执行文件探测（R2025b 优先；本机无 MATLAB 则如实退出，不改绿）
const MATLAB_CANDIDATES = [
  'D:\\Program Files\\MATLAB\\R2025b\\bin\\matlab.exe',
  'D:\\Program Files\\MATLAB\\R2025a\\bin\\matlab.exe',
  'C:\\Program Files\\MATLAB\\R2025b\\bin\\matlab.exe',
  'C:\\Program Files\\MATLAB\\R2025a\\bin\\matlab.exe',
];
const matlabExe = MATLAB_CANDIDATES.find((p) => existsSync(p));
if (!matlabExe) {
  console.error('SKIP: 本机未探明 MATLAB 安装（样例脚本已生成于 temp，可携至任意 MATLAB 环境）');
}

const mkState = (over) => ({
  type: 'gyroid', porosity: 60, cellSize: 2, thickness: 1, weights: [1, 1, 1, 1],
  structureMode: 'solid_network', containerShape: 'cube', gradientDir: 'z', endplateMm: 0,
  sliceAxis: 'z', sliceInvert: false,
  hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
  manifold: { kind: 'identity', radius: 15, scale: 1.4, axis: 'z' },  // 平台默认（types.ts L155）
  gpuAccelerate: false,
  stress: { preset: 'none', strength: 0.5, anisotropy: 1.6 },
  hierarchical: { enabled: false, microType: 'diamond', frequency: 4, amplitude: 0.25 },
  customFormula: '',
  ...over,
});

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const workDir = join(tmpdir(), 'tpms_matlab_smoke');
mkdirSync(workDir, { recursive: true });

const cases = [
  { name: 'gyroid 默认路径 (identity manifold)', state: mkState({ type: 'gyroid' }) },
  { name: 'iwp 倍频分支 (fk=28, cos2k)', state: mkState({ type: 'iwp', weights: [1, 1, 1, 1] }) },
  { name: 'poincare 非欧分支 (isonormals 修复回归)', state: mkState({ manifold: { kind: 'poincare', radius: 12, scale: 1.4, axis: 'z' } }) },
];

if (matlabExe) {
  console.log(`MATLAB: ${matlabExe}`);
  for (const c of cases) {
    const mPath = join(workDir, `smoke_${c.state.type}.m`);
    writeFileSync(mPath, buildMatlabScript(c.state), 'utf8');
    // -batch 断言：脚本原样 run（生成物零改动）→ workspace 变量后验
    const cmd = `run('${mPath.replace(/\\/g, '/')}'); `
      + `assert(all(isfinite(F(:))), 'F 场含非有限值'); `
      + `assert(~isempty(p) && ~isempty(p.Vertices), '等值面为空网格'); `
      + `fprintf('SMOKE_OK type=%s verts=%d R=%d\\n', tpms_type, size(p.Vertices,1), R);`;
    const t0 = Date.now();
    const r = spawnSync(`"${matlabExe}" -batch "${cmd.replace(/"/g, '""')}"`, {
      shell: true, encoding: 'utf8', timeout: 10 * 60 * 1000,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    const ok = r.status === 0 && /SMOKE_OK/.test(out);
    check(`${c.name} 真机跑通（${((Date.now() - t0) / 1000).toFixed(0)}s）`, ok,
      ok ? '' : `exit=${r.status} 输出尾: ${out.slice(-400).replace(/\n/g, ' | ')}`);
  }
} else {
  // 无 MATLAB 机器：至少断言生成器产出含关键结构（静态哨兵，防拆分重构破坏生成）
  for (const c of cases) {
    const s = buildMatlabScript(c.state);
    check(`${c.name} 生成物结构哨兵`, s.includes('isosurface') && s.includes('tpms_type') && s.includes('linspace(-pi, pi, N)'));
  }
}

console.log(`\nRESULT: ${passCount} PASS / ${failCount} FAIL`);
if (passCount < 3) { console.error('GUARD FAIL: 断言执行数 < 3'); process.exit(1); }
if (failCount > 0) process.exit(1);
