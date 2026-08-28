# 工作区 · 总导航

![release](https://img.shields.io/badge/release-v3.0.0--nextgen--cae-2563eb)
![ci](https://img.shields.io/badge/CI-16%2F16%20gates%C2%B7658%2B%20assertions-16a34a)
![platform](https://img.shields.io/badge/CI%20matrix-Ubuntu%20%C2%B7%20Windows%20%C2%B7%20macOS-8b5cf6)
![watertight](https://img.shields.io/badge/STL-watertight%20100%25-16a34a)
![license-note](https://img.shields.io/badge/status-独立开源作品-8b5cf6)

本工作区只有一个主项目，外加开发 / 验证辅助目录。

---

## 🅰 主项目：TPMS 结构参数探索器
> 个人长期维护的独立开源项目。可交互的三重周期性极小曲面（TPMS）教学工具，帮初学者快速入门。
> 完整项目已归入独立子目录 `tpms/`，请直接看 **[`tpms/README.md`](tpms/README.md)**（项目中枢）。

```
（仓库根）
├── docs/          单文件版主交付（GitHub Pages 源目录，index.html / app.html，双击即开）
│   ├── WORKFLOW_GUIDE.md   📖 科研与增材制造实战指南（AM/CFD/脚本/AST 沙箱/空间映射/RVE/红队矩阵）
│   └── platform/           工程版在线部署
└── tpms/
    ├── tpms-platform/ 工程化进阶版（Vite + TS，独立子工程）
    ├── prototypes/    MATLAB 早期原型（已归档）
    └── agent_memory/  项目记忆（gitignored）
```

### 科研与增材制造特性矩阵（v3.0.0-nextgen-cae）

| 能力 | 说明 | 验证 |
|---|---|---|
| 🔬 网格管线 v2 | 边穿越键提取 + 切向 Taubin + 解析 Newton 投影，构造性水密 | 29 案例审计门，开放边 = 0 |
| 🧱 加载端板 | 压缩试验防接触早溃的实心端板（0~3 mm，体素场融合） | 端板审计 26 断言，体积增量实测 ≤1.79% |
| 🌊 CFD Multi-Patch STL | inlet/outlet/sides/wall 四区块自动分类，OpenFOAM 直读 | sim_export_check 13 断言 |
| 📐 曲率热力图 | 平均/高斯曲率（数值 Hessian）+ 场权重/高度着色 | 数值健壮性断言（混叠工况无 NaN） |
| 🐍 脚本复现 | Python(PyVista)/MATLAB 自包含重建脚本，与平台逐点对齐 | parity_math 74/74 |
| 📦 工业格式导出 | 彩色 GLB（顶点色）+ 3MF（mm 原生/端板元数据/单位声明） | industrial_export_audit 12 断言 |
| 🌀 三向迂曲度 τ | 26 连通 Dijkstra 几何迂曲度（壳层排除口径）+ Zener 各向异性比 | micro_physics_audit 17 断言 |
| 🔗 分享与审计 | URL 全量恢复（含端板/混合/映射/应力/分级）+ **16 道 CI 门禁 658+ 断言**（三平台矩阵） | `npm run test:all` |
| 🧮 自定义公式沙箱 | 零依赖 AST（无 eval）+ Dual Number AD 精确梯度/Hessian + NumPy/MATLAB 代码生成 | custom_equation_audit 73 断言 |
| 🌀 RVE 均质化 + E(n) 曲面 | Voigt–Reuss 精确界 + 迂曲度调制方向刚度 + 方向模量球面热力图 | homogenization_audit 13 断言 |
| 🧭 非欧度规空间映射 | 圆柱弯曲 / 环面闭合 / 双曲径向 / 应力线各向异性（顶点级保形 warp） | manifold_audit 12 断言 |
| 🥊 红队极端工况矩阵 | 100+ 案例：孔隙率/容器/长宽比/高频/鞍点/极端权重三硬指标 | redteam_matrix_audit 100/100 |
| ⚡ WebGPU 计算管线 | 指令 IR 双后端（WGSL + JS 寄存器机），体素场 GPU 并行填充，无感 CPU 回退 | webgpu_parity_audit 34 断言（万点对拍 0.00e+0） |
| 🧩 周期性 RVE / PBC | wrapped 提取 + 平面裁剪，单胞缝合边 ±L 精确配对，3×3×3 拼接 100% 水密 | periodic_rve_audit 88 断言 |
| 🏗️ Abaqus / OpenFOAM 体网格 | C3D8 INP（节点集+载荷步）与 polyMesh 五件套直通求解，免 snappyHexMesh | cae_mesh_audit 46 断言 |
| 🦴 应力场引导 (Stress-Driven) | 主应力迹线各向异性 + 壳致密化（Wolff 定律），von Mises 应力云图 | hierarchical_audit E 段单调性红测 |
| 🌿 多级分形 TPMS | F=F_macro+λ·F_micro(Nx) 双重孔隙，coarea 比表面积分离 + 微孔连通率 100% | hierarchical_audit 18 断言 |

> 📝 **Release Notes**：[docs/RELEASE_NOTES_v3.0.0.md](docs/RELEASE_NOTES_v3.0.0.md)（中英双语：WebGPU/周期 RVE/CAE 体网格/应力引导/多级分形五阶段交付明细）｜[v2.4.0](docs/RELEASE_NOTES_v2.4.0.md)
>
> 📖 **实战指南**：[《TPMS 科研与增材制造实战指南》](docs/WORKFLOW_GUIDE.md)——
> 端板压缩试验流程、切片参数建议、snappyHexMesh 配置范例、PyVista 二次后处理。

- 单文件版（在线）：GitHub Pages 自动部署，访问站点首页即可。
- 单文件版（本地）：`docs/index.html` 落地页 → `docs/app.html` 主应用（Three.js CDN，无构建）。
- 工程版：`cd tpms/tpms-platform && npm install && npm run dev` → http://localhost:5173。
- 已通过多轮审计：`tsc` 0 错 / `vite build` 成功 / 浏览器冒烟 0 报错 / `npm run test:all` 5 门全绿。

---

## 🗂 开发 / 记忆辅助（不参与交付）
- `tpms/agent_memory/` —— 项目进度 / 上下文 / 缺陷 / 审计报告（gitignored）
- `tpms/.verify/` —— Playwright 验证脚本
- `tpms/.diag/` —— 诊断 / 探针脚本
- `tpms/.zcode/plans` —— 计划文件
- `.git` / `.gitignore`

---

## 📌 备注
- 目录布局（2026-07-24 起）：单文件版交付在仓库根 `docs/`（GitHub Pages 源目录），工程版源码与项目记忆在 `tpms/` 子目录（`tpms-platform/` / `agent_memory/` 等），见上方目录树。
- 根目录仅保留工作区导航 `README.md`。
