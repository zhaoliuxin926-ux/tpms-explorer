# TPMS Explorer 项目全貌总结（v6.0.0-digital-twin-hpc）

> 生成：2026-08-29 ｜ 对应提交 `5e9575f` ｜ 31/31 CI 门禁全绿 · 1000+ 断言
> 本文是全仓库文件内容的归纳整理：结构、模块、门禁、文档、版本史与已知边界。

---

## 一、项目定位

交互式**三重周期极小曲面（TPMS）**参数探索与多物理场数字孪生平台。8 类经典曲面
（Gyroid / Diamond / Schwarz P / Neovius / I-WP / F-RD / Lidinoid / Split-P）实时重建，
覆盖「设计 → 仿真 → 打印 → 验证」全链路。个人独立开源项目，面向初学者与科研复现。

## 二、仓库顶层结构

```
（仓库根 = GitHub Pages 源）
├── README.md                  ← 项目总览 + 特性矩阵（31 门徽章）
├── docs/                      ← 主交付（Pages）
│   ├── index.html             ← 落地页（特性卡片 + 应用场景 + 展示图）
│   ├── app.html               ← 单文件版应用（双击即开，无构建）
│   ├── platform/              ← 工程版构建产物（Vite dist 同步，CI 服务目录）
│   ├── WORKFLOW_GUIDE.md      ← 实战指南（30 章，767 行）
│   ├── RELEASE_NOTES_v2.4~v6.0.md ×5  ← 双语版本发布说明
│   ├── paper/MANUSCRIPT.md    ← SoftwareX/JOSS 论文手稿
│   ├── shots/ + vendor/       ← 展示截图 / Three.js 本地包
├── tpms/                      ← 工程工作区
│   ├── tpms-platform/         ← 平台源码（TS + Vite + Three.js，零运行时依赖）
│   │   └── src/{core,geometry,physics,export,measure,worker}/ + main.ts + index.html
│   ├── .verify/               ← 31 道 CI 门禁 + UI 回归套件 + 实验件
│   ├── agent_memory/          ← context / progress / bugs 三件套（AI 协作记忆）
│   ├── docs/platform/         ← 工程部署镜像（CI 服务目录）
│   ├── prototypes/            ← MATLAB 原型
│   └── gen_gpu_wrapper.py     ← WGSL↔TS 模板同步生成器
└── .github/workflows/         ← CI
```

## 三、源码架构（src/ ≈ 16,800 行）

### 入口与状态
| 文件 | 行数 | 职责 |
|---|---|---|
| main.ts | 2762 | 全部 UI 接线、重建调度（三级 LOD）、颜色管线、导出/仿真面板、💬 AI 助手 |
| state.ts / types.ts / url-params.ts | 123/335/145 | 状态机 + URL 全量分享恢复 + Undo/Redo |
| three-setup.ts | 381 | Three.js 场景/相机/后处理 |
| ui-helpers.ts | 648 | 公式栏/术语/侧栏渲染 |

### core/ —— 数学与语义层
| 文件 | 职责 |
|---|---|
| tpms-functions.ts | 8 类 TPMS 隐函数（弧度域，权重版）——唯一几何真源 |
| equation-parser.ts | 875 行：零依赖 AST 沙箱（无 eval）+ Dual Number AD 梯度/Hessian + NumPy/MATLAB 代码生成 |
| hybrid-functions.ts | 双曲面 Sigmoid/线性融合场 |
| gradient-functions.ts / hierarchical-functions.ts / stress-driven-field.ts | Z 向梯度 / 分形分级 / von Mises 应力引导致密化 |
| manifold-mapping.ts | 圆柱/环面/双曲/度规非欧映射（det J>0） |
| nl-agent.ts | 🆕v6.0 自然语言 CAD 代理（中英双语意图解析 + 钳制 + 结构化日志） |
| units.ts | cellSize↔mm 比例尺单一来源 |

