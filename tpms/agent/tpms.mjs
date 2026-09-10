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
import { writeFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
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


const BUILTIN_TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg'];
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

function auditMeshIndices(positions, indices) {
  const triCount = indices.length / 3;
  const vertCount = positions.length / 3;
  const KM = vertCount + 1;
  // 无向边 pack = (min*KM+max)*2 + 方向位（u<v→0）：整数 <2^53，Float64 精确；
  // 排序聚合替代字符串 key Map（R96 165 万边，Map+装箱是 CLI 命令最大热点之一）
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
    if (cx * cx + cy * cy + cz * cz <= 1e-18) degenTris++;
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
      hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
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
  const usage = '用法: node tpms.mjs mesh --type <曲面> --porosity <0~1|百分数> [--periods 6] [--resolution 64] [--container cube|cylinder] [--mode solid_network|shell|gradient_shell] [--porosity-solver exact|legacy] [--out 文件.stl] [--json]';
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

  const params = {
    type, iso: 0, periods, resolution, targetPorosity: pf,
    weights: [1, 1, 1, 1], structureMode: mode, containerShape: container,
    thickness: 1.0, gradientDir: 'z',
    hybrid: { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    customFormula: '', preview: false,
    hybrid: hybridM ?? { enabled: false, typeB: 'diamond', blendFunction: 'sigmoid', blendCenter: 0, blendWidth: 1 },
    isoGrad: isoGradM ? { dir: 'z', stops: isoGradM.stops } : undefined,
  };
  const solver = String(a['porosity-solver'] ?? 'exact');
  if (!['exact', 'legacy'].includes(solver)) die(`未知求解器 "${solver}"，可选 exact|legacy`, usage);

  core.globalBufferPool.reset();
  let res;
  let porTrace;
  try {
    if (solver === 'exact') {
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

  const audit = auditMeshIndices(res.positions, res.indices);
  const watertight = audit.openEdges === 0 && audit.nonManifoldEdges === 0 && audit.degenTris === 0;
  // porosityEstimate 平台口径为小数（=1−发散固相/包络，surface-nets 内建钳制），恒 ≤1
  const porEst = res.porosityEstimate;
  const out = {
    command: 'mesh', type, porosity: pf, periods, resolution, container, mode,
    vertCount: res.vertCount, triCount: res.triCount,
    isoUsed: res.isoUsed,
    porosityEstimate: porEst,
    porosityDeviation: Math.abs(porEst - pf),
    audit, watertight,
    lastAuditCounts: audit,
    solver, porosityTrace: porTrace,
    scaleMmPerWc: core.wcToMmFactor(periods),
    boundary: '水密自检 = mesh_audit 同款三硬指标（开放边/非流形/退化面，索引空间）；misoriented 为观测值不设门（导出翻转后全局定向一致性是平台已知盲区）；孔隙率为网格发散体积实测口径，与目标值的口径差随分辨率收敛',
  };
  if (!watertight) {
    if (json) console.log(JSON.stringify(out, null, 2));
    // 退出码约定：2=参数错误（改输入可解）；3=构建/水密门失败（物理不可产出，升分辨率或改设计）
    console.error(`✗ 水密门未过：开放边=${audit.openEdges} 非流形边=${audit.nonManifoldEdges} 退化面=${audit.degenTris} —— 不产出 STL`);
    process.exit(3);
  }
  const outFile = String(a.out ?? `tpms-${type}-p${Math.round(pf * 100)}.stl`);
  const scale = core.wcToMmFactor(periods);
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
  if (Math.abs(porEst - pf) > 0.02) console.log('  ⚠ 偏差 >2pp：exact 与 legacy 在不同工况互有胜负（gyroid R48 legacy 更准），可尝试 --porosity-solver legacy；或提高 --resolution（上限 96）');
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

  if (paramErrors.length) {
    const out = { command: 'verify', design: designPath, verdict: 'fail', stage: 'parameter', paramErrors };
    if (json) console.log(JSON.stringify(out, null, 2));
    console.error('✗ 参数检查未过（需人工修改设计文件）:\n  - ' + paramErrors.join('\n  - '));
    process.exit(3);
  }

  // ── 修复循环：分辨率升档表（水密/构建失败的修复策略）──
  const LADDER = [48, 64, 96];
  const tol = design.tolerance ?? 0.01;
  let R = Number.isInteger(design.resolution) ? design.resolution : 64;
  if (R < 48) R = 48;
  if (R > 96) R = 96;

  // C1 渐变等值场（design JSON：isoGrad: { values: [...], band?: 0.4 }，z 向）
  let isoGradD = null;
  if (design.isoGrad) {
    const g = design.isoGrad;
    if (!Array.isArray(g.values) || g.values.length < 2 || g.values.some((v) => !Number.isFinite(v))) {
      paramErrors.push('isoGrad.values 须为 ≥2 个有限数字数组');
    } else {
      const band = g.band === undefined ? 0.4 : Number(g.band);
      if (!Number.isFinite(band) || band < 0 || band > 2) paramErrors.push('isoGrad.band 须 0 ≤ b ≤ 2');
      else isoGradD = { dir: 'z', stops: gradStops(g.values, band) };
    }
    if (design.mode && design.mode !== 'solid_network') paramErrors.push('isoGrad 暂仅支持 solid_network 模式');
  }

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
      const nextR = LADDER[LADDER.indexOf(R) + 1];
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
      const nextR = LADDER[LADDER.indexOf(R) + 1];
      if (nextR) { R = nextR; continue; }
      break;
    }

    // 检查 3：孔隙率偏差（失败修复策略：解析斜率割线一步，再不行升分辨率）
    const dev = Math.abs(est - pf);
    attempt.checks.porosity_deviation = { pass: dev <= Math.max(tol, 0.03), deviation: +dev.toFixed(4) };
    attempts.push(attempt);
    if (dev > Math.max(tol, 0.03)) {
      // 修复策略（A2 实测口径）：升分辨率优先（R96 割线后 0.26pp）；已达 96 才用割线微调
      const nextR = LADDER[LADDER.indexOf(R) + 1];
      if (nextR) { R = nextR; continue; }
      if (Number.isFinite(slopeAnalytic) && Math.abs(slopeAnalytic) > 1e-6) {
        const step = Math.max(-0.35, Math.min(0.35, (pf - est) / slopeAnalytic));
        iso += step;
        continue;
      }
      break;
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
    const outFile = design.out ?? `tpms-${type}-verified.stl`;
    const stl = core.buildBinarySTL(res.positions, res.indices, core.wcToMmFactor(periods), res.normals);
    writeFileSync(outFile, Buffer.from(stl));
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
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
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
  const outPrefix = String(design.out ?? `scenario-${type}`);
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
    voxelPorosity = 1 - voxel.solidCount / (resolution * resolution * resolution); // 全包络口径
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
      : '报告口径：孔隙率双口径（网格实测/体素分位）随分辨率收敛；力学预测为解析估算非仿真结果；INP 压缩结果以 Abaqus 实跑为准',
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
  mesh: ['type', 'porosity', 'periods', 'resolution', 'container', 'mode', 'porosity-solver', 'iso-grad', 'hybrid', 'out', 'json', 'help'],
  solve: ['type', 'porosity', 'periods', 'resolution', 'container', 'mode', 'tolerance', 'max-rounds', 'iso-grad', 'hybrid', 'out', 'json', 'help'],
  verify: ['design', 'max-rounds', 'json', 'help'],
  scenario: ['design', 'json', 'help'],
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
else {
  console.log('TPMS Agent CLI（M0 数学层 + M1 几何闭环 + M5 场景模板）');
  console.log('用法:');
  console.log('  node tpms.mjs list');
  console.log('  node tpms.mjs estimate --type gyroid --porosity 0.65 [--material tc4] [--json]');
  console.log('  node tpms.mjs mesh --type gyroid --porosity 0.65 [--periods 6] [--resolution 64] [--out 文件.stl] [--json]');
  console.log('  node tpms.mjs solve --type gyroid --porosity 0.65 [--tolerance 0.01] [--max-rounds 5] [--json]');
  console.log('  node tpms.mjs verify --design 设计.json [--max-rounds 5] [--json]');
  console.log('  node tpms.mjs scenario --design 方案.json   # M5：一条指令 → STL+INP+验证报告');
  console.log(`曲面类型: ${BUILTIN_TYPES.join(' ')}`);
  console.log(`材料:     ${Object.keys(core.BASE_MODULUS).join(' ')}`);
  if (cmd !== undefined && cmd !== 'help') { console.error(`\n✗ 未知命令 "${cmd}"`); process.exit(2); }
}
