# TPMS 仿真管线调研与避坑沉淀（2026-10-28）

> 来源：宿舍机 ZCode 会话——四路并行网络调研（ABAQUS 压缩主流做法 / CFD 软件格局 / 网格前处理路线 / GitHub 资源）+ 五轮工程讨论（含外部 AI 评审"反重力"的 4 条补充及其修正）。
> 状态：**纸面方案，未经任何真实几何验证**。Phase 1 水密性验证跑通之前不算"封顶"——第一个真实 STL 走通全链路时预计有两成纸面假设要修。
> 课题背景：仿生人体骨支架、sheet 型 TPMS、Python 隐式场建模；力学压缩仿真（ABAQUS 已在另一环境跑通）+ 流体仿真（渗透率/WSS）双线。
> 现有流程：Python 建模 → ANSYS 划网格 → 导 mesh → ABAQUS 仿真。**本方案改造点 = 替换"ANSYS 划网"环节**，其余保留。

## 1. 调研核心结论速览

### 力学（ABAQUS）

- TPMS 文献绝对主流：ABAQUS + **二次四面体**——Standard 弹性段/均匀化用 C3D10，Explicit+接触用修正版 **C3D10M**；薄壁 sheet 型壁厚方向 **≥3~4 层单元**，以力-位移曲线收敛为准（文献口径：扫单元尺寸至曲线收敛，如 0.3~3mm 取 0.3mm；单胞 3 万单元起收敛、17 万稳定）。
- **压溃/大变形用 Explicit 显式准静态**，纪律：动能/内能 `ALLKE/ALLIE ≤ 5~10%` 全程保持；Smooth Step 幅值；加载时长 ≥ 10× 基频周期；加载速度 < 材料波速 1%。
- **压溃必须多胞整体模型（≥3×3×3）**，原因是物理正确性而非算力：压溃本质是变形局部化（剪切带/逐层屈曲带），少胞边界效应会人为抑制局部化带，平台应力/吸能失真；PBC 假设周期位移场，压溃后物理破缺。**"弹性段 RVE+PBC 单胞、压溃段多胞整体"是两段物理各用各的正确工具。**
- 加载：位移控制 + 解析刚体压板（**无节点不贡献动能**，能量曲线干净）+ 低摩擦接触 + General Contact 自接触。
- 本构：金属弹塑性（单轴拉伸真实应力-应变标定；失效用 J-C+单元删除）；聚合物弹性体 Ogden/Yeoh；多线性优于双线性。实测-仿真差用 knock-down factor（文献 15~40%）或 μCT 真实几何。

### 流体

- TPMS 文献第一主流 **ANSYS Fluent**（换热方向，RANS k-ω SST 居多）；**骨支架渗透率/WSS 文献里 COMSOL 与 Fluent 平分秋色**（也有用 ABAQUS 做流体渗透率的先例，如 Castro 2019）。
- **骨支架场景定标：渗透率、壁面剪切应力（WSS）、营养输运（扩散-对流）；Re 个位数以下纯层流/Stokes 流** → y+、prism 边界层、湍流模型的权重塌缩到接近零，COMSOL（层流+多物理场闭环）优势放大。
- **单胞 + 平移周期边界（translational periodic）**算充分发展流压降/渗透率是标准打法，网格量降一个量级；渗透率 Darcy 定律换算。
- OpenFOAM 定位：多孔介质基础研究第二梯队；痛点是工程包装缺失（无完整 GUI、字典配置、版本碎片化 .org/.com、snappyHexMesh 对 TPMS 精细 STL 层加密易失败），非求解能力。
- 后处理：ParaView 的替代——Tecplot 360 / EnSight（商业主流）；**pyvista（Python，VTK 封装）是自动化管线首选**，批量出同风格出版图直接喂 matplotlib。

### 网格前处理