### geometry/ —— 重建与场
| 文件 | 职责 |
|---|---|
| surface-nets.ts | 1284 行：构造性水密网格（边穿越键提取 + Taubin + 解析 Newton 投影 + 孔隙率二分） |
| webgpu-evaluator.ts + shaders/tpms-eval.wgsl | GPU 场求值（指令 IR 双后端），CPU 无感回退 |
| periodic-surface.ts | 周期单胞提取 + PBC 配对（3×3×3 拼接水密） |
| ct-reconstruction.ts / dicom-tiff-parser.ts | Micro-CT DICOM/TIFF 导入 + Otsu + 精确 3D EDT 偏差热力图 |
| curvature.ts / vertex-coloring.ts | 曲率标量 + Cool-Warm 顶点色 |

### physics/ —— 多物理场求解器（v6.0 五件套加粗）
| 文件 | 职责 |
|---|---|
| **gpu-plasticity-solver.ts** (918) | 🆕 全拉格朗日 StVK+J2 径向返回体素 FEM（TL 几何项 + 修正牛顿 + Jacobi-PCG + 子步回滚 + 静水 KUBC 模式 + 坍塌截断） |
| **gpu-plasticity-webgpu.ts + shaders/plasticity.wgsl** | 🆕 WebGPU 并行本构内核（张量空间径向返回，与 TS 逐字同步锚定） |
| **digital-twin-compression.ts** | 🆕 数字孪生压溃：最大主应变失效 + 渐进单元生死 + 坍塌应变检测 + Gibson-Ashby 对比 |
| **navier-stokes-solver.ts** (+ shaders/navier-stokes.wat 实验件) | 🆕 融合显式松弛 Stokes + Uzawa 修正（channel/periodic 两模式，Brinkman 无滑移） |
| **lpbf-thermo-mechanical.ts** | 🆕 LPBF 高斯体热源瞬态热传导（Jacobi 守恒 + 沸点封顶）+ 残余应力/翘曲/工艺窗口 |
| micro-fea-solver.ts | 波动场均质化（KUBC 6 工况 J-PCG） |
| lbm-permeability.ts | FD-Darcy SOR 渗透率（单管 κ=1/R² 解析精确） |
| homogenization.ts / inverse-design.ts / impact-energy.ts / ml-surrogate.ts | Voigt-Reuss 界+方向模量 / Nelder-Mead+LM 逆向 / SEA+模态 / MLP+Pareto |
| gibson-ashby.ts / tortuosity.ts / percolation-analysis.ts / pore-analysis.ts / permeability.ts / surface-area.ts | 经典经验模型族（C1 各向异性 / 26 连通 Dijkstra 迂曲 / 渗流阈值 / 孔径 / Kozeny-Carman / 面积） |
| bone-morphometry.ts | BV/TV、Tb.Th/Sp/N、SMI 骨计量 |

### export/ —— 工业格式族
STL（二进制/多实体）· GLB（顶点色）· 3MF（mm 原生+端板元数据）· VTK/VTI ·
Abaqus INP（PBC 节点集+载荷步）· OpenFOAM polyMesh 五件套（CFD 四区块）·
G-code 切片（Marlin/Klipper/Bambu）· 验证套件 ZIP（Abaqus/simpleFoam 自动跑批脚本）·
Python/MATLAB 重建脚本（与平台逐点对齐）· BibTeX/JSON sidecar。

### measure/ + worker/
游标卡尺 · 三维边界条件拾取器（法向角区域生长→INP/FOAM 注入）· SVG 剖面 ·
包围盒标注；Web Worker 承载重建（Transferable 零拷贝）。

## 四、门禁体系（.verify/，31 门 · 1000+ 断言）

入口：`cd tpms/tpms-platform && npm run test:all`（run_ci_suite.mjs 顺序调度 + 端口清扫）。

