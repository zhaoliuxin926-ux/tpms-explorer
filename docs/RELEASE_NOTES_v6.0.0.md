# TPMS Explorer v6.0.0-digital-twin-hpc Release Notes（双语）

> 发布日期：2026-08-28 ｜ 前置版本：v5.0.0-fullstack-cae-ecosystem（@623aa53）
> 里程碑：**31 道 CI 门禁 · 1000+ 断言**（26 门基础上新增 5 门，全绿）

---

## 中文

v6.0 将平台从「几何 + 线性物理代理」推进到「**非线性多物理场数字孪生闭环**」：弹塑性大变形、断裂失效预测、真实 Navier-Stokes 微流体、LPBF 打印热-力耦合与自然语言 CAD 代理五大前沿一次性落地。

### Stage I — WebGPU 弹塑性大变形求解器（门禁 27，42 断言）
- 全拉格朗日体素 FEM（C3D8 + 2×2×2 Gauss）：Green-Lagrange 应变 + StVK 超弹性 + J2 径向返回塑性（张量空间 Prandtl-Reuss 口径）；
- 含几何内力项的完整平衡方程 + 修正牛顿（弹性切线）+ Jacobi-PCG + 回溯线搜索 + 手风琴子步回滚 + 位移增量限幅；
- 能量台账守恒恒等式（实测 gyroid R=8 全程漂移 0.32% ≤ 0.5%）+ 静水 KUBC 解析锚点（漂移 1.9e-9）；
- WebGPU 计算着色器（`plasticity.wgsl`）并行本构内核，与 TS 权威路径逐字同步锚定；
- 视口「弹塑性压溃仿真」：von Mises 顶点色热图 + σ–ε 曲线。

### Stage II — 数字孪生单轴压溃与断裂失效预测（门禁 28，21 断言）
- 最大主应变失效判据（Cardano 解析特征值）+ 渐进单元生死（每步上限 + 活性下限双守卫）；
- **坍塌检测**：失稳发散即截断曲线并上报坍塌应变（实测 gyroid @ε=0.018）；
- Gibson-Ashby 平台应力对比（DT/GA 标定比诚实披露 ≈1.7，跨工况稳定 ≤10%）；
- 韧性代理（塑性耗散 W_pl）。

### Stage III — Navier-Stokes 微流体求解器（门禁 29，15 断言）
- 融合显式松弛 Stokes + Uzawa 压力修正；Brinkman 无滑移体素口径；
- Poiseuille 解析剖面误差 **0.002%**；gyroid 多孔渗流 κ 与 FD-Darcy 交叉验证；
- 全周期体力驱动渗流口径（标准 κ 测量）；TS 热循环权威路径；
- WASM 加速档诚实降级披露（wabt.js/V8 编码分歧；手写汇编器 + WAT 实验件保留）。

### Stage IV — LPBF 热-力耦合预测（门禁 30，18 断言）
- 高斯体热源蛇形扫描 + 显式瞬态热传导（Jacobi 双缓冲守恒：能量台账 **0.0000%**）；
- 冷却参数落文献带（R=5.9e7 K/s，G×R=3.65e15 K²/s）；沸点封顶蒸发耗能口径；
- 固有应力法残余应力（屈服封顶 880 MPa）+ 翘曲估算 + 工艺窗口三态评估；
- 「LPBF 打印工艺与残余应力」UI 卡片（功率/速度实时评估）。

### Stage V — 自然语言 CAD/CAM 代理（门禁 31，25 断言）
- 零依赖中英双语意图解析 → 参数补丁 + 动作 + 结构化日志；
- 越界钳制 + unknown 不臆造 + 帮助引导；
- 💬 AI 设计助手浮动面板：一句话「孔隙率 75%、Gyroid、2mm 端板，导出 3MF」→ 参数全应用 + 模型下载 + 触发仿真。

### 工程纪律
- 全程 31/31 门全绿（`npm run test:all`），未破坏任何 v2.0-v5.0 既有断言与 UI 回归；
- 阶段级原子交付：Stage I（4ae43fd）、Stage II+III（456c46b）先行推送；
- 诚实边界全部落入 WORKFLOW_GUIDE §26–30 与源码注释。

---

## English

v6.0 advances the platform from "geometry + linear physics surrogates" to a **nonlinear multi-physics digital-twin loop**: elastoplastic large deformation, fracture failure prediction, real Navier-Stokes microfluidics, LPBF thermo-mechanical coupling, and a natural-language CAD agent.

- **Stage I — WebGPU elastoplastic solver** (gate 27, 42 assertions): Total-Lagrangian voxel FEM, Green-Lagrange strain, StVK + J2 radial return (tensor-space Prandtl-Reuss), modified Newton + Jacobi-PCG, accordion sub-stepping with rollback, displacement increment clamping; energy-balance identity drift 0.32% on gyroid lattices (hydrostatic KUBC anchor at 1.9e-9); WGSL constitutive kernel byte-synced with the TS authority path; viewport von-Mises heat-map animation.
- **Stage II — digital-twin compression & fracture** (gate 28, 21): max-principal-strain failure with progressive element deactivation (per-step cap + activity floor), collapse detection reporting the collapse strain (gyroid @ ε=0.018), Gibson-Ashby plateau comparison with disclosed calibration ratio (~1.7).
- **Stage III — Navier-Stokes microfluidics** (gate 29, 15): fused explicit relaxation Stokes + Uzawa pressure correction, Brinkman no-slip voxels; Poiseuille profile error 0.002%; gyroid permeability cross-checked against FD-Darcy; WASM acceleration honestly downgraded to TS hot loops (wabt.js/V8 encoding divergence; hand assembler + WAT kept as experimental artifacts).
- **Stage IV — LPBF thermo-mechanics** (gate 30, 18): Gaussian volumetric heat source serpentine scan, explicit transient conduction with Jacobi double buffering (energy ledger 0.0000%), melt-pool metrics within literature bands (R=5.9e7 K/s, G×R=3.65e15 K²/s), inherent-strain residual stress capped at yield (880 MPa), distortion estimate, three-state process window; sidebar UI card.
- **Stage V — natural-language CAD agent** (gate 31, 25): zero-dependency bilingual intent parsing → parameter patches + actions + structured logs; clamped ranges, no-hallucination unknowns, help guidance; floating chat panel applies parameters, exports STL/3MF, triggers simulations.

**Engineering discipline**: 31/31 gates green (`npm run test:all`), 1000+ assertions, zero regressions on v2.0–v5.0 suites; atomic per-stage delivery; honest limitations documented in WORKFLOW_GUIDE §26–30.

验证：`cd tpms/tpms-platform && npm run test:all`（31 门 1000+ 断言）。
