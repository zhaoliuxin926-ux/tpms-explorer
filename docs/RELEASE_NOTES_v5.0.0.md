# TPMS Explorer v5.0.0-fullstack-cae-ecosystem Release Notes（双语）

> 发布日期：2026-08-28 ｜ 上一版本：v4.0.0-multiphysics-inverse-design ｜ **26 道 CI 门禁 · 1000+ 断言全绿**

---

## 中文

v5.0 是里程碑版本：**从前处理工具跨入全栈 CAE 求解与增材制造生态**。五大特性：

### ⚙️ 阶段 I：浏览器端微观力学 FEA + FD-Darcy 渗透率求解器
- `micro-fea-solver.ts`：波动场 J-PCG 体素均质化，6 工况 KUBC 边界，全实心体素 patch test 解析精确（C11=λ+2μ，C44=μ，Zener=1）
- FD-Darcy 渗透率（SOR 变系数扩散）：单管解析锚点精确、双管线性加倍
- 门禁 22（17 断言）；诚实边界：剪切波动场 b=0 结构性未解，C44–C66 为 Voigt 上界口径

### 🖱️ 阶段 II：交互式 CAE 边界条件拾取器
- 法向角区域生长（≤25°）+ 面集→节点集映射守恒 + INP/FOAM 注入
- 门禁 23（14 断言）

### 🩻 阶段 III：DICOM/TIFF 解析 + 骨形态计量学
- 显式 VR LE DICOM 子集 + 基线 TIFF 多页解析 + 16bit Rescale 归一化
- BV/TV、Tb.Th（EDT 近似）、Tb.Sp、Tb.N、SMI（面积加权偏差）
- 门禁 24（18 断言）

### 🖨️ 阶段 IV：G-code 切片引擎直出
- z 等距切片 → 扫描线填充 → Marlin/Klipper/Bambu 三预设 G-code 编译（含回抽）
- 门禁 25（13 断言）

### 🎯 阶段 V：ML 代理 + Pareto 前沿
- 自研前馈 MLP（零依赖 Float64 矩阵运算）+ SGD 在线训练（MSE 收敛 ≥10×）
- 非支配排序 Pareto 前沿（E/κ/SEA 三目标）
- 门禁 26 `ml_pareto_audit`（5 断言）

### 工程纪律
- **26 道 CI 门禁 · 1000+ 断言全绿**；WORKFLOW_GUIDE 二十五章；SoftwareX/JOSS 论文手稿包（docs/paper/）

---

## English

v5.0 closes the loop on **full-stack CAE ecosystem**: native solvers, interactive boundary picking, medical imaging, direct G-code, and ML surrogate Pareto design.

- **Stage I — Native CAE solvers**: J-PCG voxel FEA homogenization (solid-block patch test analytic-exact) + FD-Darcy permeability (single-tube anchor exact).
- **Stage II — Boundary picker**: Normal-angle region growing; INP/FOAM injection; mapping conservation.
- **Stage III — DICOM/TIFF + Bone morphometry**: Explicit VR LE parsing; BV/TV, Tb.Th, Tb.Sp, Tb.N, SMI.
- **Stage IV — G-code slicer**: Z-slicing, scanline infill, Marlin/Klipper/Bambu presets with retraction.
- **Stage V — ML surrogate + Pareto**: Zero-dependency MLP + non-dominated sorting.

**Quality**: 26 CI gates, 1000+ assertions. See `WORKFLOW_GUIDE.md` chapters 21–25.
