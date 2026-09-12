# TPMS Explorer 项目全貌总结（v8.0.0-agentic-loop）

> 生成：2026-08-29 ｜ 最近刷新：2026-09-13（对齐 v8.0-agentic-loop + M3→M4 桥接 + stress×hybrid 组合定案）｜ **43 道 CI 门禁三平台全绿 · 1000+ 断言** ｜ 曲面族 **20** ｜ Agent 路线 **M0-M5 全线打通**
> 本文是全仓库文件内容的归纳整理：结构、模块、门禁、文档、版本史与已知边界。逐版本明细见 RELEASE_NOTES_v2.4~v8.0.md（×7）。

---

## 一、项目定位

交互式**三重周期极小曲面（TPMS）**参数探索与多物理场数字孪生平台。教学版 8 类经典曲面
（Gyroid / Diamond / Schwarz P / Neovius / I-WP / F-RD / Lidinoid / Split-P）实时重建；
工程版扩至 **20 族**（+Octo / Karcher / Fischer-Koch S·Y·C(S)·C(Y) / G′ / D′ / Double P·D·G / Complementary D，
公式逐字转录自 MiniSurf 官方源码并四方同源）。覆盖「设计 → 仿真 → 打印 → 验证 → Agentic 闭环」全链路。
个人独立开源项目，面向初学者与科研复现。MIT，零后端零遥测，运行时唯一依赖 Three.js。

## 二、仓库顶层结构

```
（仓库根 = GitHub Pages 源）
├── README.md / README_EN.md   ← 项目总览 + 特性矩阵 + 文件导航（双语）
├── BENCHMARKS.md              ← 公开几何基准（20 族可产性/水密/孔隙率偏差，一条命令复跑）
├── docs/                      ← 主交付（Pages）
│   ├── index.html             ← 落地页（特性卡片 + 应用场景 + 展示图）
│   ├── app.html               ← 单文件教学版（双击即开，8 经典族，无构建）
│   ├── platform/              ← 工程版构建产物（Vite dist 同步，Pages 部署目标）
│   ├── WORKFLOW_GUIDE.md      ← 实战指南（35 章）
│   ├── RELEASE_NOTES_v2.4~v8.0.md ×7 ← 双语版本发布说明
│   ├── paper/                 ← SoftwareX 投稿包（main.tex + PDF + 导览 + Cover Letter + 清单）
│   ├── PROJECT_SUMMARY.md     ← 本文件
│   └── shots/ + vendor/       ← 展示截图 / Three.js 本地包
├── tpms/                      ← 工程工作区
│   ├── tpms-platform/         ← 平台源码（TS + Vite + Three.js，零运行时依赖）
│   │   └── src/{core,geometry,physics,export,measure,worker}/ + main.ts + index.html
│   ├── .verify/               ← 37 道行为审计门 + run_ci_suite 调度器 + run_all UI 回归
│   ├── agent/                 ← Agent CLI（六命令 + NL 工具调用 + 闭环驱动器 + 三 Provider + 五件自检）
│   ├── agent_memory/          ← context / progress / bugs 三件套（AI 协作记忆，gitignored）
│   └── prototypes/            ← MATLAB 原型（归档）
└── .github/workflows/         ← CI（三平台矩阵）
```

## 三、源码架构（src/ ≈ 16,800+ 行）

### 入口与状态
| 文件 | 职责 |
|---|---|
| main.ts | 全部 UI 接线、重建调度（三级 LOD）、颜色管线、导出/仿真面板、💬 AI 助手 |
| state.ts / types.ts / url-params.ts | 状态机 + URL 全量分享恢复 + Undo/Redo |
| three-setup.ts | Three.js 场景/相机/后处理 |
| ui-helpers.ts | 公式栏/术语/侧栏渲染 |

### core/ —— 数学与语义层
| 文件 | 职责 |
|---|---|
| tpms-functions.ts | **20 族** TPMS 隐函数（弧度域，权重版）——唯一几何真源 |
| equation-parser.ts | 零依赖 AST 沙箱（无 eval）+ Dual Number AD 梯度/Hessian + NumPy/MATLAB 代码生成 |
| hybrid-functions.ts | 双曲面 Sigmoid/线性融合场（波前物理域 + 度规坐标双域） |
| gradient-functions.ts / hierarchical-functions.ts / stress-driven-field.ts | Z 向梯度 / 分形分级 / von Mises 应力引导（各向异性 warp + 壳致密化） |
| manifold-mapping.ts | 圆柱/环面/双曲/度规非欧映射（det J>0） |
| neural-implicit-field.ts + weights.ts | 🆕v7.0 SIREN 隐式场（精确 2π 周期 + 5 专家蒸馏 + 8 维 Walsh 锚点潜在空间） |
| levelset-optimizer.ts | 🆕v7.0 水平集拓扑优化（H-J Godunov + 双目标敏感度 + exact EDT 再初始化） |
| nl-agent.ts | 自然语言 CAD 代理（中英双语意图解析 + 钳制 + 结构化日志） |
| units.ts | cellSize↔mm 比例尺单一来源 |

