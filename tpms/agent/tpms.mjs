#!/usr/bin/env node
// tpms.mjs —— TPMS Agent CLI（M0：纯数学层，无浏览器依赖）
//
// 定位：专业 Agent 路线的工具层起点——把平台确定性内核暴露为可脚本化命令。
// 诚实边界（继承项目文化）：本层只做材料级数学近似，几何相关指标
//（比表面积/渗透率/孔径）需网格管线，属 M1 范围，此处不臆造。
//
// 用法：
//   node tpms.mjs list
//   node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]
import { loadCore } from './core-loader.mjs';
import { writeFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ── A2 孔隙率精确求解器（解析积分口径 + 一轮割线校正）──
// 方法对标 RegionTPMS（SoftwareX 2021）：在解析曲面上数值积分求 iso*，使
// 解析孔隙率 = 目标；再经网格实测做一轮割线校正（补偿 surface-nets 网格
// 体积损耗）。确定性：固定种子 LCG，同参数输出逐位一致。
let _lcg = 0x9e3779b9;
function _rnd() { _lcg = (_lcg * 1664525 + 1013904223) >>> 0; return _lcg / 4294967296; }

function porAnalytic(core, type, iso, W, N = 200000, isoGrad = null) {
  const f = core.getTpmsFunction(type);
  // C1 渐变等值场：bias 基准沿 z 分段线性偏移（与 surface-nets biasAt 同语义，形状固定求根 biasBase）
  let biasAt = () => iso;
  if (isoGrad) {
    const stops = isoGrad.stops; // [z, off] 折线（与 surface-nets biasAt 同源结构）
    biasAt = (px, py, pz) => {
      let off;
      if (pz <= stops[0][0]) off = stops[0][1];
      else if (pz >= stops[stops.length - 1][0]) off = stops[stops.length - 1][1];
      else {
        let i = 0;
        while (i < stops.length - 2 && pz > stops[i + 1][0]) i++;
        const [x0, y0] = stops[i], [x1, y1] = stops[i + 1];
        off = y0 + (y1 - y0) * ((pz - x0) / (x1 - x0));
      }
      return iso + off;
    };
  }
  let solid = 0;
  for (let i = 0; i < N; i++) {
    const px = (_rnd() * 2 - 1) * Math.PI, py = (_rnd() * 2 - 1) * Math.PI, pz = (_rnd() * 2 - 1) * Math.PI;
    if (f(px, py, pz, W) < biasAt(px / Math.PI, py / Math.PI, pz / Math.PI)) solid++;
  }
  return 1 - solid / N;
}

/** C1 三区平台折线：values → [z, off] stops（n 平台等距中心 + 过渡带 half=band/2 线性过渡，z 域 [-1,1]）。
 *  例 values=[-0.1,0,0.1] band=0.4 → 平台 0（z∈[-1,-0.2]）→ 过渡 → 平台 0.6 带宽 → 过渡 → 平台 a2。
 *  折线点恒升序（边界钳制后可能产生相邻等值点，插值区间不存在除零）。 */
function gradStops(values, band) {
  const n = values.length;
  const half = Math.max(0, Math.min(band / 2, 1 / (n - 1)));
  const stops = [[-1, values[0]]];
  for (let i = 1; i < n; i++) {
    const c = -1 + (2 * i) / (n - 1);
    const lo = Math.max(-1, c - half), hi = Math.min(1, c + half);
    if (lo > stops[stops.length - 1][0]) stops.push([lo, values[i - 1]]);
    if (hi > stops[stops.length - 1][0]) stops.push([hi, values[i]]);
  }
  if (1 > stops[stops.length - 1][0]) stops.push([1, values[n - 1]]);
  return stops;
}

/** 解析 --iso-grad 参数："<v0,v1,...>[@band]"（z 向三区平台+过渡带；band 默认 0.4）。
 *  返回 buildSurface/porAnalytic 同构的 { dir:'z', stops } 结构。 */
function parseIsoGrad(str, usage) {
  const m = String(str ?? '').match(/^(-?[\d.]+(?:\s*,\s*-?[\d.]+)+)(?:@([\d.]+))?$/);
  if (!m) die(`--iso-grad 格式须为 "<v0,v1,...>[@band]"，如 -0.1,0,0.1@0.4（z 向梯度，值=各平台 iso 偏移）`, usage);
  const values = m[1].split(',').map(Number);
  if (values.some((v) => !Number.isFinite(v))) die('--iso-grad 值须全为有限数字', usage);
  if (values.some((v) => v < -1.5 || v > 1.5)) die('--iso-grad 平台值须在 [-1.5, 1.5]（超出平台 iso 可用域）', usage);
  if (values.length < 2 || values.length > 6) die('--iso-grad 须 2~6 个平台值（1 值无梯度意义；>6 超出支架语义）', usage);
  const band = m[2] !== undefined ? Number(m[2]) : 0.4;
  if (!Number.isFinite(band) || band < 0 || band > 2) die('--iso-grad 过渡带 band 须 0 ≤ b ≤ 2', usage);
  return { dir: 'z', stops: gradStops(values, band), values, band };
}

/** 解析 --hybrid 参数（C1 第二批异族拼接）："<typeB>[:<blend>[:<center>[:<width>[:<axis>]]]]"。
 *  blend ∈ linear|sigmoid（默认 linear=两区平台+线性过渡带——凸组合场连续，零面闭合⇒跨族水密缝合）；
 *  axis ∈ x|y|z|radial（默认 x）。返回 BuildParams.hybrid 同构对象（enabled: true）。 */
function parseHybrid(str, usage) {
  const parts = String(str ?? '').split(':');
  const typeB = parts[0] ?? '';
  if (!BUILTIN_TYPES.includes(typeB)) die(`--hybrid typeB "${typeB}" 不在 ${BUILTIN_TYPES.join('/')}`, usage);
  const blendFunction = parts[1] === undefined || parts[1] === '' ? 'linear' : parts[1];
  if (blendFunction !== 'linear' && blendFunction !== 'sigmoid') die('--hybrid blend 须 linear|sigmoid', usage);
  const blendCenter = parts[2] === undefined || parts[2] === '' ? 0 : Number(parts[2]);
  if (!Number.isFinite(blendCenter) || blendCenter < -1 || blendCenter > 1) die('--hybrid center 须 -1 ≤ c ≤ 1（phys 域）', usage);
  const blendWidth = parts[3] === undefined || parts[3] === '' ? 0.6 : Number(parts[3]);
  if (!Number.isFinite(blendWidth) || blendWidth <= 0 || blendWidth > 2) die('--hybrid width 须 0 < w ≤ 2', usage);
  const axis = parts[4] === undefined || parts[4] === '' ? 'x' : parts[4];
  if (!['x', 'y', 'z', 'radial'].includes(axis)) die('--hybrid axis 须 x|y|z|radial', usage);
  return { enabled: true, typeB, blendFunction, blendCenter, blendWidth, axis };
}

// iso* 跨进程缓存：固定种子 + 固定样本数下 iso*(type,pf) 是确定值，按 key 落盘复用
// （审查 2 节：省 ~0.2s/次；确定性语义不变——同 key 必命中同一结果）。
// key 含四要素（2026-09-06 终审加固）：类型|目标孔隙率|权重|公式指纹(源哈希:样本数)——
// 公式实现或样本量变更后旧缓存自动失活，不静默命中陈旧 iso*。
const ISO_CACHE = new URL('./.iso-cache.json', import.meta.url);
const ISO_CACHE_TMP = new URL('./.iso-cache.json.tmp', import.meta.url);
const MC_BISECT_N = 60000; // 终审实测 30k 固定种子噪声最差 0.235pp 超宣称口径，60k 减半仍省一半采样
let _formulaFp = null;
function formulaFingerprint() {
  if (_formulaFp) return _formulaFp;
  try {
    const src = readFileSync(new URL('../tpms-platform/src/core/tpms-functions.ts', import.meta.url));
    _formulaFp = createHash('sha1').update(src).digest('hex').slice(0, 8);
  } catch { _formulaFp = 'nosrc'; }
  return _formulaFp;
}
function solveIsoAnalytic(core, type, target, W, isoGrad = null) {
  const gradKey = isoGrad ? 'G' + JSON.stringify(isoGrad.stops) : '';
  const key = `${type}|${target.toFixed(6)}|${W.join(',')}|${formulaFingerprint()}:${MC_BISECT_N}${gradKey}`;
  let cache = {};
  try { cache = JSON.parse(readFileSync(ISO_CACHE, 'utf8')); } catch { /* 首次无缓存 */ }
  if (cache[key]) return cache[key];
  let lo = -1.6, hi = 1.6;
  for (let it = 0; it < 34; it++) {
    const mid = (lo + hi) / 2;
    if (porAnalytic(core, type, mid, W, MC_BISECT_N, isoGrad) > target) lo = mid; else hi = mid;
  }
  const iso = (lo + hi) / 2;
  const d = 0.02;
  const slope = (porAnalytic(core, type, iso + d, W, 40000, isoGrad) - porAnalytic(core, type, iso - d, W, 40000, isoGrad)) / (2 * d);
  const result = { iso, slope };
  cache[key] = result;
  // 原子写（终审：直写被并发/中断截断会丢整个缓存）：temp + rename
  try { writeFileSync(ISO_CACHE_TMP, JSON.stringify(cache, null, 1)); renameSync(ISO_CACHE_TMP, ISO_CACHE); } catch { /* 只读环境忽略 */ }
  return result;
}

/**
 * 精确孔隙率求解：解析求根 iso* → build → 网格实测 → 一轮割线校正。
 * 已知物理边界（实测登记）：R48 网格对 iso 的响应含不可约非线性（顶点投影
 * 混沌敏感性），单轮后 diamond ~5pp / gyroid ~2pp；R96 ≤0.1pp。
 */
function solveExactPorosity(core, type, pf, R, buildOnce, isoGrad = null) {
  const W = [1, 1, 1, 1];
  _lcg = 0x9e3779b9; // 每次求解重置种子：确定性
  const { iso, slope } = solveIsoAnalytic(core, type, pf, W, isoGrad);
  let cur = iso;
  let res = buildOnce(cur);
  let est = res.porosityEstimate;
  const trace = [{ iso: cur, est }];
  if (Math.abs(est - pf) > 0.005 && Number.isFinite(slope) && Math.abs(slope) > 1e-6) {
    let next = cur + (pf - est) / slope;
    next = Math.max(-1.6, Math.min(1.6, next - cur > 0.35 ? cur + 0.35 : next < cur - 0.35 ? cur - 0.35 : next));
    const res2 = buildOnce(next);
    // 低分辨率下网格损耗因子随 iso 漂移，割线可能过冲——变差则回退直出
    if (Math.abs(res2.porosityEstimate - pf) < Math.abs(est - pf)) {
      res = res2; est = res2.porosityEstimate;
      trace.push({ iso: next, est });
      cur = next;
    }
  }
  return { res, est, isoUsed: cur, trace };
}


const BUILTIN_TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd', 'slotp', 'fs', 'qstar', 'ws'];
const MATERIAL_LABELS = { tc4: 'Ti-6Al-4V', polymer: 'PLLA/PLA', thermal: '高导热复合材料(≈Al-SiC)' };
const STRUCTURE_MODES = ['solid_network', 'shell', 'gradient_shell'];
const CONTAINER_SHAPES = ['cube', 'cylinder'];

const core = await loadCore();

const BOOL_FLAGS = new Set(['json', 'help']);

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    if (t.includes('=')) { // --key=value 形式
      const eq = t.indexOf('=');
      a[t.slice(2, eq)] = t.slice(eq + 1);
      continue;
    }
    const key = t.slice(2);
    if (BOOL_FLAGS.has(key)) { a[key] = true; continue; } // 布尔开关不吞值
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

function SAFE_OUT_BASENAME(p) {
  // 拒路径穿越；合法绝对路径（tmpdir 等）原样保留
  if (typeof p !== 'string' || !p) return p;
  if (p.includes('..') || p.includes('\0')) {
    console.error('✗ --out 禁止路径穿越（..）');
    process.exit(2);
  }
  return p;
}
function die(msg, usage = '') {
  console.error('✗ ' + msg);
  if (usage) console.error(usage);
  process.exit(2);
}

function cmdList(json) {
  const types = BUILTIN_TYPES.map((t) => {
    const { C1 } = core.gibsonAshby(1, t); // ρ̄=1 退化为常数本身
    return { type: t, C1, anisotropy: core.getAnisotropy(t) };
  });
  const materials = Object.fromEntries(Object.entries(core.BASE_MODULUS).map(([k, gpa]) => [
    k, { label: MATERIAL_LABELS[k], modulusGPa: gpa, yieldMPa: core.BASE_YIELD_STRENGTH[k] },
  ]));
  const out = {
    types,
    materials,
    model: { E: 'E*/Es = C1·ρ̄²', sigma: 'σ*/σs = C2·ρ̄^1.5（C2=0.3）', refs: 'Abueidda 2017 / Maskery 2018 / Berger 2017' },
    boundary: '材料级近似；几何相关指标需 M1 网格管线',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('内置曲面（C1 = Gibson-Ashby 刚度系数，anisotropy = 方向模量比）：');
  for (const t of types) console.log(`  ${t.type.padEnd(10)} C1=${t.C1.toFixed(2)}  anisotropy=${t.anisotropy}`);
  console.log('基体材料：');
  for (const [k, m] of Object.entries(materials)) console.log(`  ${k.padEnd(10)} E=${m.modulusGPa} GPa  σ=${m.yieldMPa} MPa  (${m.label})`);
}

function cmdEstimate(a, json) {
  const usage = '用法: node tpms.mjs estimate --type <曲面> --porosity <0~1 或百分数> [--material tc4|polymer|thermal] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"（选项请用 --key value 或 --key=value）`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) {
    die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}（custom 公式沙箱属后续里程碑）`, usage);
  }
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p; // 与平台同口径：>1 视为百分数
  if (pf < 0 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0 ≤ p < 1`, usage);
  const material = String(a.material ?? 'tc4');
  if (!(material in core.BASE_MODULUS)) {
    die(`未知材料 "${material}"，可选: ${Object.keys(core.BASE_MODULUS).join(' ')}`, usage);
  }

  const rel = 1 - pf;
  const { E_Es, sigma_Es, C1 } = core.gibsonAshby(rel, type);
  const C2 = core.gibsonAshby(1, type).sigma_Es; // ρ̄=1 → C2
  const out = {
    command: 'estimate',
    type,
    porosity: pf,
    porosityPercent: pf * 100,
    relativeDensity: rel,
    material,
    materialLabel: MATERIAL_LABELS[material],
    E_over_Es: E_Es,
    youngsModulusGPa: E_Es * core.BASE_MODULUS[material],
    sigma_over_sigmas: sigma_Es,
    yieldStrengthMPa: sigma_Es * core.BASE_YIELD_STRENGTH[material],
    C1,
    C2,
    anisotropy: core.getAnisotropy(type),
    model: 'Gibson-Ashby 开孔泡沫近似: E*/Es=C1·ρ̄², σ*/σs=C2·ρ̄^1.5',
    boundary: '几何相关指标（比表面积/渗透率/孔径/各向异性刚度张量）需网格管线，M1 提供',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 力学估算（Gibson-Ashby 开孔泡沫近似）');
  console.log(`  曲面类型    ${out.type}`);
  console.log(`  孔隙率      ${(pf * 100).toFixed(1)}%（相对密度 ρ̄ = ${rel}）`);
  console.log(`  基体材料    ${material}（${out.materialLabel}）`);
  console.log('  ───────────────────────────────');
  console.log(`  E* / Es     = ${E_Es.toFixed(6)}`);
  console.log(`  E*          = ${out.youngsModulusGPa.toFixed(3)} GPa`);
  console.log(`  σ* / σs     = ${sigma_Es.toFixed(6)}`);
  console.log(`  σ*          = ${out.yieldStrengthMPa.toFixed(1)} MPa`);
  console.log(`  各向异性比  ${out.anisotropy}`);
  console.log('  ───────────────────────────────');
  console.log('  边界: ' + out.boundary);
}

// ── M1 几何闭环：参数 → 体素场 → Surface Nets → STL（不经浏览器）──────────
// 自检口径与 .verify/mesh_audit.mjs 同源：开放边/非流形/退化面三硬指标，任一非零
// 即判失败且【不产出 STL】——水密门不过不交货。

function auditMeshIndices(positions, indices, opts) {
  const triCount = indices.length / 3;
  const vertCount = positions.length / 3;
  const KM = vertCount + 1;
  // 退化判据模式（radial-grad MT 管线解锁，2026-09-15）：'absolute'（默认，|cross|²≤1e-18，
  // surface-nets 管线历史契约）| 'shape'（尺度无关 area/max_edge²<1e-12——manifold_audit
  // 2026-09-11 先例判据：等边微楔片是相切带的真实离散几何计为合法，针形仍拦）
  const shapeMode = opts?.degenMode === 'shape';
  const edgeKeys = new Float64Array(triCount * 3);
  let n = 0, degenTris = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    if (i0 === i1 || i1 === i2 || i0 === i2) { degenTris++; continue; }
    edgeKeys[n++] = (i0 < i1 ? i0 * KM + i1 : i1 * KM + i0) * 2 + (i0 < i1 ? 0 : 1);
    edgeKeys[n++] = (i1 < i2 ? i1 * KM + i2 : i2 * KM + i1) * 2 + (i1 < i2 ? 0 : 1);
    edgeKeys[n++] = (i2 < i0 ? i2 * KM + i0 : i0 * KM + i2) * 2 + (i2 < i0 ? 0 : 1);
    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
    const ax = positions[p1] - positions[p0], ay = positions[p1 + 1] - positions[p0 + 1], az = positions[p1 + 2] - positions[p0 + 2];
    const bx = positions[p2] - positions[p0], by = positions[p2 + 1] - positions[p0 + 1], bz = positions[p2 + 2] - positions[p0 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (shapeMode) {
      const maxE2 = Math.max(ax * ax + ay * ay + az * az, bx * bx + by * by + bz * bz,
        (positions[p1] - positions[p2]) ** 2 + (positions[p1 + 1] - positions[p2 + 1]) ** 2 + (positions[p1 + 2] - positions[p2 + 2]) ** 2);
      if (maxE2 > 0 && (cx * cx + cy * cy + cz * cz) / (4 * maxE2) < 1e-24) degenTris++;
    } else if (cx * cx + cy * cy + cz * cz <= 1e-18) degenTris++;
  }
  const edges = edgeKeys.subarray(0, n);
  edges.sort(); // TypedArray 数值排序
  let openEdges = 0, nonManifoldEdges = 0, misorientedEdges = 0;
  for (let i = 0; i < n; ) {
    const undKey = Math.floor(edges[i] / 2);
    let ab = 0, ba = 0; // ab = min→max 计数，ba = max→min 计数
    while (i < n && Math.floor(edges[i] / 2) === undKey) {
      if (edges[i] % 2 === 0) ab++; else ba++;
      i++;
    }
    const total = ab + ba;
    if (total === 1) openEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (ab === 0 || ba === 0) misorientedEdges++; // total==2 但两三角同向
  }
  return { triCount, degenTris, openEdges, nonManifoldEdges, misorientedEdges };
}

// ── B-t4.0 M4 内环自校正：solve 命令 ──
// 闭环语义：解析求根 → build → 网格实测 → 校正 iso → 重复，直至收敛或判定不可达。
// 可达性判定（诚实边界）：iso 触界 / 连续两轮无改善 ⇒ 该分辨率下物理不可达，
// 输出结构化诊断（非静默放弃），退出码 3。

function cmdSolve(a, json) {
  const usage = '用法: node tpms.mjs solve --type <曲面> --porosity <0~1|百分数> [--resolution 64] [--periods 6] [--tolerance 0.01] [--max-rounds 5] [--container cube|cylinder] [--mode solid_network|shell|gradient_shell] [--out 文件.stl] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}`, usage);
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p;
  if (pf < 0.05 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0.05 ≤ p < 1`, usage);
  const periods = a.periods === undefined ? 6 : Number(a.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) die('periods 须为 1~12 整数', usage);
  const resolution = a.resolution === undefined ? 64 : Number(a.resolution);
  if (!Number.isInteger(resolution) || resolution < 48 || resolution > 128) die('resolution 须为 48~128 整数', usage);
  const container = String(a.container ?? 'cube');
  if (!CONTAINER_SHAPES.includes(container)) die(`未知容器 "${container}"`, usage);
  const mode = String(a.mode ?? 'solid_network');
  if (!STRUCTURE_MODES.includes(mode)) die(`未知结构模式 "${mode}"`, usage);
  const tolerance = a.tolerance === undefined ? 0.01 : Number(a.tolerance);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.2) die('tolerance 须为 0 < t ≤ 0.2', usage);
  const maxRounds = a['max-rounds'] === undefined ? 5 : Number(a['max-rounds']);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 8) die('max-rounds 须为 1~8 整数', usage);
  const isoGrad = a['iso-grad'] !== undefined ? parseIsoGrad(a['iso-grad'], usage) : null;
  const isoGrad0 = isoGrad ? { dir: 'z', stops: isoGrad.stops } : null;
  if (isoGrad && mode !== 'solid_network') die('--iso-grad 暂仅支持 solid_network 模式', usage);
  const hybridS = a.hybrid !== undefined ? parseHybrid(a.hybrid, usage) : null;
  if (hybridS && isoGrad) die('--hybrid 与 --iso-grad 暂不支持组合', usage);
  if (hybridS && mode !== 'solid_network') die('--hybrid 暂仅支持 solid_network 模式', usage);

  const buildOnce = (iso) => {
    core.globalBufferPool.reset();
    return core.buildSurface({
      type, iso, periods, resolution, targetPorosity: undefined,
      weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
      thickness: 1.0, gradientDir: 'z',
      customFormula: '', preview: false, isoGrad,
      hybrid: hybridS ?? { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    }, core.globalBufferPool);
  };

  _lcg = 0x9e3779b9;
  const W = [1, 1, 1, 1];
  const { iso: iso0, slope } = solveIsoAnalytic(core, type, pf, W, isoGrad0);

  const trace = [];
  let iso = iso0, est = NaN, res = null, audit = null, best = null;
  let unreachable = null, prevDev = Infinity, stall = 0;
  let round = 0;

  for (; round < maxRounds; round++) {
    try {
      res = buildOnce(iso);
    } catch (e) {
      unreachable = { reason: 'build_throw', detail: String(e?.message ?? e), iso };
      break;
    }
    if (res.type === 'error' || !res.positions) {
      unreachable = { reason: 'build_error', detail: String(res.message ?? res.type), iso };
      break;
    }
    audit = auditMeshIndices(res.positions, res.indices);
    est = res.porosityEstimate;
    const dev = Math.abs(est - pf);
    const wt = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
    trace.push({ round, iso: +iso.toFixed(6), est: +est.toFixed(6), deviation: +dev.toFixed(6), watertight: wt });
    // best 只记水密轮：不可达诊断的备选建议必须指向网格表示可靠的 iso
    if (wt && (!best || dev < best.deviation)) best = { iso: +iso.toFixed(6), est: +est.toFixed(6), deviation: +dev.toFixed(6) };

    // 水密门前移（与 mesh 同承诺：水密不过不交货、不继续迭代——网格表示已不可信）。
    // 【终审修复】此前只查 nm/degen 漏掉 openEdges，且收敛交付前无水密检查，
    // 曾静默交付 12.1MB 非水密 STL（gyroid R64 第 3 轮 open>0 实录）
    if (!wt) {
      unreachable = { reason: 'water_tightness', detail: `open=${audit.openEdges} nm=${audit.nonManifoldEdges} degen=${audit.degenTris}（该分辨率/孔隙率/iso 组合网格表示不可靠）`, iso };
      break;
    }
    if (dev <= tolerance) break;
    // 收敛停滞：连续两轮校正无改善
    if (round > 0 && dev >= prevDev - 1e-9) stall++;
    else stall = 0;
    if (stall >= 1 && round >= 2) {
      unreachable = { reason: 'stall', detail: `校正无改善（dev=${dev.toFixed(4)}），保守早退防震荡；该分辨率下物理受限`, iso };
      break;
    }
    prevDev = dev;

    // 校正：首轮解析斜率，之后两点割线（数值历史，非字符串解析）
    let slopeUse = slope;
    if (trace.length >= 2) {
      const [p1, p2] = trace.slice(-2);
      const den = (p2.est - p1.est) / (p2.iso - p1.iso);
      if (Number.isFinite(den) && Math.abs(den) > 1e-6) slopeUse = den;
    }
    let next = iso + (pf - est) / slopeUse;
    const step = Math.max(-0.35, Math.min(0.35, next - iso));
    next = iso + step;
    if (next <= -1.6 || next >= 1.6) {
      unreachable = { reason: 'iso_boundary', detail: `iso 触界 ${next.toFixed(3)}（目标在该分辨率下不可达）`, iso };
      break;
    }
    iso = next;
  }

  // 结构化诊断
  if (!unreachable && (round >= maxRounds) && Math.abs(est - pf) > tolerance) {
    unreachable = { reason: 'max_rounds', detail: `${maxRounds} 轮未收敛（best 偏差 ${(best.deviation * 100).toFixed(2)}pp）`, iso };
  }
  // 收敛但水密不达标（理论上前向门已拦，双保险）
  if (!unreachable && !(audit && audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0)) {
    unreachable = { reason: 'water_tightness', detail: '收敛但水密指标非零（双保险拦截止产出）', iso };
  }

  const suggestions = [];
  if (unreachable) {
    if (resolution < 96) suggestions.push(`提高 --resolution 96（当前 ${resolution}；孔隙率偏差随分辨率收敛）`);
    if (pf < 0.15) suggestions.push('孔隙率目标过接近全实心，建议 ≥0.15 或改用 shell 模式');
    if (pf > 0.9) suggestions.push('孔隙率目标过接近全空，建议 ≤0.9');
    suggestions.push(`best: iso=${best ? best.iso : '—'} est=${best ? (best.est * 100).toFixed(2) + '%' : '—'}`);
  }

  const out = {
    command: 'solve', type, porosity: pf, periods, resolution, container, mode,
    tolerance, maxRounds, rounds: trace.length,
    isoGrad: isoGrad ? { values: isoGrad.values, band: isoGrad.band } : undefined,
    reachable: !unreachable,
    unreachable: unreachable ?? undefined,
    best, trace,
    porosityEstimate: est,
    porosityDeviation: est === est ? Math.abs(est - pf) : NaN,
    watertight: audit ? (audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0) : false,
    boundary: 'solve = 解析求根起点 + 网格实测闭环校正；不可达时输出结构化诊断而非静默放弃',
    lastAuditCounts: audit,
  };

  if (unreachable) {
    out.suggestions = suggestions;
    if (json) console.log(JSON.stringify(out, null, 2));
    console.error(`✗ 不可达: ${unreachable.reason} — ${unreachable.detail}` + (suggestions.length ? `
  建议: ${suggestions.join('; ')}` : ''));
    process.exit(3);
  }

  const outFile = String(a.out ?? `tpms-${type}-p${Math.round(pf * 100)}-solved.stl`);
  const stl = core.buildBinarySTL(res.positions, res.indices, core.wcToMmFactor(periods), res.normals);
  writeFileSync(outFile, Buffer.from(stl));
  out.file = outFile;
  out.fileBytes = stl.byteLength;
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 闭环求解（解析求根起点 + 网格实测自校正）');
  console.log(`  目标/收敛    ${(pf * 100).toFixed(1)}% → 实测 ${(est * 100).toFixed(2)}%（偏差 ${(Math.abs(est - pf) * 100).toFixed(2)}pp ≤ 容差 ${(tolerance * 100).toFixed(1)}pp）`);
  console.log(`  轮次         ${trace.length}（iso: ${trace.map((x) => x.iso).join(' → ')})`);
  console.log(`  水密自检     开放边=${audit.openEdges} 非流形=${audit.nonManifoldEdges} 退化面=${audit.degenTris}（索引空间）`);
  console.log(`  STL 已写入   ${outFile}（${(stl.byteLength / 1024).toFixed(1)} KB）`);
}

function cmdMesh(a, json) {
  const usage = '用法: node tpms.mjs mesh --type <曲面> --porosity <0~1|百分数> [--periods 6] [--resolution 64] [--container cube|cylinder] [--mode solid_network|shell|gradient_shell] [--porosity-solver exact|legacy] [--out 文件.stl] [--json]（注: 官方容差矩阵标定域 k≤5；k=6 非标定域，薄壁族建议 --periods ≤5；径向双族分区: --region-inner <族> [--region-r 0.55] [--region-blend 0.15]）';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}`, usage);
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p;
  if (pf < 0.05 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0.05 ≤ p < 1（近全实心的网格无工程意义）`, usage);
  const periods = a.periods === undefined ? 6 : Number(a.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) die('periods 须为 1~12 整数（上限保证 R≤96 时每周期 ≥8 格）', usage);
  // 平台缓冲池容量硬约束：N³ > 1e6 即 throw（units.ts 分辨率档位 R≤99）——CLI 上限对齐
  const resolution = a.resolution === undefined ? 64 : Number(a.resolution);
  if (!Number.isInteger(resolution) || resolution < 48 || resolution > 128) die('resolution 须为 48~128 整数', usage);
  const container = String(a.container ?? 'cube');
  if (!CONTAINER_SHAPES.includes(container)) die(`未知容器 "${container}"，可选: ${CONTAINER_SHAPES.join(' ')}`, usage);
  const mode = String(a.mode ?? 'solid_network');
  if (!STRUCTURE_MODES.includes(mode)) die(`未知结构模式 "${mode}"，可选: ${STRUCTURE_MODES.join(' ')}`, usage);
  const isoGradM = a['iso-grad'] !== undefined ? parseIsoGrad(a['iso-grad'], usage) : null;
  if (isoGradM && mode !== 'solid_network') die('--iso-grad 暂仅支持 solid_network 模式', usage);
  const hybridM = a.hybrid !== undefined ? parseHybrid(a.hybrid, usage) : null;
  if (hybridM && isoGradM) die('--hybrid 与 --iso-grad 暂不支持组合（渐变基准下的异族拼接待定案）', usage);
  if (hybridM && a['porosity-solver'] === 'legacy') die('--hybrid 需 exact 求解器（legacy 体素二分无混合语义）', usage);
  if (hybridM && mode !== 'solid_network') die('--hybrid 暂仅支持 solid_network 模式', usage);

  // ── 【M(r) 空间映射径向梯度】（论文几何借鉴，2026-09-15）：--radial-grad K 启用。
  // periods 语义变为域内晶胞数（论文口径直径 12 晶胞）；ta/tb 默认按论文比例折算 L=1mm
  //（论文 L=2.5mm/ta=0.5 → 平台 ta=0.2；tb=nTop 标定表 ×0.4）；设计密度由公式决定（禁二分）
  const RG_TB_TABLE = { 1.25: 0.278, 1.5: 0.322, 1.75: 0.345, 2.0: 0.370 };
  let radialM = null;
  if (a['radial-grad'] !== undefined) {
    const K = Number(a['radial-grad']);
    if (!Number.isFinite(K) || K < 1 || K > 3) die('--radial-grad K 须 1 ≤ K ≤ 3（1=均匀 P 基准；论文序列 1/1.25/1.5/1.75/2）', usage);
    if (type !== 'schwarz') die('--radial-grad 须 --type schwarz（论文口径 P 曲面）', usage);
    if (mode !== 'solid_network') die('--radial-grad 须 --mode solid_network', usage);
    if (container !== 'cube') die('--radial-grad 须 --container cube（立方采样域 + 场内圆柱裁剪——论文 export_stl.py 同方案，绕过壳场×容器交线盲区）', usage);
    if (isoGradM || hybridM) die('--radial-grad 与 --iso-grad/--hybrid 互斥', usage);
    if (a['container-mesh'] !== undefined) die('--radial-grad 与 --container-mesh 互斥（归一化域即映射域）', usage);
    if (periods < 2) die('--radial-grad 须 periods ≥ 2（单周期域无径向梯度意义，与 validateRadialGrad 声明口径对齐）', usage);
    const ta = a.ta === undefined ? 0.2 : Number(a.ta);
    if (!Number.isFinite(ta) || ta <= 0 || ta > 2) die('--ta 须 0 < t ≤ 2 mm（中心壁厚，默认 0.2=论文 0.5 按 L 比例折算）', usage);
    let tb = a.tb === undefined ? (RG_TB_TABLE[K] ?? 0.3) : Number(a.tb);
    if (!Number.isFinite(tb) || tb <= 0 || tb > 2) die('--tb 须 0 < t ≤ 2 mm（边缘壁厚，默认按 nTop 标定表折算）', usage);
    if (K === 1) tb = ta; // K=1 均匀分支 tb 不参与
    // 壁厚体素比守卫（fail-fast，2026-09-15 实测：ta·R/periods≈1 时薄壁自触非流形 6444 边拒产）
    const voxPerWall = (ta * resolution) / periods;
    if (voxPerWall < 2) die(`壁厚体素数不足（ta·R/periods=${voxPerWall.toFixed(2)} < 2）——亚体素壁必致非流形拒产；升 --resolution（如 128）或降 --periods 或增 --ta`, usage);
    radialM = { K, sizeMm: periods, taMm: ta, tbMm: tb };
  }

  // ── 【径向双族分区构型】（bimodal scaffold，2026-09-17）：--region-inner <族> 启用。
  // 内区（r1<rSplit）放 inner 族、外区放 --type 族，过渡带 smoothstep 凸组合
  // （凸组合同号不变性 ⟹ 无额外零面；C1 权重 ⟹ 法线连续——surface-nets 原生管线水密门同标准）。
  // 两族共享 periods/thickness/iso；互斥面与 --radial-grad 同清单。
  // 退化锚：--region-r 1 ⟹ 纯外族；--region-r 0 ⟹ 纯内族（与单族基准逐字节一致，探针用）。
  let regionM = null;
  if (a['region-inner'] !== undefined || a['region-r'] !== undefined || a['region-blend'] !== undefined) {
    if (a['region-inner'] === undefined) die('--region-r/--region-blend 须与 --region-inner 成对出现', usage);
    const inner = String(a['region-inner']);
    if (!BUILTIN_TYPES.includes(inner)) die(`--region-inner 未知曲面族 "${inner}"（可选: ${BUILTIN_TYPES.join(' ')}）`, usage);
    if (inner === type) die(`--region-inner 与 --type 同族（${type}）无分区语义`, usage);
    if (mode !== 'solid_network') die('--region 须 --mode solid_network', usage);
    if (container !== 'cube') die('--region 须 --container cube（分区半径按归一化圆柱半径 r1 定义）', usage);
    if (isoGradM || hybridM || radialM) die('--region 与 --iso-grad/--hybrid/--radial-grad 互斥', usage);
    if (a['container-mesh'] !== undefined) die('--region 与 --container-mesh 互斥', usage);
    const rS = a['region-r'] === undefined ? 0.55 : Number(a['region-r']);
    if (!Number.isFinite(rS) || rS < 0 || rS > 1) die('--region-r 须 0 ≤ r ≤ 1（归一化圆柱半径；0.55 默认；端点值=单族退化锚）', usage);
    const bl = a['region-blend'] === undefined ? 0.15 : Number(a['region-blend']);
    if (!Number.isFinite(bl) || bl < 0.02 || bl > 0.6) die('--region-blend 须 0.02 ≤ b ≤ 0.6（过渡带全宽，归一化域）', usage);
    regionM = { innerType: inner, rSplit: rS, blend: bl };
  }

  const params = {
    type, iso: 0, periods, resolution, targetPorosity: pf,
    weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
    thickness: 1.0, gradientDir: 'z',
    customFormula: '', preview: false,
    hybrid: hybridM ?? { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1, axis: 'x' },
    isoGrad: isoGradM ? { dir: 'z', stops: isoGradM.stops } : undefined,
    radialGrad: radialM,
    regionGrad: regionM,
  };
  // ── 【C5 v9.0】mesh 容器：外部流形 STL → 体素 SDF（fail-closed 于非水密输入）──
  // 【红队 A C-1 修复】本段曾在 1314fc7 被宣称实装但补丁静默失败（replace 未命中仍打印
  // success），KNOWN_FLAGS 放行 flag 后静默忽略用户意图、产出 cube 裁剪 STL——CLI 接入
  // 实为 2026-09-13 对抗审查轮才真正落地，RELEASE_NOTES 的 CLI 宣称自此成立。
  let meshDomain = null;
  let mr = null;
  if (a['container-mesh'] !== undefined) {
    const meshPath = String(a['container-mesh']);
    let buf;
    try { buf = readFileSync(meshPath); } catch (e) { die(`容器 STL 读取失败: ${e?.message ?? e}`, usage); }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    try { mr = core.computeMeshSDF(ab, resolution + 1); } catch (e) { die(`容器 STL 不合格: ${e?.message ?? e}`, usage); }
    meshDomain = mr.domain;
    params.containerMeshSdf = mr.sdf;
    params.containerVolumePhys = mr.volumePhys; // 孔隙率分母唯一定义源（容器口径专项）
    params.containerBlend = a['container-blend'] !== undefined ? Number(a['container-blend']) : 0;
    if (!Number.isFinite(params.containerBlend) || params.containerBlend < 0 || params.containerBlend > 1) {
      die('--container-blend 须 0 ≤ h ≤ 1（>1 会全域实体化，红队 A MINOR-3 域校验）', usage);
    }
    if (isoGradM || hybridM) die('--container-mesh 与 --iso-grad/--hybrid 暂不支持组合', usage);
  }
  // ── 【方向 C 2026-09-13】C5 容器 CFD polyMesh 四 patch 导出（规格书：fail-closed 语义）──
  const cfdPoly = a['cfd-polyMesh'] === true || a['cfd-polyMesh'] === 'true';
  const flowAxisS = a['flow-axis'] !== undefined ? String(a['flow-axis']) : undefined;
  if (cfdPoly && a['container-mesh'] === undefined)
    die('--cfd-polyMesh 当前作用域 = --container-mesh（C5 容器）；cube/cylinder 走平台 UI 既有三 patch 导出', usage);
  if (cfdPoly && flowAxisS === undefined)
    die('--cfd-polyMesh 须显式 --flow-axis x|y|z（任意流形流向自动识别 ill-posed——方向 C 规格书 fail-closed）', usage);
  if (!cfdPoly && flowAxisS !== undefined)
    die('--flow-axis 仅与 --cfd-polyMesh 组合使用', usage);
  if (flowAxisS !== undefined && !['x', 'y', 'z'].includes(flowAxisS))
    die(`--flow-axis 须 x|y|z（收到 "${flowAxisS}"）`, usage);
  const solver = String(a['porosity-solver'] ?? 'exact');
  if (!['exact', 'legacy'].includes(solver)) die(`未知求解器 "${solver}"，可选 exact|legacy`, usage);

  core.globalBufferPool.reset();
  let res;
  let porTrace;
  try {
    if (radialM) {
      // M(r) 径向梯度：Marching Tetrahedra 提取管线（解锁战役定案）——surface-nets 对该场的
      // |P| 折痕/max 尖点结构性非流形（三轮实测），MT 的 cell corner 二值化免疫之（论文 MC 同机理）；
      // 复合场 = max(P²−C(r)², r1²−1, |Z|−1)：平方壳场 + 场内圆柱裁剪（论文 export_stl.py 方案）
      const Ln = 2 / periods, invKP = 1 / (periods * Math.PI), rc = radialM;
      // clip 边界内移半格（h=0.5/R）：节点网格含边界点，clip=|Z|−1 在 z=±1 节点恒 0
      //（恰等值 corner 海量 → 插值顶点重合 → degen 三角 6.6 万拒产）——内移后边界 corner
      // 恒负、等值面落最后两节点间；几何尺寸损 h（R128 时 0.4%，披露）
      const h = 0.5 / resolution, rb = 1 - h;
      const field = (X, Y, Z) => {
        const [x2, y2, z2] = core.radialGradTransform(X, Y, Z, rc.K);
        const P = core.schwarzPPhase(x2, y2, z2, Ln);
        const C = core.radialGradThresholdAt(X, Y, rc, periods);
        const r1 = Math.hypot(X, Y);
        return Math.max(P * P - C * C, r1 * r1 - rb * rb, Math.abs(Z) - rb);
      };
      const mt = core.marchingTetrahedra(field, resolution);
      // 顶点量化焊接（δ=1e-6，物理尺度 12nm——等值面贴角极限产生的近重合顶点合并；
      // 微三角 → 自环 → 安全过滤[自环边零配对贡献]；删除路线已证死胡同：微三角占共享边，
      // 直接删 open 爆 7004。焊接后边配对审计兜底（open/nm>0 即如实拒产 fail-closed））
      {
        const Pm = mt.positions, D = 1e6; // δ=1e-6（≈12nm）：只收编数值性近重合顶点；等边微楔片
        // （相切带真实几何，实测 820 片/r1>0.95 占 64%/边 2e-5~7e-5）保留——审计走尺度无关判据
        const weldMap = new Map();
        const remap = new Int32Array(Pm.length / 3);
        let wCount = 0;
        for (let v = 0; v < remap.length; v++) {
          const k = Math.round(Pm[v * 3] * D) + ',' + Math.round(Pm[v * 3 + 1] * D) + ',' + Math.round(Pm[v * 3 + 2] * D);
          let id = weldMap.get(k);
          if (id === undefined) { id = wCount++; weldMap.set(k, id); }
          remap[v] = id;
        }
        const keep = [];
        for (let t = 0; t < mt.indices.length; t += 3) {
          const a = remap[mt.indices[t]], b = remap[mt.indices[t + 1]], c = remap[mt.indices[t + 2]];
          if (a === b || b === c || a === c) continue;
          keep.push(mt.indices[t], mt.indices[t + 1], mt.indices[t + 2]); // 原索引输出（位置未动），重映射仅过滤
        }
        mt.indices = Uint32Array.from(keep);
        mt.triCount = keep.length / 3;
      }
      let vol6 = 0;
      const Pp = mt.positions, Ii = mt.indices;
      for (let t = 0; t < Ii.length; t += 3) {
        const i0 = Ii[t] * 3, i1 = Ii[t + 1] * 3, i2 = Ii[t + 2] * 3;
        vol6 += Pp[i0] * (Pp[i1 + 1] * Pp[i2 + 2] - Pp[i1 + 2] * Pp[i2 + 1])
          + Pp[i0 + 1] * (Pp[i1 + 2] * Pp[i2] - Pp[i1] * Pp[i2 + 2])
          + Pp[i0 + 2] * (Pp[i1] * Pp[i2 + 1] - Pp[i1 + 1] * Pp[i2]);
      }
      const volN = Math.abs(vol6) / 6;
      res = {
        positions: mt.positions, indices: mt.indices, normals: mt.normals, triCount: mt.triCount,
        // 圆柱包络（归一域半径 1、高 2）体积 2π；孔隙率=1−固相/包络
        porosityEstimate: Math.max(0, Math.min(1, 1 - volN / (2 * Math.PI))),
        isoUsed: 0,
        radialMtSignedVolume: Math.sign(vol6),
      };
    } else if (regionM) {
      // 径向双族分区：MT 提取管线（radial-grad 先例 1:1）——两族零面在过渡带拓扑重组处
      // 是 surface-nets 结构性非流形（2026-09-17 实测 nm 20~52 与 blend 无关），MT 的 cell
      // corner 二值化免疫之（radial 三轮实测定案同机理）。立方域裁剪（|X|,|Y|,|Z| − rb）
      // 半格内移同 radial clip 语义：等值面完全落域内，MT 网格闭合。
      const rS = regionM.rSplit, bl = regionM.blend, invKP = 1 / (periods * Math.PI);
      const rb = 1 - 0.5 / resolution;
      const fA = core.getTpmsFunction(type);
      const fB = core.getTpmsFunction(regionM.innerType);
      const wts = params.weights;
      const field = (X, Y, Z) => {
        const s = core.regionWeight(Math.hypot(X, Y), rS, bl);
        // 归一化物理坐标 → 度规坐标 mx=wc·k（各族场以度规坐标求值）
        const mx = X / invKP, my = Y / invKP, mz = Z / invKP;
        const v = s * fA(mx, my, mz, wts) + (1 - s) * fB(mx, my, mz, wts);
        return Math.max(v, Math.abs(X) - rb, Math.abs(Y) - rb, Math.abs(Z) - rb);
      };
      const mt = core.marchingTetrahedra(field, resolution);
      // 顶点量化焊接 + 自环过滤（radial MT 分支同款，δ=1e-6）
      {
        const Pm = mt.positions, D = 1e6;
        const weldMap = new Map();
        const remap = new Int32Array(Pm.length / 3);
        let wCount = 0;
        for (let v = 0; v < remap.length; v++) {
          const k = Math.round(Pm[v * 3] * D) + ',' + Math.round(Pm[v * 3 + 1] * D) + ',' + Math.round(Pm[v * 3 + 2] * D);
          let id = weldMap.get(k);
          if (id === undefined) { id = wCount++; weldMap.set(k, id); }
          remap[v] = id;
        }
        const keep = [];
        for (let t = 0; t < mt.indices.length; t += 3) {
          const a = remap[mt.indices[t]], b = remap[mt.indices[t + 1]], c = remap[mt.indices[t + 2]];
          if (a === b || b === c || a === c) continue;
          keep.push(mt.indices[t], mt.indices[t + 1], mt.indices[t + 2]);
        }
        mt.indices = Uint32Array.from(keep);
        mt.triCount = keep.length / 3;
      }
      let vol6 = 0;
      const Pp = mt.positions, Ii = mt.indices;
      for (let t = 0; t < Ii.length; t += 3) {
        const i0 = Ii[t] * 3, i1 = Ii[t + 1] * 3, i2 = Ii[t + 2] * 3;
        vol6 += Pp[i0] * (Pp[i1 + 1] * Pp[i2 + 2] - Pp[i1 + 2] * Pp[i2 + 1])
          + Pp[i0 + 1] * (Pp[i1 + 2] * Pp[i2] - Pp[i1] * Pp[i2 + 2])
          + Pp[i0 + 2] * (Pp[i1] * Pp[i2 + 1] - Pp[i1 + 1] * Pp[i2]);
      }
      const volN = Math.abs(vol6) / 6;
      res = {
        positions: mt.positions, indices: mt.indices, normals: mt.normals, triCount: mt.triCount,
        // 立方包络（归一域 [-1,1]³ 体积 8）；孔隙率=1−固相/包络
        porosityEstimate: Math.max(0, Math.min(1, 1 - volN / 8)),
        isoUsed: 0,
        regionMtSignedVolume: Math.sign(vol6),
      };
    } else if (solver === 'exact') {
      const buildOnce = (iso) => {
        core.globalBufferPool.reset();
        return core.buildSurface({ ...params, iso, targetPorosity: undefined }, core.globalBufferPool);
      };
      const solved = solveExactPorosity(core, type, pf, resolution, buildOnce, isoGradM ? { dir: 'z', stops: isoGradM.stops } : null);
      res = solved.res;
      porTrace = solved.trace;
    } else {
      res = core.buildSurface(params, core.globalBufferPool); // legacy：平台体素分位二分
    }
  } catch (e) {
    // 平台几何失败全部走 throw（容量/非有限场/退化场），统一转 CLI 语义。
    // 【2026-09-10 B-1 修复】构建失败属「3=构建/水密门失败」而非 die 的参数语义 2
    //（与 solve 的 build_throw→exit 3 对齐，见下方退出码约定注释）
    console.error('✗ 网格构建失败: ' + (e?.message ?? String(e)));
    process.exit(3);
  }

  // radial-grad MT 管线：degen 判据走尺度无关口径（manifold_audit 2026-09-11 先例——等边微楔片
  // 为相切带真实离散几何；针形/自环仍拦）
  const audit = auditMeshIndices(res.positions, res.indices, (radialM || regionM) ? { degenMode: 'shape' } : undefined);
  const watertight = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
  // porosityEstimate 平台口径为小数（=1−发散固相/包络，surface-nets 内建钳制），恒 ≤1
  const porEst = res.porosityEstimate;
  const out = {
    command: 'mesh', type, porosity: pf, periods, resolution, container, mode,
    vertCount: res.vertCount, triCount: res.triCount,
    isoUsed: res.isoUsed,
    porosityEstimate: porEst,
    porosityDeviation: Math.abs(porEst - pf),
    envelopeVolume: res.envelopeVolume, // 表观体积（cube/cylinder 解析包络；C5=容器散度体积——口径专项
    audit, watertight,
    lastAuditCounts: audit,
    solver, porosityTrace: porTrace,
    scaleMmPerWc: core.wcToMmFactor(periods),
    boundary: (radialM
      ? 'radial-grad MT 管线：Marching Tetrahedra 提取（论文 MC 同机理）+ 复合场（平方壳 P²−C(r)² + 场内圆柱裁剪 max(r1²−rb², |Z|−rb)）；'
        + '退化判据=尺度无关（area/max_edge²<1e-12，manifold_audit 2026-09-11 先例）——相切带等边微楔片为真实离散几何；'
        + 'clip 边界内移半格（尺寸损 1/R）+ corner 值 η=3e-3 正则化（等值面位移 ~24nm 级）；'
        + 'R128/periods12 产出 ~443 万三角（STL ~221MB）——按需降 resolution/periods 减小；'
      : '')
      + (regionM
      ? '径向双族分区 MT 管线：内区（r1<' + regionM.rSplit + '）族 ' + regionM.innerType + '、外区族 ' + type + '，过渡带 smoothstep 凸组合'
        + '（带宽 ' + regionM.blend + '，归一化域）；Marching Tetrahedra 提取（两族零面在过渡带拓扑重组为 surface-nets 结构性非流形——'
        + '2026-09-17 实测 nm 20~52 与 blend 无关，MT cell corner 二值化免疫，radial-grad 先例同机理）+ 立方域裁剪（边界内移半格，尺寸损 1/R）；'
        + '两族共享 periods/iso=0，--porosity 仅作名义值进报告（分区密度由构型承担，未参与二分）；退化判据=尺度无关；'
      : '')
      + '水密自检 = mesh_audit 同款三硬指标（开放边/非流形/退化面，索引空间）；misoriented 为观测值不设门（导出翻转后全局定向一致性是平台已知盲区）；孔隙率为网格发散体积实测口径，与目标值的口径差随分辨率收敛',
  };
  const outFile = String(a.out ?? `tpms-${type}-p${Math.round(pf * 100)}.stl`);
  // ── 【方向 C】C5 容器 polyMesh：体素流体域（inside∩¬solid）→ 四 patch → STORED ZIP ──
  // 先于水密门构建：polyMesh 源自体素流体域，不依赖 STL 网格——C5 容器属「相对水密域」
  //（审计定案：管壁碎片结构性存在），STL 绝对门失败时 CFD 交付物仍有效（仅拒 STL）
  if (cfdPoly) {
    const vox = core.buildVoxelModel({
      type, periods, weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
      thickness: 1.0, targetPorosity: pf, iso: 0, customFormula: '',
      containerSdf: mr.sdf,
    }, resolution);
    const pm = core.buildOpenfoamPolyMesh(vox, periods, {
      fourPatch: true,
      flowAxis: { x: 0, y: 1, z: 2 }[flowAxisS],
    });
    // 可运行 case 模板（CFD 交付链完整化战役，2026-09-15）：0/{U,p,C}+system+constant+README，
    // 使 zip 解压即 foamRun 可解——字典口径经 FEA_Bone_Scaffold 论文工程验证（SIMPLE 稳态/
    // flowRateInletVelocity/运动压强/upwind/WSS 预埋），细节与坑见 zip 内 README.md
    const flowRate = a['flow-rate'] === undefined ? 8.33e-9 : Number(a['flow-rate']);
    if (!Number.isFinite(flowRate) || flowRate <= 0) die('--flow-rate 须为正体积流量 m³/s（默认 8.33e-9 = 0.5 mL/min）', usage);
    const nuM = a.nu === undefined ? 1.45e-6 : Number(a.nu);
    if (!Number.isFinite(nuM) || nuM <= 0) die('--nu 须为正运动黏度 m²/s（默认 1.45e-6 = DMEM@37°C）', usage);
    const caseFiles = core.buildCaseFiles({
      patches: ['flow_inlet', 'flow_outlet', 'casing_wall', 'tpms_scaffold_wetted'],
      inletPatch: 'flow_inlet', outletPatch: 'flow_outlet',
      wallPatches: ['casing_wall', 'tpms_scaffold_wetted'],
      flowRateM3s: flowRate, nu: nuM,
    });
    const enc = new TextEncoder();
    const entries = Object.entries(pm.files).map(([name, text]) => ({ name, data: enc.encode(text) }));
    for (const [name, text] of Object.entries(caseFiles)) entries.push({ name, data: enc.encode(text) });
    const zipBuf = core.buildStoredZip(entries);
    const cfdFile = outFile.replace(/\.stl$/i, '') + '.polyMesh.zip';
    writeFileSync(cfdFile, Buffer.from(zipBuf));
    out.cfdPolyMesh = {
      file: cfdFile, fileBytes: zipBuf.byteLength,
      fluidCells: pm.stats.cells, internalFaces: pm.stats.internalFaces,
      boundaryFaces: pm.stats.boundaryFaces, patches: pm.stats.patches,
      flowAxis: flowAxisS, flowRateM3s: flowRate, nu: nuM,
      note: '流体域=容器内∩非固相（体素口径）；物理尺度 = voxel 域全宽 periods mm（容器最长轴 0.95×periods）；'
        + 'zip 含可运行 case 模板（0/{U,p,C}+system+README——SIMPLE 稳态/WSS 预埋/两流量点渗透率见 README）',
    };
  }
  if (!watertight) {
    if (cfdPoly) {
      // CFD 交付物独立于 STL 水密门（体素流体域无 STL 水密语义）：产出 zip、拒 STL、显式披露
      out.stlSkipped = `水密门未过（开放边=${audit.openEdges} 非流形=${audit.nonManifoldEdges} 退化面=${audit.degenTris}）——STL 未产出；polyMesh 基于体素流体域不受影响（C5 相对水密域，审计定案）`;
      console.error(`⚠ ${out.stlSkipped}`);
      if (json) { console.log(JSON.stringify(out, null, 2)); return; }
      console.log('CFD polyMesh 已交付（STL 因水密门跳过——见上方警示）');
      return;
    }
    if (json) console.log(JSON.stringify(out, null, 2));
    // 退出码约定：2=参数错误（改输入可解）；3=构建/水密门失败（物理不可产出，升分辨率或改设计）
    console.error(`✗ 水密门未过：开放边=${audit.openEdges} 非流形边=${audit.nonManifoldEdges} 退化面=${audit.degenTris} —— 不产出 STL`);
    process.exit(3);
  }
  const scale = radialM ? periods / 2 : (meshDomain ? meshDomain.scale : core.wcToMmFactor(periods)); // MT 归一域 [−1,1] → mm 直径 periods
  const stl = core.buildBinarySTL(res.positions, res.indices, scale, res.normals);
  writeFileSync(outFile, Buffer.from(stl));
  out.file = outFile;
  out.fileBytes = stl.byteLength;
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 网格导出（Surface Nets，构造性水密）');
  console.log(`  曲面/孔隙率  ${type} @ ${(pf * 100).toFixed(1)}%（等值常数 iso=${res.isoUsed.toFixed(4)}）`);
  console.log(`  结构/容器    ${mode} / ${container}，${periods} 周期 × ${resolution}³ 体素`);
  console.log('  ───────────────────────────────');
  console.log(`  顶点/三角形  ${res.vertCount} / ${res.triCount}`);
  console.log(`  实测孔隙率   ${(porEst * 100).toFixed(2)}%（目标 ${(pf * 100).toFixed(1)}%，偏差 ${(Math.abs(porEst - pf) * 100).toFixed(2)}pp）`);
  if (Math.abs(porEst - pf) > 0.02) console.log('  ⚠ 偏差 >2pp：exact 与 legacy 在不同工况互有胜负（gyroid R48 legacy 更准），可尝试 --porosity-solver legacy；或提高 --resolution（上限 128）');
  console.log(`  水密自检     开放边=${audit.openEdges} 非流形=${audit.nonManifoldEdges} 退化面=${audit.degenTris} → 通过（索引空间定向观测 misoriented=${audit.misorientedEdges}）`);
  console.log(`  STL 已写入   ${outFile}（${(stl.byteLength / 1024).toFixed(1)} KB，单位 mm，${scale.toFixed(4)} mm/wc）`);
}


// 每命令已知 flag 集（schema additionalProperties:false 的 CLI 层实现）
// ── B-t4 跨门禁 verify-loop：verify 命令 ──
// 输入设计方案 JSON，依次过四道检查（参数/构建水密/孔隙率偏差/物理合理性），
// 失败按有限修复策略自动修正（解析割线校正、升分辨率），N 轮内出结构化 verdict。
// 语义承诺：pass 必伴随交付物（STL + 指标）；fail 必伴随逐检查诊断与建议，非静默放弃。

function cmdVerify(core, a, json) {
  const usage = '用法: node tpms.mjs verify --design 设计.json [--max-rounds 5] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const designPath = String(a.design ?? '');
  if (!designPath) die('缺少 --design <设计方案.json>', usage);
  if (!existsSync(designPath)) die(`设计文件不存在: ${designPath}`, usage);
  let design;
  try {
    design = JSON.parse(readFileSync(designPath, 'utf8'));
  } catch (e) {
    die(`设计文件不是合法 JSON: ${e.message}`, usage);
  }
  const maxRounds = a['max-rounds'] === undefined ? 5 : Number(a['max-rounds']);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 8) die('max-rounds 须为 1~8 整数', usage);

  // ── 检查 1：参数合法性（不可自动修复——需人工改设计文件）──
  const paramErrors = [];
  const type = design.type;
  if (!BUILTIN_TYPES.includes(type)) paramErrors.push(`type "${type}" 不在 ${BUILTIN_TYPES.join('/')}`);
  const rawP = design.porosity;
  if (!Number.isFinite(rawP)) paramErrors.push('porosity 缺失或非数字');
  const pf = Number.isFinite(rawP) ? (rawP > 1 ? rawP / 100 : rawP) : NaN;
  if (Number.isFinite(pf) && (pf < 0.05 || pf >= 1)) paramErrors.push(`孔隙率 ${pf} 越界（0.05 ≤ p < 1）`);
  const periods = design.periods ?? 6;
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) paramErrors.push(`periods ${periods} 越界（1~12）`);
  const material = design.material ?? 'tc4';
  if (!(material in core.BASE_MODULUS)) paramErrors.push(`material "${material}" 不在 ${Object.keys(core.BASE_MODULUS).join('/')}`);
  const mode = design.mode ?? 'solid_network';
  if (!STRUCTURE_MODES.includes(mode)) paramErrors.push(`mode "${mode}" 不在 ${STRUCTURE_MODES.join('/')}`);
  const container = design.container ?? 'cube';
  if (!CONTAINER_SHAPES.includes(container)) paramErrors.push(`container "${container}" 不在 ${CONTAINER_SHAPES.join('/')}`);

  // C1 渐变等值场校验（【红队 C C-2 修复】原位置在下方出口检查之后——paramErrors.push 是死代码，
  // 非法 isoGrad 被静默丢弃后照常 exit 0 交付，违反「无静默回退」铁律。整体前移 + 与
  // tools.schema.json 的 isoGrad 槽位同源补全：values 范围 [-1.5,1.5]、元素数 2~6、
  // band 严格 number、未知属性拒绝）
  let isoGradD = null;
  if (design.isoGrad) {
    const g = design.isoGrad;
    if (typeof g !== 'object' || Array.isArray(g)) paramErrors.push('isoGrad 须为 object');
    else {
      for (const k of Object.keys(g)) if (!['values', 'band'].includes(k)) paramErrors.push(`isoGrad 未知属性 "${k}"`);
      const vals = g.values;
      if (!Array.isArray(vals) || vals.length < 2 || vals.length > 6 || vals.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < -1.5 || v > 1.5)) {
        paramErrors.push('isoGrad.values 须为 2~6 个 ∈[-1.5,1.5] 的有限数字');
      } else {
        const band = g.band === undefined ? 0.4 : g.band;
        if (typeof band !== 'number' || !Number.isFinite(band) || band < 0 || band > 2) paramErrors.push('isoGrad.band 须为 0 ≤ b ≤ 2 的数字');
        else isoGradD = { dir: 'z', stops: gradStops(vals, band) };
      }
      if (design.mode && design.mode !== 'solid_network') paramErrors.push('isoGrad 暂仅支持 solid_network 模式');
    }
  }

  if (paramErrors.length) {
    const out = { command: 'verify', design: designPath, verdict: 'fail', stage: 'parameter', paramErrors };
    if (json) console.log(JSON.stringify(out, null, 2));
    console.error('✗ 参数检查未过（需人工修改设计文件）:\n  - ' + paramErrors.join('\n  - '));
    process.exit(3);
  }

  // ── 修复循环：分辨率升档表（水密/构建失败的修复策略）──
  // 【2026-09-12】R128 档位扩容补漏：LADDER 与钳制上限 96→128（此前 mesh/solve 开放 R128
  // 而 verify 仍钳 96——fcks R120 梯外修复被静默降回 96 的根因）
  const LADDER = [48, 64, 96, 128];
  const tol = design.tolerance ?? 0.01;
  let R = Number.isInteger(design.resolution) ? design.resolution : 64;
  if (R < 48) R = 48;
  if (R > 128) R = 128;
  // 【红队 C C-8 修复】非档位起点（如 schema 合法的 R=100）原 indexOf(R)=-1 → nextR=48
  // 先降后升浪费修复轮；改为「向上一档」
  const nextLadder = (cur) => LADDER.find((x) => x > cur);

  const W = [1, 1, 1, 1];
  const attempts = [];
  let verdict = 'fail', finalStage = '', res = null, audit = null, est = NaN, isoUsed = NaN;
  let iso = null;
  const t0 = Date.now();

  // 解析求根只依赖 (type, pf, W, MC_BISECT_N)，与轮次/分辨率无关——循环不变量，算一次复用。
  // （此前在循环内每轮重算：缓存未命中场景下每轮全量 34 轮 MC 二分，纯浪费；
  //   _lcg 仅被 porAnalytic 消耗、buildSurface 确定性，外提不影响轮次间行为。）
  _lcg = 0x9e3779b9; // 重置 LCG：确定性
  const { iso: isoStar, slope: slopeAnalytic } = solveIsoAnalytic(core, type, pf, W, isoGradD);

  for (let round = 1; round <= maxRounds; round++) {
    const attempt = { round, resolution: R, iso: iso === null ? null : +iso.toFixed(4), checks: {} };
    iso = iso === null ? isoStar : iso;

    core.globalBufferPool.reset();
    let built = null, buildErr = null;
    try {
      built = core.buildSurface({
        type, iso, periods, resolution: R, targetPorosity: undefined,
        weights: W, structureMode: mode, containerShape: container,
        thickness: 1.0, gradientDir: 'z',
        hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
        customFormula: '', preview: false, isoGrad: isoGradD,
      }, core.globalBufferPool);
    } catch (e) { buildErr = String(e?.message ?? e); }
    if (buildErr || !built?.positions) {
      attempt.checks.build = { pass: false, detail: buildErr ?? 'empty' };
      attempts.push(attempt);
      finalStage = 'build';
      const nextR = nextLadder(R);
      if (nextR) { R = nextR; continue; }
      break;
    }
    res = built;
    audit = auditMeshIndices(res.positions, res.indices);
    const wt = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
    est = res.porosityEstimate;
    isoUsed = res.isoUsed;

    // 检查 2：水密（失败修复策略：升分辨率）
    attempt.checks.water_tightness = { pass: wt, open: audit.openEdges, nm: audit.nonManifoldEdges, degen: audit.degenTris, misoriented: audit.misorientedEdges };
    if (!wt) {
      attempts.push(attempt);
      finalStage = 'water_tightness';
      const nextR = nextLadder(R);
      if (nextR) { R = nextR; continue; }
      break;
    }

    // 检查 3：孔隙率偏差（失败修复策略：解析斜率割线一步，再不行升分辨率）
    const dev = Math.abs(est - pf);
    attempt.checks.porosity_deviation = { pass: dev <= Math.max(tol, 0.03), deviation: +dev.toFixed(4) };
    attempts.push(attempt);
    if (dev > Math.max(tol, 0.03)) {
      // 修复策略（A2 实测口径）：升分辨率优先（R96 割线后 0.26pp）；已达 96 才用割线微调
      const nextR = nextLadder(R);
      if (nextR) { R = nextR; continue; }
      if (Number.isFinite(slopeAnalytic) && Math.abs(slopeAnalytic) > 1e-6) {
        const step = Math.max(-0.35, Math.min(0.35, (pf - est) / slopeAnalytic));
        iso += step;
        continue;
      }
      finalStage = 'porosity_deviation'; break; // 红队 C C-5
    }

    // 检查 4：物理合理性（E* ∈ (0, 基体模量)）
    const { E_Es } = core.gibsonAshby(1 - pf, type);
    const eStar = E_Es * (core.BASE_MODULUS[material] || 110);
    const physicsOk = eStar > 0 && eStar < (core.BASE_MODULUS[material] || 110);
    attempt.checks.physics_range = { pass: physicsOk, youngsModulusGPa: +eStar.toFixed(3) };
    attempts.push(attempt);
    if (!physicsOk) { finalStage = 'physics_range'; break; }

    verdict = 'pass';
    break;
  }

  const out = {
    command: 'verify', design: designPath, verdict,
    designNormalized: { type, porosity: pf, periods, material, mode, container },
    resolutionUsed: R, rounds: attempts.length, attempts,
    buildTimeMs: Date.now() - t0,
    boundary: 'verify = 跨门禁闭环：参数/构建水密/孔隙率偏差/物理合理性四道检查，失败按有限策略自动修复（割线校正、升分辨率），不可修复项结构化报告',
  };
  if (verdict === 'pass') {
    const outFile = SAFE_OUT_BASENAME(design.out) ?? `tpms-${type}-verified.stl`;
    const stl = core.buildBinarySTL(res.positions, res.indices, core.wcToMmFactor(periods), res.normals);
    try {
      writeFileSync(outFile, Buffer.from(stl));
    } catch (e) { // 红队 C C-1：out='..' 曾 pass 分支裸崩 EISDIR（exit 1 stdout 空）被 driver 吞成不可达
      const outE = { command: 'verify', design: designPath, verdict: 'fail', stage: 'parameter', paramErrors: ['out "' + outFile + '" 写入失败: ' + (e?.code ?? e?.message)] };
      if (json) { console.log(JSON.stringify(outE, null, 2)); process.exitCode = 3; return; }
      console.error('out 写入失败: ' + (e?.message ?? e));
      process.exit(3);
    }
    out.file = outFile;
    out.fileBytes = stl.byteLength;
    out.metrics = {
      porosityEstimate: +est.toFixed(4),
      isoUsed: +isoUsed.toFixed(4),
      vertCount: res.vertCount, triCount: res.triCount,
      youngsModulusGPa: +(core.gibsonAshby(1 - pf, type).E_Es * core.BASE_MODULUS[material]).toFixed(3),
    };
    if (json) { console.log(JSON.stringify(out, null, 2)); return; }
    console.log(`verify PASS（${attempts.length} 轮，R=${R}）→ ${outFile}`);
    console.log(`  实测孔隙率 ${(est * 100).toFixed(2)}% | 三角 ${res.triCount} | 水密三硬指标全零`);
    return;
  }
  out.finalStage = finalStage;
  out.suggestions = [
    finalStage === 'parameter' ? '按 paramErrors 逐项修正设计文件' : null,
    finalStage === 'water_tightness' || finalStage === 'build' ? `分辨率已升至 ${R} 仍失败——该 (曲面, 孔隙率, 容器) 组合在此精度下不可达，建议改曲面族或容器` : null,
    finalStage === 'porosity_deviation' ? `分辨率已升至 ${R} 仍超容差——高谐波族在该分辨率属表示极限，建议 R=96 或放宽 tolerance` : null,
  ].filter(Boolean);
  if (json) { console.log(JSON.stringify(out, null, 2)); process.exitCode = 3; return; } // 红队 C C-5：json fail 曾 exit 0 假成功
  console.error(`✗ verify FAIL @ ${finalStage}`);
  console.error(JSON.stringify(out.suggestions, null, 2));
  process.exit(3);
}

// ── M5 骨支架场景模板：一条指令的端到端交付 ──
// 设计意图 JSON → Gibson-Ashby 解析预测 → exact 孔隙率求解（水密门）→ STL + Abaqus INP → 验证报告。
// 语义承诺：exit 0 必伴随四件交付物（STL/INP/报告 MD+JSON）；失败必伴随结构化诊断（exit 2 参数/exit 3 构建）。
// 口径诚实：STL 网格实测孔隙率（exact 求解校正）与 INP 体素孔隙率（体素分位二分）是同 iso 的两种
// 离散表示，双口径并列披露；力学预测为 Gibson-Ashby 解析工程口径（非 FEA），文献带对比如实引用系数。

const POISSON_BY_MATERIAL = { tc4: 0.34, polymer: 0.4, thermal: 0.3 }; // 基体泊松比（工程常数，INP *ELASTIC 用）

// ── 【战役三 2026-09-14】直接隐式层切：跳过三角网格，V 场 Marching Squares 直出矢量层切 ──
// 数学源 = VoxelModel 的 V 场 + isoUsed（与体素/网格同 iso）；体积口径 = 层切积分 Σ(净面积×层高)，
// 与同模型体素体积（solidCount×h³）构成两独立积分口径对拍（门禁断言，见 gcode_slicer_audit D 节）。
function cmdSlice(a, json) {
  const usage = '用法: node tpms.mjs slice --type <曲面> --porosity <0~1|百分数> [--periods 6] [--resolution 64] [--layers 200] [--out 前缀] [--json]';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const type = String(a.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) die(`未知曲面类型 "${type}"，可选: ${BUILTIN_TYPES.join(' ')}`, usage);
  const p = Number(a.porosity);
  if (!Number.isFinite(p)) die('porosity 必须是数字', usage);
  const pf = p > 1 ? p / 100 : p;
  if (pf < 0.05 || pf >= 1) die(`孔隙率 ${pf} 越界，须 0.05 ≤ p < 1`, usage);
  const periods = a.periods === undefined ? 6 : Number(a.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) die('periods 须为 1~12 整数', usage);
  const resolution = a.resolution === undefined ? 64 : Number(a.resolution);
  if (!Number.isInteger(resolution) || resolution < 48 || resolution > 128) die('resolution 须为 48~128 整数', usage);
  const layers = a.layers === undefined ? 200 : Number(a.layers);
  if (!Number.isInteger(layers) || layers < 8 || layers > 2000) die('layers 须为 8~2000 整数（层高=试样高/层数）', usage);
  const container = String(a.container ?? 'cube');
  if (!['cube', 'cylinder'].includes(container)) die('--container 限 cube|cylinder', usage);
  const mode = String(a.mode ?? 'solid_network');
  if (mode !== 'solid_network') die('--mode 限 solid_network（shell 的等值语义 dv²−(t/2)² 另属）', usage);
  // v2 容器裁剪轮：--container-mesh 解锁 C5 任意流形容器层切（sdf 行区间线性求根 ∩ TPMS 区间）
  let mrSlice = null;
  if (a['container-mesh'] !== undefined) {
    let buf;
    try { buf = readFileSync(String(a['container-mesh'])); } catch (e) { die(`容器 STL 读取失败: ${e?.message ?? e}`, usage); }
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    try { mrSlice = core.computeMeshSDF(ab, resolution + 1); } catch (e) { die(`容器 STL 不合格: ${e?.message ?? e}`, usage); }
  }

  core.globalBufferPool.reset();
  let vox;
  try {
    vox = core.buildVoxelModel({
      type, periods, weights: [1, 1, 1, 1], structureMode: mode,
      containerShape: mrSlice ? 'cube' : container,
      thickness: 1.0, targetPorosity: pf, iso: 0, customFormula: '',
      containerSdf: mrSlice ? mrSlice.sdf : undefined,
    }, resolution);
  } catch (e) {
    console.error('✗ 体素模型构建失败: ' + (e?.message ?? String(e)));
    process.exit(3);
  }
  const res = core.directSlice(vox, layers, periods, {
    containerShape: mrSlice ? 'mesh' : container,
    containerSdf: mrSlice ? mrSlice.sdf : undefined,
  });
  // 输出格式：svg（默认，矢量观察件）/ cli（工业 Common Layer Interface）/ both
  const fmt = String(a.format ?? 'svg');
  if (!['svg', 'cli', 'both'].includes(fmt)) die('--format 须 svg|cli|both', usage);
  const outPrefix = String(a.out ?? `tpms-${type}-p${Math.round(pf * 100)}`);
  const baseName = outPrefix.replace(/\.(svg|cli|stl)$/i, '');
  const svgFile = baseName + '.svg';
  const cliFile = baseName + '.cli';
  const outFiles = [];
  if (fmt === 'svg' || fmt === 'both') {
    writeFileSync(svgFile, core.buildSliceSvg(res, periods), 'utf8');
    outFiles.push(svgFile);
  }
  if (fmt === 'cli' || fmt === 'both') {
    writeFileSync(cliFile, core.buildCliFormat(res, periods), 'utf8');
    outFiles.push(cliFile);
  }

  // 双口径对拍：同模型体素体积（solidCount×h³，独立积分口径）
  const hWc = 2 * Math.PI / resolution;
  const scale = periods / (2 * Math.PI);
  const voxelVol = vox.solidCount * Math.pow(hWc * scale, 3);
  const out = {
    command: 'slice', type, porosity: pf, periods, resolution, layers,
    container: mrSlice ? 'mesh' : container, mode,
    files: outFiles.map((p) => ({ file: p, bytes: statSync(p).size })),
    layerHeightMm: res.layerHeightMm,
    slicedVolumeMm3: res.volumeMm3,
    voxelVolumeMm3: vox.solidCount * Math.pow(hWc * scale, 3),
    crossCaliberDeviationPct: Math.abs(res.volumeMm3 - voxelVol) / voxelVol * 100,
    totalRings: res.totalRings,
    minLayerNetAreaMm2: Math.min(...res.layers.map((l) => l.netArea)),
    boundary: '层切积分体积与体素体积为同模型两独立离散口径（对拍偏差随分辨率/层数收敛）；'
      + '等值面与 mesh/solid 同 iso；跳过三角化无弦化误差；层数即增材层高语义（层高=试样高/层数）；'
      + (mrSlice ? '容器=C5 mesh SDF 行区间线性求根（容器体积口径=散度 volumePhys）' : container === 'cylinder' ? '容器=cylinder 解析区间（精确一阶）' : '容器=cube 域边界'),
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 直接隐式层切（Marching Squares，无三角网格中转）');
  console.log(`  曲面/孔隙率  ${type} @ ${(pf * 100).toFixed(1)}%（iso=${vox.isoUsed.toFixed(4)}）`);
  console.log(`  层切         ${layers} 层 × 层高 ${res.layerHeightMm.toFixed(4)} mm（试样全宽 ${periods} mm）`);
  console.log(`  层切体积     ${res.volumeMm3.toFixed(2)} mm³（体素口径对照 ${voxelVol.toFixed(2)} mm³，偏差 ${out.crossCaliberDeviationPct.toFixed(2)}%）`);
  console.log(`  轮廓环       ${res.totalRings} 个（嵌套定向：外环+ / 内孔−）`);
  for (const p of outFiles) console.log(`  已写入       ${p}（${(statSync(p).size / 1024).toFixed(1)} KB）`);
}

function cmdOverhang(a, json) {
  const usage = '用法: node tpms.mjs overhang --input <模型.stl> [--critical 45] [--search] [--json]\n'
    + '悬垂口径: α=朝下面与水平面夹角（arccos(−N·b)，0°=水平悬挑最危险，90°=竖直墙安全）；α<critical 判需支撑';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const input = String(a.input ?? '');
  if (!input) die('缺少 --input <模型.stl>', usage);
  const critical = a.critical === undefined ? 45 : Number(a.critical);
  if (!Number.isFinite(critical) || critical <= 0 || critical >= 90) die('--critical 须 0 < θ < 90（度，默认 45）', usage);
  const search = a.search === true;
  let buf;
  try { buf = readFileSync(input); } catch (e) { die(`STL 读取失败: ${e?.message ?? e}`, usage); }
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let mesh;
  try { mesh = core.parseSTL(ab); } catch (e) { die(`STL 解析失败: ${e?.message ?? e}`, usage); }
  const check = core.checkMesh(mesh.indices);
  if (!check.watertight) {
    console.error(`✗ 网格非水密（开放边 ${check.openEdges} / 非流形边 ${check.nonManifoldEdges}）——悬垂审计要求封闭流形外向法向，fail-closed 拒绝`);
    process.exit(3);
  }
  let report, searchRes = null;
  try {
    report = core.auditOverhang(mesh.positions, mesh.indices, [0, 0, 1], critical);
    if (search) searchRes = core.searchBuildOrientation(mesh.positions, mesh.indices, critical);
  } catch (e) {
    console.error('✗ 悬垂审计失败: ' + (e?.message ?? String(e)));
    process.exit(3);
  }
  const out = {
    command: 'overhang', input, tris: report.tris, skippedDegenerate: report.skippedDegenerate,
    criticalDeg: critical, buildDir: report.buildDir,
    totalArea: report.totalArea, downFacingArea: report.downFacingArea,
    criticalArea: report.criticalArea, criticalAreaRatio: report.criticalAreaRatio,
    alphaHistogram10deg: report.alphaHistogram,
    ...(searchRes ? { search: searchRes } : {}),
    boundary: 'α=朝下面与水平面夹角（0°=水平悬挑最危险）；45° 为无支撑 FDM/SLM 常用工程阈值（实际 30~60° 因材料/工艺而异）；'
      + '面积加权口径≠支撑材料体积；摆盘寻优仅最小化临界面积比（表面质量/支撑痕位置/构建时间未纳入）；上机前建议与切片器支撑预览交叉复核',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS 可打印性审计（悬垂角 + 面积加权统计）');
  console.log(`  网格         ${report.tris} 三角（退化跳过 ${report.skippedDegenerate}）｜总表面积 ${report.totalArea.toFixed(2)}`);
  console.log(`  悬垂判定     α < ${critical}°（b=[0,0,1]）`);
  console.log(`  朝下面积     ${report.downFacingArea.toFixed(2)}（占全表面 ${(report.downFacingArea / report.totalArea * 100).toFixed(1)}%）`);
  console.log(`  临界面积     ${report.criticalArea.toFixed(2)}（criticalAreaRatio ${(report.criticalAreaRatio * 100).toFixed(2)}%）`);
  console.log('  α 直方图    ' + report.alphaHistogram.map((v, i) => `${i * 10}~${i * 10 + 10}:${((v / report.totalArea) * 100).toFixed(1)}%`).join(' '));
  if (searchRes) {
    console.log(`  最优摆盘     b=[${searchRes.bestDir.map((v) => v.toFixed(4)).join(', ')}] → critical ${(searchRes.bestCriticalRatio * 100).toFixed(2)}%（${searchRes.samples} 采样 Fibonacci 球）`);
  }
}

function cmdCfdPost(a, json) {
  const usage = '用法: node tpms.mjs cfd-post --q1 <m³/s> --dp1 <Pa> --q2 <m³/s> --dp2 <Pa> [--mu 1.45e-3] [--rho 1000] [--kinematic] [--box-mm 6] [--length-mm 6] [--wss <Pa>] [--json]\n'
    + 'Forchheimer 两点分离：ΔP=A·Q+B·Q² → K_int=μL/(A_box·A)（Stokes 截距）；两个流量点来自同一几何两次 CFD；\n'
    + '--kinematic：dp 输入为 mm 单位制 case 直提的运动压差 mm²/s²（自动 ×1e-6×ρ 转 Pa）';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const num = (k, def) => (a[k] === undefined ? def : Number(a[k]));
  const q1 = num('q1', NaN), dp1 = num('dp1', NaN), q2 = num('q2', NaN), dp2 = num('dp2', NaN);
  for (const [k, v] of [['q1', q1], ['dp1', dp1], ['q2', q2], ['dp2', dp2]]) {
    if (!Number.isFinite(v) || v <= 0) die(`--${k} 须为正数（m³/s 或 Pa）`, usage);
  }
  const mu = num('mu', 1.45e-3);
  if (!Number.isFinite(mu) || mu <= 0) die('--mu 须为正动力黏度 Pa·s（默认 1.45e-3 = DMEM@37°C）', usage);
  const rho = num('rho', 1000);
  if (!Number.isFinite(rho) || rho <= 0) die('--rho 须为正密度 kg/m³（默认 1000）', usage);
  const kinematic = a.kinematic === true; // dp 输入为运动压差 mm²/s²（mm 单位制 case 直提）→ Pa = dp×1e-6×ρ
  const boxMm = num('box-mm', 6), lenMm = num('length-mm', 6);
  if (!Number.isFinite(boxMm) || boxMm <= 0 || boxMm > 1000) die('--box-mm 须 0 < L ≤ 1000（盒边长，默认 6 = periods）', usage);
  if (!Number.isFinite(lenMm) || lenMm <= 0 || lenMm > 1000) die('--length-mm 须 0 < L ≤ 1000（轴向长，默认 6）', usage);
  const wss = a.wss === undefined ? null : Number(a.wss);
  if (wss !== null && (!Number.isFinite(wss) || wss < 0)) die('--wss 须为非负壁面剪应力 Pa（面积加权口径）', usage);

  let r;
  try {
    if (Math.abs(q1 - q2) < 1e-30) die('两点分离要求 q1 ≠ q2（同流量两点方程奇异——改输入可解，exit2）', usage);
    // kinematic 模式：dp 为 mm 单位制 case 直提的运动压差 mm²/s² → Pa = dp × 1e-6 × ρ
    const toPa = (dp) => (kinematic ? dp * 1e-6 * rho : dp);
    r = core.forchheimerTwoPoint({ q1, dp1: toPa(dp1), q2, dp2: toPa(dp2), mu, length: lenMm / 1000, area: (boxMm / 1000) ** 2 });
    r = { ...r, dp1Pa: toPa(dp1), dp2Pa: toPa(dp2) };
  } catch (e) {
    console.error('✗ Forchheimer 分离失败: ' + (e?.message ?? String(e)));
    process.exit(3);
  }
  // WSS 文献带诊断：10–30 mPa = 3D 灌注培养促矿化剪应力量级（PNAS 100(25):14683，论文核验口径）
  let wssDiag = null;
  if (wss !== null) {
    const mPa = wss * 1000;
    wssDiag = { wssPa: wss, wssMPa: mPa, inMineralizationBand: mPa >= 10 && mPa <= 30, bandMPa: [10, 30] };
  }
  const out = {
    command: 'cfd-post', q1, dp1, q2, dp2, mu,
    ...(kinematic ? { dp1Pa: r.dp1Pa, dp2Pa: r.dp2Pa, kinematicNote: `dp 输入 mm²/s² 运动压差，已 ×1e-6×ρ(${rho}) 转 Pa` } : {}),
    boxMm, lengthMm: lenMm, areaM2: (boxMm / 1000) ** 2,
    A_Pa_s_per_m3: r.A, B_Pa_s2_per_m6: r.B,
    kInt_m2: r.kInt,
    kApp_m2: r.kApp,
    inertialFractionPct: r.inertialFraction.map((f) => f * 100),
    ...(wssDiag ? { wss: wssDiag } : {}),
    boundary: 'K_int=Stokes 截距（黏性固有渗透率）；两点若落非线性高段 A/B 为区间等效值；'
      + '绝对值受网格敏感性影响（未做网格收敛研究前带区间披露，不报 GCI）；'
      + 'WSS 带 10-30 mPa=3D 灌注培养促矿化量级（PNAS 100(25):14683）',
  };
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log('TPMS CFD 后处理（Forchheimer 两点分离，论文工程验证口径）');
  console.log(`  输入         Q₁=${q1.toExponential(3)} m³/s @ ΔP₁=${dp1.toExponential(3)} Pa｜Q₂=${q2.toExponential(3)} @ ΔP₂=${dp2.toExponential(3)}`);
  console.log(`  Stokes 阻抗  A = ${r.A.toExponential(4)} Pa·s/m³｜惯性系数 B = ${r.B.toExponential(4)} Pa·s²/m⁶`);
  console.log(`  固有渗透率   K_int = ${r.kInt.toExponential(3)} m²（μL/(A_box·A)，μ=${mu.toExponential(2)}、L=${lenMm}mm、A_box=${((boxMm / 1000) ** 2).toExponential(2)} m²）`);
  console.log(`  表观渗透率   K_app(Q₁)=${r.kApp[0].toExponential(3)}｜K_app(Q₂)=${r.kApp[1].toExponential(3)} m²`);
  console.log(`  惯性占比     ${r.inertialFraction.map((f) => (f * 100).toFixed(1)).join('% / ')}%（B·Q²/ΔP）`);
  if (wssDiag) console.log(`  WSS 诊断     ${wssDiag.wssMPa.toFixed(2)} mPa ${wssDiag.inMineralizationBand ? '∈' : '∉'} 促矿化带 [10, 30] mPa`);
}

function cmdScenario(a, json) {
  const usage = '用法: node tpms.mjs scenario --design <方案.json> [--json]\n'
    + '方案 JSON: { type, porosity, material 必填; resolution/periods/container/mode/tolerance/\n'
    + '  nominalStrain/specimenSizeMm/out 可选（默认 64 / 6 / cube / solid_network / 0.01 / 0.05 / periods / scenario-<type>）}';
  if (a._.length) die(`多余的位置参数 "${a._.join(' ')}"`, usage);
  const designPath = String(a.design ?? '');
  if (!designPath) die('缺少 --design <方案.json>', usage);
  let design;
  try { design = JSON.parse(readFileSync(designPath, 'utf8')); } catch (e) { die(`设计文件读取/解析失败: ${e?.message ?? e}`, usage); }
  if (!design || typeof design !== 'object' || Array.isArray(design)) die('设计文件顶层须为 JSON 对象', usage);

  // ── 1. 参数校验（结构化 paramErrors，与 verify 同语义）──
  const paramErrors = [];
  const type = String(design.type ?? '');
  if (!BUILTIN_TYPES.includes(type)) paramErrors.push(`type "${type}" 不在 ${BUILTIN_TYPES.join('/')}`);
  const pRaw = Number(design.porosity);
  const pf = pRaw > 1 ? pRaw / 100 : pRaw;
  if (!Number.isFinite(pRaw)) paramErrors.push('porosity 必须是数字');
  else if (pf < 0.05 || pf >= 1) paramErrors.push(`porosity ${pf} 越界，须 0.05 ≤ p < 1（>1 视为百分数）`);
  const material = String(design.material ?? '');
  if (!(material in core.BASE_MODULUS)) paramErrors.push(`material "${material}" 不在 ${Object.keys(core.BASE_MODULUS).join('/')}`);
  const resolution = design.resolution === undefined ? 64 : Number(design.resolution);
  if (!Number.isInteger(resolution) || resolution < 48 || resolution > 128) paramErrors.push('resolution 须为 48~128 整数');
  const periods = design.periods === undefined ? 6 : Number(design.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) paramErrors.push('periods 须为 1~12 整数');
  const container = String(design.container ?? 'cube');
  if (!CONTAINER_SHAPES.includes(container)) paramErrors.push(`container "${container}" 不在 ${CONTAINER_SHAPES.join('/')}`);
  const mode = String(design.mode ?? 'solid_network');
  if (!STRUCTURE_MODES.includes(mode)) paramErrors.push(`mode "${mode}" 不在 ${STRUCTURE_MODES.join('/')}`);
  const tolerance = design.tolerance === undefined ? 0.01 : Number(design.tolerance);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.2) paramErrors.push('tolerance 须为 0 < t ≤ 0.2');
  const nominalStrain = design.nominalStrain === undefined ? 0.05 : Number(design.nominalStrain);
  if (!Number.isFinite(nominalStrain) || nominalStrain <= 0 || nominalStrain > 0.2) paramErrors.push('nominalStrain 须为 0 < ε ≤ 0.2（小应变压缩口径）');
  const specimenSizeMm = design.specimenSizeMm === undefined ? periods : Number(design.specimenSizeMm);
  if (!Number.isFinite(specimenSizeMm) || specimenSizeMm <= 0 || specimenSizeMm > 1000) paramErrors.push('specimenSizeMm 须为 0 < L ≤ 1000');
  const outPrefix = String(SAFE_OUT_BASENAME(design.out) ?? `scenario-${type}`);
  if (paramErrors.length) {
    const out = { command: 'scenario', stage: 'parameter', paramErrors, designPath };
    if (json) { console.log(JSON.stringify(out, null, 2)); process.exit(3); }
    console.error(`✗ scenario 参数层拒绝（${paramErrors.length} 项）：`);
    for (const e of paramErrors) console.error('  - ' + e);
    process.exit(3);
  }

  const t0 = Date.now();
  const rel = 1 - pf;
  const matGPa = core.BASE_MODULUS[material];
  const poisson = POISSON_BY_MATERIAL[material];

  // ── 2. Gibson-Ashby 解析预测（工程口径，非 FEA）──
  const ga = core.gibsonAshby(rel, type);
  const eStarGPa = ga.E_Es * matGPa;
  const sigmaStarMPa = ga.sigma_Es * core.BASE_YIELD_STRENGTH[material];
  // 文献带（gibson-ashby.ts 头注定案）：E* 经典开孔 C1∈[0.35,0.44]·ρ̄²；σ* 平台 C2=0.3（网格泡沫折中上界）vs 经典开孔 0.23·ρ̄^1.5
  const eBandGPa = [0.35 * rel * rel * matGPa, 0.44 * rel * rel * matGPa];
  const sigmaBandMPa = [0.23 * Math.pow(rel, 1.5) * core.BASE_YIELD_STRENGTH[material], 0.3 * Math.pow(rel, 1.5) * core.BASE_YIELD_STRENGTH[material]];

  // ── 3. exact 孔隙率求解（解析求根 + 网格实测割线校正）──
  // C1 渐变等值场（design JSON：isoGrad: { values: [...], band?: 0.4 }，z 向）。
  // INP 体素模型暂不支持渐变——isoGrad 存在时 INP 跳过，报告如实注明。
  let isoGradS = null;
  if (design.isoGrad) {
    const g = design.isoGrad;
    if (!Array.isArray(g.values) || g.values.length < 2 || g.values.some((v) => !Number.isFinite(v))) {
      paramErrors.push('isoGrad.values 须为 ≥2 个有限数字数组');
    } else {
      const band = g.band === undefined ? 0.4 : Number(g.band);
      if (!Number.isFinite(band) || band < 0 || band > 2) paramErrors.push('isoGrad.band 须 0 ≤ b ≤ 2');
      else isoGradS = { dir: 'z', stops: gradStops(g.values, band) };
    }
    if (mode !== 'solid_network') paramErrors.push('isoGrad 暂仅支持 solid_network 模式');
  }
  const buildOnce = (iso) => {
    core.globalBufferPool.reset();
    return core.buildSurface({
      type, iso, periods, resolution, targetPorosity: undefined,
      weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
      thickness: 1.0, gradientDir: 'z',
      hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
      customFormula: '', preview: false, isoGrad: isoGradS,
    }, core.globalBufferPool);
  };
  _lcg = 0x9e3779b9;
  let solved;
  try { solved = solveExactPorosity(core, type, pf, resolution, buildOnce, isoGradS); } catch (e) {
    console.error(`✗ scenario 构建失败: ${e?.message ?? e}`);
    process.exit(3);
  }
  const res = solved.res;
  const audit = auditMeshIndices(res.positions, res.indices);
  const watertight = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
  if (!watertight) {
    console.error(`✗ scenario 水密门未过：开放边=${audit.openEdges} 非流形边=${audit.nonManifoldEdges} 退化面=${audit.degenTris} —— 该 (曲面, 孔隙率, 容器) 组合在 R=${resolution} 下网格表示不可靠，建议提高 resolution`);
    process.exit(3);
  }
  const meshPorosity = res.porosityEstimate;
  const isoUsed = solved.isoUsed;

  // ── 4. 交付物：STL（mm）+ Abaqus INP（体素 C3D8 + PBC 压缩工况）──
  const scale = core.wcToMmFactor(periods);
  const stlBuf = core.buildBinarySTL(res.positions, res.indices, scale, res.normals);
  const stlFile = `${outPrefix}.stl`;
  writeFileSync(stlFile, Buffer.from(stlBuf));

  let inpText = null, nodeCount = 0, elemCount = 0, voxelPorosity = NaN;
  let voxel = null;
  if (!isoGradS) {
    voxel = core.buildVoxelModel({
      type, periods, weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
      thickness: 1.0, targetPorosity: pf, iso: 0, customFormula: '',
    }, resolution);
    const inp = core.buildAbaqusInp(voxel, {
      youngModulusMPa: matGPa * 1000, poisson, nominalStrain, specimenSizeMm,
    });
    inpText = inp.text; nodeCount = inp.nodeCount; elemCount = inp.elemCount;
    const inpFile = `${outPrefix}.inp`;
    writeFileSync(inpFile, inpText, 'utf8');
    voxelPorosity = 1 - voxel.solidCount / voxel.insideCount; // 容器内体素口径（cube=R³；cylinder=柱内格点——全盒分母曾致 21.5pp 虚高）
  }

  // ── 5. 验证报告（MD + JSON）──
  const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const reportJson = {
    command: 'scenario', scenario: 'bone-scaffold-template (M5)',
    design: { type, porosity: pf, material, materialLabel: MATERIAL_LABELS[material], resolution, periods, container, mode, tolerance, nominalStrain, specimenSizeMm },
    isoGrad: isoGradS ? { values: design.isoGrad.values, band: design.isoGrad.band === undefined ? 0.4 : Number(design.isoGrad.band), dir: 'z' } : undefined,
    geometry: {
      isoUsed: +isoUsed.toFixed(6), rounds: solved.trace.length, porosityTrace: solved.trace,
      meshPorosity: +meshPorosity.toFixed(6), meshPorosityDeviation: +(Math.abs(meshPorosity - pf)).toFixed(6),
      voxelPorosity: Number.isFinite(voxelPorosity) ? +voxelPorosity.toFixed(6) : null,
      voxelSolidCount: Number.isFinite(voxelPorosity) ? voxel.solidCount : null,
      voxelInsideCount: Number.isFinite(voxelPorosity) ? voxel.insideCount : null,
      watertight: { openEdges: audit.openEdges, nonManifoldEdges: audit.nonManifoldEdges, degenTris: audit.degenTris },
      vertCount: res.vertCount, triCount: res.triCount,
    },
    mechanics: {
      method: 'Gibson-Ashby 解析工程口径（非 FEA）',
      relativeDensity: +rel.toFixed(6),
      youngsModulusGPa: +eStarGPa.toFixed(4),
      literatureBandGPa: eBandGPa.map((v) => +v.toFixed(4)),
      inLiteratureBand: eStarGPa >= eBandGPa[0] && eStarGPa <= eBandGPa[1],
      yieldStrengthMPa: +sigmaStarMPa.toFixed(2),
      sigmaNote: '平台 C2=0.3·ρ̄^1.5（网格泡沫折中上界）；经典开孔泡沫 0.23·ρ̄^1.5 为带下界',
      inpElastic: { youngModulusMPa: matGPa * 1000, poisson, nominalStrain, specimenSizeMm },
    },
    files: [
      { path: stlFile, bytes: stlBuf.byteLength, sha256_16: sha16(Buffer.from(stlBuf)), role: '水密网格（mm，打印/CFD）' },
      ...(inpText !== null ? [{ path: `${outPrefix}.inp`, bytes: Buffer.byteLength(inpText), sha256_16: sha16(inpText), role: 'Abaqus 体素压缩模型（C3D8+PBC）', nodeCount, elemCount }] : []),
    ],
    boundary: isoGradS
      ? '报告口径：渐变等值场模式下 INP 体素模型暂不支持（体素二分无渐变语义）已跳过——渐变工况的仿真交付待扩展；力学预测为解析估算非仿真结果'
      : '报告口径：孔隙率双口径（网格实测[容器散度体积分母]/体素分位[容器内体素分母]）随分辨率收敛；INP 体素模型不含端板（多孔芯层口径，端板属增材工艺层）；力学预测为解析估算非仿真结果；INP 压缩结果以 Abaqus 实跑为准',
    elapsedMs: Date.now() - t0,
  };
  const md = [
    `# TPMS 场景验证报告 — ${type} 支架 @ ${(pf * 100).toFixed(1)}% 孔隙率`,
    '',
    `生成：${new Date().toISOString()}｜scenario 命令（M5 骨支架场景模板）｜耗时 ${reportJson.elapsedMs}ms`,
    '',
    '## 1. 设计参数',
    '| 项 | 值 |', '|---|---|',
    `| 曲面族 | ${type} |`, `| 目标孔隙率 | ${(pf * 100).toFixed(1)}% |`,
    `| 材料 | ${MATERIAL_LABELS[material]}（E=${matGPa} GPa, ν=${poisson}） |`,
    `| 结构/容器 | ${mode} / ${container} |`, `| 分辨率/周期 | R=${resolution} / ${periods} 周期 |`,
    `| 试样宽 | ${specimenSizeMm} mm（${scale.toFixed(4)} mm/wc） |`,
    '',
    '## 2. 几何交付（STL 网格）',
    `- 等值常数 iso = ${isoUsed.toFixed(6)}（exact 解析求根 + ${solved.trace.length} 轮网格实测校正）`,
    `- 网格实测孔隙率 **${(meshPorosity * 100).toFixed(2)}%**（目标偏差 ${(Math.abs(meshPorosity - pf) * 100).toFixed(2)}pp）`,
    `- 水密三硬指标：开放边 ${audit.openEdges} / 非流形边 ${audit.nonManifoldEdges} / 退化面 ${audit.degenTris}（全零通过）`,
    `- 顶点 ${res.vertCount} / 三角 ${res.triCount}`,
    '',
    ...(inpText !== null ? [
      '## 3. 仿真交付（Abaqus INP）',
      `- 体素模型 R=${resolution}（C3D8 单元 ${elemCount} 个 / 节点 ${nodeCount} 个，含 PBC 周期边界集与 BOTTOM/TOP 压缩面集）`,
      `- 体素孔隙率 ${(voxelPorosity * 100).toFixed(2)}%（体素分位二分口径；与网格口径的差随 R 收敛，双口径并列披露）`,
      `- 工况：单轴压缩名义应变 ${nominalStrain}（TOP 面位移/L），E=${matGPa * 1000} MPa，ν=${poisson}`,
    ] : [
      '## 3. 仿真交付（Abaqus INP）',
      `- 渐变等值场（isoGrad ${JSON.stringify(design.isoGrad)}）模式下 INP 体素模型暂不支持（体素二分无渐变语义），本报告跳过 INP 交付`,
    ]),
    '',
    '## 4. 力学预测（Gibson-Ashby 解析口径，非 FEA）',
    '| 量 | 平台预测 | 文献带 | 带内 |',
    '|---|---|---|---|',
    `| 相对密度 ρ̄ | ${rel.toFixed(4)} | — | — |`,
    `| E* (GPa) | ${eStarGPa.toFixed(4)} | [${eBandGPa[0].toFixed(4)}, ${eBandGPa[1].toFixed(4)}]（C1∈[0.35,0.44]·ρ̄²） | ${eStarGPa >= eBandGPa[0] && eStarGPa <= eBandGPa[1] ? '✓' : '✗'} |`,
    `| σ* (MPa) | ${sigmaStarMPa.toFixed(2)} | [${sigmaBandMPa[0].toFixed(2)}, ${sigmaBandMPa[1].toFixed(2)}]（0.23~0.3·ρ̄^1.5） | ${sigmaStarMPa >= sigmaBandMPa[0] && sigmaStarMPa <= sigmaBandMPa[1] ? '✓' : '✗'} |`,
    '',
    '## 5. 交付物',
    '| 文件 | 字节 | sha256(16) | 用途 |', '|---|---|---|---|',
    `| ${stlFile} | ${stlBuf.byteLength} | \`${sha16(Buffer.from(stlBuf))}\` | 水密网格（打印/CFD） |`,
    ...(inpText !== null ? [`| ${outPrefix}.inp | ${Buffer.byteLength(inpText)} | \`${sha16(inpText)}\` | Abaqus 体素压缩模型 |`] : []),
    '',
    '## 6. 边界与限制（诚实声明）',
    '- 力学预测为 Gibson-Ashby 解析工程估算，非仿真结果；压缩响应以 Abaqus 实跑为准',
    ...(inpText !== null ? ['- STL（网格）与 INP（体素）是同一 iso 的两种离散表示，孔隙率口径差随分辨率收敛'] : ['- 渐变等值场模式下 INP 体素模型暂不支持（已跳过）']),
    '- 高谐波曲面族（iwp/frd/lidinoid/splitp）低分辨率下网格表示物理受限，偏差 >2pp 时建议 R=96',
    '',
  ].join('\n');
  const mdFile = `${outPrefix}.report.md`;
  const reportJsonFile = `${outPrefix}.report.json`;
  writeFileSync(mdFile, md, 'utf8');
  writeFileSync(reportJsonFile, JSON.stringify(reportJson, null, 2), 'utf8');

  if (json) { console.log(JSON.stringify(reportJson, null, 2)); return; }
  console.log('TPMS 场景交付（M5 骨支架模板：设计 → 求解 → STL+INP → 验证报告）');
  console.log('  ───────────────────────────────');
  console.log(`  方案         ${type} / ${(pf * 100).toFixed(1)}% / ${MATERIAL_LABELS[material]} / R=${resolution} × ${periods} 周期`);
  const voxelTxt = inpText !== null ? `｜体素口径 ${(voxelPorosity * 100).toFixed(2)}%` : '｜渐变模式（INP 跳过）';
  console.log(`  网格实测孔隙率 ${(meshPorosity * 100).toFixed(2)}%（偏差 ${(Math.abs(meshPorosity - pf) * 100).toFixed(2)}pp）${voxelTxt}`);
  console.log(`  E* 预测      ${eStarGPa.toFixed(3)} GPa（文献带 [${eBandGPa[0].toFixed(3)}, ${eBandGPa[1].toFixed(3)}]）`);
  const inpTxt = inpText !== null ? ` + ${outPrefix}.inp（C3D8×${elemCount}）` : '（渐变模式 INP 跳过）';
  console.log(`  交付         ${stlFile}${inpTxt} + ${mdFile} + ${reportJsonFile}`);
}

