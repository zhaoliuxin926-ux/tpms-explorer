/**
 * strut_exit_audit.mjs —— strut 桁架族跨出口一致性审计（2026-10-11 打磨计划 G1-G5）
 *
 * 背景：codex 对抗审查抓出 strut 双族三处结构性缺陷——G1 尺度口径矛盾（cell=2 对
 * 2πk 域 → πk 个无理倍 cell，边界截断）、G2 Octet 角↔面心邻接 Manhattan 条件恒假
 * （角杆全灭）、G3 提取场分派漏列（V 场走查表尾项=schwarz，实测同参数 strutbcc 与
 * schwarz 三角数逐位相同=交付物实为 schwarz 嵌合体）。本门锁修复后的跨出口契约。
 *
 * 章节：
 *  A. G1 尺度契约：cell=2π（一 TPMS 周期）、域内恰 k 个 cell、周期性精确
 *  B. G2 拓扑锚：独立几何构造的固相/空气期望（节点/杆中点/体心）
 *  C. 独立暴力参考对拍：剪枝/实现回归防护（≤1e-12）
 *  D. G3 分派哨兵：surface-nets/periodic-surface 的 useLookup 排除 + 数值法线清单
 *  E. 跨出口一致性：mesh（bcc 全链）/octet fail-closed/体素/RVE/重建脚本
 *
 * 运行：node strut_exit_audit.mjs（仓库根或 .verify/ 下均可；CLI 级用例走 spawn）
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../agent/core-loader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, detail = '') => { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { fail++; failures.push(name); console.log(`  FAIL ${name} — ${detail}`); };
const check = (name, cond, detail = '') => (cond ? ok(name, detail) : bad(name, detail));

const core = await loadCore();
const fBcc = core.getTpmsFunction('strutbcc');
const fOct = core.getTpmsFunction('strutoctet');
const W = core.getDefaultWeights('strutbcc');
const TAU = 2 * Math.PI;

// ── A. G1 尺度契约（纯函数，秒级）────────────────────────────────
console.log('\n[A] G1 尺度契约：cell=2π=一 TPMS 周期');
{
  // 节点恰在 2π·ℤ³：任意 k 下 cell 边界与域 [−πk,πk] 齐平 → 域内整数个 cell
  for (const k of [1, 3, 5]) {
    let nodes = 0, worst = 0;
    for (let m = -k; m <= k; m++) for (let n = -k; n <= k; n++) for (let l = -k; l <= k; l++) {
      const v = fBcc(m * TAU, n * TAU, l * TAU, W);
      worst = Math.max(worst, Math.abs(v + W[0] * Math.PI));
      if (v < 0) nodes++;
    }
    check(`bcc k=${k}: 节点间距=2π（cell=一周期），格点节点全固相`, worst < 1e-9, `maxDev=${worst.toExponential(2)}`);
    void nodes;
  }
  // 周期性精确（f(p+2π)=f(p)）
  let pd = 0;
  const pts = [[0.3, 1.1, 2.2], [TAU * 0.7, -2.0, 0.5], [1.0, 2.9, -0.4], [-2.5, 0.1, 1.7]];
  for (const [x, y, z] of pts) {
    pd = Math.max(pd, Math.abs(fOct(x, y, z, W) - fOct(x + TAU, y, z, W)), Math.abs(fBcc(x, y, z, W) - fBcc(x, y + TAU, z, W)));
  }
  check('双族周期性 2π 精确（cell 与域 commensurate）', pd < 1e-12, `maxDev=${pd.toExponential(2)}`);
}

// ── B. G2 拓扑锚（独立几何构造期望）──────────────────────────────
console.log('\n[B] G2 拓扑锚：节点/杆中点/体心的固相-空气期望');
{
  const solidAt = (f, x, y, z) => f(x, y, z, W) < 0;
  check('bcc 角节点固相', solidAt(fBcc, 0, 0, 0));
  check('bcc 体心节点固相', solidAt(fBcc, Math.PI, Math.PI, Math.PI));
  check('bcc 角-体心杆中点固相', solidAt(fBcc, Math.PI / 2, Math.PI / 2, Math.PI / 2));
  check('octet 角节点固相（角杆曾全灭——G2 回归锚）', solidAt(fOct, 0, 0, 0));
  check('octet 面心节点固相', solidAt(fOct, Math.PI, Math.PI, 0));
  check('octet 角-面心杆中点固相', solidAt(fOct, Math.PI / 2, Math.PI / 2, 0));
  check('octet 体心空气（FCC 无体心节点——与 bcc 的判别锚）', !solidAt(fOct, Math.PI, Math.PI, Math.PI));
  // 深节点值 = −r（w0·半胞）：胶囊 SDF 在杆轴上的精确值
  const r = W[0] * Math.PI;
  check('节点深度=−r（r=w0·半胞契约）', Math.abs(fBcc(0, 0, 0, W) + r) < 1e-12 && Math.abs(fOct(0, 0, 0, W) + r) < 1e-12, `r=${r.toFixed(4)}`);
}

// ── C. 独立暴力参考对拍（无剪枝 5³ 邻域全杆集合）────────────────
console.log('\n[C] 独立暴力参考对拍（AABB 剪枝零影响实证）');
{
  const seg = (px, py, pz, a, b) => {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / (abx * abx + aby * aby + abz * abz)));
    return Math.hypot(px - (a[0] + t * abx), py - (a[1] + t * aby), pz - (a[2] + t * abz));
  };
  const refDist = (ty, mx, my, mz, w0) => {
    const rr = w0 * Math.PI;
    const ci = Math.floor(mx / TAU), cj = Math.floor(my / TAU), cl = Math.floor(mz / TAU);
    let d = Infinity;
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (let dl = -2; dl <= 2; dl++) {
      const i = ci + di, j = cj + dj, l = cl + dl;
      const corners = [];
      for (let vi = 0; vi < 2; vi++) for (let vj = 0; vj < 2; vj++) for (let vl = 0; vl < 2; vl++)
        corners.push([(i + vi) * TAU, (j + vj) * TAU, (l + vl) * TAU]);
      const faces = [];
      for (const [fx, fy, fz] of [[0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) {
        faces.push([(i + fx) * TAU, (j + fy) * TAU, (l + fz) * TAU]);
        faces.push([(i + 1 - fx) * TAU, (j + 1 - fy) * TAU, (l + 1 - fz) * TAU]);
      }
      if (ty === 'bcc') {
        const bc = [(i + 0.5) * TAU, (j + 0.5) * TAU, (l + 0.5) * TAU];
        for (const c of corners) d = Math.min(d, seg(mx, my, mz, c, bc));
      } else {
        for (const c of corners) for (const fc of faces) {
          if (Math.abs(fc[0] - c[0]) <= 0.501 * TAU && Math.abs(fc[1] - c[1]) <= 0.501 * TAU && Math.abs(fc[2] - c[2]) <= 0.501 * TAU)
            d = Math.min(d, seg(mx, my, mz, c, fc));
        }
        for (let a = 0; a < faces.length; a++) for (let b = a + 1; b < faces.length; b++) {
          const dx = faces[a][0] - faces[b][0], dy = faces[a][1] - faces[b][1], dz = faces[a][2] - faces[b][2];
          if (Math.abs(dx * dx + dy * dy + dz * dz - 0.5 * TAU * TAU) < 1e-6)
            d = Math.min(d, seg(mx, my, mz, faces[a], faces[b]));
        }
      }
    }
    return d - rr;
  };
  let seed = 20261011;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let mdB = 0, mdO = 0;
  const w0s = [0.06, 0.12, 0.25, 0.4];
  for (let n = 0; n < 300; n++) {
    const x = (rnd() * 2 - 1) * 3 * Math.PI, y = (rnd() * 2 - 1) * 3 * Math.PI, z = (rnd() * 2 - 1) * 3 * Math.PI;
    const w0 = w0s[n % 4], WW = [w0, 0, 0, 0];
    mdB = Math.max(mdB, Math.abs(fBcc(x, y, z, WW) - refDist('bcc', x, y, z, w0)));
    mdO = Math.max(mdO, Math.abs(fOct(x, y, z, WW) - refDist('octet', x, y, z, w0)));
  }
  check('bcc 与暴力参考逐点一致（AABB 剪枝零影响）', mdB < 1e-12, `maxDev=${mdB.toExponential(2)}`);
  check('octet 与暴力参考逐点一致', mdO < 1e-12, `maxDev=${mdO.toExponential(2)}`);
}

// ── D. G3 分派哨兵（静态——useLookup 漏列回归）───────────────────
console.log('\n[D] G3 提取场分派哨兵（useLookup/数值法线清单含 strut）');
{
  const sn = readFileSync(join(ROOT, 'tpms/tpms-platform/src/geometry/surface-nets.ts'), 'utf8');
  const ps = readFileSync(join(ROOT, 'tpms/tpms-platform/src/geometry/periodic-surface.ts'), 'utf8');
  const lookupRe = /type !== 'strutbcc' && type !== 'strutoctet'/;
  check('surface-nets useLookup 排除 strut 双族（漏列=schwarz 嵌合体回归）', lookupRe.test(sn));
  check('periodic-surface useLookup 排除 strut 双族（RVE 出口同防）', lookupRe.test(ps));
  check('surface-nets 数值法线清单（c2New）含 strut（防解析查表法线错配）',
    /c2New = type === 'octo'[^;]*type === 'strutoctet'/.test(sn.replace(/\r/g, '')) || /'strutbcc' \|\| type === 'strutoctet'/.test(sn));
}

// ── E. 跨出口一致性 ──────────────────────────────────────────────
console.log('\n[E] 跨出口一致性（mesh/体素/RVE/脚本）');
const BP = (type, extra = {}) => ({ type, iso: 0, periods: 3, resolution: 48, weights: core.getDefaultWeights(type),
  structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0, gradientDir: 'z',
  customFormula: '', preview: false,
  hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 }, ...extra });
{
  // E1 mesh（bcc 全链）：顶点落在真场零面（嵌合体在场上残差 O(1)，必红）
  const t0 = Date.now();
  const r1 = core.buildSurface(BP('strutbcc'));
  const P = r1.positions, k = 3, M = 0.1;
  let maxRes = 0, cnt = 0;
  for (let i = 0; i < P.length; i += 3) {
    if (Math.abs(P[i]) > Math.PI - M || Math.abs(P[i + 1]) > Math.PI - M || Math.abs(P[i + 2]) > Math.PI - M) continue;
    maxRes = Math.max(maxRes, Math.abs(fBcc(P[i] * k, P[i + 1] * k, P[i + 2] * k, W)));
    cnt++;
  }
  check('E1 mesh(bcc): 内部顶点落真场零面（|f|≤1e-3）', cnt > 1000 && maxRes < 1e-3,
    `verts=${r1.positions.length / 3} sampled=${cnt} maxRes=${maxRes.toExponential(2)} ${Date.now() - t0}ms`);
  // E1b 反嵌合体：strutbcc 网格不得再与 schwarz 同构（历史缺陷签名=三角数逐位相同）
  const r1b = core.buildSurface(BP('schwarz'));
  check('E1b mesh(bcc)≠schwarz（三角数分化——嵌合体签名防回归）',
    (r1.indices.length / 3) !== (r1b.indices.length / 3),
    `bcc=${r1.indices.length / 3} schwarz=${r1b.indices.length / 3}`);
}
{
  // E2 mesh（octet）: 真拓扑在 surface-nets 下结构性非流形（12 杆结点多片同胞）——
  // 契约=CLI fail-closed 拒交付（exit 3），绝不落盘破网格。抽取器多片胞改造前为已知边界。
  const r = spawnSync(process.execPath, [join(ROOT, 'tpms/agent/tpms.mjs'), 'mesh', '--type', 'strutoctet',
    '--porosity', '70', '--resolution', '48', '--json'], { encoding: 'utf8', timeout: 600_000, cwd: ROOT });
  const rejected = r.status === 3;
  check('E2 mesh(octet): 非流形 fail-closed（exit 3 结构化拒收，无破网格交付）', rejected,
    `exit=${r.status} ${(r.stderr || '').slice(0, 90).replace(/\n/g, ' ')}`);
}
{
  // E3 体素/CAE 出口：MC 解析 iso（跨出口同源）+ 体素化离散收敛带
  for (const ty of ['strutbcc', 'strutoctet']) {
    const vox = core.buildVoxelModel({ type: ty, periods: 3, weights: core.getDefaultWeights(ty),
      structureMode: 'solid_network', containerShape: 'cube', thickness: 1.0,
      targetPorosity: 0.7, iso: 0, customFormula: '' }, 64);
    let solid = 0;
    for (const b of vox.solid) solid += b;
    const dev = solid / vox.solid.length - 0.3;
    check(`E3 voxel(${ty}): 固相率≈目标（|dev|≤2.5pp，MC iso+细杆体素化离散）`, Math.abs(dev) <= 0.025,
      `solidFrac=${(solid / vox.solid.length).toFixed(4)} dev=${(dev * 100).toFixed(2)}pp iso=${vox.isoUsed.toFixed(4)}`);
    const { iso: mcIso } = core.solveIsoAnalytic(core.getTpmsFunction(ty), 0.7, core.getDefaultWeights(ty), null, `audit:${ty}`);
    check(`E3b voxel(${ty}) isoUsed=MC 解析求根值（跨出口同源）`, Math.abs(vox.isoUsed - mcIso) < 1e-9,
      `vox=${vox.isoUsed.toFixed(6)} mc=${mcIso.toFixed(6)}`);
  }
}
{
  // E4 RVE 出口：MC iso（并列块根除）+ 体数量化带
  for (const ty of ['strutbcc', 'strutoctet']) {
    const rve = core.buildPeriodicSurface({ type: ty, iso: 0, periods: 2, resolution: 32,
      weights: core.getDefaultWeights(ty), targetPorosity: 0.7, structureMode: 'solid_network',
      containerShape: 'cube', thickness: 1.0, customFormula: '' });
    check(`E4 RVE(${ty}): 孔隙率≈目标（|dev|≤6pp，节点栅格并列量化带）`,
      Math.abs(rve.porosityEstimate - 0.7) <= 0.06 && rve.vertCount > 0,
      `porEst=${rve.porosityEstimate.toFixed(4)} verts=${rve.vertCount}`);
  }
}
{
  // E5 重建脚本出口：Python/MATLAB strut 分派在位（交付时才报 Unsupported 的回归防护；
  // 数值 parity 已 2026-10-11 双语实测 1e-15 级，CI 以 C 节独立参考覆盖同构数学）
  const sePy = readFileSync(join(ROOT, 'tpms/tpms-platform/src/export/script-exporter.ts'), 'utf8');
  check('E5 Python 脚本 strut 分派（strut_field + 双族 elif）',
    /def strut_field/.test(sePy) && /elif t == 'strutbcc'[\s\S]*?strut_field\(kk\*X, kk\*Y, kk\*Z, w\[0\], False\)/.test(sePy) && /elif t == 'strutoctet'[\s\S]*?strut_field\(kk\*X, kk\*Y, kk\*Z, w\[0\], True\)/.test(sePy));
  check('E5 MATLAB 脚本 strut 分派（strut_truss_field 局部函数）',
    /function D = strut_truss_field/.test(sePy) && /strut_truss_field\(kk\*X, kk\*Y, kk\*Z, weights\(1\), strcmp\(tpms_type, 'strutoctet'\)\)/.test(sePy));
}

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
if (fail) { console.log('失败项: ' + failures.join(', ')); process.exit(1); }
if (pass < 24) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 24（A3+B8+C2+D3+E12，2026-10-11）`); process.exit(1); }
