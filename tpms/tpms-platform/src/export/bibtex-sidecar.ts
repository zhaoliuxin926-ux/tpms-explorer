import type { AppState, PhysicsMetrics } from '../types';

const DOI_MAP: Record<string, string> = {
  gyroid: '10.1016/j.ijsolstr.2017.02.015',
  diamond: '10.1016/j.actbio.2018.04.011',
  schwarz: '10.1016/j.addma.2017.03.019',
  'i-wp': '10.1016/j.mechmat.2022.104504',
  'f-rd': '',
  neovius: '10.1016/j.eml.2020.100688',
  lidinoid: '',
  splitp: '',
  custom: '',
  // f-rd / lidinoid / splitp：原始数学文献（Schoen 1970 NASA TR、Lidin & Larsson 1990）无 DOI，
  // 亦未检索到可靠的现代专文 DOI，宁缺毋滥保持空——生成 BibTeX 时省略 doi 行
};

function mapType(type: string): string {
  if (type === 'iwp') return 'i-wp';
  if (type === 'frd') return 'f-rd';
  return type;
}

/**
 * BibTeX 自由文本转义：LaTeX 编译 .bbl 时 % 起注释作用（静默吞掉其后内容），
 * & 报 Misplaced alignment tab，_ # 同样需转义。URL 统一用 \url{...} 包裹（需 \usepackage{url}）。
 */
function escapeBibText(s: string): string {
  return s.replace(/%/g, '\\%').replace(/&/g, '\\&').replace(/_/g, '\\_').replace(/#/g, '\\#');
}

/**
 * 生成 BibTeX 引用文本（供论文 supplementary 使用）
 * meshHash：基于网格数据的确定性哈希，保证同参数多次导出得到一致 cite key（科研可复现）
 */
export function generateBibTeX(state: AppState, metrics: PhysicsMetrics | null, meshHash: string): string {
  const now = new Date().toISOString();
  // 用确定性 meshHash 截断作为 cite key，保证可复现（与 generateJSONSidecar 对齐）
  const hash = meshHash.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) || 'unnamed';
  const doi = DOI_MAP[mapType(state.type)] || '';
  const doiLine = doi ? `  doi = {https://doi.org/${doi}},\n` : '';
  const url = window.location.href;

  const title = escapeBibText(
    `TPMS ${state.type} Scaffold: Porosity ${state.porosity}% | Cell Size ${state.cellSize} mm`
  );

  // 指标段仅在 metrics 可用时输出，避免 "Sv=undefined" 进入引用
  let metricsLine = '';
  if (metrics) {
    metricsLine =
      ` Sv=${metrics.svRatio.toFixed(3)} mm$^{-1}$, E*/Es=${metrics.gibsonAshbyE.toFixed(4)}, ` +
      `C1=${metrics.C1.toFixed(2)}, K=${(metrics.permeability * 1e6).toFixed(2)} um$^2$. ` +
      `Mean pore: ${metrics.poreStats.meanDiameter.toFixed(3)} mm.`;
  }

  return `@misc{tpms_explorer_${hash},
  title = {${title}},
  author = {TPMS Explorer Platform},
  year = {${new Date().getFullYear()}},
${doiLine}  keywords = {TPMS, ${state.type}, scaffold, porosity, additive manufacturing, bone tissue engineering},
  note = {Generated on ${now}. Structure: ${escapeBibText(state.structureMode)}, Container: ${escapeBibText(state.containerShape)}.${metricsLine} Reproducible via: \\url{${url}}},
  url = {\\url{${url}}}
}`;
}

/**
 * 生成 JSON sidecar（含 mesh hash 校验值）
 * @param build 构建上下文（分辨率与二分 iso）——第三方按参数重建网格时对齐壁厚/顶点密度所需
 */
export function generateJSONSidecar(
  state: AppState,
  metrics: PhysicsMetrics | null,
  meshHash: string,
  build?: { resolution: number; isoUsed: number | null }
): string {
  return JSON.stringify({
    version: '2.1',
    generatedAt: new Date().toISOString(),
    parameters: {
      type: state.type,
      porosity: state.porosity,
      cellSize: state.cellSize,
      thickness: state.thickness,
      weights: state.weights,
      structureMode: state.structureMode,
      containerShape: state.containerShape,
      material: state.material,
      gradientDir: state.gradientDir,
      hybrid: state.hybrid,
      customFormula: state.customFormula,
    },
    build: {
      resolution: build?.resolution ?? null,
      isoUsed: build?.isoUsed ?? null,
    },
    metrics: metrics ? {
      surfaceArea: metrics.surfaceArea,
      envelopeVolume: metrics.envelopeVolume,
      svRatio: metrics.svRatio,
      gibsonAshbyE: metrics.gibsonAshbyE,
      youngsModulusGPa: metrics.youngsModulusGPa,
      yieldStrengthMPa: metrics.yieldStrengthMPa,
      gibsonAshbySigma: metrics.gibsonAshbySigma,
      C1: metrics.C1,
      permeability_mm2: metrics.permeability,
      permeability_um2: metrics.permeability * 1e6,
      poreMeanDiameter_mm: metrics.poreStats.meanDiameter,
      poreMinDiameter_mm: metrics.poreStats.minDiameter,
      poreMaxDiameter_mm: metrics.poreStats.maxDiameter,
      tortuosity: metrics.poreStats.tortuosity,
    } : null,
    meshHash,
    reproducibility: {
      platform: 'TPMS Explorer v2.0',
      url: window.location.href,
    },
  }, null, 2);
}
