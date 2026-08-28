/**
 * 自然语言 CAD/CAM 提示词代理（v6.0 阶段 V · LLM-Powered CAD Agent）
 *
 * 零依赖规则/关键词意图解析（中英双语）：把日常语言指令翻译为
 * 参数补丁（patches）+ 动作（actions）+ 结构化调整日志。
 * 设计原则：只做确定性映射（不猜、不臆造参数）；未识别的输入显式返回 unknown，
 * 由调用方展示帮助而非静默失败。
 *
 * 示例：「给我设计一个孔隙率 75%、采用 Gyroid 结构、上下带 2mm 实心端板、
 *        用于股骨修复的人工骨支架，并导出 3MF。」
 *   → patches: { porosity: 75, type: 'gyroid', endplateMm: 2 }
 *   → actions: ['export-3mf']
 */

export interface NLPatches {
  type?: string;
  porosity?: number;        // 0-100
  cellSize?: number;
  thickness?: number;
  material?: string;
  structureMode?: string;
  endplateMm?: number;
  containerShape?: string;
}

export type NLAction = 'export-stl' | 'export-3mf' | 'run-simulation' | 'reset' | 'preset-bone' | 'preset-thermal';

export interface NLIntent {
  kind: 'set' | 'action' | 'help' | 'unknown';
  patches: NLPatches;
  actions: NLAction[];
  /** 结构化调整日志（对话面板逐条展示） */
  log: Array<{ field: string; to: string | number }>;
  reply: string;
  confidence: number;
}

const TYPE_WORDS: Array<[RegExp, string, string]> = [
  [/gyroid|吉罗伊德|螺旋|gyroid结构/i, 'gyroid', 'Gyroid'],
  [/diamond|金刚石|钻石/i, 'diamond', 'Diamond'],
  [/schwarz\s*p|施瓦兹|p曲面|schwarzp/i, 'schwarz', 'Schwarz P'],
  [/neovius|新ovius|诺沃厄斯/i, 'neovius', 'Neovius'],
  [/i-?wp|iw plast| iwp/i, 'iwp', 'I-WP'],
  [/f-?rd|frd/i, 'frd', 'F-RD'],
  [/lidinoid|利迪诺/i, 'lidinoid', 'Lidinoid'],
  [/split-?p|分裂p/i, 'splitp', 'Split-P'],
];

const MATERIAL_WORDS: Array<[RegExp, string, string]> = [
  [/ti-?6-?4|tc4|钛合金|钛\b|titanium/i, 'tc4', 'Ti-6Al-4V'],
  [/pla|聚合物|聚合物支架|polymer|高分子/i, 'polymer', 'PLA/聚合物'],
  [/散热|导热|thermal|heat.?sink/i, 'thermal', '高导热'],
];

const MODE_WORDS: Array<[RegExp, string, string]> = [
  [/实心.{0,6}(网格|网络)|solid.?network|实体网络/i, 'solid_network', '实体网络'],
  [/梯度壳|gradient.?shell/i, 'gradient_shell', '梯度壳'],
];

const CONTAINER_WORDS: Array<[RegExp, string, string]> = [
  [/圆柱|cylinder/i, 'cylinder', '圆柱'],
  [/立方|cube|方块/i, 'cube', '立方'],
  [/球|sphere/i, 'sphere', '球'],
];

