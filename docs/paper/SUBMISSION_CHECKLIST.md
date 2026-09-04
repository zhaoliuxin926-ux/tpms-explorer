# SoftwareX 投稿清单（B-t1 收尾）

> 状态标记：✅ 完成 / ⬜ 需用户操作 / ⬜ 待办

## 材料
- ✅ 主稿：`docs/paper/latex/main.tex`（pdflatex 三连编译通过，PDF 112KB，无错误）
- ✅ 摘要导览：`docs/paper/MANUSCRIPT.md`（与主稿同步）
- ✅ LICENSE：仓库根 MIT
- ✅ 可复现：`npm install && npm run test:all` → 39/39 门禁（CI 三平台矩阵 .github/workflows/ci.yml）
- ⬜ figures/：现有图是否覆盖新特性（定向传播前后对比图、exact 求解器流程图可加分）——建议投稿前补 1~2 张
- ⬜ cover letter：草稿要点——①对标 RegionTPMS 同刊先例 ②差异=验证门禁文化（39 门/1000+ 断言）③exact 求解器与定向传播两处方法论贡献 ④全部声明可由 CI 复跑验证

## 需用户操作（AI 无法代劳）
- ⬜ **push 仓库**（本地领先远程多个 commit；GitHub Actions 三平台矩阵即"干净环境可复现"证据）
- ⬜ repo Settings → Topics 添加：`tpms` `lattice` `bone-scaffold` `webgpu` `additive-manufacturing`
- ⬜ LICENSE 版权行：`Copyright (c) 2026 TPMS Explorer contributors` 可改为真实署名
- ⬜ main.tex 作者信息：`Anonymous Author` → 真实姓名/单位（投稿前必须）
- ⬜ Editorial Manager 注册并提交（投稿系统账号只能本人注册）
- ⬜ `https://github.com/xxx/tpms` 占位链接改为真实仓库地址（README_EN / MANUSCRIPT）

## 提交前终检
- [ ] push 后 GitHub Actions 三平台全绿截图（审稿证据）
- [ ] main.pdf 人眼通读一遍（图表编号、引用、作者信息）
- [ ] 仓库根 `git status` 干净