### geometry/ —— 重建与场
| 文件 | 职责 |
|---|---|
| surface-nets.ts | 构造性水密网格（边穿越键提取 + Taubin + 解析 Newton 投影 + 孔隙率二分；**hybridFn 创建点应力包装 2026-09-12**） |
| webgpu-evaluator.ts + shaders/ | GPU 场求值（指令 IR 双后端），CPU 无感回退（应力开启强制 CPU） |
| periodic-surface.ts | 周期单胞提取 + PBC 配对（3×3×3 拼接水密） |
| ct-reconstruction.ts / dicom-tiff-parser.ts | Micro-CT DICOM/TIFF 导入 + Otsu + 精确 3D EDT 偏差热力图 |
| curvature.ts / vertex-coloring.ts | 曲率标量 + Cool-Warm 顶点色 |

### physics/ —— 多物理场求解器
| 文件 | 职责 |
|---|---|
| gpu-plasticity-solver.ts (+ WGSL 内核) | v6.0 全拉格朗日 StVK+J2 径向返回体素 FEM |
| digital-twin-compression.ts | v6.0 数字孪生压溃：主应变失效 + 渐进单元生死 + Gibson-Ashby 对比 |
| navier-stokes-solver.ts | v6.0 Stokes-Uzawa 微流体（collocated 中心差分） |
| lpbf-thermo-mechanical.ts | v6.0 LPBF 高斯体热源瞬态热传导 + 残余应力/翘曲/工艺窗口 |
| yield-surface.ts | 🆕v7.0 多轴屈服包络（Hill-48/Tsai-Wu/Gurson/DP 统一射线距离） |
| phononic-bandgap.ts | 🆕v7.0 Bloch-Floquet 点阵动力学 + deflate-Lanczos + 长波标定 |
| tissue-growth.ts | 🆕v7.0 氧准稳态 + 低氧门控增殖 + 矿化（28 天组织长入） |
| micro-fea-solver.ts / lbm-permeability.ts | 波动场均质化（J-PCG）/ FD-Darcy SOR 渗透率 |
| homogenization.ts / inverse-design.ts / impact-energy.ts / ml-surrogate.ts | VRH 界+方向模量 / NM+LM 逆向 / SEA+模态 / MLP+Pareto |
| gibson-ashby.ts / tortuosity.ts / permeability.ts 等 | 经验模型族（Kozeny-Carman 已修量纲混用）/ 26 连通 Dijkstra 迂曲 |
| bone-morphometry.ts | BV/TV、Tb.Th/Sp/N、SMI 骨计量 |

### export/ —— 工业格式族
STL（二进制/多实体，构造性全局定向）· GLB（顶点色）· 3MF（mm 原生+端板元数据）· VTK/VTI ·
Abaqus INP（C3D8+PBC 节点集+载荷步）· OpenFOAM polyMesh 五件套（CFD 四区块）·
G-code 切片（Marlin/Klipper/Bambu）· 验证套件 ZIP（Abaqus/simpleFoam 自动跑批脚本）·
Python/MATLAB 重建脚本（与平台逐点对齐）· BibTeX/JSON sidecar。

### measure/ + worker/
游标卡尺 · 三维边界条件拾取器（法向角区域生长→INP/FOAM 注入）· SVG 剖面 ·
包围盒标注；Web Worker 承载重建（Transferable 零拷贝）。

## 四、Agent 层（tpms/agent/，M0-M5 全线 + M3→M4 桥接）

| 组件 | 职责 |
|---|---|
| tpms.mjs | 六子命令 list/estimate/mesh/verify/solve/scenario（JSON 输出；exact 孔隙率求解器 0.26pp@R96） |
| tools.schema.json | **五工具**注册面（+tpms_design_verify 闭环入口），枚举/数值域/路径狱与 CLI 逐项对拍 |
| llm-provider.mjs | 三 Provider（Ollama / OpenAI 兼容端点 / Mock）+ validateToolCalls 拦截器（逐槽位钳制） |
| llm-agent.mjs | 自然语言 → LLM tool calling → 拦截器 → CLI 确定性执行（退出码 0/2/3/4） |
| tpms-driver.mjs | M4 闭环：propose→verify→有界修复菜单→确定性应用→重跑；不可达结构化宣告 |
| 验收 | 真实模型 glm-4.6 中英回归 34/34（现 37 条含闭环意图组，key 门）；Mock 闭环自检 6/6 + 真实 2/2 |
| 自检（CI 纳管） | agent_selftest 47 + schema_check 87 + llm_provider_selftest 33；llm_driver_selftest 6（手动门） |

铁律：LLM 只填 schema 界定槽位；一切数值由拦截器钳制或拒绝；执行与验收全部确定性代码。