const KNOWN_FLAGS = {
  list: ['json', 'help'],
  estimate: ['type', 'porosity', 'material', 'json', 'help'],
  mesh: ['type', 'porosity', 'periods', 'resolution', 'container', 'mode', 'porosity-solver', 'iso-grad', 'hybrid', 'container-mesh', 'container-blend', 'cfd-polyMesh', 'flow-axis', 'flow-rate', 'nu', 'radial-grad', 'ta', 'tb', 'region-inner', 'region-r', 'region-blend', 'out', 'json', 'help'],
  solve: ['type', 'porosity', 'periods', 'resolution', 'container', 'mode', 'tolerance', 'max-rounds', 'iso-grad', 'hybrid', 'out', 'json', 'help'],
  verify: ['design', 'max-rounds', 'json', 'help'],
  scenario: ['design', 'json', 'help'],
  slice: ['type', 'porosity', 'periods', 'resolution', 'layers', 'container', 'container-mesh', 'mode', 'format', 'out', 'json', 'help'],
  overhang: ['input', 'critical', 'search', 'json', 'help'],
  'cfd-post': ['q1', 'dp1', 'q2', 'dp2', 'mu', 'rho', 'kinematic', 'box-mm', 'length-mm', 'wss', 'json', 'help'],
};

const a = parseArgs(process.argv.slice(2));
const json = a.json === true;
const cmd = a._[0];
a._ = a._.slice(1); // 命令字出栈，其余位置参数供子命令校验
{
  const known = KNOWN_FLAGS[cmd];
  if (known) {
    const unknown = Object.keys(a).filter((k) => k !== '_' && !known.includes(k));
    if (unknown.length) die(`未知选项 ${unknown.map((k) => '--' + k).join(' ')}（${cmd} 支持: --${known.join(' --')}）`);
  }
}
if (cmd === 'list') cmdList(json);
else if (cmd === 'estimate') cmdEstimate(a, json);
else if (cmd === 'mesh') cmdMesh(a, json);
else if (cmd === 'solve') cmdSolve(a, json);
else if (cmd === 'verify') cmdVerify(core, a, json);
else if (cmd === 'scenario') cmdScenario(a, json);
else if (cmd === 'slice') cmdSlice(a, json);
else if (cmd === 'overhang') cmdOverhang(a, json);
else if (cmd === 'cfd-post') cmdCfdPost(a, json);
else {
  console.log('TPMS Agent CLI（M0 数学层 + M1 几何闭环 + M5 场景模板）');
  console.log('用法:');
  console.log('  node tpms.mjs list');
  console.log('  node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]');
  console.log('  node tpms.mjs mesh --type gyroid --porosity 0.65 [--periods 6] [--resolution 64] [--out 文件.stl] [--json]');
  console.log('  node tpms.mjs solve --type gyroid --porosity 0.65 [--tolerance 0.01] [--max-rounds 5] [--json]');
  console.log('  node tpms.mjs verify --design 设计.json [--max-rounds 5] [--json]');
  console.log('  node tpms.mjs scenario --design 方案.json   # M5：一条指令 → STL+INP+验证报告');
  console.log('  node tpms.mjs overhang --input 模型.stl [--critical 45] [--search]   # 可打印性审计：悬垂角 + 最优摆盘');
  console.log('  node tpms.mjs cfd-post --q1 8.33e-9 --dp1 0.5 --q2 8.33e-8 --dp2 15  # Forchheimer 两点分离 → K_int/WSS 诊断');
  console.log(`曲面类型: ${BUILTIN_TYPES.join(' ')}`);
  console.log(`材料:     ${Object.keys(core.BASE_MODULUS).join(' ')}`);
  if (cmd !== undefined && cmd !== 'help') { console.error(`\n✗ 未知命令 "${cmd}"`); process.exit(2); }
}
