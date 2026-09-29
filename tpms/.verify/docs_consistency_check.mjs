/**
 * docs_consistency_check.mjs —— 文档数字一致性门禁（静态哨兵，秒级）
 *
 * 防「过期数字/口径漂移」类事故（2026-09-23 对抗审查实锤：Diamond 0.26pp、
 * 3.4× 倍率、徽章 stale、位级一致、37/37 无 n=1 等）。纯文本对拍，不跑几何。
 *
 * 运行：node tpms/.verify/docs_consistency_check.mjs   （仓库根）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

let pass = 0, fail = 0;
const failures = [];
const ok = (name) => { pass++; console.log('  ✓', name); };
const bad = (name, info = '') => { fail++; failures.push(name + (info ? ' — ' + info : '')); console.log('  ✗', name, info); };

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1. GUARD 基线 ↔ 文档宣称 ──
console.log('\n[A] GUARD 基线 ↔ 文档宣称');
{
  const parity = read('tpms/.verify/parity_math.mjs');
  const selftest = read('tpms/agent/selftest.mjs');
  const llmp = read('tpms/agent/llm_provider_selftest.mjs');
  const schema = read('tpms/agent/schema_check.mjs');
  const inv = read('tpms/.verify/inverse_design_audit.mjs');

  const guardOf = (src, n) => new RegExp(`\\bpass(?:Count)?\\s*<\\s*${n}\\b`).test(src);
  guardOf(parity, 332) ? ok('parity_math GUARD 332') : bad('parity_math GUARD 332');
  guardOf(selftest, 50) ? ok('selftest GUARD 50') : bad('selftest GUARD 50');
  guardOf(llmp, 35) ? ok('llm_provider GUARD 35') : bad('llm_provider GUARD 35');
  guardOf(schema, 98) ? ok('schema_check GUARD 98（实测可 >）') : bad('schema_check GUARD 98');
  guardOf(inv, 27) ? ok('inverse_design GUARD 27') : bad('inverse_design GUARD 27');

  const readme = read('README.md');
  const readmeEn = read('README_EN.md');
  (readme + readmeEn).includes('46') && /46\/46|46 道|46 gates/i.test(readme + readmeEn)
    ? ok('README 宣称 46 门') : bad('README 宣称 46 门');
  readme.includes('332') ? ok('README 引用 parity 332') : bad('README 引用 parity 332');
  readme.includes('inverse_design_audit 27') ? ok('README 反演 27 断言') : bad('README 反演 27 断言');
}

// ── 2. 发布物禁止出现的过期/夸大口径 ──
console.log('\n[B] 过期/夸大口径扫描（发布物）');
{
  const targets = [
    'README.md',
    'README_EN.md',
    'docs/blog/2026-09-16-44-gates.md',
    'docs/blog/2026-09-17-agent-architecture.md',
    'docs/blog/publish/2026-09-16-44-gates.md',
    'docs/blog/publish/2026-09-17-agent-architecture.md',
    'docs/career/interview-pack.md',
    'docs/WORKFLOW_GUIDE.md',
    'docs/PROJECT_INVENTORY.md',
    'docs/PROJECT_SUMMARY.md',
    'docs/LEARNING_PATH.md',
    'BENCHMARKS.md',
    'tpms/README.md',
    'docs/paper/MANUSCRIPT.md',
    'docs/paper/COVER_LETTER.md',
    'docs/paper/latex/main.tex',
  ];
  // job_narrative 在 gitignored 记忆区，存在则一并扫（面试材料不许漂）
  const optional = ['tpms/agent_memory/job_narrative.md'];
  const banned = [
    [/位级一致|逐位一致/, '「位级/逐位一致」夸大（实为容差对拍）'],
    [/56[^\n]{0,40}3\.4×/, '56→15ms 误写 3.4×（应为 ≈3.7×）'],
    [/Diamond R96 偏差 0\.26|0\.26\s*pp\s*@\s*R96|0\.26pp@R96|R96 0\.26pp|reaching 0\.26\s*pp|0\.26\s*pp\s*\(Diamond/, 'Diamond R96 0.26pp（实测 0.13pp）'],
    [/Diamond[^\n]{0,30}65\s*%?\s*target|65\s*%?\s*target[^\n]{0,20}Diamond/, 'Diamond 目标孔隙率 65%（BENCHMARKS 口径 60%）'],
    [/五层架构|链路分五层|五层信任/, '五层 vs M0–M5 六项矛盾'],
    [/打穿六次/, '「六次」应为「两轮六例」'],
    [/selftest\.mjs[^\n]{0,40}49\s*断言|#\s*CLI 自检：49\s*断言|106\/49\/33/, 'selftest 断言数 49（GUARD 已钉 50）'],
    [/~3(?:50|53)KB\s*gzip|首屏[^\n]{0,10}35\dKB/, '首屏 35xKB gzip（分包后 ~283KB：three 182+主包 101）'],
  ];
  const scanList = targets.concat(optional.filter((rel) => existsSync(path.join(ROOT, rel))));
  for (const rel of scanList) {
    if (!existsSync(path.join(ROOT, rel))) { bad('文件存在 ' + rel); continue; }
    const src = read(rel);
    for (const [re, why] of banned) {
      re.test(src) ? bad(rel + ' 含禁句', why) : ok(rel + ' 无「' + why.slice(0, 12) + '…」');
    }
  }
  // 37/37 必须带 n=1 或 single/best-of 限定（防统计→确定）
  for (const rel of scanList) {
    const src = read(rel);
    const hits = src.match(/37\/37/g) || [];
    if (hits.length === 0) { ok(rel + ' 无裸 37/37'); continue; }
    // 样本量限定：n=1/单轮 或 多轮 n≥2 均可（2026-09-27：LIVE 已是多轮 37/37，勿称确定性）
    // geq 变体：论文 LaTeX 写 n$\geq$2（pdflatex 不收 Unicode ≥）
    // 逐出现点判定（红队 I P3-10：文件级放行会放过同文件其他裸 37/37）
    const scopeOk = /(n=1|n≥2|n\$\\geq\$\s?2|单轮|多轮|multi[- ]round|single|best[- ]of|一次全绿|勿称确定)/i;
    let allScoped = true;
    for (const m of src.matchAll(/37\/37/g)) {
      const ctx = src.slice(Math.max(0, m.index - 80), m.index + 90);
      if (!scopeOk.test(ctx)) { allScoped = false; break; }
    }
    allScoped ? ok(rel + ' 37/37 带样本量限定（逐点）') : bad(rel + ' 37/37 无 n=1/单轮限定');
  }
}

// ── 3. publish 粘贴版 ↔ 正式版同源 ──
console.log('\n[C] publish 粘贴版同源');
{
  const stripLinks = (s) => s.replace(/\]\((https?:\/\/[^)]+|[^)]+\.md)\)/g, '](URL)');
  const pairs = [
    ['docs/blog/2026-09-16-44-gates.md', 'docs/blog/publish/2026-09-16-44-gates.md'],
    ['docs/blog/2026-09-17-agent-architecture.md', 'docs/blog/publish/2026-09-17-agent-architecture.md'],
  ];
  for (const [a, b] of pairs) {
    const A = stripLinks(read(a)), B = stripLinks(read(b));
    A === B ? ok(path.basename(a) + ' 正式/粘贴内容同源') : bad(path.basename(a) + ' 正式/粘贴内容漂移', '（忽略链接形态后不等）');
  }
  // 链接绝对化与正式版→粘贴版变换同源（与 sync-publish.mjs 对拍，防「改正式版忘粘贴版」）
  try {
    execSync('node tpms/agent/sync-publish.mjs --check', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 });
    ok('sync-publish --check 粘贴版未漂移');
  } catch (e) {
    bad('sync-publish --check 失败', String(e.stdout || e.message).slice(0, 120));
  }
}

// ── 3b. 工程版调色预设单例（防 8 连插重复块回归）──
console.log('\n[C2] 调色预设结构');
{
  const html = read('tpms/tpms-platform/index.html');
  const cssBlocks = (html.match(/:root\[data-palette="teach"\]/g) || []).length;
  cssBlocks === 1 ? ok('teach 调色 CSS 块恰好 1 份') : bad('teach 调色 CSS 块重复/缺失', `count=${cssBlocks}`);
  html.includes('data-palette-set="engine"') && html.includes('data-palette-set="teach"')
    ? ok('顶栏 engine/teach 切换按钮在位') : bad('调色切换按钮缺失');

  // 导出中心 G-code 入口在位（引擎+门禁已就绪，UI 面）
  const srcMain = read('tpms/tpms-platform/src/main.ts');
  html.includes('data-export="gcode"') && srcMain.includes("case 'gcode'") && srcMain.includes('compileGcode')
    ? ok('G-code 导出入口接线（menu + handleExport）')
    : bad('G-code 导出入口缺失', 'menu 或 main.ts case 未接');
  html.includes('id="gcode-preset"') && srcMain.includes('gcode-layer') && srcMain.includes('gOpts.layerHeightMm')
    ? ok('G-code 工艺参数可调（preset/层高/线宽/温度）')
    : bad('G-code 工艺参数未接线');

  // 教学版禁止原生 alert（toast 对齐工程版）
  const appHtml = read('docs/app.html');
  /alert\(/.test(appHtml)
    ? bad('教学版仍有 alert()', '应改 flashToast')
    : ok('教学版无 alert（flashToast）');
  appHtml.includes('flashToast') && appHtml.includes('.toast')
    ? ok('教学版 toast 契约在位') : bad('教学版 toast 缺失');

  // 索引池上界须为 18·R³ 算法硬上界（2026-09-27 红队矩阵五连溢出实锤；防回退 6×N³ 经验值；
  // 2026-09-29 绝对帽提 9M→18M，哨兵同步——cdd k10 R116 实测需求 9,000,003 曾距旧帽差 3）
  const snSrc = read('tpms/tpms-platform/src/geometry/surface-nets.ts');
  /ensureIndices\(\s*Math\.min\(\s*18_000_000\s*,\s*R\s*\*\s*R\s*\*\s*R\s*\*\s*18\s*\)/.test(snSrc)
    ? ok('索引池上界 18·R³（算法硬上界；绝对帽 18M）')
    : bad('索引池上界回退', '期望 ensureIndices(min(18M, R*R*R*18))');

  // RELEASE_NOTES 一律带「发布时点快照」边界（防当轮门禁数被读成现态）
  const rnFiles = readdirSync(path.join(ROOT, 'docs')).filter((f) => f.startsWith('RELEASE_NOTES'));
  const rnMissing = rnFiles.filter((f) => !read('docs/' + f).includes('发布时点快照'));
  rnMissing.length === 0
    ? ok(`RELEASE_NOTES 快照边界全覆盖（${rnFiles.length} 份）`)
    : bad('RELEASE_NOTES 缺快照边界', rnMissing.join(','));

  // 版本纪元：产品自称 v1.0.x；用户可见功能标签须带「原型期」
  const expHeaders = [
    'tpms/tpms-platform/src/main.ts',
    'tpms/tpms-platform/src/export/bibtex-sidecar.ts',
    'tpms/tpms-platform/src/export/gcode-slicer.ts',
    'tpms/tpms-platform/src/export/abaqus-inp-exporter.ts',
    'tpms/tpms-platform/src/export/verification-suite.ts',
  ].map((f) => read(f)).join('\n');
  /Explorer v(?:0|2|3|4|5|6|7|8|9)\./.test(expHeaders)
    ? bad('导出物仍自称 v0/v2–v9', '应 v1.0.3')
    : ok('导出物产品号 v1.0.3');
  /Explorer v1\.0\./.test(expHeaders) ? ok('导出物含 v1.0.x') : bad('导出物缺 v1.0.x');
  const landing = read('docs/index.html');
  /style="color:#[0-9a-f]+">v[0-9]+\.[0-9]</.test(landing)
    ? bad('落地页裸版本 chip', '须带「原型期」')
    : ok('落地页版本 chip 均带原型期');
  /v7\.0\.0|v9\.2\.0-24families/.test(read('docs/LEARNING_PATH.md') + read('docs/PROJECT_SUMMARY.md') + read('docs/WORKFLOW_GUIDE.md'))
    ? bad('文档自称旧产品版本', '应 v1.0.x')
    : ok('学习路径/总纲/工作流自称 v1.0.x');

  // 三主线交付物在位
  for (const rel of ['docs/QUICKSTART.md', 'CONTRIBUTING.md', 'docs/HONESTY_BOUNDARIES.md', 'docs/regression-matrix.md', 'docs/LAB_ONE_PAGER.md', 'docs/PROJECT_INVENTORY.md', 'docs/LIT_BAND_CARD.md', 'docs/YOUR_10_MIN.md', 'docs/VIRTUAL_CALIBRATION.md']) {
    existsSync(path.join(ROOT, rel)) ? ok('交付物 ' + rel) : bad('缺交付物 ' + rel);
  }

  // 红队修复哨兵
  const qs = read('docs/QUICKSTART.md');
  qs.includes('--provider zhipu')
    ? bad('QUICKSTART 仍写 --provider zhipu')
    : ok('QUICKSTART provider 口径');
  const spec = read('tpms/agent/export-specimens.mjs');
  spec.includes("type: 'fcky'") && !spec.includes("type: 'fks'")
    ? ok('试样 S5/S6 = fcky') : bad('试样族 fcky 不一致');
  const fit = read('tpms/agent/fit-batch.mjs');
  fit.includes('fit-report.mock.md') && fit.includes('ISO')
    ? ok('fit-batch mock 隔离+诚实标注') : bad('fit-batch 假 ISO/mock 覆盖');
  // WORKFLOW 阶段标签须带「原型期」
  const wf = read('docs/WORKFLOW_GUIDE.md');
  /🆕 v[0-9]/.test(wf)
    ? bad('WORKFLOW 裸阶段版本号', '应 🆕 原型期 vN')
    : ok('WORKFLOW 阶段标签统一');
  const spec2 = read('tpms/agent/export-specimens.mjs');
  spec2.includes('outAbs') && spec2.includes('TIMEOUT_MS') && spec2.includes("type: 'fcky'")
    ? ok('export-specimens 路径钳制+超时+fcky')
    : bad('export-specimens 未硬化');
  // 文献带偏差卡可复跑且默认带内
  try {
    execSync('node tpms/agent/lit-band-card.mjs', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 15_000 });
    ok('lit-band-card 默认带内');
  } catch (e) {
    bad('lit-band-card 失败', String(e.stdout || e.message).slice(0, 80));
  }

  // 空态/错误文案标点：失败后半角冒号 / 用户可见 "..." 省略号
  const uiSrc = read('tpms/tpms-platform/src/main.ts') + appHtml;
  /失败: /.test(uiSrc)
    ? bad('UI 文案半角冒号「失败: 」', '应全角「失败：」')
    : ok('UI 失败文案冒号统一');
  /初始化中\.\.\.|准备中\.\.\.|正在下载\.\.\./.test(uiSrc + html)
    ? bad('UI 省略号仍为 ...', '应 …')
    : ok('UI 省略号统一为 …');

  // 部署产物卫生：禁 sourcemap 外泄、禁旧 hash 主包残留（2026-09-23 实锤 index-Nm2 孤儿）
  const assetsDir = path.join(ROOT, 'docs/platform/assets');
  const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const maps = assets.filter((f) => f.endsWith('.map'));
  maps.length === 0 ? ok('docs/platform 无 .map 外泄') : bad('docs/platform 残留 sourcemap', maps.join(','));
  const entryJs = assets.filter((f) => /^index-.*\.js$/.test(f));
  entryJs.length === 1 ? ok('docs/platform 主包唯一 index-*.js') : bad('docs/platform 主包残留/缺失', entryJs.join(','));
  const deployed = read('docs/platform/index.html');
  const ref = deployed.match(/assets\/(index-[^"]+\.js)/);
  ref && entryJs[0] === ref[1]
    ? ok('index.html 引用主包与 assets 一致')
    : bad('index.html 主包引用漂移', ref ? ref[1] : '未找到');
}

// ── 4. 版本徽章 ↔ 最新 tag ──
console.log('\n[D] 版本徽章 ↔ 最新 tag');
{
  let tag = 'v1.0.3';
  try {
    tag = execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { /* 无 git 时用默认 */ }
  const readme = read('README.md');
  readme.includes(`release-${tag}`) || readme.includes(tag)
    ? ok('README 徽章/正文含最新 tag ' + tag)
    : bad('README 徽章未对齐最新 tag', `期望 ${tag}`);
}

console.log(`\nDOCS-CONSISTENCY ${pass} PASS / ${fail} FAIL`);
// pass 下限守卫（2026-09-27 对抗审查批：论文/targets/禁句+池上界/快照边界扩面后钉 180，防断言集体跳过；实测 197）
if (pass < 180) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 180（实测 197；文案 160 为历史漂移，guard_audit 首跑抓出 2026-09-29）`); process.exit(1); }
if (fail > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
