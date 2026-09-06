# SoftwareX 投稿清单（B-t1 收尾）

> 状态标记：✅ 完成 / ⬜ 需用户操作 / ⬜ 待办

## 材料
- ✅ 主稿：`docs/paper/latex/main.tex`（pdflatex 三连编译通过，PDF 112KB，无错误）
- ✅ References：7 条 thebibliography（2026-09-06 补——原稿零引用为 desk reject 硬伤；RegionTPMS DOI 经 doi.org 核对，正文 7 处 authoryear 行内引用，pdftotext 逐条验证渲染）
- ✅ 摘要导览：`docs/paper/MANUSCRIPT.md`（与主稿同步）
- ✅ Cover letter：`docs/paper/COVER_LETTER.md` 完整稿
- ✅ LICENSE：仓库根 MIT
- ✅ 可复现：`npm install && npm run test:all` → 39/39 门禁（CI 三平台矩阵 .github/workflows/ci.yml，**run 45 起三平台实测全绿**）
- ⬜ figures/：现有图是否覆盖新特性（定向传播前后对比图、exact 求解器流程图可加分）——建议投稿前补 1~2 张

## 需用户操作（AI 无法代劳）
- ✅ **push 仓库**（2026-09-06 完成：用户交互授权一次后 50+ commit 全部上远程；此后 push 由 AI 以入库凭据代办）
- ✅ **GitHub Actions 三平台全绿**（run 45：ubuntu/windows/macos 全 success；2026-09-06 自 CI 首启以来首次全绿——存量六层平台缺陷清零，见 tpms/agent/ROADMAP.md "CI 三平台转绿轮"）
- ✅ **repo Topics**：`tpms` `lattice` `bone-scaffold` `webgpu` `additive-manufacturing`（经 GitHub API 设置并公开复核）
- ⬜ LICENSE 版权行 + main.tex 作者行（L20 `Anonymous Author`）+ 单位行：真实署名（**投稿前必须**；署名三项信息 2026-09-06 已向用户征集，待答复）
- ⬜ Editorial Manager 注册并提交（投稿系统账号只能本人注册）；提交号回填本清单与 progress.md
- ✅ `https://github.com/xxx/tpms` 占位链接 → 已改真实地址 `zhaoliuxin926-ux/tpms-explorer`（MANUSCRIPT.md，2026-09-06）

## 提交前终检
- [x] GitHub Actions 三平台全绿（run 45，2026-09-06）：https://github.com/zhaoliuxin926-ux/tpms-explorer/actions/runs/34025777466
- [ ] main.pdf 人眼通读一遍（图表编号、引用、作者信息）
- [x] 仓库根 `git status` 干净（2026-09-06 复核）
