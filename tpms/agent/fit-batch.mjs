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
 * 运行: node tpms/agent/fit-batch.mjs [--mock] [--dir specimens/csv] [--out <仓库根内相对路径>] [--json]
 * 输出: docs/fit-report.md（mock → docs/fit-report.mock.md）；--out 显式指定（含 selftest 隔离）；
 *       0 有效曲线时不写文件并 exit1——保护既有成功报告（2026-10-24 实用性审查 #3）。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MOCK = process.argv.includes('--mock');
const JSON_OUT = process.argv.includes('--json');
const dirIdx = process.argv.indexOf('--dir');
const DIR = dirIdx >= 0 ? process.argv[dirIdx + 1] : 'specimens/csv';
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null;
if (outIdx >= 0) {
  // 与 --dir 同款守卫：显式报告路径必须位于仓库根内（防 selftest/误用写到仓库外或覆盖系统路径）
  if (!OUT || isAbsolute(OUT) || OUT.trim() === '') { console.error('FAIL --out 须为仓库根内相对路径'); process.exit(1); }
  const relOut = relative(ROOT, resolve(ROOT, OUT));
  if (isAbsolute(relOut) || relOut.startsWith('..' + sep) || relOut === '..') { console.error('FAIL --out 须为仓库根内相对路径'); process.exit(1); }
}

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

// `# key=value` 元数据（数值型；parseCurve 会剥离注释行，仅 fit-batch 侧读取）。
// 【批十八 P2-02】语法收窄到与 UI/协议 §六 同一白名单（`# key=value`）：旧正则还接受
// `// key: value`——同一 CLI 合法文件在 UI 端静默回落默认口径（评估实证 E≈993→2000、
// 平台 36→144 无告警）。单一语法消除跨端口径分裂；缺失报错文案指向协议模板。
function parseMeta(text) {
  const meta = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[\d.]+)\s*$/);
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

// ── 输入溯源：逐份记录来源路径与原始文本 sha256（前 16 位）——id 不足以唯一追溯输入 ──
const sha16 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

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
      const text = readFileSync(join(tmp, f), 'utf8');
      rows.push({ ...fitOneCsv(text, f.replace(/\.csv$/i, '')), src: `mock:${f.replace(/\.csv$/i, '')}`, sha: sha16(text), truthE: truths[f.replace(/\.csv$/i, '')] });
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
    const text = readFileSync(join(dirAbs, f), 'utf8');
    rows.push({ ...fitOneCsv(text, f.replace(/\.csv$/i, '')), src: relative(ROOT, join(dirAbs, f)).replace(/\\/g, '/'), sha: sha16(text) });
  }
}

// ── 重复间离散度（同 S 前缀 r1/r2/r3 分组；n≥2 才有 CV）──
const groupOf = (id) => id.replace(/_r\d+$/, '');
// 样本 CV = 样本标准差/均值（n−1 分母，NIST 口径；2026-10-24 审查 #6——旧实现为极差/均值，
// [100,110,120] 曾报 18.18%，样本 CV 实为 9.09%）
const cv = (xs) => {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  if (!(m > 0)) return NaN;
  const s = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return (s / m) * 100;
};
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
  `> **分析配置**：位移→应变基准=实测 H₀（# lengthMm）；H₀ 档位校验 {12,24,34}±1（越档照算+告警）；εd=吸能效率 η 内部极值（截断曲线 η 极值落记录末点=未观察到密实化，εd 不适用，W 积分至记录末点并标注）；重复间离散度=样本 CV（std/均值，n−1）；输入 ${rows.length} 份（逐份溯源见下）。`,
  '',
  '## 输入溯源',
  '',
  '| 输入文件 | sha256(前16) | 数据类型 | H₀/宽/厚 (mm) |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.src} | ${r.sha} | ${MOCK ? 'mock 合成' : '试验 CSV'} | ${fmt(r.dims?.lengthMm, 1)}/${fmt(r.dims?.widthMm, 1)}/${fmt(r.dims?.thicknessMm, 1)} |`),
  '',
  '## 单件特征',
  '',
  '| 试样 | H₀ (mm) | E* (MPa) | Rp0.2 (MPa) | 首峰 (MPa) | 平台σ (MPa) | ε_d | W (MJ/m³) | 告警 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => r.error
    ? `| ${r.id} | — | FAIL | ${r.error.slice(0, 60)} | | | | | |`
    : `| ${r.id} | ${fmt(r.dims.lengthMm, 1)} | ${fmt(r.metrics.elasticModulusE)} | ${fmt(r.metrics.proofStressRp02)} | ${fmt(r.metrics.firstPeakStress)} | ${fmt(r.metrics.plateauStress)} | ${r.metrics.densificationStrain == null ? '未观察' : fmt(r.metrics.densificationStrain, 3)} | ${fmt(r.metrics.energyAbsorptionW, 3)} | ${r.hWarn ? '⚠ H₀ 越档' : ''} |`),
  ...(rows.some((r) => r.hWarn) ? ['', ...rows.filter((r) => r.hWarn).map((r) => `- ⚠ ${r.id}：${r.hWarn}`)] : []),
  ...(rows.some((r) => r.error) ? ['', ...rows.filter((r) => r.error).map((r) => `- ✗ ${r.id}：${r.error}`)] : []),
  ...(rows.some((r) => r.metrics?.densificationStatus === 'not-observed') ? ['', ...rows.filter((r) => r.metrics?.densificationStatus === 'not-observed').map((r) => `- ⚠ ${r.id}：未观察到密实化（曲线截断，η 极值落记录末点）——εd 不适用；W=${fmt(r.metrics.energyAbsorptionW, 3)} MJ/m³ 系截至记录末点 ε=${fmt(r.metrics.energyAbsorptionEndStrain, 3)} 的积分，非"至密实化吸能"`)] : []),
  '',
  '## 重复间离散度（同构型 r1/r2/r3，样本 CV % = std/均值）',
  '',
  '| 构型 | n | CV(E*) | CV(Rp0.2) | CV(平台σ) |',
  '|---|---|---|---|---|',
  ...repeats.map((g) => `| ${g.id} | ${g.n} | ${g.cvE === null ? '—' : fmt(g.cvE) + '%'} | ${g.cvRp === null ? '—' : fmt(g.cvRp) + '%'} | ${g.cvPl === null ? '—' : fmt(g.cvPl) + '%'} |`),
  '',
].join('\n');

const good = rows.filter((r) => r.metrics).length;
const out = OUT ? resolve(ROOT, OUT) : join(ROOT, MOCK ? 'docs/fit-report.mock.md' : 'docs/fit-report.md');
if (!good) {
  // 2026-10-24 实用性审查 #3：0 有效曲线不写报告文件（先判后写）——坏输入不再覆盖既有成功报告
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, mock: MOCK, out: null, good, rows, repeats }, null, 2));
  console.error(`FAIL 无有效曲线（0/${rows.length} 行成功）——报告未写入，${out} 保持不变`);
  process.exit(1);
}
writeFileSync(out, md, 'utf8');
if (JSON_OUT) console.log(JSON.stringify({ ok: true, mock: MOCK, out, good, rows, repeats }, null, 2));
console.log('WROTE', out, 'rows', `${good}/${rows.length}`);
