import type { AppState, PhysicsMetrics } from '../types';

const DOI_MAP: Record<string, string> = {
  gyroid: '10.1016/j.ijsolstr.2017.02.015',
  diamond: '10.1016/j.actbio.2018.04.011',
  schwarz: '10.1016/j.addma.2017.03.019',
  'i-wp': '',
  'f-rd': '',
  neovius: '',
  lidinoid: '',
  splitp: '',
  custom: '',
};

function mapType(type: string): string {
  if (type === 'iwp') return 'i-wp';
  if (type === 'frd') return 'f-rd';
  return type;
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

  return `@misc{tpms_explorer_${hash},
  title = {TPMS ${state.type} Scaffold: Porosity ${state.porosity}% | Cell Size ${state.cellSize} mm},
  author = {TPMS Explorer Platform},
  year = {${new Date().getFullYear()}},
  doi = {${doi ? 'https://doi.org/' + doi : ''}},
  keywords = {TPMS, ${state.type}, scaffold, porosity, additive manufacturing, bone tissue engineering},
  note = {Generated on ${now}. Structure: ${state.structureMode}, Container: ${state.containerShape}. Sv=${metrics?.svRatio.toFixed(3)} mm$^{-1}$, E*/Es=${metrics?.gibsonAshbyE.toFixed(4)}, C1=${metrics?.C1.toFixed(2)}, K=${metrics?.permeability ? (metrics.permeability * 1e6).toFixed(2) + ' um$^2$' : 'N/A'}. Mean pore: ${metrics?.poreStats.meanDiameter.toFixed(3)} mm. Reproducible via: ${window.location.href}},
  url = {${window.location.href}}
}`;
}

/**
 * 生成 JSON sidecar（含 mesh hash 校验值）
 */
export function generateJSONSidecar(
  state: AppState,
  metrics: PhysicsMetrics | null,
  meshHash: string
): string {
  return JSON.stringify({
    version: '2.0',
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