- **破除伪命题**："HyperMesh 统一前处理 vs Fluent Mesh 二选一"不成立。正解：**几何（STL 修复/水密化）统一修一份"单一几何源"；力学体网格与 CFD 体网格分别各划一套**。两类网格要求本质冲突（FEA：单元质量/雅可比/二次单元；CFD：各向异性 prism/y+），工业分区 FSI 的标准架构就是两套网格+界面映射（Ansys System Coupling）。TPMS 额外原因：流体域是 TPMS 负空间，需单独布尔/包面，几何本不同源。
- HyperMesh：汽车/航天**工业界** FEA 前处理标准（大模型装配/连接管理/模板）；学术 TPMS 少数派；对无 CAD 特征的 TPMS 清理量大；**难进 Python 自动化管线——本项目不选**。
- 学术事实主流：**ABAQUS CAE 原生**（STL Import + 虚拟拓扑 + 自由四面体）或 **Gmsh**（官方 Python API，开源，本项目力学线首选）。
- CFD 网格主流：**Fluent Meshing Watertight 工作流**（局部尺寸→包面→面网格→poly-hexcore+prism→质量优化）；脏 STL 有 fault-tolerant/wrap 兜底。
- STL 本质缺陷（marching cubes 输出）：非流形边/自相交/间隙/零体积隐患——不修直接进任何体网格器会失败或出劣质网格（有文献实锤：gyroid STL 在 ABAQUS 因自相交无法划网被迫转体素法）。**修复应在生成端消灭（分辨率+隐式区间提取），pymeshfix 只做兜底保险**——每次都要 repair 说明上游参数有问题。

## 2. 推荐管线（定稿架构）

```
【生成端】Python 隐式场（sheet 区间提取，相对密度标定）
   → 水密性 gate：trimesh is_watertight + 连通域检查（pymeshfix 仅兜底）
        │
   ┌────┴─────────────────────┐
【力学线】                    【流体线】
Gmsh Python API               首选 COMSOL（MPh 库脚本化；
(HXT, C3D10/C3D10M)           层流+WSS+营养主场，可隐式方程直建）
→ meshio 中转出 .inp          备选 Fluent Meshing + Fluent
  （tet10 节点序由 permute 处理； （PyFluent 全脚本化）
   过滤混入的 2D 面单元；        单胞平移周期边界算渗透率
   材料/截面/ELSET 模板自补）
→ ABAQUS：Static 弹性段/均匀化
   + Explicit 准静态压溃段（按需）
→ ABAQUS Python 批量 + ODB 后处理
        │
【编排层】TPMS agent 调度整条链；pyvista 批量出图
```

两条设计原则：
1. **每环 CLI 可调用 + 输入输出文件化 + 每步验证 gate**（水密性/网格质量报告/ALLKE-ALLIE 能量比）。管线是执行层、agent 是编排层，接口干净两层才咬合。
2. **最小改造**：替换"ANSYS 划网"环节（Workbench Meshing 是自动化瓶颈），Python 建模与 ABAQUS 仿真已跑通的部分原样保留。

## 3. 八个深水坑（前 4 条来自外部评审，已核实并深化）

