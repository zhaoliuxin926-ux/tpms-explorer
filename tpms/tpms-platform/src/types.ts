/**
 * TPMS Platform — Shared Type Definitions
 * 所有模块共享的核心类型声明，确保主线程与 Worker 之间的契约一致。
 */

/** 支持的 TPMS 曲面类型 */
export type TpmType = 'gyroid' | 'diamond' | 'schwarz' | 'neovius' | 'iwp' | 'frd' | 'lidinoid' | 'splitp' | 'custom';

/** 渲染模式 */
export type RenderModel = 'surface' | 'strut' | 'solid';

/** 结构拓扑 */
export type StructureMode = 'solid_network' | 'shell' | 'gradient_shell';

/** 容器形状 */
export type ContainerShape = 'cube' | 'cylinder';

/** 材质预设 */
export type MaterialPreset = 'auto' | 'tc4' | 'polymer' | 'thermal';

/** 梯度方向 */
export type GradientDirection = 'z' | 'radial' | 'spherical';

/** 顶点着色模式：单色实体 / 场标量（混合权重或壁厚梯度）/ 高度分布 / 平均与高斯曲率 */
export type ColoringMode = 'none' | 'field' | 'elevation' | 'mean_curvature' | 'gauss_curvature';

/** 端板厚度上限 UI 档位与防重叠钳制系数（两端板间隙 ≥ 0.2·L） */
export const ENDPLATE_MAX_UI_MM = 3.0;
export const ENDPLATE_CLAMP_FRAC = 0.4;

/** 应用完整状态 */
export interface AppState {
  type: TpmType;
  model: RenderModel;
  structureMode: StructureMode;
  containerShape: ContainerShape;
  porosity: number;
  cellSize: number;
  thickness: number;
  slice: number;
  material: MaterialPreset;
  weights: [number, number, number, number];
  autoRotate: boolean;
  gradientDir: GradientDirection;
  coloring: ColoringMode;
  /** 实心加载端板厚度（mm，单侧）；0 = 关闭 */
  endplateMm: number;
  hybrid: {
    enabled: boolean;
    typeB: TpmType;
    blendFunction: 'sigmoid' | 'linear';
    blendCenter: number;
    blendWidth: number;
  };
  customFormula: string;
}

/** 默认状态（与原系统完全兼容） */
export const DEFAULT_STATE: AppState = {
  type: 'gyroid',
  model: 'surface',
  structureMode: 'solid_network',
  containerShape: 'cube',
  porosity: 75,
  cellSize: 3,
  thickness: 1.0,
  slice: 100,
  material: 'auto',
  weights: [1, 1, 1, 1],
  autoRotate: true,
  gradientDir: 'z',
  coloring: 'none',
  endplateMm: 0,
  hybrid: {
    enabled: false,
    typeB: 'diamond',
    blendFunction: 'sigmoid',
    blendCenter: 0,
    blendWidth: 1.0,
  },
  customFormula: '',
};

/** Worker 计算请求消息 */
export interface WorkerRequest {
  id: number;
  type: 'build';
  params: BuildParams;
}

/** Worker 计算结果消息 */
export interface WorkerResponse {
  id: number;
  type: 'result' | 'error' | 'cancelled';
  positions?: Float32Array;
  normals?: Float32Array;
  indices?: Uint32Array;
  /** 顶点颜色（Cool-Warm LUT），coloring !== 'none' 时 Worker 侧生成并零拷贝传输 */
  colors?: Float32Array;
  vertCount: number;
  triCount: number;
  porosityEstimate: number;
  isoUsed: number;
  resolution: number;
  surfaceArea?: number;
  envelopeVolume?: number;
  svRatio?: number;
  /** 网格实测固相体积分数（发散定理），与 porosityEstimate（公式格子 MC）独立 */
  meshSolidFraction?: number;
  /** 非流形边数（鞍点掐捏残留），供采样定理警示 */
  nmEdgeCount?: number;
  buildTimeMs: number;
  error?: string;
}

/** buildSurface 参数 */
export interface BuildParams {
  type: TpmType;
  iso: number;
  periods: number;
  resolution: number;
  targetPorosity: number;
  weights: [number, number, number, number];
  structureMode: StructureMode;
  containerShape: ContainerShape;
  thickness: number;
  gradientDir: GradientDirection;
  hybrid: AppState['hybrid'];
  customFormula: string;
  preview: boolean;
  /** 主线程按 UI 合法性校验后下发的着色模式；缺省或 'none' 时 Worker 不产颜色 */
  coloring?: ColoringMode;
  /** 实心加载端板厚度 mm（0 关闭；生效值会被 0.4·cellSize 钳制防两板相接） */
  endplateMm?: number;
}

