# 项目总览（PROJECT INVENTORY）

> 生成：2026-09-23 · 产品版本 **v1.0.3**（稳定序列）· 仓库 `zhaoliuxin926-ux/tpms-explorer`  
> 口径：功能标签写「原型期 vN」；产品自称只用 v1.0.x。

---

## 1. 这是什么

**TPMS Explorer** — 浏览器端三周期极小曲面（TPMS）生成式设计与多物理场分析平台 + LLM Agent 安全闭环。

- 受众：骨支架 / 轻量化 / 换热催化等增材制造与科研
- 交付形态：
  | 形态 | 入口 | 定位 |
  |---|---|---|
  | 教学版单文件 | `docs/app.html` | 8 族经典，file:// 双击，功能冻结 |
  | 工程版 SPA | `tpms/tpms-platform` → `docs/platform/` | 24 族 + 全链仿真/导出 |
  | CLI / Agent | `tpms/agent/` | 脚本化、门禁、LLM tool-calling |
  | Pages | https://zhaoliuxin926-ux.github.io/tpms-explorer/ | 在线零安装 |

---

## 2. 目录地图

```
tpms-explorer/
├── README.md / README_EN.md      # 双语门面
├── CONTRIBUTING.md               # 贡献/PR/issue 剧本
├── BENCHMARKS.md                 # 实测基准
├── PHYSICAL_TESTING_PROTOCOL.md  # ISO 13314 试样与压缩协议
├── LICENSE (MIT)
├── docs/
│   ├── index.html / app.html     # 落地页 / 教学版
│   ├── platform/                 # 工程版部署产物（无 .map）
│   ├── QUICKSTART.md             # 5 分钟三 Demo
│   ├── WORKFLOW_GUIDE.md         # 36+ 章实战指南（TOC 1–36，另有零散章）
│   ├── LEARNING_PATH.md          # 学习路径
│   ├── HONESTY_BOUNDARIES.md     # 诚实边界表（自动生成）
│   ├── regression-matrix.md      # 拦截器覆盖矩阵
│   ├── LAB_ONE_PAGER.md          # 打印/试验工位卡
│   ├── fit-report.mock.md        # 曲线示意（非 ISO 正式）
│   ├── PROJECT_SUMMARY.md        # 项目摘要
│   ├── blog/ + publish/          # 技术博客 + 粘贴版
│   ├── career/interview-pack.md  # 求职弹药
│   ├── paper/                    # SoftwareX 材料（投稿搁置）
│   └── RELEASE_NOTES_v*.md       # v2.4–v9.2 档案 + v1.0.0–1.0.3
├── specimens/                    # 物理试样 STL（gitignored）
└── tpms/
    ├── tpms-platform/            # Vite+TS 源码（main.ts 等）
    ├── agent/                    # CLI、Agent、工具脚本
    ├── .verify/                  # 71 个审计/门禁脚本
    └── agent_memory/             # 进度/上下文/缺陷/计划（gitignored）
```

---

## 3. 能力矩阵（工程版）

| 域 | 能力 | 状态 |
|---|---|---|
| 几何 | 24 族 level-set；水密 Surface Nets + MT 双提取器；exact 孔隙率 | 完整 |
| 构型 | hybrid / isoGrad / region / radial-grad / C5 保形容器 | 完整（互斥硬拒） |
| 导出 | STL/GLB/3MF/VTK/VTI/CFD STL/RVE/INP/OpenFOAM/CAE 包/脚本/BibTeX/JSON/**G-code** | 完整（G-code 单壁+扫描填充） |
| 力学 | Gibson-Ashby、弹塑性压溃、数字孪生、屈服包络 | 完整/半（k≥2 求解域见边界表） |
| 流体/热 | NS 渗流、LPBF 热-力 | 完整（研究级口径） |
| 优化 | 逆向设计、水平集拓扑、组织长入、声子能带、SIREN 神经场 | 完整/半（部分拒 custom/C2 族） |
| 试验 | ISO 13314 反演 UI、fit-batch 示意、上机卡 | 待真实 CSV |
| Agent | NL→schema 拦截→CLI→有界修复（M0–M5） | 完整（回归见矩阵） |

互斥与诚实边界：见 `docs/HONESTY_BOUNDARIES.md`（13 条，由 `bugs.md` 重生）。

---

## 4. 质量体系

| 层 | 内容 | 当前值 |
|---|---|---|
| 顶层调度 | `tpms/.verify/run_ci_suite.mjs` | ****45 门**（main 现态；**tag v1.0.3 时为 44**，docs_consistency 于 tag 后入列） |
| 断言示例 | parity 332 / schema 106 / webgpu 119 / docs_consistency **68** | GUARD 锁下限 |
| 三平台 | GitHub Actions Ubuntu/Windows/macOS | push 即跑 |
| 快检 | `schema_check --fast`（~28s，GUARD 40）+ matrix + boundary + docs + sync-publish | ~1 min |
| 拦截覆盖 | `regression_matrix.mjs` 注入合法/非法 toolCalls | 3×6 绿 |
| 博客同源 | `sync-publish.mjs --check` | 粘贴版漂移 exit 1 |
| 版本哨兵 | 导出物 v1.0.3 / 落地页「原型期」/ fcky / fit 诚实 | docs 门禁内 |

**宣称纪律**：命令可指认；性能 grep 调用点；数字以 SCHEDULE/GUARD 为准（见 CONTRIBUTING）。

---

## 5. LLM Agent

- Provider：`openai`（含智谱兼容）/ `ollama` / `mock`
- 拦截：`validateToolCalls` 逐槽位 schema；非法 exit 2
- 回归：`llm_regression.mjs`（37 条，需密钥）；`regression_matrix.mjs`（离线拦截矩阵）
- 历史战绩口径：**须带样本量**（如 glm-5.3-flash 单轮 37/37，n=1；复测 36/37）

---

## 6. 文档与转化资产

| 资产 | 路径 | 状态 |
|---|---|---|
| 5 分钟上手 | `docs/QUICKSTART.md` | 可用 |
| 实战指南（TOC 1–36） | `docs/WORKFLOW_GUIDE.md` | 可用 |
| 面试包 | `docs/career/interview-pack.md` | 中英对称 |
| 博客×2 | `docs/blog/` + `publish/` | 粘贴就绪，**未发布** |
| SoftwareX | `docs/paper/` | 材料齐，**投稿搁置** |
| 社交图 | `docs/screenshots/social-preview.png` | **未上传** |

---

## 7. 当前状态与余项

**已完成（本轮）**：版本纪元对齐 · G-code UI+工艺 · 教学 toast · 文案统一 · 三主线交付 · 红队已修项与登记余险 · 路径/超时硬化。

**待用户**：社交图、发博客、论文/试样拍板、试验 CSV。

**待密钥/实机**：llm_regression 真实三轮 · export-specimens 全量 18 件 · 真机床 G-code。

**明确不做**：门禁计数洁癖、main.ts 为拆而拆、无需求扩族、未拍板投稿。

---

## 8. 一分钟命令卡

```bash
# 安装与开发
cd tpms/tpms-platform && npm install && npm run dev

# CLI 出件
node tpms/agent/tpms.mjs mesh --type gyroid --porosity 0.75 --resolution 64 --out demo.stl

# 快检（约 1 min）
node tpms/agent/schema_check.mjs --fast
node tpms/agent/regression_matrix.mjs --rounds 3
node tpms/agent/gen-boundary-table.mjs --check
node tpms/.verify/docs_consistency_check.mjs
node tpms/agent/sync-publish.mjs --check

# 全量门禁（6–10 min）
cd tpms/tpms-platform && npm run test:all
```
