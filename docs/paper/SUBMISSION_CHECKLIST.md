# SoftwareX 投稿清单（B-t1 收尾）

> 状态标记：✅ 完成 / ⬜ 需用户操作 / ⬜ 待办

## 材料
- ✅ 主稿：`docs/paper/latex/main.tex`（2026-09-12 对齐 v8.0-agentic-loop + 42 门 + (viii) agentic 验证层；同轮修复 v7.0 稿两处预存 LaTeX 缺陷——psmallmatrix 缺 mathtools、\doi 未定义，此前"三连编译通过"实为 nonstopmode 带错出 PDF；现 log 0 错误，PDF 4 页 126KB，pdftotext 内容验证在案）
- ✅ References：7 条 thebibliography（2026-09-06 补——原稿零引用为 desk reject 硬伤；RegionTPMS DOI 经 doi.org 核对，正文 7 处 authoryear 行内引用，pdftotext 逐条验证渲染；2026-09-12 起 \doi 经 providecommand 渲染为可点击 doi.org 链接）
- ✅ 摘要导览：`docs/paper/MANUSCRIPT.md`（与主稿同步）
- ✅ Cover letter：`docs/paper/COVER_LETTER.md` 完整稿（2026-09-12 同步 v8.0/42 门 + 第三条方法论贡献 agentic 闭环验证层）
- ✅ LICENSE：仓库根 MIT
- ✅ 可复现：`npm install && npm run test:all` → 42/42 门禁（CI 三平台矩阵 .github/workflows/ci.yml；2026-09-12 本机全量复验 + CI run 34702020524 三平台 success）
- ⬜ figures/：现有图是否覆盖新特性（定向传播前后对比图、exact 求解器流程图可加分）——建议投稿前补 1~2 张

## 需用户操作（AI 无法代劳）
- ✅ **push 仓库**（2026-09-06 完成：用户交互授权一次后 50+ commit 全部上远程；此后 push 由 AI 以入库凭据代办）
- ✅ **GitHub Actions 三平台全绿**（**HEAD 双重实证**：run 59 + run 60 三平台 success，2026-09-07；历史首绿 run 45。13 层修复全记录见 tpms/agent/ROADMAP.md "CI 三平台转绿轮"——最后一层为 verify 无限自递归挂死，两度误诊后根治）
  证据链接：https://github.com/zhaoliuxin926-ux/tpms-explorer/actions/runs/34047851986
- ✅ **repo Topics**：`tpms` `lattice` `bone-scaffold` `webgpu` `additive-manufacturing`（经 GitHub API 设置并公开复核）
- ⏸ **投稿整体搁置（2026-09-07 用户决策）**：项目优先继续打磨优化，不急于投稿。搁置项包括：署名三项（作者拼写/单位行/LICENSE 版权行——建议投稿前与导师确认单位署名规范）、Editorial Manager 注册提交、投稿号回填；软件确认 SoftwareX 为完全开放获取（APC 以官网为准）后再做预算决定。重启时从本清单续走即可，所有材料不会过期。
- ✅ `https://github.com/xxx/tpms` 占位链接 → 已改真实地址 `zhaoliuxin926-ux/tpms-explorer`（MANUSCRIPT.md，2026-09-06）

## 提交前终检
- [x] GitHub Actions 三平台全绿（**run 59+60 双重 success @HEAD b6e5054**，2026-09-07）：https://github.com/zhaoliuxin926-ux/tpms-explorer/actions/runs/34047851986
- [ ] main.pdf 人眼通读一遍（图表编号、引用、作者信息）——投稿重启时做
- [x] 仓库根 `git status` 干净（2026-09-07 复核）
