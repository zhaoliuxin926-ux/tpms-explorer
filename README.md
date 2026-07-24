# 工作区 · 总导航

本工作区并排放着**两个独立项目**，外加开发 / 验证辅助目录。

---

## 🅰 主项目：TPMS 结构参数探索器
> 个人长期维护的独立开源项目。可交互的三重周期极小曲面（TPMS）教学工具，帮初学者快速入门。
> 完整项目已归入独立子目录 `tpms/`，请直接看 **[`tpms/README.md`](tpms/README.md)**（项目中枢）。

```
tpms/
├── web/           单文件版主交付（index.html / app.html，双击即开）
├── tpms-platform/ 工程化进阶版（Vite + TS，独立子工程）
├── prototypes/    MATLAB 早期原型（已归档）
└── agent_memory/  项目记忆（gitignored）
```

- 单文件版：`tpms/web/index.html` 落地页 → `tpms/web/app.html` 主应用（Three.js CDN，无构建）。
- 工程版：`cd tpms/tpms-platform && npm install && npm run dev` → http://localhost:5173。
- 已通过多轮审计：`tsc` 0 错 / `vite build` 成功 / 浏览器冒烟 0 报错。

---

## 🅱 副项目：Claude Code 工作流全景架构图
> 与 TPMS **无关**。单文件、零依赖、可离线的工作流可视化工具（阶段 → 节点 → 连线），支持编辑 / 撤销 / CRDT 多人协作光标。
- `claude-code-workflow/` —— 主交付 + 协作后端 + 测试，详见其内 `README.md`。

---

## 🗂 开发 / 记忆辅助（不参与交付）
- `tpms/agent_memory/` —— 项目进度 / 上下文 / 缺陷 / 审计报告（gitignored）
- `tpms/.verify/` —— Playwright 验证脚本
- `tpms/.diag/` —— 诊断 / 探针脚本
- `tpms/.zcode/plans` —— 计划文件
- `.git` / `.gitignore` / `.workbuddy/`

---

## 📌 备注
- TPMS 主项目已整体迁入 `tpms/` 子目录（2026-07-24）：单文件版的 `index.html` / `app.html` / `shots/` 与工程版 `tpms-platform/` 均在其内，结构清爽、独立管理。
- 根目录仅保留工作区导航 `README.md` 与副项目 `claude-code-workflow/`。
