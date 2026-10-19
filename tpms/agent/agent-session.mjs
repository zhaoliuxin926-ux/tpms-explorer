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

export const SESSION_SCHEMA_VERSION = 1;
/** 几何语义标签：任何改变同参数产出几何的修复都必须换标签（v2=2026-10-11 strut 真场修正） */
export const GEOMETRY_SEMANTICS = 'v2-2026-10-11-true-strut';

export function newSession() {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    geometrySemantics: GEOMETRY_SEMANTICS,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    recommendations: [],
    executions: [],
  };
}

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
  if (s?.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`会话 schemaVersion=${s?.schemaVersion} ≠ 当前 ${SESSION_SCHEMA_VERSION}（不兼容，明确拒绝）`);
  }
  if (s?.geometrySemantics !== GEOMETRY_SEMANTICS) {
    throw new Error(`会话几何语义版本 ${s?.geometrySemantics} ≠ 当前 ${GEOMETRY_SEMANTICS}——旧候选来自不同几何语义，未经核对不得当作当前结果（S3）。请重新生成推荐`);
  }
  if (!Array.isArray(s.recommendations) || !Array.isArray(s.executions)) {
    throw new Error('会话结构损坏（recommendations/executions 非数组）——拒绝加载');
  }
  return s;
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

/** 从 tpms_pareto 的 CLI 结果记录推荐集（幂等：同一 input+内容不重复记录） */
export function recordPareto(session, toolArgs, parsed) {
  if (!parsed || parsed.command !== 'pareto' || !Array.isArray(parsed.recommendations) || parsed.recommendations.length === 0) return false;
  const cand = parsed.recommendations.map((r, i) => ({
    rank: i + 1, type: r.type, porosity: r.porosity, cellSize: r.cellSize,
    E_GPa: r.E_GPa, kappa_m2: r.kappa_m2, dist_log10: r.dist_log10,
    meetsTarget: parsed.reachable !== false && r.E_GPa >= parsed.targetE && r.kappa_m2 >= parsed.targetKappaM2,
  }));
  const dup = session.recommendations.some((rec) =>
    JSON.stringify(rec.input) === JSON.stringify({ targetE: parsed.targetE, targetKappaM2: parsed.targetKappaM2, top: parsed.top })
    && JSON.stringify(rec.candidates) === JSON.stringify(cand));
  if (dup) return false;
  session.recommendations.push({
    id: `r${session.recommendations.length + 1}`,
    createdAt: new Date().toISOString(),
    tool: 'tpms_pareto',
    input: { targetE: parsed.targetE, targetKappaM2: parsed.targetKappaM2, top: parsed.top },
    reachable: parsed.reachable !== false,
    candidates: cand,
    // S3 来源披露：代理口径随候选落盘（不因会话传递而丢失）
    source: 'tpms_pareto 解析代理（Gibson-Ashby×Kozeny-Carman，非 FE 精确）',
  });
  return true;
}

/** 记录一次推荐派生的执行（S3：候选来源/完整参数/产物位置） */
export function recordExecution(session, entry) {
  session.executions.push({ id: `e${session.executions.length + 1}`, at: new Date().toISOString(), ...entry });
}

// ── 指代解析（S2 确定性绑定）────────────────────────────────────
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const ORDINAL_RE = /第\s*([一二两三四五六七八九十]|\d+)\s*(?:个|项|条|推荐|方案|设计|候选)?/;   // 第N(个/项/...)
const ORDINAL_EN_RE = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\b/i;
const DEMON_RE = /(刚才|上次|之前|前面|上面的|那个|首推|首个)/;
const BUILD_RE = /(构建|建一?个|生成|导出|打印|输出|做出|造|build|construct|export|generate|print|make|create)/i;

function parseOrdinal(s) {
  if (CN_NUM[s]) return CN_NUM[s];
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}
const EN_ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9, '10th': 10 };

/**
 * 解析指令中的"指代+构建"意图到会话推荐集的具体候选。
 * @returns {{status:'none'} | {status:'reject', reason:string} |
 *           {status:'resolved', recId:string, ordinal:number, candidate:object, meetsTarget:boolean}}
 */
