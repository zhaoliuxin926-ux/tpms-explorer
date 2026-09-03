// core-loader.mjs —— 在 Node 中加载平台 TS 核心（tpms/agent 专用）
//
// 与 .verify/evaluator_check.mjs 同款 rolldown 临时 bundle 模式：
// TS 源码是无扩展名相对导入，Node 原生 type-stripping 无法解析，
// 须经 rolldown 打包成单文件 ESM 后动态 import。
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// 按需导出的核心符号清单（M0：纯数学层；M1 追加几何管线入口）
const CORE_EXPORTS = [
  `export { getTpmsFunction } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
  `export { gibsonAshby, getAnisotropy, BASE_MODULUS, BASE_YIELD_STRENGTH } from ${JSON.stringify(join(PLATFORM, 'src/physics/gibson-ashby.ts'))};`,
].join('\n');

export async function loadCore() {
  const BUNDLE = tmpdir() + '/tpms_agent_core.mjs';
  const entry = tmpdir() + `/tpms_agent_core_entry_${process.pid}.ts`;
  writeFileSync(entry, CORE_EXPORTS);
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('rolldown 打包失败:\n' + (r.stdout || '') + (r.stderr || ''));
  }
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
  return import(pathToFileURL(BUNDLE));
}
