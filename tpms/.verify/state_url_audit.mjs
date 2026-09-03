/** state_url_audit.mjs —— 状态隔离、Undo/Redo 与分享链接回归审计 */

import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');
const entry = join(tmpdir(), 'tpms_state_url_audit_entry.ts');
const bundle = join(tmpdir(), 'tpms_state_url_audit_bundle.mjs');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(PLATFORM, 'src/state.ts'))};`,
  `export { parseURLParams } from ${JSON.stringify(join(PLATFORM, 'src/url-params.ts'))};`,
].join('\n'));
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
if (!existsSync(rolldown)) {
  console.error('rolldown 不存在:', rolldown);
  process.exit(1);
}
const built = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${bundle}"`, {
  shell: true,
  encoding: 'utf8',
});
if (built.status !== 0) {
  console.error('rolldown 打包失败:', built.stdout, built.stderr);
  process.exit(1);
}

const {
  getState,
  setState,
  pushHistory,
  resetHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  buildShareURL,
  parseURLParams,
} = await import(pathToFileURL(bundle));

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// getState 必须是隔离快照：外部修改不能回写当前状态。
const leaked = getState();
leaked.weights[0] = 9;
leaked.hybrid.axis = 'radial';
leaked.neural.z[0] = -9;
const untouched = getState();
check('getState 深拷贝 weights', untouched.weights[0] === 1);
check('getState 深拷贝 hybrid', untouched.hybrid.axis === 'x');
check('getState 深拷贝 neural.z', untouched.neural.z[0] === 3);

// 嵌套 partial 更新应保留同一配置中未更新的字段。
setState({ hybrid: { enabled: true } });
const merged = getState();
check('嵌套 partial 合并', merged.hybrid.enabled && merged.hybrid.typeB === 'diamond');

// 历史快照必须独立于后续状态修改，且 redo 能恢复原值。
setState({ neural: { enabled: true, z: [1, 0, 0, 0, 0, 0, 0, 0] } });
pushHistory();
setState({ neural: { z: [2, 0, 0, 0, 0, 0, 0, 0] } });
pushHistory();
check('Undo 可用', canUndo());
const undone = undo();
check('Undo 恢复深层快照', undone?.neural.enabled === true && undone.neural.z[0] === 1);
const redone = redo();
check('Redo 恢复最新状态', redone?.neural.z[0] === 2 && !canRedo());

// URL 恢复后的状态必须成为新会话历史基线；首次编辑后撤销不能跳回默认态。
setState({ type: 'diamond', material: 'polymer', coloring: 'elevation' });
resetHistory();
setState({ material: 'thermal' });
pushHistory();
const urlBaselineUndo = undo();
check('URL 恢复态成为 Undo 基线', urlBaselineUndo?.type === 'diamond'
  && urlBaselineUndo.material === 'polymer' && urlBaselineUndo.coloring === 'elevation');
const urlBaselineRedo = redo();
check('URL 基线之后的编辑可 Redo', urlBaselineRedo?.type === 'diamond'
  && urlBaselineRedo.material === 'thermal' && urlBaselineRedo.coloring === 'elevation');

// 分享链接覆盖非默认渲染/空间参数，并兼容 URL 白名单解析。
setState({
  coloring: 'gauss_curvature',
  gpuAccelerate: false,
  manifold: { kind: 'metric', radius: 18, scale: 2.2, axis: 'x' },
});
globalThis.location = { href: 'https://example.test/platform/index.html' };
const share = buildShareURL();
const parsed = parseURLParams(new URL(share).search);
check('分享链接恢复 coloring', parsed.coloring === 'gauss_curvature');
check('分享链接恢复 GPU 偏好', parsed.gpuAccelerate === false);
check('分享链接恢复 manifold 全参数', parsed.manifold?.kind === 'metric'
  && parsed.manifold.radius === 18 && parsed.manifold.scale === 2.2 && parsed.manifold.axis === 'x');

console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  if (pass < 12) { console.error('GUARD FAIL: 断言执行数 ' + pass + ' < 基线 12（恒真/集体跳过防护，2026-09-04 审查纳管）'); process.exit(1); }
if (fail) process.exit(1);
