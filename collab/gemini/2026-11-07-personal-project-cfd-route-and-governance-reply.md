# Gemini 回执 · Phase 3 CFD 免费约束工具路线 + 熔断卡治理（2026-11-07）

> **提问**：`2026-11-07-personal-project-cfd-route-and-governance.md`（工位侧 ZCode 出题）
> **回执**：用户代贴 Gemini 原文归档如下｜**处置结论见文末（ZCode 登记）**

---

针对零机构依赖约束下的 Phase 3 流体仿真工具链选型与实验室记账中枢治理，核心裁决支持以 **OpenFOAM v13 + `gmshToFoam`（一阶网格）+ 端盖平移共形网格** 为主力 CFD 路线，并对 #3~#18 求助卡执行 **单行归档批量结案 + 作用域隔离改造**。

## Q1：免费约束下的 Phase 3 工具路线裁决

### 1. 周期对策略：`cyclicAMI` vs 几何端强制共形

* **核心裁决**：**主推"几何端端盖平移复制强制共形 + 标准 `cyclic`（或完全重叠 `cyclicAMI`）"，将非共形 `cyclicAMI` 作为容错备选**。

* **0.04% 暴露区非对称对 K 的一阶精度影响**：OpenFOAM 的 cyclicAMI 通过计算源面与目标面多边形交集的面积权重传递通量。单迷宫周期面 0.04% 的暴露区非对称位于固液无滑移交线处（局部流速趋于零）；开启 `lowWeightCorrection` 后，其对体平均达西速度与渗透率 K 的一阶积分误差仅为 **O(10⁻⁴)（小于 0.05%）**，远小于网格离散误差。

* **为何仍需追求共形**：非共形 `cyclicAMI` 在 0.04% 面积权重不闭合处会产生微小的全局质量通量残差（∑φ≠0），在全周期不可压缩流场中易引起压力泊松方程连续性误差累积。既然单迷宫 STL 周期面三角计数已达 `1376/1376` 完全相等且具备端盖平移复制预案，直接在 Python 中将主周期面三角网平移 2πk 覆盖对侧面、锁定表面网格后交由 Gmsh 剖分内部体网格，即可零成本获得节点严格对应的共形周期对。

### 2. 网格路线：`gmshToFoam` vs `snappyHexMesh` vs `cfMesh`

* **核心裁决**：**首选 `Gmsh 一阶四面体 + gmshToFoam（可选配 polyDualMesh）`；严禁将力学线 C3D10 二阶网格直接转入 OpenFOAM，放弃 `snappyHexMesh` 裸包薄壁**。

* **一阶网格铁律**：OpenFOAM 有限体积法仅支持线性一阶面元，力学线的 C3D10 二阶四面体直接喂给 `gmshToFoam` 会丢失曲边中点或导致拓扑错乱；必须在 Gmsh 4.15 中生成**一阶四面体（Element Type 4，导出 `.msh` v2 ASCII 格式）**。

* **三条路线风险对比**：
  * **`gmshToFoam`（零泄漏主力）**：直接基于已水密的 4.6 万面单迷宫 STL 内部剖分四面体，完全杜绝跨薄壁穿透。针对纯四面体非正交角偏大（65°~78°）的问题，可在转网后执行一行 `polyDualMesh 75` 转化为对偶多面体网格（或保留四面体并在 `fvSolution` 中设 `nNonOrthogonalCorrectors 2`）。
  * **`snappyHexMesh`（高泄漏风险）**：Sheet 薄壁仅约 1.5 格距，背景网格锯齿贴合与边界层挤压极易在鞍面薄壁处发生跨壁穿透（破面连通两迷宫）。
  * **`cfMesh`（`cartesianMesh`，优质备选）**：直接读取水密 STL 生成六面体核心 + 贴壁多面体过渡网，若纯四面体壁面切应力噪点偏高，可无缝切换至 `cfMesh`。

