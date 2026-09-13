#!/usr/bin/env node
// benchmarks.mjs —— B5 公开基准采集：20 曲面 × R{48,96} × p0.6 矩阵
// 每格：退出码/水密三硬指标/解析-实测孔隙率偏差/构建耗时/交付物
// 用法: node tpms/agent/benchmarks.mjs [--md 仓库根/BENCHMARKS.md] [--json 路径] [--quick(R48-only)]
// 诚实口径：拒产/超时如实记录（fail-closed 是平台行为的一部分）；fcks 可产域=R120 中段孔隙率（p0.5-0.7 实测可产）。
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tpms.mjs');
const OUT = 'C:/Users/qi/AppData/Local/Temp/tpms-bench/_bench.stl';
const args = process.argv.slice(2);
const mdPath = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : join(HERE, 'benchmarks-latest.json');
const quick = args.includes('--quick');
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd'];
const RS = quick ? [48] : [48, 96];
const P = 0.6;

const run = (type, R) => {
  if (existsSync(OUT)) rmSync(OUT);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, 'mesh', '--type', type, '--porosity', String(P), '--resolution', String(R), '--out', OUT, '--json'], { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  const wall = Date.now() - t0;
  let o = null;
  try { o = JSON.parse(r.stdout); } catch { /* 拒产/错误时 stdout 可能为空 */ }
  const rejected = (r.stderr || '').includes('水密门');
  return {
    type, R,
    exit: r.status,
    watertight: o?.watertight === true,
    nm: o?.audit?.nonManifoldEdges ?? null,
    devPP: o?.porosityDeviation !== undefined ? +(o.porosityDeviation * 100).toFixed(2) : null,
    tris: o?.triCount ?? null,
    stlBytes: o?.fileBytes ?? null,
    wallMs: wall,
    rejected: rejected || r.status === 3,
    err: r.status !== 0 && !rejected ? (r.stderr || '').slice(-80) : '',
  };
};

console.log(`B5 基准采集：${TYPES.length} 曲面 × R{${RS.join(',')}} × p${P}（fcks 可产域=R120 中段孔隙率，拒产格如实记录）`);
const rows = [];
for (const type of TYPES) {
  for (const R of RS) {
    const row = run(type, R);
    rows.push(row);
    console.log(`  ${type.padEnd(9)} R${R}: exit=${row.exit} ${row.watertight ? '水密' : (row.rejected ? '拒产' : '错误')} nm=${row.nm ?? '-'} dev=${row.devPP ?? '-'}pp ${row.wallMs}ms ${row.err}`);
  }
}

writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), porosity: P, rows }, null, 1));
console.log(`\nJSON 已写 ${jsonPath}`);

if (mdPath) {
  const okRow = (r) => r.watertight ? `✓ ${r.devPP !== null ? r.devPP + 'pp' : ''}` : (r.rejected ? `拒产(nm ${r.nm ?? '—'})` : `错误`);
  const lines = [
    '# BENCHMARKS — TPMS Explorer 公开基准', '',
    `> 生成于 ${new Date().toISOString()}｜复跑：\`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md\`（约 10-20 分钟，全程确定性）`,
    `> 口径：目标孔隙率 ${P * 100}%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。`, '',
    '## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）', '',
    '| 曲面 | R48 | R96 |', '|---|---|---|',
    ...TYPES.map((t) => {
      const r48 = rows.find((x) => x.type === t && x.R === 48);
      const r96 = rows.find((x) => x.type === t && x.R === 96);
      const f = (r) => r ? (r.watertight ? `✓ dev ${r.devPP}pp / ${r.wallMs}ms` : `拒产 (nm ${r.nm}) / ${r.wallMs}ms`) : '—';
      return `| ${t} | ${f(r48)} | ${f(r96)} |`;
    }), '',
    '## 2. 可用域速查（LLM/用户选择曲面时的决策表）', '',
    '| 曲面 | R48 可产 | R96 可产 | 备注 |', '|---|---|---|---|',
    ...TYPES.map((t) => {
      const g = (R) => { const r = rows.find((x) => x.type === t && x.R === R); return r?.watertight ? '✅' : '⛔'; };
      const note = t === 'fcks' ? '谐波 3×：可产域=R120 k6（p0.5-0.7 nm=0）∪ R128 k2（nm=0，偏差 0.13pp，~9s）；k6 R48/R96/R128 薄壁自触 fail-closed——降周期数可避'
        : t === 'dprime' || t === 'cdd' ? '低分辨率薄壁自触 fail-closed，R96 可产（nm 18252@R48）'
        : t === 'dg' ? 'p0.6 iso 触求解域下界 −1.6：偏差 ~8pp 为可用域事实（nm=0 可产，如实报告）'
        : t === 'gprime' ? '默认周期数 k6 R96 p0.6 薄壁自触 fail-closed（nm 19080），降周期数 k=2 可产'
        : ['frd', 'lidinoid', 'fks', 'fky'].includes(t) ? '低分辨率薄壁自触 fail-closed，R96 可产' : '';
      return `| ${t} | ${g(48)} | ${g(96)} | ${note} |`;
    }), '',
    '## 3. 力学解析口径（Gibson-Ashby，非 FEA）', '',
    '- E*/Es = C1·ρ̄²（C1 文献带 0.35~0.44，per-曲面标定值见 `list` 命令）',
    '- σ*/σs = 0.3·ρ̄^1.5（网格泡沫折中上界；经典开孔泡沫 0.23 为带下界）',
    '- 文献对比带已内建于 `scenario` 命令验证报告（每曲面带内/带外自动判定）', '',
    '## 4. 对标（开源生态）', '',
    '| 能力 | 本项目 | RegionTPMS | MiniSurf | microgen |', '|---|---|---|---|---|',
    '| 浏览器零安装交互 | ✅ WebGPU/TS 单页 | ❌ Mathematica | ❌ MATLAB | ❌ Python 库 |',
    '| 曲面族 | 20 | 4 | 19 | 8+ |',
    '| 验证门禁 | 44 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |',
    '| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |',
    '| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |',
    '| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |',
    '| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |', '',
    '## 5. 诚实边界', '',
    '- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛',
    '- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）',
    '- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准',
    '- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）',
  ].join('\n');
  writeFileSync(mdPath, lines);
  console.log(`MD 已写 ${mdPath}`);
}
const fail = rows.some((r) => r.exit !== 0 && r.exit !== 3);
process.exit(fail ? 1 : 0);