| # | 坑 | 对策 |
|---|---|---|
| 1 | sheet 加厚若用中面 offset，曲率半径 < 壁厚/2 的鞍点必自交 | **永远在隐式场层面做区间提取** `c1 ≤ f ≤ c2`，从根源杜绝自交 |
| 2 | 区间法壁厚天然不均（\|∇f\| 空间变化，厚度≈(c2−c1)/\|∇f\|） | 参数标定用**相对密度（体积分数）**而非名义壁厚（文献惯例）；SDF 重整化一般不必做（徒增计算量） |
| 3 | 单侧阈值超临界后等值面拓扑断开成孤立团簇 | 生成端跑**连通域检查**（trimesh connected components），一条命令避免"算完才发现结构是断的" |
| 4 | Gmsh→INP 的 tet10 节点序差异 | 这是**格式级稳定差异**（非版本 bug），走 **meshio 中转**（内置 permute）或 microgen 内置导出；另需过滤混入的 2D 面单元、自补材料/截面/ELSET |
| 5 | Explicit 压溃时间步：金属 Lmin=0.05mm 时 Δt≈3e-9 s——不提速是 **1e11 步级**、提速到 0.1s 求解时间仍千万步级（外部评审原估"几十万步"低了 2~6 个数量级） | **固定质量缩放（目标 Δt~1e-7 s）是必需品非可选项**；sliver 单元在 Gmsh 端设最小尺寸下限（不靠无脑缩放）；监控质量增加因子 + ALLKE/ALLIE |
| 6 | 离散刚体压板有节点、贡献动能，污染能量监控 | 压板用**解析刚体**（analytical rigid） |
| 7 | 细碎 marching-cubes STL 直入 Fluent Meshing wrap 易漏面/自相交 | 先 **OCP(OpenCASCADE) 缝合成 SOLID STEP**，管线设水密性 gate（实战项目 tpms-cold-plate-cfd-automation 的教训） |
| 8 | translational periodic 要求进出口面网格**共形匹配**，prism 层在周期面也要对齐 | 这是设计管线前就要知道的约束（决定 CFD 网格生成方式），事后无法调试解决；骨支架低 Re 层流下此坑权重下降但共形要求不变 |
| 9 | **有限域提取周期结构时，marching cubes 把穿越数据边界的固相切成开放面**（不水密、连通域碎裂、体积对不上）——2026-10-28 宿舍实测首跑即触发（watertight=False/comp=2/孔隙率偏 37pp） | 盒 SDF 相交封闭：g=max(c−f, sdf_box)，等值面 g=0 在盒壁自然闭合；**数据域必须比盒外扩 ≥2 格**（盒面落在数据边界上等值面照样被切断，二次实测触发）；marching 面朝向需体积分量符号自动校正。修复后 k2p60 实测：水密+单域+孔隙率偏差 0.90pp（sim/p0_generate.py）。附带发现：k3p75 高孔隙下盒内固相真实断裂 comp=2——坑 3 连通域检查非摆设 |

## 4. 决策记录

**三问决策表**（问题 2 已由课题背景回答）：
1. sheet vs network → **sheet 型**（已确认）：坑 1~3 全额生效，生成端纪律必须做。
2. 吸能 vs 换热 → **骨支架：力学（模量匹配骨骼/抗压）+ 流体（渗透率/WSS/营养输运）两条都要**；管线几何端共用，两支路互不干扰。
3. 有无打印实验 → 待定；有则加可制造性约束（钛 LPBF 壁厚 ≥0.3~0.4mm 保守取 0.4，聚合物 DLP 更薄）、knock-down 闭环、**称重法相对密度**对齐名义模型。

**骨支架定标表**：
| 项 | 定标 |
|---|---|
| 力学模型形态 | 试件级压缩（Ø 圆柱多胞）对标体外实验；Explicit 压溃纪律按需保留 |
| 流体模型形态 | 单胞 + 平移周期边界（骨支架文献大量先例），层流小网格量 |
| 设计指标 | 多目标：模量匹配 × 渗透率 × WSS 窗口 × 比表面积——天然适合参数扫描自动化 |

**软件选型理由**：
- 不选 HyperMesh：工业界标准但学术 TPMS 少数派、无 CAD 特征清理量大、难脚本化。
- 力学选 Gmsh：与 Python 生成端同语言同环境、HXT 对复杂 STL 快且省、免费；代价是对 STL 质量敏感需调参。
- 流体首选 COMSOL（骨支架低 Re 层流+多物理场主场，MPh 可自动化）；Fluent+PyFluent 为对齐文献主流的备选。两者皆远优于 OpenFOAM 体验。
- 后处理 pyvista：可复现批量出版图。

## 5. GitHub 资源（2026-10-28 已核实存在）

| 用途 | 仓库 |
|---|---|
| 微结构生成+Gmsh 周期网格+Abaqus 均匀化（学术最主流） | https://github.com/3MAH/microgen |
| 端到端 CFD 自动化（隐式场→OCP STEP→PyFluent FT 网格→CHT，README 含实战铁则） | https://github.com/jiazekong/tpms-cold-plate-cfd-automation |
| 中文 TPMS→ABAQUS 力学全流程（Gyroid vs Schwarz-P 拉压对比） | https://github.com/super32125/Finite-Element-Analysis-of-TPMS-Lattice-Structures |
| Fluent 官方 Python 接口 | https://github.com/ansys/pyfluent |
| Abaqus PBC 插件（引用最多） | https://github.com/smrg-uob/PeriodicBoundaryCondition |
| TPMS 体素法 Abaqus 均匀化脚本 | https://github.com/FayyazNo/RVE-homogenization-of-TPMS-structures |
| TPMS 生成器（MATLAB，Al-Ketan 出品，引用最多） | https://github.com/MSLattice/MSLattice_windows |
| STL 修复/水密校验 | https://github.com/mikedh/trimesh · https://github.com/pyvista/pymeshfix |
| 网格格式转换（.inp/.msh 互转） | https://github.com/nschloe/meshio |
| 后处理/可视化 | https://github.com/pyvista/pyvista |
| COMSOL Python 接口 | https://pypi.org/project/mph/ |
| 免许可证 FEM 备选闭环（microgen 配套） | https://github.com/3MAH/fedoo |

