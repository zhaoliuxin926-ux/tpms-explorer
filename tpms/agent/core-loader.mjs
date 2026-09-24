// core-loader.mjs —— 在 Node 中加载平台 TS 核心（tpms/agent 专用）
//
// 与 .verify/evaluator_check.mjs 同款 rolldown 临时 bundle 模式：
// TS 源码是无扩展名相对导入，Node 原生 type-stripping 无法解析，
// 须经 rolldown 打包成单文件 ESM 后动态 import。
//
// 【2026-09-25】源码 mtime 指纹缓存：CLI 短命令冷启动不再每次全量 rolldown
// （此前每条命令都付秒级打包税）。源码或导出清单变更时指纹变化自动重建。
import { writeFileSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  `export { computeMeshSDF, checkMesh, parseSTL, closestPtTriangle } from ` + JSON.stringify(join(PLATFORM, 'src/geometry/mesh-container.ts')) + `;
  export { buildBinarySTL } from ${JSON.stringify(join(PLATFORM, 'src/export/stl-exporter.ts'))};`,
  `export { buildVoxelModel } from ${JSON.stringify(join(PLATFORM, 'src/export/voxel-model.ts'))};`,
  `export { buildOpenfoamPolyMesh, buildStoredZip } from ${JSON.stringify(join(PLATFORM, 'src/export/openfoam-polymesh-exporter.ts'))};`,
  `export { directSlice, buildSliceSvg, buildCliFormat } from ${JSON.stringify(join(PLATFORM, 'src/export/direct-slicer.ts'))};`,
  `export { auditOverhang, searchBuildOrientation } from ${JSON.stringify(join(PLATFORM, 'src/physics/printability-audit.ts'))};`,
  `export { forchheimerTwoPoint } from ${JSON.stringify(join(PLATFORM, 'src/physics/forchheimer.ts'))};`,
  `export { marchingTetrahedra } from ${JSON.stringify(join(PLATFORM, 'src/geometry/marching-tetrahedra.ts'))};`,
  `export { radialGradTransform, schwarzPPhase, radialGradThresholdAt } from ${JSON.stringify(join(PLATFORM, 'src/core/radial-grad.ts'))};`,
  `export { regionWeight } from ${JSON.stringify(join(PLATFORM, 'src/core/region-grad.ts'))};`,
  `export { buildCaseFiles } from ${JSON.stringify(join(PLATFORM, 'src/export/openfoam-case-template.ts'))};`,
  `export { buildAbaqusInp } from ${JSON.stringify(join(PLATFORM, 'src/export/abaqus-inp-exporter.ts'))};`,
].join('\n');

/** 递归收集 src 下 .ts 文件的 path:mtimeMs:size，供指纹计算 */
function collectSrcFingerprints(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      collectSrcFingerprints(p, out);
    } else if (e.isFile() && e.name.endsWith('.ts')) {
      const st = statSync(p);
      out.push(`${p}:${st.mtimeMs}:${st.size}`);
    }
  }
  out.sort();
  return out;
}

/** 源码 + 导出清单指纹；变更即失效缓存 */
function sourceFingerprint() {
  const h = createHash('sha1');
  h.update(CORE_EXPORTS);
  for (const line of collectSrcFingerprints(join(PLATFORM, 'src'))) h.update(line);
  // package.json 依赖变更（如 rolldown 版本）也应触发重建
  try {
    h.update(readFileSync(join(PLATFORM, 'package.json')));
  } catch { /* 忽略 */ }
  return h.digest('hex').slice(0, 16);
}

export async function loadCore() {
  const fp = sourceFingerprint();
  const BUNDLE = join(tmpdir(), `tpms_agent_core_${fp}.mjs`);
  if (existsSync(BUNDLE)) {
    return import(pathToFileURL(BUNDLE));
  }

  const entry = join(tmpdir(), `tpms_agent_core_entry_${fp}.ts`);
  writeFileSync(entry, CORE_EXPORTS);
  // rolldown 是 vite 8 的传递依赖（npm 提升至 tpms-platform/node_modules/.bin）；
  // Windows 下是 .cmd shim，其余平台是无扩展名可执行 shim
  const bin = join(PLATFORM, `node_modules/.bin/rolldown${process.platform === 'win32' ? '.cmd' : ''}`);
  const r = spawnSync(`"${bin}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  try { rmSync(entry, { force: true }); } catch { /* 忽略 */ }
  if (r.status !== 0) {
    try { rmSync(BUNDLE, { force: true }); } catch { /* 忽略 */ }
    throw new Error(
      'rolldown 打包失败（先确认已执行: cd tpms/tpms-platform && npm install）:\n' + (r.stdout || '') + (r.stderr || '')
    );
  }
  return import(pathToFileURL(BUNDLE));
}
