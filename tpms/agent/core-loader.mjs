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

// 按需导出的核心符号清单（M0：纯数学层；M1：几何管线；M5：体素 INP 交付）
const CORE_EXPORTS = [
  `export { getTpmsFunction } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
  `export { gibsonAshby, getAnisotropy, BASE_MODULUS, BASE_YIELD_STRENGTH } from ${JSON.stringify(join(PLATFORM, 'src/physics/gibson-ashby.ts'))};`,
  `export { buildSurface } from ${JSON.stringify(join(PLATFORM, 'src/geometry/surface-nets.ts'))};`,
  `export { globalBufferPool } from ${JSON.stringify(join(PLATFORM, 'src/geometry/buffer-pool.ts'))};`,
  `export { wcToMmFactor } from ${JSON.stringify(join(PLATFORM, 'src/core/units.ts'))};`,
  `export { buildBinarySTL } from ${JSON.stringify(join(PLATFORM, 'src/export/stl-exporter.ts'))};`,
  `export { buildVoxelModel } from ${JSON.stringify(join(PLATFORM, 'src/export/voxel-model.ts'))};`,
  `export { buildAbaqusInp } from ${JSON.stringify(join(PLATFORM, 'src/export/abaqus-inp-exporter.ts'))};`,
].join('\n');

export async function loadCore() {
  const BUNDLE = tmpdir() + `/tpms_agent_core_${process.pid}.mjs`;
  const entry = tmpdir() + `/tpms_agent_core_entry_${process.pid}.ts`;
  writeFileSync(entry, CORE_EXPORTS);
  // rolldown 是 vite 8 的传递依赖（npm 提升至 tpms-platform/node_modules/.bin）；
  // Windows 下是 .cmd shim，其余平台是无扩展名可执行 shim
  const bin = join(PLATFORM, `node_modules/.bin/rolldown${process.platform === 'win32' ? '.cmd' : ''}`);
  const r = spawnSync(`"${bin}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
  if (r.status !== 0) {
    throw new Error(
      'rolldown 打包失败（先确认已执行: cd tpms/tpms-platform && npm install）:\n' + (r.stdout || '') + (r.stderr || '')
    );
  }
  return import(pathToFileURL(BUNDLE));
}
