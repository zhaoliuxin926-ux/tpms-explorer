# TPMS Explorer v3.0.0-nextgen-cae Release Notes（双语）

> 发布日期：2026-08-28 ｜ 上一版本：v2.4.0-ultimate-engine ｜ **16 道 CI 门禁 · 658+ 断言全绿**

---

## 中文

v3.0 聚焦「**计算力学仿真闭环**」：从三维设计工具跨入 CAE 前处理 + 力学仿生设计。五大特性：

### ⚡ 阶段 I：WebGPU 计算管线
- 「标量指令 IR」单一语义源，双后端渲染：WGSL compute shader（真实 GPU）与 JS f64 寄存器机（审计对拍内核）
- 覆盖 8 类内置 TPMS、AST 自定义方程、四向波前 Hybrid；GPU 只接管 V 场填充热循环，网格化仍走 Worker 管线
- 无 navigator.gpu / 适配器失败 / 管线报错 → 无感回退 CPU（本仓库：seq + cacheKey 双守卫防陈旧覆写）
- 门禁 13 `webgpu_parity_audit`（34 断言）：万点对拍 **0.00e+0**、opcode 双后端完备、模板逐字同步、端到端水密

### 🧩 阶段 II：周期性 RVE / PBC 网格生成器
- 回卷复制节点层架构：节点层 R ≡ 层 0 位级复制；跨 {R−1,0} 层对 quad 恒定 +2π 平移规则（周期一致性由构造保证）
- 跨界 quad Sutherland–Hodgman 平面裁剪 + 缝合 Canonical 吸附 + 容差焊接
- PBC 配对表（三对面 100% 覆盖 + 12 棱/8 角等价类）随 JSON sidecar 导出
- 门禁 14 `periodic_rve_audit`（88 断言）：**3×3×3 拼接内部 100% 水密**、v_right−v_left=(L,0,0) ≤1e-5、五重可行性守卫

### 🏗️ 阶段 III：原生 CAE 体网格导出
- 【Abaqus C3D8 INP】：体素六面体 + NSET_BOTTOM/TOP + 三向 PBC 节点集 + 材料/单轴压缩载荷步模板
- 【OpenFOAM polyMesh ZIP】：流道流体域五件套直通求解（免 snappyHexMesh）；owner<neighbour、面法线定向、patch 连续
- 门禁 15 `cae_mesh_audit`（46 断言）：面闭合、Jacobian=h³、cell-face 关联精确守恒、ZIP CRC32 逐条目

### 🦴 阶段 IV：主应力张量迹线引导场（Wolff 定律）
- 三工况解析应力张量（三点弯曲/悬臂/扭转）+ 3×3 Jacobi 特征分解 → 主轴各向异性拉伸（晶胞沿主应力迹线伸长 α）
- 壳模式高应力侧孔隙板收窄（固相致密化）；von Mises 应力云图着色；URL/CAE/Python/MATLAB 全链路同源
- 行为级红测：vm 五分桶相对密度 [0.335→0.628] 严格递增（首版方向反转被此断言抓获并修正）

### 🌿 阶段 V：多级分形分级 TPMS
- F = F_macro + λ·F_micro(N·x)：宏观承载/骨长入 + 微孔传质/超高比表面积
- coarea MC 双重比表面积分离估算 + 微孔连通率 BFS（实测 100% ≥ 95% 门限）
- 门禁 16 `hierarchical_audit`（18 断言）：分级水密、λ=0 退化、S 随 N 增长、应力单调性

### 工程纪律
- 16 道 CI 门禁矩阵（新增 4 门）658+ 断言全绿；Ubuntu/Windows/macOS 三平台矩阵
- 每阶段 commit→push→docs/platform 双部署；`agent_memory/` 全程记录四轮真 bug 解剖（周期平移不一致/SH 共享引用污染/复制层双发射/缝合抖动）与 shell「孔隙板宽度」语义定案

---

## English

v3.0 closes the loop on **computational mechanics**: from 3D design into CAE preprocessing and mechanics-inspired design.

- **Stage I — WebGPU pipeline**: a single scalar-instruction IR rendered to both WGSL compute shaders and a JS f64 register VM (audit twin). GPU accelerates only the voxel-field hot loop with graceful CPU fallback. Gate 13: 10k-point parity **0.00e+0**.
- **Stage II — Periodic RVE / PBC**: wrapped-node Surface Nets with plane clipping; seam vertices snap to ±L/2 exactly; PBC pair tables (faces/edges/corners) exported as JSON. Gate 14: **3×3×3 tiling 100% watertight** on interior seams, v_right−v_left = L within 1e-5.
- **Stage III — Native CAE volumetric meshes**: Abaqus C3D8 INP (node sets + compression step) and OpenFOAM polyMesh (5-file zip) straight to solver — no snappyHexMesh. Gate 15: face closure, Jacobian = h³, owner<neighbour, orientation, CRC32.
- **Stage IV — Principal-stress-guided fields (Wolff's law)**: analytic stress presets + Jacobi eigen frames stretch cells along principal stress lines; shell densification at high von Mises; behavioral red-test enforces monotone relative density [0.335→0.628].
- **Stage V — Hierarchical TPMS**: F = F_macro + λ·F_micro(N·x) with coarea-estimated dual specific surface area and ≥95% micro-channel connectivity (measured 100%).

**Quality**: 16 CI gates, 658+ assertions, 3-platform matrix. See `WORKFLOW_GUIDE.md` chapters 13–16 for Abaqus/OpenFOAM/stress-driven/hierarchical tutorials.
