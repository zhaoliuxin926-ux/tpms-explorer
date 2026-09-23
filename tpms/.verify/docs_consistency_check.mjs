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

  const guardOf = (src, n) => src.includes(`pass < ${n}`) || src.includes(`passCount < ${n}`);
  guardOf(parity, 332) ? ok('parity_math GUARD 332') : bad('parity_math GUARD 332');
  guardOf(selftest, 49) ? ok('selftest GUARD 49') : bad('selftest GUARD 49');
  guardOf(llmp, 33) ? ok('llm_provider GUARD 33') : bad('llm_provider GUARD 33');
  guardOf(schema, 98) ? ok('schema_check GUARD 98（实测可 >）') : bad('schema_check GUARD 98');
  guardOf(inv, 27) ? ok('inverse_design GUARD 27') : bad('inverse_design GUARD 27');

  const readme = read('README.md');
  const readmeEn = read('README_EN.md');
  /44\/44|44 道|45 gates|44-gate/i.test(readme + readmeEn)
    ? ok('README 宣称 45 门') : bad('README 宣称 45 门');
  readme.includes('332') ? ok('README 引用 parity 332') : bad('README 引用 parity 332');
  readme.includes('inverse_design_audit 27') ? ok('README 反演 27 断言') : bad('README 反演 27 断言');
}

// ── 2. 发布物禁止出现的过期/夸大口径 ──
console.log('\n[B] 过期/夸大口径扫描（发布物）');
{
  const targets = [
    'docs/blog/2026-09-16-44-gates.md',
    'docs/blog/2026-09-17-agent-architecture.md',
    'docs/blog/publish/2026-09-16-44-gates.md',
    'docs/blog/publish/2026-09-17-agent-architecture.md',
    'docs/career/interview-pack.md',
  ];
  const banned = [
    [/位级一致/, '「位级一致」夸大（实为容差对拍）'],
    [/56[^\n]{0,40}3\.4×/, '56→15ms 误写 3.4×（应为 ≈3.7×）'],
    [/Diamond R96 偏差 0\.26/, 'Diamond R96 0.26pp（实测 0.13pp）'],
    [/五层架构|链路分五层/, '五层 vs M0–M5 六项矛盾'],
    [/打穿六次/, '「六次」应为「两轮六例」'],
  ];
  for (const rel of targets) {
    if (!existsSync(path.join(ROOT, rel))) { bad('文件存在 ' + rel); continue; }
    const src = read(rel);
    for (const [re, why] of banned) {
      re.test(src) ? bad(rel + ' 含禁句', why) : ok(rel + ' 无「' + why.slice(0, 12) + '…」');
    }
  }
  // 37/37 必须带 n=1 或 single/best-of 限定（防统计→确定）
  for (const rel of targets) {
    const src = read(rel);
    const hits = src.match(/37\/37/g) || [];
    if (hits.length === 0) { ok(rel + ' 无裸 37/37'); continue; }
    const scoped = /37\/37[^\n]{0,40}(n=1|单轮|single|best[- ]of|一次全绿)/i.test(src)
      || /n=1[^\n]{0,40}37\/37|单轮[^\n]{0,20}37\/37/i.test(src);
    scoped ? ok(rel + ' 37/37 带样本量限定') : bad(rel + ' 37/37 无 n=1/单轮限定');
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
    execSync('node tpms/agent/sync-publish.mjs --check', { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
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

  // 教学版禁止原生 alert（toast 对齐工程版）
  const appHtml = read('docs/app.html');
  /alert\(/.test(appHtml)
    ? bad('教学版仍有 alert()', '应改 flashToast')
    : ok('教学版无 alert（flashToast）');
  appHtml.includes('flashToast') && appHtml.includes('.toast')
    ? ok('教学版 toast 契约在位') : bad('教学版 toast 缺失');

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
if (fail > 0) {
  console.log('失败项:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
