#!/usr/bin/env node
/**
 * fit-batch.mjs — 试验 CSV 批量 → ISO 13314 报告（真实 experimental-fit 内核）
 *
 * 内核：rolldown 临时打包平台 src/physics/experimental-fit.ts（与 experimental_fit_audit
 * 同一加载桥——ISO 特征唯一真源；2026-10-20 用户复核交办：示意算法 mockIso 弃用）。
 *
 * CSV 契约（PHYSICAL_TESTING_PROTOCOL §四/§六，端板固定 2mm 口径）：
 *   - 表头必含列名：displacement_mm,force_N[,time_s]（无表头=拒绝——不再默认前两列当应变应力）
 *   - `# key=value` 元数据行：lengthMm/widthMm/thicknessMm（卡尺实测；lengthMm=含端板总高 H₀）
 *   - 尺寸校验：H₀ 匹配协议档 {12,24,34}mm ±1 为标称；越档照算但在报告标注口径告警
 *     （×2.5 档总高 24 非 30——端板不随缩放，2026-10-20 协议修正）
 *
 * 运行: node tpms/agent/fit-batch.mjs [--mock] [--dir specimens/csv] [--json]
 * 输出: docs/fit-report.md（mock → docs/fit-report.mock.md）；--json 附 stdout 机器摘要
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MOCK = process.argv.includes('--mock');
const JSON_OUT = process.argv.includes('--json');
const dirIdx = process.argv.indexOf('--dir');
const DIR = dirIdx >= 0 ? process.argv[dirIdx + 1] : 'specimens/csv';

// ── 内核桥（experimental_fit_audit 同款：rolldown 打包 TS → 临时 mjs import）──
const PLATFORM = join(HERE, '../tpms-platform');
const BUNDLE = join(tmpdir(), 'tpms_fitbatch_expfit.mjs');
{
  const entry = join(tmpdir(), 'tpms_fitbatch_entry.ts');
  writeFileSync(entry, `export { fitExperimentalCurve } from ${JSON.stringify(join(PLATFORM, 'src/physics/experimental-fit.ts'))};`);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('FAIL experimental-fit 内核打包失败（rolldown）:', (r.stderr || '').slice(0, 200)); process.exit(1); }
}
const { fitExperimentalCurve } = await import(pathToFileURL(BUNDLE));

const PROTOCOL_TOTALS = [12, 24, 34];   // 原生/×2.5/×3.75 含固定 2×2mm 端板（协议 §四表）

// `# key=value` / `// key: value` 元数据（数值型；parseCurve 会剥离注释行，仅 fit-batch 侧读取）
function parseMeta(text) {
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:#|\/\/)\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(-?[\d.]+)\s*$/);
    if (m) meta[m[1]] = Number(m[2]);
  }
  return meta;
}

function fitOneCsv(text, id) {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim() && !/^\s*(?:#|\/\/)/.test(l)) ?? '');
  if (!/displacement\s*_?\s*mm/i.test(firstLine) || !/force\s*_?\s*N/i.test(firstLine)) {
    return { id, error: `缺表头列名（契约：displacement_mm,force_N[,time_s]——协议 §六）首行="${firstLine.slice(0, 60)}"` };
  }
  const meta = parseMeta(text);
  const dims = { lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm };
  const missing = Object.entries(dims).filter(([, v]) => !Number.isFinite(v) || v <= 0).map(([k]) => k);
  if (missing.length) return { id, error: `试样尺寸元数据缺失/非法（# lengthMm=… widthMm=… thicknessMm=…，卡尺实测含端板）缺 ${missing.join(',')}` };
  const nearest = PROTOCOL_TOTALS.reduce((a, b) => (Math.abs(b - dims.lengthMm) < Math.abs(a - dims.lengthMm) ? b : a));
  const hWarn = Math.abs(nearest - dims.lengthMm) <= 1 ? null
    : `H₀=${dims.lengthMm}mm 不匹配协议档 {12,24,34}±1（×2.5 档=24 非 30——端板固定 2mm 不随缩放，2026-10-20 修正；本行照算，E* 应变基准以实测 H₀ 为准，建议核对端板/缩放）`;
  try {
    const r = fitExperimentalCurve({ text, inputType: 'displacement-force', columnX: 'displacement_mm', columnY: 'force_N', specimenDimensions: dims });
    return { id, dims, hWarn, metrics: r.metrics };
  } catch (e) {
    return { id, dims, hWarn, error: `内核拟合失败：${e.message}` };
  }
}

// ── mock 自测：合成位移-载荷 CSV（真值已知）走与真实 CSV 完全相同的文件路径 ──
function synthDf(seed) {
  const H0 = 24, A = 20 * 20;                      // ×2.5 档标称（协议 §四）
  const E0 = 1200 + seed * 40;                     // 真值 MPa（toe 补偿后应恢复）
  const TOE_K = E0 / 0.02;
  const sig = (e) => {
    if (e <= 0.01) return TOE_K * e * e;
    if (e <= 0.035) return TOE_K * 0.0001 + E0 * (e - 0.01);
    if (e <= 0.06) { const t = (e - 0.035) / 0.025, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 36 + (t3 - 2 * t2 + t) * E0 * 0.025 + (-2 * t3 + 3 * t2) * 45; }
    if (e <= 0.08) { const t = (e - 0.06) / 0.02, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * 45 + (-2 * t3 + 3 * t2) * 36; }
    if (e <= 0.45) { const x = e - 0.08; return 36 + 0.08 * x + 1.2 * Math.sin(2 * Math.PI * x / 0.075) * Math.exp(-x / 0.25); }
    return 36 + 0.08 * 0.37 + 25 * (Math.exp(18 * (e - 0.45)) - 1);
  };
  const lines = ['# lengthMm=24', '# widthMm=20', '# thicknessMm=20', 'displacement_mm,force_N'];
  for (let k = 0; k <= 500; k++) {
    const e = k * 0.001;
    lines.push((e * H0).toFixed(6) + ',' + (sig(e) * A).toFixed(4));
  }
  return { text: lines.join('\n'), truthE: E0 };
}

const rows = [];
if (MOCK) {
  const tmp = mkdtempSync(join(tmpdir(), 'fitbatch-mock-'));
  try {
    const truths = {};
    for (const [sid, seed] of [['mock_S1_G60', 1], ['mock_S2_G75', 2]]) {
      for (const r of [1, 2, 3]) {
        const { text, truthE } = synthDf(seed + (r - 1) * 0.1);
        truths[`${sid}_r${r}`] = truthE;
        writeFileSync(join(tmp, `${sid}_r${r}.csv`), text, 'utf8');
      }
    }
    for (const f of readdirSync(tmp).filter((x) => /\.csv$/i.test(x)).sort()) {
      rows.push({ ...fitOneCsv(readFileSync(join(tmp, f), 'utf8'), f.replace(/\.csv$/i, '')), truthE: truths[f.replace(/\.csv$/i, '')] });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
} else {
  const dirAbs = resolve(ROOT, DIR);
  const relDir = relative(ROOT, dirAbs);
  if (isAbsolute(relDir) || relDir.startsWith('..' + sep) || relDir === '..') {
    console.error('FAIL --dir 必须位于仓库根内');
    process.exit(1);
  }
  if (!existsSync(dirAbs)) {
    console.error('无 CSV 目录', dirAbs, '—— 用 --mock 自测，或放入试验机 CSV（契约见脚本头注/协议 §六）');
    process.exit(1);
  }
  for (const f of readdirSync(dirAbs).filter((x) => /\.csv$/i.test(x)).sort()) {
    rows.push({ ...fitOneCsv(readFileSync(join(dirAbs, f), 'utf8'), f.replace(/\.csv$/i, '')) });
  }
}

// ── 重复间离散度（同 S 前缀 r1/r2/r3 分组；n≥2 才有 CV）──
const groupOf = (id) => id.replace(/_r\d+$/, '');
const cv = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return m > 0 ? (Math.max(...xs) - Math.min(...xs)) / m * 100 : NaN; };
const repeats = Object.values(rows.filter((r) => r.metrics).reduce((acc, r) => {
  const g = groupOf(r.id);
  (acc[g] ??= { id: g, E: [], Rp: [], Pl: [] });
  acc[g].E.push(r.metrics.elasticModulusE); acc[g].Rp.push(r.metrics.proofStressRp02); acc[g].Pl.push(r.metrics.plateauStress);
  return acc;
}, {})).map((g) => ({ id: g.id, n: g.E.length, cvE: g.E.length >= 2 ? cv(g.E) : null, cvRp: g.E.length >= 2 ? cv(g.Rp) : null, cvPl: g.E.length >= 2 ? cv(g.Pl) : null }));

const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const md = [
  `# ISO 13314 曲线批量反演报告（experimental-fit 内核）`,
  '',
  `> 模式：${MOCK ? '**mock 自测曲线**（合成位移-载荷，非试验数据；走与真实 CSV 相同路径）' : '试验 CSV'} · ${new Date().toISOString().slice(0, 10)}`,
  '> **口径**：内核=平台 `experimental-fit.ts`（Toe 补偿+ISO 13314 特征，门 43 独立审计）；位移→应变以实测 H₀（含端板）为基准——压机柔度与端板变形使 E\* 为**下限口径**；正式引用前以工程版「试验曲线反演」复核（协议 §七预处理建议）。',
  '',
  '## 单件特征',
  '',
  '| 试样 | H₀ (mm) | E* (MPa) | Rp0.2 (MPa) | 首峰 (MPa) | 平台σ (MPa) | ε_d | W (MJ/m³) | 告警 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => r.error
    ? `| ${r.id} | — | FAIL | ${r.error.slice(0, 60)} | | | | | |`
    : `| ${r.id} | ${fmt(r.dims.lengthMm, 1)} | ${fmt(r.metrics.elasticModulusE)} | ${fmt(r.metrics.proofStressRp02)} | ${fmt(r.metrics.firstPeakStress)} | ${fmt(r.metrics.plateauStress)} | ${fmt(r.metrics.densificationStrain, 3)} | ${fmt(r.metrics.energyAbsorptionW, 3)} | ${r.hWarn ? '⚠ H₀ 越档' : ''} |`),
  ...(rows.some((r) => r.hWarn) ? ['', ...rows.filter((r) => r.hWarn).map((r) => `- ⚠ ${r.id}：${r.hWarn}`)] : []),
  ...(rows.some((r) => r.error) ? ['', ...rows.filter((r) => r.error).map((r) => `- ✗ ${r.id}：${r.error}`)] : []),
  '',
  '## 重复间离散度（同构型 r1/r2/r3，极差/均值 %）',
  '',
  '| 构型 | n | CV(E*) | CV(Rp0.2) | CV(平台σ) |',
  '|---|---|---|---|---|',
  ...repeats.map((g) => `| ${g.id} | ${g.n} | ${g.cvE === null ? '—' : fmt(g.cvE) + '%'} | ${g.cvRp === null ? '—' : fmt(g.cvRp) + '%'} | ${g.cvPl === null ? '—' : fmt(g.cvPl) + '%'} |`),
  '',
].join('\n');

const out = join(ROOT, MOCK ? 'docs/fit-report.mock.md' : 'docs/fit-report.md');
writeFileSync(out, md, 'utf8');
const good = rows.filter((r) => r.metrics).length;
if (JSON_OUT) console.log(JSON.stringify({ ok: good > 0, mock: MOCK, out, good, rows, repeats }, null, 2));
if (!good) {
  console.error('FAIL 无有效曲线（0 行成功）');
  process.exit(1);
}
console.log('WROTE', out, 'rows', `${good}/${rows.length}`);
