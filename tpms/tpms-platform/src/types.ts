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
export type ColoringMode = 'none' | 'field' | 'elevation' | 'mean_curvature' | 'gauss_curvature' | 'stress_vm';

/** 混合波前轴向：x/y/z 轴向平面波前，radial 球面波前 */
export type BlendAxis = 'x' | 'y' | 'z' | 'radial';

/** 端板厚度上限 UI 档位与防重叠钳制系数（两端板间隙 ≥ 0.2·L） */
export const ENDPLATE_MAX_UI_MM = 3.0;
export const ENDPLATE_CLAMP_FRAC = 0.4;

/** 动态剖切轴向 */
export type SliceAxis = 'x' | 'y' | 'z';

/** 【阶段 IV】非欧度规空间映射类型（作用于生成网格的顶点级连续 warp） */
export type ManifoldKind = 'identity' | 'cylinder' | 'torus' | 'hyperbolic' | 'metric' | 'poincare';

export interface ManifoldConfig {
  kind: ManifoldKind;
  /** 弯曲半径（mm；cylinder 需 > 域半宽、torus 需满足双半径约束） */
  radius: number;
  /** metric 沿轴缩放 */
  scale: number;
  /** metric 轴 */
  axis: 'x' | 'y' | 'z';
}

/** 【v3.0 阶段 V】多级分形分级 TPMS 配置（F = F_macro + λ·F_micro(N·x)） */
export interface HierarchicalConfig {
  enabled: boolean;
  /** 微曲面类型（宏观 = 当前 type） */
  microType: TpmType;
  /** 微观频率倍率 N（≥3） */
  frequency: number;
  /** 微观调制幅值 λ（0.1~0.5） */
  amplitude: number;
}

/** 【v7.0 Stage I】隐式神经场（SIREN/INR）配置：8 维潜在码驱动拓扑流形插值 */
export interface NeuralConfig {
  enabled: boolean;
  /** 潜在码 z ∈ R^8（锚点幅值 ±3；clamp 于 sanitizeLatent） */
  z: number[];
}

/** 【v3.0 阶段 IV】应力场引导工况（解析应力张量预设） */
export type StressPreset = 'none' | 'bending' | 'cantilever' | 'torsion';

export interface StressConfig {
  preset: StressPreset;
  /** 孔隙板收窄幅值 β（shell 模式：t = tEff·(1 − β·vm)，高应力侧固相致密化） */
  strength: number;
  /** 各向异性拉伸比 α（晶胞沿最大主应力方向伸长比） */
  anisotropy: number;
}

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
  /** 动态剖切轴向（渲染层裁切，不进入几何缓存键） */
  sliceAxis: SliceAxis;
  /** 剖切反向（保留法线负侧） */
  sliceInvert: boolean;
  hybrid: {
    enabled: boolean;
    typeB: TpmType;
    blendFunction: 'sigmoid' | 'linear';
    blendCenter: number;
    blendWidth: number;
    axis: BlendAxis;
  };
  /** 【阶段 IV】非欧度规空间映射（identity = 关闭） */
  manifold: ManifoldConfig;
  /** 【v3.0 阶段 I】WebGPU 场计算加速（自动探测不可用时无感回退 CPU Worker） */
  gpuAccelerate: boolean;
  /** 【v3.0 阶段 IV】应力场引导（preset none = 关闭） */
  stress: StressConfig;
  /** 【v3.0 阶段 V】多级分形分级 TPMS（enabled = 关闭） */
  hierarchical: HierarchicalConfig;
  /** 【v7.0 Stage I】隐式神经拓扑（SIREN，enabled = 关闭） */
  neural: NeuralConfig;
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
  sliceAxis: 'z',
  sliceInvert: false,
  hybrid: {
    enabled: false,
    typeB: 'diamond',
    blendFunction: 'sigmoid',
    blendCenter: 0,
    blendWidth: 1.0,
    axis: 'x',
  },
  manifold: { kind: 'identity', radius: 15, scale: 1.4, axis: 'z' },
  gpuAccelerate: true,
  stress: { preset: 'none', strength: 0.5, anisotropy: 1.6 },
  hierarchical: { enabled: false, microType: 'diamond', frequency: 4, amplitude: 0.25 },
  neural: { enabled: false, z: [3, 3, 3, 3, 3, 3, 3, 3] },
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
  /**
   * 【v3.0 阶段 II】PBC 节点配对表（periodicRve 模式专属）：
   * 三对面配对（索引对）+ 12 条棱等价类 + 8 个顶角等价类，
   * 供有限元周期性边界条件（PBC）方程施加直接引用。
   */
  pbcPairs?: {
    pairsX: [number, number][];
    pairsY: [number, number][];
    pairsZ: [number, number][];
    edgeClasses: number[][];
    cornerClasses: number[][];
  };
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
  /**
   * 【v3.0 阶段 I】WebGPU 预计算的 V 场（N³ = (R+1)³，弧度域，与 CPU 第 2 步同语义）。
   * 由主线程 evaluateFieldGPU 产出后随请求传入；Worker 跳过三角函数热循环直接进入
   * 模式公式/二分。长度校验失败抛错（不静默截肢）。CPU 回退路径不携带此字段。
   */
  gpuVField?: Float32Array;
  /**
   * 【v3.0 阶段 II】周期性 RVE 模式（PBC-Ready）：wrapped 场索引 + 跨平面裁剪 +
   * 缝合边精确配对（v_right − v_left = (L,0,0)），输出可三维无缝平铺的单胞网格。
   * 约束：cube 容器 / solid_network 或 shell / 无端板 / 无 Hybrid / 无梯度；
   * 违反时 buildSurface 抛错（导出层先行校验并 toast 引导）。
   */
  periodicRve?: boolean;
  /** 【v3.0 阶段 IV】应力场引导调制（主轴各向异性 + 壁厚 vm 自适应） */
  stress?: StressConfig;
  /** 【v3.0 阶段 V】多级分形分级调制（F = F_macro + λ·F_micro(N·x)） */
  hierarchical?: HierarchicalConfig;
  /** 【v7.0 Stage I】隐式神经场调制（SIREN 专家混合，enabled 时覆盖代数场） */
  neural?: NeuralConfig;
}

/** 导出格式（svg 由截面测量模块的独立按钮触发，不经过统一 handleExport） */
export type ExportFormat = 'stl' | 'vtk' | 'vti' | 'py' | 'm' | 'svg' | 'json' | 'bibtex' | 'cfdstl' | 'glb' | '3mf';

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