## 五、门禁体系（43 项，run_ci_suite.mjs 调度，三平台矩阵）

入口：`cd tpms/tpms-platform && npm run test:all`（本机 6-10 分钟）。构成 = 38 道行为审计（含 experimental_fit_audit 实验曲线反演，v9.0 门 43）
（rolldown 打包 TS 源实跑，无 mock 数学）+ ui_jump_check 快检 + run_all（6 套 UI 回归）+
agent_selftest/schema_check/llm_provider_selftest 三项 CLI 门。每门带 pass 下限守卫
（断言被中和/跳过不得绿灯）。大断言门：parity_math 282 · redteam_matrix 100 ·
custom_equation 73 · periodic_rve 88 · cae_mesh 46 · webgpu_parity 101（万点对拍 0.00e+0）·
schema_check 87。全 43 项清单见 `tpms/.verify/run_ci_suite.mjs` 或 README 特性矩阵。

## 六、文档体系

- **README.md / README_EN.md**：定位 + 文件导航 + 特性矩阵（43 门徽章 1000+）+ LEARNING_PATH 入口
- **WORKFLOW_GUIDE.md**：35 章实战指南（几何→分形/逆向→FEA/DICOM/G-code→弹塑性/孪生→v7 生成式五件套）
- **RELEASE_NOTES_v2.4~v8.0**：七份双语发布说明
- **BENCHMARKS.md**：20 族 × R{48,96} 可产性/偏差/耗时公开矩阵（复跑约 10-20 分钟，确定性）
- **paper/**：SoftwareX 投稿包（已对齐 v8.0；pdflatex 0 错误）
- **agent_memory/**：context / progress / bugs 三件套 + archive

## 七、版本史

| 版本 | 主题 | 门禁 |
|---|---|---|
| v1-v2.4 | 8 曲面沙盘 + 水密网格 v2 + 端板 + 3MF | 3→12 |
| v3.0 | WebGPU 管线 + 应力迹线 + 分形分级 + 体网格直通 + GPU 同源门 | 16 |
| v4.0 | 逆向设计 + CT 偏差 + SEA/模态 + 庞加莱 + 验证链 | 21 |
| v5.0 | Micro-FEA/FD-Darcy + BC 拾取 + DICOM 骨计量 + G-code + ML Pareto + 论文 | 26 |
| v6.0 | 弹塑性大变形 + 压溃孪生 + 微流体 + LPBF + NL 代理 | 31 |
| v7.0 | SIREN 隐式场 + 屈服包络 + 声子能带 + 组织长入 + 水平集拓扑优化 | 38 |
| v8.0 | 曲面 14→20 + Agent M0-M5 全线（真实模型 34/34）+ K-C 量纲修复 + fcks 池溢出根治 + R128 标定 + 98MB 历史清洗 | **42** |

## 八、诚实边界（全部披露于源码注释与 Release Notes）

1. 微观 FEA 剪切波动场 b=0 结构性未解——C44-C66 为 Voigt 上界口径；
2. LBM D3Q19 降级 FD-Darcy（bounce-back 动量吸收不稳定，三版重构未解）；
3. DT/GA 平台应力标定比 ≈1.7-2.0（体素 FEM 偏刚），守稳定带而非裸 ±10%；
4. WASM 加速档降级 TS 热循环（wabt.js/V8 编码分歧，实验件保留）；
5. LPBF 热-力解耦（固有应力法），熔池对流/辐射未建模；
6. 薄壁自触族可用域 fail-closed（frd/fks/fky/gprime-k6/lidinoid 高孔隙等，实测 nm 钉进 schema）；
7. cylinder+diamond 深水区全分辨率拒产且非单调不收敛（独立机制，fail-closed 正确）；
8. k=6 非标定域；ML 代理为演示精度；G-code 单壁轮廓 + 体积偏差 ≤10%（修正后）；
9. GPU wall-time 目标需真机 WebGPU 实测（headless 无 WebGPU）。

## 九、常用命令

```bash
cd tpms/tpms-platform
npm run dev          # 开发
npm run build        # 构建（dist → docs/platform 同步，勿入库 sourcemap）
npm run test:all     # 43 门 CI（本机约 6-10 分钟）

# Agent CLI
node tpms/agent/tpms.mjs mesh --type gyroid --porosity 0.65 --resolution 96 --json
node tpms/agent/llm-agent.mjs --provider openai "设计一个孔隙率 75% 的 Gyroid 骨支架并验证到通过"  # 需 TPMS_LLM_API_KEY
node tpms/agent/tpms-driver.mjs --design 方案.json --provider mock   # 离线闭环（TPMS_ALLOW_MOCK_EXEC=1 时经 llm-agent）
node tpms/agent/benchmarks.mjs --md BENCHMARKS.md                    # 公开基准复跑（~10-20 分钟）
```