## 6. 关键文献/资料

- TPMS AM 综述（软件使用统计）：https://pmc.ncbi.nlm.nih.gov/articles/PMC12736839
- TPMS 压缩建模方法学（Explicit 统计陈述）：https://pmc.ncbi.nlm.nih.gov/articles/PMC11766584
- 均匀化方法学最全（microgen+Gmsh+Abaqus PBC）：https://www.mdpi.com/1996-1944/18/23/5357
- Abaqus 准静态专题：https://caeassistant.com/blog/quasi-static-analysis-in-abaqus
- PBC 权威指南（3DS 官方 PDF）：https://www.3ds.com/assets/invest/2023-12/applying-periodic-boundary-conditions-finite-element-analysis-14.pdf
- Fluent 做 TPMS 换热器实例（CEA，k-ω SST）：https://cea.hal.science/cea-04896410
- 骨支架渗透率（ABAQUS 路线先例，TU/e）：https://research.tue.nl/en/publications/permeability-versus-design-in-tpms-scaffolds
- sheet-TPMS 力学标杆（Al-Ketan & Abu Al-Rub）：10.1002/adem.201800094；能量吸收标杆（Zhang & Feih 2018）：10.1016/j.addma.2018.06.012

## 7. 待验证 MVP（三阶段）

1. **Phase 1 几何水密性验证**：✅ **2026-10-29 修订版全绿**（经反重力 T1 评审修复：坐标系重构为整数周期盒+盒内统计阈值，孔隙率偏差 0.90pp→**0.02pp**；.inp 过滤 2D 面单元（旧版实测混入 CPE6=ABAQUS datacheck 必挂）+ C3D10MH→C3D10 规范化；lmax 生效+minSICN 质量审计上线，212,209 C3D10 实测 minSICN min=0.057/0 个<0.05/p50=0.797，tet10 体积符号 0 非正 PASS；三阶段几何审计 meshfix 侵蚀 -0.00%）。脚本 `sim/p0_generate.py`、`sim/p1_mesh.py`、`sim/p1_geom_check.py`。过程中新增坑 9（见 §3）与铁律：Gmsh 对数万面片 MC 网格禁用 classifySurfaces(forceParametrizable=True)（用 createTopology discrete 路线）；trimesh 5.0 无 remove_degenerate_faces（用 process(validate=True)）；pymeshfix 0.18 拒收 TrackedArray（np.array() 转）；meshio tetra10→C3D10MH 硬编码 + triangle6→CPE6 混入（写 inp 必须只传 tet10 + 类型文本规范化）。
2. **Phase 2 力学线打通**：单胞 → Gmsh C3D10/C3D10M → .inp → ABAQUS（Static 与 Explicit 准静态各验一次）。.inp 产物约 20~80MB，git 不适合传输——两机传递通道待定（文件中心 SMB / 重新在工位跑 p0+p1 即可复现同网格）。
3. **Phase 3 流体线打通**：负空间流体域提取 → 周期边界网格 → COMSOL/Fluent 算渗透率。

## 8. 开放问题（下次会话优先回答）

1. 压缩仿真现状：弹性段取模量，还是平台段/压溃？（决定 Explicit 纪律是否进管线）
2. 打印工艺与材料（钛 LPBF / 聚合物 DLP / PEEK...）？（决定壁厚下限与 μCT 对标路线）
3. 力学线的具体形态确认：现"ANSYS 划网导 mesh"一环中，网格是实体四面体还是面网格（壳单元）？若实际是壳单元（S4R）策略需重写（本方案按 sheet 型片式结构 + C3D10 实体单元理解）。