* **网格规模敏感度**：
  * **渗透率 K**：体积积分量对近壁网格不敏感，孔喉直径跨 12~15 个单元即可收敛；k=1、R48 档单迷宫约 **30万~60万 四面体（或 15万~25万 对偶多面体）** 即可使 K 误差小于 2%。
  * **壁面剪切应力 WSS**：壁面速度一阶导数对近壁网格敏感；无需强加易畸变的薄壁棱柱层，只需加密近壁四面体使特征尺寸 Δx ≤ D_throat/20（单迷宫约 **80万~120万 四面体**），即可使 WSS 直方图中位数与 P10/P90 分位数误差控制在 5% 以内。

### 3. 求解器架构与 Forchheimer 惯性项判据

* **OpenFOAM v13 版本语法排雷**：若使用 **OpenFOAM Foundation v13**，传统 `simpleFoam` 与 `fvOptions` 已被废弃，需调用模块化求解器 `foamRun -solver incompressibleFluid`，并在 `constant/momentumTransport` 中设 `simulationType laminar;`，动量源项写入 `constant/fvModels`。

* **求解策略**：**直接从零初场运行稳态层流 SIMPLE 算法，无需 `potentialFoam` 初始化**。粘性主导孔道流在 150~300 步内即可单调收敛至 10⁻⁶；若需绝对纯 Stokes 解，在 `system/fvSchemes` 的 `divSchemes` 中将 `div(phi,U)` 设为零即可彻底关停对流惯性项。

* **Forchheimer 污染判据**：基于孔隙雷诺数 Re_p = ρ_f·v_Darcy·d_p/μ 与 Forchheimer 数：
  * 当 **Re_p < 1** 时，惯性压降占比小于 1%，流场严格处于纯 Darcy 线性区，单点流速即可精确测定 K。
  * 当 1 ≤ Re_p ≤ 10（个位数 Re 上沿）时，迷宫弯道二次流会使表观渗透率偏低 3%~12%；若工况覆盖该区间，需跑 3 个流速点拟合二次曲线 ΔP/L = (μ/K)·v_Darcy + ρ_f·β·v_Darcy² 取一次项系数定 K。

### 4. K 标准提取口径与 WSS 伪值剔除

* **定目标流速反算压降源项（推荐标准口径）**：在三向全周期盒中，使用 `constant/fvModels`（旧版为 `fvOptions`）中的 `meanVelocityForce` 指定目标本征平均速度 `Ubar (U0 0 0)`。求解器自动迭代修正维持该流速所需的比压力梯度源项 G = |∇P|/ρ_f（单位 m/s²），收敛后直接从日志读取 `pressure gradient = G`，按以下公式一步算出渗透率（ν 为运动粘度，ε_eff 为计入孔隙率）：

  K = ν·ε_eff·U0/G

* **剔除 AMI/周期面上的 WSS 伪值**：
  1. 在 `constant/polyMesh/boundary` 中将固液界面单独命名为 `scaffoldWall`（`type wall;`），6 个周期端盖严格设为 `type cyclic;` 或 `type cyclicAMI;`。
  2. 在 `controlDict` 的 `wallShearStress` 函数对象中显式指定 `patches (scaffoldWall);`，阻止后处理扫描周期边界面。
  3. **量纲换算提醒**：OpenFOAM 不可压缩求解器输出的 `wallShearStress` 是运动学切应力 τ/ρ_f（单位 m²/s²），统计骨支架真实物理 WSS 直方图（单位 Pa）时必须乘以流体密度 ρ_f。

### 5. 四层误差分离的最小解析验证锚

在 [0, 2π]³ 周期盒（L=2π）内构建**半径 R=0.5L 的轴向贯通直圆管（Hagen-Poiseuille 解析流）**，用 3 个递进算例完成四层误差解耦：

