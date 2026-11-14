/**
 * agent-session.mjs — CLI 显式会话（打磨计划批次 4 S1-S3，2026-10-11）
 *
 * 设计：
 *  - 会话文件=带版本 JSON：推荐集（tpms_pareto 结果快照）+ 执行记录（来源链接/完整
 *    参数/产物位置）。原子写（同目录 tmp+rename）；不保存 API key（内容只来自工具
 *    结果，密钥从不进入会话——by construction）。
 *  - 损坏/不兼容文件明确拒绝（throw 结构化信息，调用方 exit 2）。
 *  - 跨调用指代（S2）=**确定性绑定**：指代词+构建意图由本模块解析到会话推荐集的
 *    具体候选并直接构造 tpms_mesh 参数——不把指代交给模型猜（两步旅程对抗定案：
 *    模型臆造参数=信任破坏面）。缺结果/越界/歧义→结构化拒绝，绝不静默构建另一方案。
 *  - 几何语义版本（S3）：会话记录创建时的语义标签；语义变化（如 strut 真场修正）
 *    后旧候选未经核对不得当作当前结果——加载即拒。
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SESSION_SCHEMA_VERSION,
  GEOMETRY_SEMANTICS,
  BINDING_SEMANTICS,
  newSession,
  validateSessionObject,
  recordPareto,
  recordExecution,
  candidateToMeshArgs,
  resolveReference,
  AFFIRM_WL,
} from './session-core.mjs';

export {
  SESSION_SCHEMA_VERSION,
  GEOMETRY_SEMANTICS,
  BINDING_SEMANTICS,
  newSession,
  validateSessionObject,
  recordPareto,
  recordExecution,
  candidateToMeshArgs,
  resolveReference,
  AFFIRM_WL,
};

/** 加载并校验会话；损坏/版本不兼容/语义版本变化 → throw（调用方 exit 2） */
export function loadSession(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`会话文件不可读（${path}）：${e.message}`);
  }
  let s;
  try {
    s = JSON.parse(raw);
  } catch {
    throw new Error(`会话文件损坏（非 JSON）：${path}——拒绝加载。如需全新会话请删除该文件或另指定 --session 路径`);
  }
  return validateSessionObject(s);
}

/** 原子写：同目录临时文件+rename（半写状态不被读到） */
export function saveSession(path, session) {
  session.updated = new Date().toISOString();
  const tmp = join(dirname(path), `.session-tmp-${randomBytes(4).toString('hex')}.json`);
  writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8');
  renameSync(tmp, path);
}

/** 首跑新建/续跑加载（不存在→全新会话；存在→严格校验加载） */
export function loadOrCreateSession(path) {
  if (!existsSync(path)) return newSession();
  return loadSession(path);
}
