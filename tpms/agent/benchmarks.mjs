#!/usr/bin/env node
// benchmarks.mjs —— B5 公开基准采集：24 曲面 × R{48,96} × p0.6 矩阵
// 每格：退出码/水密三硬指标/解析-实测孔隙率偏差/构建耗时/交付物
// 用法: node tpms/agent/benchmarks.mjs [--md 仓库根/BENCHMARKS.md] [--json 路径] [--quick(R48-only)]
// 诚实口径：拒产/超时如实记录（fail-closed 是平台行为的一部分）；fcks 可产域=R120 中段孔隙率（p0.5-0.7 实测可产）。
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'tpms.mjs');
const OUT = join(tmpdir(), 'tpms-bench', '_bench.stl');
mkdirSync(join(tmpdir(), 'tpms-bench'), { recursive: true });
const args = process.argv.slice(2);
const mdPath = args.includes('--md') ? args[args.indexOf('--md') + 1] : null;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : join(HERE, 'benchmarks-latest.json');
const quick = args.includes('--quick');
const TYPES = ['gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'octo', 'karcher', 'fks', 'fky', 'gprime', 'fcks', 'dprime', 'dp', 'dd', 'dg', 'fcky', 'cdd', 'slotp', 'fs', 'qstar', 'ws', 'strutbcc', 'strutoctet'];
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
        : t === 'dg' ? '求根域自适应后（2026-10-02 C1）R96 精确命中 0.19pp（旧 ±1.6 钳制时代曾带 ~8pp 偏差静默交付）；R48 p0.6 薄壁自触 fail-closed（nm 18354），R96 可产；k6 下 p≥0.75 各分辨率拒产、升分辨率非单调（R128 p0.65 交错拒产，2026-10-04 实测）；高孔隙率需求建议 periods=3（实测全 p 可产）'
        : t === 'gprime' ? '默认周期数 k6 R96 p0.6 薄壁自触 fail-closed（nm 19080），降周期数 k=2 可产'
        : t === 'strutbcc' ? '桁架杆网络 SDF（弯曲主导 E∝ρ²）；k 固定=3（cellSize 暂不联动）；C1 代理未标定走 fallback（标定留档）'
        : t === 'strutoctet' ? '桁架拉伸主导（E∝ρ，Deshpande-Fleck）；k 固定=3；C1 未标定；与 strutbcc 构成 strut 力学谱'
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
    // 2026-10-02 审查：模板数字曾停 20 族/45 门——生成器每次重算冲掉手修，源头修
    '| 曲面族 | 24 | 4 | 19 | 8+ |',
    '| 验证门禁 | 46 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |',
    '| 孔隙率求解 | exact 解析求根+网格实测校正（Diamond R96 见 §2 当前快照，MC 噪声带 0.1~0.4pp） | 解析 NIntegrate | level-set 近似 | 数值 |',
    '| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |',
    '| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |',
    '| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |', '',
    '## 5. 诚实边界', '',
    '- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛',
    '- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）',
    '- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准',
    '- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）', '',
    '## 6. 访客体验快照（Lighthouse·环境相关·人工复测节——生成器不重算，数字为标注日期的实测快照）', '',
    '- 2026-10-03 实测（Chrome 稳定版 · Pages 线上 · 落地页+platform × desktop+mobile 四轮）：Accessibility / Best Practices / SEO / Agentic Browsing 四类 **100/100**（落地页两轮各 40 项审计零失败；platform 两轮各 50 项零失败；分数有环境方差，以当日复测为准）',
    '- 2026-10-04 补测教学版 docs/app.html（Pages 形态 × desktop+mobile 两轮）：四类同样 **100/100**（各 51 项审计零失败）——三页 × 双端六轮全满贯',
    '- 关键时延（同日 Navigation Timing，未节流口径）：落地页 TTFB 194ms · FCP 1.06s · load 0.95s；platform 首开 load 4.7s · 传输 ~325KB（gzip；three.js 主包 277KB 见 GitHub 压缩产物口径）；教学版 TTFB 516ms · FCP 0.93s · load 1.8s · 传输 ~138KB',
    '- 复测口径（访客可复现）：Chrome DevTools Lighthouse 面板 / Lighthouse CLI / PageSpeed Insights 任一，对三页各跑 desktop+mobile navigation 审计；本节数字仅在人工复测后更新（生成器重跑 §1-§5 不触碰本节内容块以外的快照值）',
    '- 口径披露：本快照为 Accessibility/Best Practices/SEO/Agentic 四类，**不含 Performance 类**；加载时延以上行未节流 Navigation Timing 另列，**与 Lighthouse simulated 节流值口径不可互比**',
  ].join('\n');
  writeFileSync(mdPath, lines);
  console.log(`MD 已写 ${mdPath}`);
}
const fail = rows.some((r) => r.exit !== 0 && r.exit !== 3);
process.exit(fail ? 1 : 0);