| 验证算例 | 几何与网格输入 | 理论基准解（ε = πR²/L²） | 分离验证的目标层 | 放行阈值 |
|---|---|---|---|---|
| **Anchor-1（求解+后处理层）** | Gmsh 原生圆柱 CAD 剖分共形四面体 | K = εR²/8；WSS = 4μU0/R | 验证 `meanVelocityForce` 源项提取与 ρ_f 量纲换算 | 误差 <0.5% |
| **Anchor-2（MC 几何+FVM 网格层）** | 隐式场 x²+y²≤R² 经 R48 MC 导出 STL → gmshToFoam | 同上（检验 R48 表面离散湿周放大效应） | 分离 MC 多面体逼近与四面体非正交带来的离散偏差 | K 误差 <2%，WSS 误差 <3% |
| **Anchor-3（周期接口层）** | 在 Anchor-2 基础上将一端网格人为错位走 cyclicAMI vs 共形 cyclic | Anchor-2 实测值 | 单独剥离 cyclicAMI 面积插值对 K 的影响 | 两路线偏差 <0.2% |

### 6. 商业软件替代必要性判定

* **结论**：**完全无需在个人项目中引入 COMSOL 或 Fluent**。在低 Re 单相层流下，OpenFOAM v13 的求解精度与商业软件完全一致，且与现有 Python/Gmsh 批处理管线天然契合，零授权成本即可跑通全套标定。

## Q2：个人项目在实验室记账 Hub 上的熔断卡治理

**核心裁决**：**采纳"① 批量结案（#3~#18）+ ③ 命名空间隔离与 TTL 改造"，严禁选"② 留着不动"**。

### 1. 为什么不能留着不动

16 张未过期求助卡长期占据导师晨报干预清单，既会稀释实验室正牌课题真实故障的告警信噪比，又容易让导师误判你在主课题中频繁卡壳。

### 2. 批量结案注记粒度规范

* **最佳粒度**：**"状态前缀 + 一句话性质声明 + 归档索引路径"的单行注记**（导师晨报扫视只需确认"非课题任务、已闭环、无需介入"，切忌贴入大段技术排错细节）。
* **标准结案注记模板**：`[CLOSED | 个人业余项目-无需导师介入] 技术事件已自闭环，根因与修复归档于 #<Archive-ID/Path>（历史自动熔断卡 #3~#18 批量结案）`

### 3. Hub 记账隔离与熔断机制改造建议

1. **增加项目作用域标签（Scope Tag）**：在记账条目元数据中加入 `scope: personal`（或标题前缀 `[personal]`），并在导师晨报推送路由中添加过滤规则 `scope != 'personal'`，实现个人项目留痕与导师汇报彻底解耦。
2. **修正熔断计数口径**：将熔断触发条件从"48h 内排错记录≥3 条"改为"48h 内**未闭环（status=open）**的排错记录≥3 条"，已随手闭环的记录不再触发求助卡。
3. **引入求助卡 TTL 自动过期**：为求助卡配置默认 TTL=72h 及归档联动钩子（一旦关联日志标记为已归档，对应求助卡自动转为 Auto-Resolved 并移出晨报清单）。

---

## 处置结论（ZCode 登记 2026-11-07）

| 项 | 处置 | 落地 |
|---|---|---|
| Q1 | **采纳** | OpenFOAM v13 主力路线入 plans §7.3（共形端盖主力+cyclicAMI 备选/gmshToFoam 一阶网格铁律/Anchor 1-3 误差分离阶梯=Phase 3 启动序）；v13 模块化语法抽验见下 |
| Q2 | **采纳** | #3~#18 批量结案（单行模板注记，resolved_by=zlx）；三条 hub 改造建议经 report_mcp_feedback(suggestion) 提交反馈中心 |
| 口径注记 | 登记 | K=ν·ε_eff·U0/G 中 ε_eff 因子隐含 U0=孔隙内流速口径；meanVelocityForce 的 Ubar 是全域平均（表面流速）——两者不能混用，Anchor-1 已知 K 反推即钉死口径（预期以表面流速 Ubar 口径 K=ν·Ubar/G 为准，ε 因子是否出现由 Anchor-1 裁决） |
| 版本语法抽验 | 执行中 | rag-kb openfoam KB（v13）核对 foamRun/incompressibleFluid/fvModels/momentumTransport/wallShearStress 运动学输出 |

**抽验结果（ZCode 2026-11-07）**：见 progress 同日条目（KB 对拍逐条登记）。
