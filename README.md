# 工作区 · 总导航

![release](https://img.shields.io/badge/release-v2.2.0--endplates--cfd-2563eb)
![ci](https://img.shields.io/badge/CI-5%20gates%20%C2%B7%20250%2B%20assertions-16a34a)
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
│   ├── WORKFLOW_GUIDE.md   📖 科研与增材制造实战指南（AM 压缩 / OpenFOAM CFD / 脚本复现）
│   └── platform/           工程版在线部署
└── tpms/
    ├── tpms-platform/ 工程化进阶版（Vite + TS，独立子工程）
    ├── prototypes/    MATLAB 早期原型（已归档）
    └── agent_memory/  项目记忆（gitignored）
```

### 科研与增材制造特性矩阵（v2.2.0）

| 能力 | 说明 | 验证 |
|---|---|---|
| 🔬 网格管线 v2 | 边穿越键提取 + 切向 Taubin + 解析 Newton 投影，构造性水密 | 29 案例审计门，开放边 = 0 |
| 🧱 加载端板 | 压缩试验防接触早溃的实心端板（0~3 mm，体素场融合） | 端板审计 26 断言，体积增量实测 ≤1.79% |
| 🌊 CFD Multi-Patch STL | inlet/outlet/sides/wall 四区块自动分类，OpenFOAM 直读 | sim_export_check 13 断言 |
| 📐 曲率热力图 | 平均/高斯曲率（数值 Hessian）+ 场权重/高度着色 | 数值健壮性断言（混叠工况无 NaN） |
| 🐍 脚本复现 | Python(PyVista)/MATLAB 自包含重建脚本，与平台逐点对齐 | parity_math 74/74 |
| 🔗 分享与审计 | URL 全量恢复（含端板）+ 5 道 CI 门禁 250+ 断言 | `npm run test:all` |

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
