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
- ⬜ **push 仓库**（2026-09-06 实测：本机无任何存储 GitHub 凭据——GCM 无 github.com 记录、gh token 已失效；github.com 直连被阻、仅 Clash 7890 代理可通。**在你自己的终端跑一次 `git push origin main`，GCM 会弹浏览器授权一次**；授权成功后凭据入库，此后的 Actions 核对/topics 均可由 AI 代办）
- ⬜ repo Settings → Topics：`tpms` `lattice` `bone-scaffold` `webgpu` `additive-manufacturing`（凭据入库后可由 AI 经 GitHub API 代设）
- ⬜ LICENSE 版权行 + main.tex 作者行（L20 `Anonymous Author`）+ 单位行：真实署名（学术署名须本人定，2026-09-06 询问未获答复，保持现状）
- ⬜ Editorial Manager 注册并提交（投稿系统账号只能本人注册）；提交号回填本清单与 progress.md
- ✅ `https://github.com/xxx/tpms` 占位链接 → 已改真实地址 `zhaoliuxin926-ux/tpms-explorer`（MANUSCRIPT.md，2026-09-06）

## 提交前终检
- [ ] push 后 GitHub Actions 三平台全绿截图（审稿证据）
- [ ] main.pdf 人眼通读一遍（图表编号、引用、作者信息）
- [ ] 仓库根 `git status` 干净