function firstNum(input: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = input.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

/** 解析自然语言指令 → 参数补丁 + 动作 */
export function parseNL(input: string): NLIntent {
  const text = input.trim();
  const patches: NLPatches = {};
  const actions: NLAction[] = [];
  const log: Array<{ field: string; to: string | number }> = [];
  if (!text) {
    return { kind: 'unknown', patches, actions, log, reply: '请输入设计指令，或输入「帮助」查看示例。', confidence: 0 };
  }
  if (/帮助|help|你能做什么|how to/i.test(text)) {
    return {
      kind: 'help', patches, actions, log,
      reply: '示例：\n· 「孔隙率 75%、Gyroid 结构、带 2mm 端板，导出 3MF」\n· 「钛合金支架，孔隙率 60，圆柱容器」\n· 「运行压溃仿真」\n· 「重置为默认」',
      confidence: 1,
    };
  }

  // 类型
  for (const [re, key, label] of TYPE_WORDS) {
    if (re.test(text)) { patches.type = key; log.push({ field: '曲面类型', to: label }); break; }
  }
  // 材料
  for (const [re, key, label] of MATERIAL_WORDS) {
    if (re.test(text)) { patches.material = key; log.push({ field: '材料', to: label }); break; }
  }
  // 结构模式
  for (const [re, key, label] of MODE_WORDS) {
    if (re.test(text)) { patches.structureMode = key; log.push({ field: '结构模式', to: label }); break; }
  }
  // 容器
  for (const [re, key, label] of CONTAINER_WORDS) {
    if (re.test(text)) { patches.containerShape = key; log.push({ field: '容器', to: label }); break; }
  }
  // 孔隙率（%可省）
  const poro = firstNum(text, [
    /孔隙率?\s*([0-9.]+)\s*%?/i, /porosity\s*[:：]?\s*([0-9.]+)/i, /孔隙\s*([0-9.]+)\s*%?/i,
  ]);
  if (poro !== null) {
    patches.porosity = Math.max(5, Math.min(95, poro));
    log.push({ field: '孔隙率', to: `${patches.porosity}%` });
  }
  // 端板
  const ep = firstNum(text, [
    /([0-9.]+)\s*mm\s*端板/i, /端板\s*([0-9.]+)\s*mm/i, /endplate\s*[:：]?\s*([0-9.]+)/i, /([0-9.]+)\s*毫米\s*端板/i,
  ]);
  if (ep !== null || /端板|endplate|实心端/i.test(text)) {
    patches.endplateMm = ep !== null ? Math.max(0, Math.min(10, ep)) : 2;
    log.push({ field: '端板厚度', to: `${patches.endplateMm}mm` });
  }
  // 单元尺寸
  const cs = firstNum(text, [
    /单元尺寸\s*([0-9.]+)/i, /cellsize\s*[:：]?\s*([0-9.]+)/i, /([0-9.]+)\s*mm\s*单元/i,
  ]);
  if (cs !== null) {
    patches.cellSize = Math.max(1, Math.min(8, cs));
    log.push({ field: '单元尺寸', to: `${patches.cellSize}mm` });
  }
  // 壁厚
  const th = firstNum(text, [
    /壁厚\s*([0-9.]+)/i, /thickness\s*[:：]?\s*([0-9.]+)/i,
  ]);
  if (th !== null) {
    patches.thickness = Math.max(0.2, Math.min(5, th));
    log.push({ field: '壁厚', to: `${patches.thickness}` });
  }
  // 动作
  if (/3mf/i.test(text)) actions.push('export-3mf');
  else if (/stl/i.test(text)) actions.push('export-stl');
  if (/导出|导出模型|export/i.test(text) && !/3mf|stl/i.test(text)) actions.push('export-stl');
  if (/压溃|压缩仿真|simulate|仿真/i.test(text)) actions.push('run-simulation');
  if (/重置|恢复默认|reset/i.test(text)) actions.push('reset');
  if (/骨支架|股骨|bone|医用|植入/i.test(text)) actions.push('preset-bone');

  const nSet = Object.keys(patches).length + actions.length;
  if (nSet === 0) {
    return {
      kind: 'unknown', patches, actions, log,
      reply: `未能从「${text}」识别出参数或动作。输入「帮助」查看示例。`,
      confidence: 0.1,
    };
  }
  const kind: NLIntent['kind'] = actions.length > 0 ? 'action' : 'set';
  const logText = log.map((l) => `${l.field}→${l.to}`).join('、');
  const actText = actions.length ? `；动作：${actions.join('、')}` : '';
  return {
    kind,
    patches,
    actions,
    log,
    reply: `已解析 ${nSet} 项：${logText || '（动作）'}${actText}`,
    confidence: Math.min(1, 0.4 + nSet * 0.2),
  };
}
