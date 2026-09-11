# TPMS 学习路径 —— 从"看不懂"到"能用它做科研"

> 面向第一次接触三周期极小曲面（TPMS, Triply Periodic Minimal Surfaces）的同学。
> 设计原则：**每一步都动手、都有自检标准**——不需要先啃微分几何，形状先于公式，理解先于精确。
> 全程只用本项目的在线版（零安装），专业阶段才需要工程版。

---

## 为什么 TPMS 难入门（我们先把门槛拆开）

| 门槛 | 表现 | 本路径的拆法 |
|---|---|---|
| 数学语言 | "平均曲率为零""三周期"像天书 | 肥皂膜类比 + 只从一个公式开始 |
| 看不见形状 | 公式和 3D 形状对不上号 | 交互沙盘：拖滑块，公式与形状同步变 |
| 工程量抽象 | 孔隙率、比表面积、迂曲度不知道怎么用 | 预设场景（骨支架）+ 文献数值带 |
| 制造/仿真鸿沟 | "做出来了然后呢" | STL 直打印 + Abaqus/OpenFOAM 导出直通 |

---

## 第 0 阶 · 5 分钟：先玩，别学

**做什么**：先看 30 秒概念动画——[转动的截面：Gyroid 是怎么生成的](animations/tpms-intro.html)（可拖滑块手动扫描切片），
然后打开在线版（仓库 `docs/` 即 GitHub Pages 首页，本地则双击 `docs/index.html` → "开始探索"）。
选 **Gyroid**，拖**孔隙率**滑块，看结构从实变空、再反转。

**你刚看到的就是 TPMS**：一个曲面在空间中无限延伸，在**三个方向上都周期性重复**，并且像肥皂膜一样把表面张力"拉平"——数学上叫**平均曲率为零（极小曲面）**。肥皂泡拉出的膜就是天然的极小曲面，TPMS 只是把它变成了可编程、可重复的工业版本。

**自检** ✅：能用自己的话说出"三周期"和"极小"分别指什么。
（答不上也没关系，第 1 阶会再遇到它。）

---

## 第 1 阶 · 30 分钟：拆解公式——每一项都在"捏"形状

**做什么**：打开**公式权重面板**（单文件版特色功能）。

Gyroid 的隐函数只有一行：

```
F(x, y, z) = sin x·cos z + sin y·cos x + sin z·cos y
```

曲面就是 F = 0 的等值面。逐项实验：

1. 把某一项权重拖到 0 → 观察形状"塌"掉一角：**每一项负责一个方向的周期结构**。
2. 拖动**等值常数 C** → 曲面变胖/变瘦：这就是**孔隙率的数学源头**（项目内置二分搜索自动反解 C，所见即所得）。
3. 切换 Schwarz P（`cos x + cos y + cos z`）、Diamond 等其他曲面 → 体会"换公式 = 换结构族"。

**顺手点开术语解释卡**：遇到"等值面/周期/孔隙率"随时查，不用去翻教材。

**自检** ✅：
- 能解释"为什么叫极小"——每一点的平均曲率为零，曲面上没有哪个方向更弯，像肥皂膜一样；
- 能预测"把三项权重改成不相等会发生什么"，然后拖滑块验证。

---

## 第 2 阶 · 2 小时：工程量——从形状到"有用"

**做什么**：切到**预设场景卡**，选**仿生骨支架**（卡片会解释"为什么这样配"）。

需要建立的三个核心直觉（也是文献里的数值带）：

| 工程量 | 一句话理解 | 骨支架文献带 |
|---|---|---|
| 孔隙率 p | 留给组织长入的空间 | ~50–80%（平台教学词条采用 70–85% 常用子带） |
| 孔径 | 细胞能住多大的房子 | ~300–800 µm |
| 等效模量 E* | 多孔后还剩多少刚度 | 由 Gibson-Ashby 标度 E*/Es ≈ C1·ρ̄² 决定（ρ̄ = 1−p） |

**动手**：
1. 把孔隙率从 50% 拖到 80%，观察面板上等效模量掉得多快——**平方级衰减**（ρ̄²），这就是多孔设计的核心代价曲线；
2. 切换"实体网络 / 等厚双壳 / 梯度双壳"拓扑，看同一公式长出不同家族；
3. 试圆柱容器与梯度结构——这是真实零件（牙根、椎间融合器）的雏形。

**自检** ✅：
- 给你"65% 孔隙率的 TC4 gyroid"，能口算 E* ≈ 0.38 × 0.35² × 110 ≈ 5.1 GPa；
- 能说出骨支架为什么要这个孔隙率窗口（营养输送 vs 承载的折中）。