| # | 门禁 | 断言 | # | 门禁 | 断言 |
|---|---|---|---|---|---|
| 1 | mesh_audit 几何质量 | 29 案例 | 17 | inverse_design 逆向设计 | 23 |
| 2 | parity_math 数学同源（py/matlab/平台） | 184 | 18 | poincare_metric 庞加莱映射 | 12 |
| 3 | sim_export_check CFD 分块+曲率 | 13 | 19 | cae_verification CAE 验证链 | 25 |
| 4 | endplate_audit 端板专项 | 26 | 20 | impact_modal 冲击吸能+模态 | 11 |
| 5 | micro_physics 迂曲度+刚度 | 17 | 21 | ct_reconstruction CT 重构 | 11 |
| 6 | hybrid_audit 多相混合 | 5 | 22 | native_cae_solver Micro-FEA/FD-Darcy | 17 |
| 7 | industrial_export GLB+3MF | 12 | 23 | boundary_picker 边界拾取 | 14 |
| 8 | custom_equation 公式沙箱 | 73 | 24 | bone_morphometry DICOM 骨计量 | 18 |
| 9 | homogenization RVE 均质化 | 13 | 25 | gcode_slicer G-code 切片 | 13 |
| 10 | manifold_audit 非欧映射 | 12 | 26 | ml_pareto ML 代理 Pareto | 5 |
| 11 | redteam_matrix 极端工况 | 100 | 27 | **gpu_plasticity 弹塑性大变形** 🆕 | **42** |
| 12 | webgpu_parity GPU 同源 | 34 | 28 | **digital_twin_compression 压溃孪生** 🆕 | **21** |
| 13 | periodic_rve 周期 RVE/PBC | 88 | 29 | **wasm_navier_stokes 微流体** 🆕 | **15** |
| 14 | cae_mesh Abaqus/FOAM 体网格 | 46 | 30 | **lpbf_thermo_mechanical LPBF** 🆕 | **18** |
| 15 | hierarchical 分形分级 | 18 | 31 | **nl_agent 自然语言代理** 🆕 | **25** |
| 16 | inverse…（见 17） | — | + | run_all UI 回归（6 套件 Playwright） | 108 |

另有 redteam/ 子目录（verify_fixes/followups/tip_toggle）与实验件（gen_ns_wasm.mjs、
shaders/navier-stokes.wat——wabt.js/V8 编码分歧降级披露）。

## 五、文档体系

- **README.md**：定位 + 快速开始 + 特性矩阵（v6.0 徽章 31 门 1000+）
- **WORKFLOW_GUIDE.md**：30 章实战指南——几何/着色/混合/映射（早期）→ 分形/逆向/CT/冲击（v3-v4）→ FEA/BC 拾取/DICOM/G-code/ML（v5）→ 弹塑性/压溃孪生/微流体/LPBF/NL 代理（v6 §26-30）
- **RELEASE_NOTES_v2.4~v6.0**：五份双语发布说明
- **paper/MANUSCRIPT.md**：期刊手稿
- **agent_memory/**：context（项目级上下文）/ progress（逐阶段进度）/ bugs（11 条 v6.0 定案教训）/ archive

## 六、版本史

| 版本 | 主题 | 门禁 |
|---|---|---|
| v1-v2.4 | 8 曲面沙盘 + 水密网格 v2 + 端板 + 3MF | 3 门起步 |
| v3.0 | WebGPU 管线 + 应力迹线 + 分形分级 + 体网格直通 + GPU 同源门 | 13 |
| v4.0 | 逆向设计 + CT 偏差 + SEA/模态 + 庞加莱 + 验证链 | 21 |
| v5.0 | Micro-FEA/FD-Darcy + BC 拾取 + DICOM 骨计量 + G-code + ML Pareto + 论文 | 26 |
| **v6.0** | **弹塑性大变形 + 压溃孪生 + 微流体 + LPBF + NL 代理** | **31** |

## 七、诚实边界（全部披露于 §26-30 与源码注释）

1. WASM 加速档降级 TS 热循环（wabt.js/V8 编码分歧，实验件保留）；
2. DT/GA 平台应力标定比 ≈1.7（体素 FEM 偏刚），守稳定带而非裸 ±10%；
3. J2 取 PK2 空间（中等应变近似）；一致切线/几何切线已实现默认关闭（SPD 优先）；
4. LPBF 热-力解耦（固有应力法），熔池对流/辐射未建模（沸点封顶代理）；
5. NS 为低雷诺数 Stokes 占优口径 + 中心差分（collocated）；FE 均质化剪切波动场仍未解（研究阻塞）。

## 八、常用命令

```bash
cd tpms/tpms-platform
npm run dev          # 开发
npm run build        # 构建（dist → docs/platform 同步）
npm run test:all     # 31 门 CI（约 12-15 分钟）
```