export function resolveReference(session, instruction) {
  const build = BUILD_RE.test(instruction);
  const ordCount = [...instruction.matchAll(new RegExp(ORDINAL_RE.source, 'g'))].length
    + [...instruction.matchAll(new RegExp(ORDINAL_EN_RE.source, 'gi'))].length;
  const mOrd = instruction.match(ORDINAL_RE);
  const mEn = instruction.match(ORDINAL_EN_RE);
  const mDem = DEMON_RE.test(instruction);
  const hasRef = !!(mOrd || mEn || mDem);
  if (!hasRef || !build) return { status: 'none' };   // 非指代构建指令 → 走正常 LLM 路径

  // 2026-10-19 Codex 审计 A1 收窄（学生裁决：第一版只接受明确、单一的肯定指代）：
  // 否定表述（"不要构建第一个，构建第二个"曾静默绑第 1 项）与多序数指代（"第一个和第二个"
  // 曾只绑第 1 项不披露）一律解释后拒绝，不做否定范围推断；指代+参数覆盖解析留待后续独立批次。
  if (/(不要|别(?!的)|勿|莫|而非|而不是|除了|排除|不用)/.test(instruction)) {
    return { status: 'reject', reason: '检测到否定/排除表述——第一版指代绑定只接受明确、单一的肯定指代；请直接说"把第 N 个构建出来"' };
  }
  if (ordCount > 1) {
    return { status: 'reject', reason: `检测到 ${ordCount} 个序数指代——第一版不支持多候选/对比选择，请逐个指代（如"把第二个构建出来"）` };
  }

  // 歧义守卫：指令同时携带新参数 → 拒绝静默混合（2026-10-19 扩周期/容器/分辨率：
  // "改成 4 个周期""换成圆柱容器"曾静默用候选原值构建，llm-agent 不经模型直接绑定）
  if (/孔隙率|porosity|周期|periods|容器|container|分辨率|resolution|\d+\s*[%％]/i.test(instruction)) {
    return { status: 'reject', reason: '指令同时含指代与新的参数（孔隙率/周期/容器/分辨率等）——歧义拒绝。请要么只说"把第 N 个构建出来"，要么给完整参数不带指代' };
  }
  if (session.recommendations.length === 0) {
    return { status: 'reject', reason: '会话中没有任何推荐结果可指代——请先用 tpms_pareto 生成推荐（同一 --session 文件）' };
  }
  let ordinal = 1;
  if (mOrd) {
    // 红队 2026-10-11：「第一百个」曾把"一"捕获静默当第一（误导绑定）——复合数词
    // （百/千/万/零或连串数字字）超出支持域，一律结构化拒绝而非猜
    const after = instruction.slice((mOrd.index ?? 0) + mOrd[0].length);
    if (/[一二两三四五六七八九十百千万零]/.test(after.slice(0, 1))) {
      return { status: 'reject', reason: '复合/超域中文数词（如"一百"）不在 1~10 支持域——请用阿拉伯数字或"第 N 个"（1~10）' };
    }
    if (/^[.\d]/.test(after) && /^\d/.test(after.slice(1))) {
      return { status: 'reject', reason: '指代序数含小数（如"第 1.5 个"）——只支持 1~10 整数序' };
    }
    ordinal = parseOrdinal(mOrd[1]);
  }
  else if (mEn) ordinal = EN_ORD[mEn[1].toLowerCase()];
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    return { status: 'reject', reason: `无法解析指代序数（"${mOrd?.[0] ?? mEn?.[0]}"）——请用"第 N 个"（1~10）` };
  }
  const rec = session.recommendations[session.recommendations.length - 1];   // 多次推荐时指最近一次
  if (ordinal > rec.candidates.length) {
    return { status: 'reject', reason: `指代越界：最近一次推荐（${rec.id}）只有 ${rec.candidates.length} 个候选，没有第 ${ordinal} 个` };
  }
  const candidate = rec.candidates[ordinal - 1];
  return { status: 'resolved', recId: rec.id, ordinal, candidate, meetsTarget: candidate.meetsTarget !== false };
}
