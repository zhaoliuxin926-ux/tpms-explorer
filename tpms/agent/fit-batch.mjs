#!/usr/bin/env node
/**
 * fit-batch.mjs — 试验 CSV 批量 → ISO 13314 报告（mock 曲线可自测）
 *
 * 运行: node tpms/agent/fit-batch.mjs [--mock] [--dir specimens/csv]
 * 输出: docs/fit-report.md（或 stdout 摘要）
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MOCK = process.argv.includes('--mock');
const dirIdx = process.argv.indexOf('--dir');
const DIR = dirIdx >= 0 ? process.argv[dirIdx + 1] : 'specimens/csv';

// 动态加载平台 experimental-fit（经源码相对路径；Node 原生无法直跑 TS——用 mock 内联最小实现当自测）
function mockIso(strain, stress) {
  // 线性段斜率 → 近似 E*；0.2% 偏置 → Rp0.2；平台 = 屈服后均值
  const n = strain.length;
  let e = 0;
  for (let i = 1; i < n; i++) {
    const ds = stress[i] - stress[0];
    const de = strain[i] - strain[0];
    if (de > 0.005 && de < 0.01) e = Math.max(e, ds / de);
  }
  const peak = Math.max(...stress);
  const plateau = stress.slice(Math.floor(n * 0.4), Math.floor(n * 0.7)).reduce((a, b) => a + b, 0) /
    Math.max(1, Math.floor(n * 0.3));
  return { E_MPa: e, Rp02_MPa: peak * 0.8, peak_MPa: peak, plateau_MPa: plateau };
}

function synthCurve(seed) {
  const strain = [], stress = [];
  for (let i = 0; i <= 200; i++) {
    const s = i * 0.001;
    strain.push(s);
    const E = 120 + seed * 8;
    let sig = E * s;
    if (s > 0.02) sig = E * 0.02 + (s - 0.02) * 8;
    if (s > 0.04) sig = E * 0.02 + 0.0002 * 8 + (s - 0.04) * 2 + 0.5 * Math.sin(s * 40 + seed);
    stress.push(Math.max(0, sig));
  }
  return { strain, stress };
}

const rows = [];
if (MOCK) {
  for (let i = 1; i <= 6; i++) {
    const { strain, stress } = synthCurve(i);
    const m = mockIso(strain, stress);
    rows.push({ id: `mock_S${i}`, ...m });
  }
} else {
  const dirAbs = resolve(ROOT, DIR);
  const relDir = relative(ROOT, dirAbs);
  if (isAbsolute(relDir) || relDir.startsWith('..' + sep) || relDir === '..') {
    console.error('FAIL --dir 必须位于仓库根内');
    process.exit(1);
  }
  const dir = dirAbs;
  if (!existsSync(dir)) {
    console.error('无 CSV 目录', dir, '—— 用 --mock 自测，或放入试验机 CSV');
    process.exit(1);
  }
  for (const f of readdirSync(dir).filter((x) => /\.csv$/i.test(x))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const lines = text.trim().split(/\r?\n/).slice(1);
    const strain = [], stress = [];
    for (const line of lines) {
      const [a, b] = line.split(/[,\t;]/).map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) { strain.push(a); stress.push(b); }
    }
    rows.push({ id: f.replace(/\.csv$/i, ''), ...mockIso(strain, stress) });
  }
}

const md = [
  '# 曲线批量示意报告（**非** ISO 13314 正式拟合）',
  '',
  `> 模式：${MOCK ? '**mock 自测曲线**（非试验数据）' : '试验 CSV'} · ${new Date().toISOString().slice(0, 10)}`,
  '> **诚实边界**：本脚本仅为批处理示意（简化 mockIso，Rp0.2 非偏移线）。正式 ISO 13314 特征唯一真源是平台 `experimental-fit.ts`；真实 CSV 也必须在工程版「试验曲线反演」复核后再引用。',
  '',
  '| 试样 | E* 示意 (MPa) | 峰值×0.8 示意 (MPa) | 峰值 (MPa) | 平台示意 (MPa) |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.E_MPa.toFixed(1)} | ${r.Rp02_MPa.toFixed(1)} | ${r.peak_MPa.toFixed(1)} | ${r.plateau_MPa.toFixed(1)} |`),
  '',
].join('\n');

const out = join(ROOT, MOCK ? 'docs/fit-report.mock.md' : 'docs/fit-report.md');
writeFileSync(out, md, 'utf8');
if (!rows.length) {
    console.error('FAIL 无有效曲线（0 行）');
    process.exit(1);
  }
  console.log('WROTE', out, 'rows', rows.length);