/** 导出格式（svg 由截面测量模块的独立按钮触发，不经过统一 handleExport） */
export type ExportFormat = 'stl' | 'vtk' | 'vti' | 'py' | 'm' | 'svg' | 'json' | 'bibtex' | 'cfdstl';

/** Gibson-Ashby 经验参数（按曲面类型） */
export interface GibsonAshbyParams {
  C: number;
  m: number;
  source: string;
}

/** 物理力学指标 */
export interface PhysicsMetrics {
  surfaceArea: number;       // mm²
  envelopeVolume: number;    // mm³
  svRatio: number;           // mm⁻¹
  relativeDensity: number;   // 1 - porosity
  youngsModulusGPa: number;  // GPa (假设基体材料)
  yieldStrengthMPa: number;  // MPa
  gibsonAshbyE: number;      // E*/Es
  gibsonAshbySigma: number;  // σ*/σs
  C1: number;                // 拓扑特定 Gibson-Ashby 常数
  anisotropy: number;        // E_max/E_min 比值，>1 表示各向异性
  permeability: number;      // mm²
  poreStats: {
    meanDiameter: number;
    minDiameter: number;
    maxDiameter: number;
    tortuosity: number;
  };
  gradientRange?: {
    minE: number;
    maxE: number;
    avgE: number;
  };
}

/** 测量点 */
export interface MeasurePoint {
  position: { x: number; y: number; z: number };
  label?: string;
}

/** 测量结果 */
export interface MeasureResult {
  distance: number;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  midpoint: { x: number; y: number; z: number };
}

/** 颜色映射 */
export const TYPE_COLORS: Record<TpmType, string> = {
  gyroid: '#f59e0b',
  diamond: '#0ea5e9',
  schwarz: '#8b5cf6',
  neovius: '#ec4899',
  iwp: '#22c55e',
  frd: '#ef4444',
  lidinoid: '#84cc16',
  splitp: '#f43f5e',
  custom: '#6b7280',
};

/** 预设场景 */
export interface PresetScene {
  key: string;
  label: string;
  description: string;
  state: Partial<AppState>;
}

export const PRESET_SCENES: PresetScene[] = [
  {
    key: 'bone',
    label: '仿生骨支架',
    description: '骨支架：高孔隙率（70%）+ 梯度双壳结构，底部致密承重、顶部疏松促骨长入。材质：TC4 钛合金。',
    state: { type: 'gyroid', model: 'surface', structureMode: 'gradient_shell', containerShape: 'cylinder', porosity: 70, cellSize: 3, thickness: 1.3, material: 'tc4' },
  },
  {
    key: 'lightweight',
    label: '轻量化零件',
    description: '轻量化：Gyroid 实体网络 + 高孔隙率（90%）+ 大单元（4×），低密度高比刚度。材质：PLLA 聚合物。',
    state: { type: 'gyroid', model: 'strut', structureMode: 'solid_network', containerShape: 'cube', porosity: 90, cellSize: 4, thickness: 1.3, material: 'polymer' },
  },
  {
    key: 'heat',
    label: '散热结构',
    description: '散热：Schwarz P 壳结构 + 中等孔隙率（74%）+ 小单元（2×），高比表面积增强对流。材质：高导热复合材料。',
    state: { type: 'schwarz', model: 'surface', structureMode: 'shell', containerShape: 'cube', porosity: 74, cellSize: 2, thickness: 1.0, material: 'thermal' },
  },
  {
    key: 'catalyst',
    label: '催化载体',
    description: '催化：I-WP 平衡曲面 + 高孔隙率（80%）+ 实体网络，孔隙分布均匀、渗透性佳，最大化反应接触面积。材质：PLLA 高分子（可牺牲模板）。',
    state: { type: 'iwp', model: 'surface', structureMode: 'solid_network', containerShape: 'cube', porosity: 80, cellSize: 3, thickness: 1.1, material: 'polymer' },
  },
  {
    key: 'acoustic',
    label: '声学超材料',
    description: '声学：Gyroid 等厚双壳 + 中等孔隙率（72%），周期性通道形成带隙，用于吸声与声学隐身。材质：PLLA 聚合物。',
    state: { type: 'gyroid', model: 'surface', structureMode: 'shell', containerShape: 'cube', porosity: 72, cellSize: 3, thickness: 1.0, material: 'polymer' },
  },
  {
    key: 'electrode',
    label: '电池电极',
    description: '电极：Neovius 伴随曲面 + 高孔隙率（78%）+ 实体网络，通道宽、节点强，提升离子迁移与活性物质负载。材质：TC4 钛合金（导电骨架）。',
    state: { type: 'neovius', model: 'surface', structureMode: 'solid_network', containerShape: 'cube', porosity: 78, cellSize: 3, thickness: 1.2, material: 'tc4' },
  },
];
