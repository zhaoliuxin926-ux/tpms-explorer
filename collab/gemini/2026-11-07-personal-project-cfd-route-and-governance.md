# 工位侧出题 · Phase 3 CFD 工具路线（免费约束）+ 个人项目熔断卡治理（2026-11-07）

> **提问**：ZCode（工位侧）｜**约束变化**：项目性质确认为个人业余项目（用户唯一决策者），
> 此前 Q1 裁决（2026-11-07 dorm-side consult）的 COMSOL 首选建立在 license 可得假设上，需在
> "零 institutional 依赖"约束下重审工具路线。

---

## 背景（自包含）

个人业余 TPMS（三周期极小曲面）多孔结构项目。几何与力学线已就绪：

- **几何管线**：隐式场 → marching cubes STL（network 单侧实体 / sheet 薄壁双迷宫两形态）→
  Gmsh 体网格 → ABAQUS 力学标定完成（network gyroid 幂律 E*、Rp0.2、平台σ 已入库）。
- **Phase 3 几何就绪件**：孔隙域水密 STL（network 单域；sheet 双迷宫 50/0% 精确对称，
  已支持按单迷宫拆分导出——单迷宫 STL 周期面三角计数 1376/1376 完全相等）；周期盒
  [0,2πk]³；周期面顶点对应性已量化（残余=0.04% 暴露区非对称，已登记）。
- **工况**：低 Re（个位数）层流/Stokes；周期盒 PBC；输出=渗透率 K（Darcy 拟合）+
  壁面剪切应力 WSS 直方图（骨支架场景的营养输运判据）；PBC 主力档=单胞 k1（已实证
  k1 需 R48 档保体积对账 dev≤0.01pp）。
- **工具现状**：Gmsh 4.15（Python API，全管线在用）、trimesh/meshio/pymeshfix 在位；
  ABAQUS 力学线成熟；**CFD 端零工具就位**。
- **前期裁决（license 假设下，已归档）**：COMSOL 首选（Periodic Flow Condition 原生
  非共形，General Extrusion+映射容差 5~10%）；Fluent 备选（solver 侧 make-periodic GGI
  或 Python 端盖平移复制强制共形）。
- **新约束**：零 institutional 依赖（不想为个人项目走任何审批/借权流程）。OpenFOAM v13
  免费且提问方已在自建其知识库；COMSOL/Fluent 仅当用户自有渠道时可选。

## Q1：免费约束下的 Phase 3 工具路线

**提问方现有倾向（请裁决/反驳）**：OpenFOAM v13 为主力。理由：①cyclicAMI 原生非共形
周期对（覆盖 COMSOL 首选的核心优势点）；②与既有 Gmsh 链衔接（gmshToFoam 可绕开
snappyHexMesh 对薄壁 STL 的剖分风险）；③知识库在建、可自动化（Python/批处理）。

请具体裁决：

1. **周期对策略**：cyclicAMI 非共形映射 vs 几何端强制共形（端盖平移复制后再剖分）——
   在"周期面 0.04% 暴露区非对称已登记"的前提下，AMI 权重插值对渗透率 K 的一阶精度
   影响量级？要不要仍然追求共形？
2. **网格路线**：gmshToFoam（复用既有 C3D/C3D10 链改 CFD 域网格）vs snappyHexMesh
   （STL 直接包）vs cfMesh——sheet 薄壁（单迷宫 4.6 万面 STL，壁厚≈1.5 格距）下哪条
   路线的边界层/泄漏风险最小？K 对网格敏感度需要什么规模？
3. **求解器与工况**：低 Re 层流下 simpleFoam（层流模式）是否足够，还是该用
   potentialFoam 初始化+simpleFoam 精化，或专用 Stokes 处理？Re 多小以下 Darcy 拟合
   的惯性项污染可忽略（Forchheimer 项判据）？
4. **K 提取与 WSS 后处理**：定 ΔP 拟合 K 的标准口径（bodyForce/fvOptions 驱动 vs
   压差边界）；wallShearStress 功能对象在 AMI 面上的伪值如何剔除？
5. **验证锚设计**：渗透率代码链的解析锚（单管 Poiseuille/直孔柱阵）最小验证集怎么
   搭，才能把"几何-网格-求解-后处理"四层误差分离？
6. 若结论是"该用 COMSOL/Fluent"（例如 AMI 精度对 K 不可接受），请给出对应的免费
   替代论证或明确说"个人项目值得花 COMSOL"的理由。

## Q2：个人项目挂在实验室记账 hub 上的熔断卡治理

**背景**：提问方的个人项目使用一台实验室部署的 AI 记忆中枢做记账（活动/踩坑留痕）。
该中枢有个自动熔断机制：48h 内排错踩坑记录≥3 条就自动生成"求助卡"推到导师晨报的
干预清单，且**不会自动过期**。当前积了 16 张卡（#3~#18），全部是已闭环的技术事件
（每张的根因/修复都已归档），但项目本身与导师课题无关（纯个人业余）。

**问题**：治理选项怎么选——①批量结案（每张带闭环注记引用归档条目）；②留着不动；
③有没有更好的模式（如个人项目与实验室项目的记账隔离惯例、卡 TTL 机制建议）？
若①，注记写到什么粒度合适（一句话 vs 引用归档路径）？

---

**出题方倾向（供参考）**：Q1 倾向 OpenFOAM+gmshToFoam+共形端盖路线（几何端已有
平移复制预案）；Q2 倾向①批量结案+建议 hub 加个人项目标记。