> 专业旁路：命令行一条命令也能算——`node tpms/agent/tpms.mjs estimate --type gyroid --porosity 0.65 --material tc4`（前置：`cd tpms/tpms-platform && npm install`，CLI 依赖工程版的本地依赖树）。
> 进阶：`node tpms/agent/tpms.mjs mesh --type gyroid --porosity 0.65 --out scaffold.stl` 直接产出**打印级水密 STL**（命令内建水密门：开放边/非流形/退化面任一非零即拒绝交货）。

---

## 第 3 阶 · 半天：动手做出来、算起来

**做什么**：装工程版，走通"参数 → 几何 → 制造/仿真"全链路。

```bash
cd tpms/tpms-platform && npm install && npm run dev   # http://localhost:5173
```

1. **3D 打印**：导出 STL——网格管线构造性水密（28 案例审计，开放边 = 0），切片软件直接吃；
2. **仿真**：导出 Abaqus INP（C3D8 体网格 + 载荷步）或 OpenFOAM polyMesh——免 snappyHexMesh 建模；
3. **科研复现**：导出 Python(PyVista)/MATLAB 脚本，审稿人可逐点复现你的几何。

**自检** ✅：
- 导出的 STL 在你的切片软件里无报错、无破面；
- 能说出平台里的力学指标是**解析工程估算**（快、适合设计迭代），要"论文级精确"该走哪条路（工程版 CAE 验证链 / Abaqus 直通）。

---

## 第 4 阶 · 进阶（按需）：直接当生产工具用

- **《TPMS 科研与增材制造实战指南》**（[WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md)，35 章）：端板压缩试验、snappyHexMesh 配置、RVE 均质化、红队极端工况、DICOM 骨计量、G-code 直出——专业流程逐章可查；
- **验证文化**：本项目 41 道 CI 门禁、1000+ 断言守着每条公式与导出——你改参数不必怀疑"算得对不对"，先例见 `tpms/.verify/`；
- **逆向设计**：知道目标模量/渗透率，让引擎反解最优构型（工程版）。

**自检** ✅：能用 WORKFLOW_GUIDE 独立跑通一次"设计 → 仿真 → 对比文献"的完整验证。

---

## 外部资源（按学习顺序）

**综述（建立全景）**
- [TPMS Porous Structures: From Multi-scale Design to Manufacturing](https://iopscience.iop.org/article/10.1088/2631-7990/ac5be6)（IOP, 2022，引用 1000+，多尺度设计与制造全景）
- [An Overview of Additive Manufacturing of TPMS](https://pmc.ncbi.nlm.nih.gov/articles/PMC12736839/)（PMC, 2025，增材制造视角综述）

**视频（看别人怎么建模）**
- [Gyroid Minimal Surface — Grasshopper Tutorial](https://www.youtube.com/watch?v=mhYrVlvbN4k)（从等值面方程逐步建模）
- [Gyroid in Under 10 Minutes](https://www.youtube.com/watch?v=QskCGfV23fg)（免插件快速复现）
- [nTop：How to model a gyroid](https://support.ntop.com/hc/en-us/articles/360035831653-How-to-model-a-gyroid-using-the-Periodic-Lattice-block)（工业级 TPMS 点阵工具的官方教程）

**骨支架方向（你的应用落点）**
- [TPMS-Based Scaffolds for Bone Tissue Engineering](https://pmc.ncbi.nlm.nih.gov/articles/PMC10611970/)（2023：gyroid 是最有前景的支架微架构）
- [Comparing Ceramic FKS and Gyroid TPMS Scaffolds](https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/10.3389/fbioe.2024.1410837/full)（Frontiers, 2024）
- [Ti6Al4V Gyroid & Diamond Scaffolds 力学表征](https://www.mdpi.com/2306-5354/9/10/504)（MDPI, 2022：孔隙率-力学关系实验数据）

---

## 常见误区（前人踩过的坑）

1. **"等值面 = 网格"**：TPMS 是连续曲面，网格只是它的采样重建——网格质量有专门审计（水密/定向/体积偏差），别拿渲染截图当几何。
2. **"孔隙率 65% → 刚度 65%"**：错。弯曲主导的开孔结构是平方级衰减（ρ̄²），这正是轻量化的物理与代价。
3. **"平台算的就是 FEA"**：平台的物理指标是**解析工程估算**（文献标定，秒级出结果，适合设计空间探索）；论文级精确走工程版 CAE 验证链。两者口径在界面与文档中始终分开。
4. **改公式不跑回归**：本项目铁律——改公式/导出逻辑先跑 `parity_math.mjs`（全部内置曲面三实现互证，2026-09 起 20 族）。

---

*本路径对应平台版本 v7.0.0。发现讲得不清楚的步骤，欢迎提 issue——这份文档本身也按"自检可过"标准维护。*
