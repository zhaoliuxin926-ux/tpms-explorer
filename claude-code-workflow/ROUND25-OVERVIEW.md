# Claude Code 工作流架构图 · 体验打磨续（第二十五轮，全部执行）

按用户「全部执行」落实上轮结尾提的三件事，全部落在单文件 `claude-code-workflow.html`，并新建 `e2e-regression.mjs` 回归套件，经真实无头 Chrome 验证 **10/10 PASS、0 错误**。

## 三项交付

### ① 固化 E2E 回归套件进项目
- `claude-code-workflow/e2e-regression.mjs`（ESM）：`createRequire` 加载 playwright-core，自动探测 Chrome/Edge，HTML 路径可 `--file`/环境变量，`__dirname` 推导；用 `process.exitCode`（非 `process.exit`）避免异步未落盘导致退出码异常。
- 运行：`NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs`

### ② PNG/SVG「浅色快照」开关
- 工具栏 `🖼/📐` 旁新增「浅色」勾选（默认开，省墨）。`exportPNG`/`exportSVG` 按 `snapLight()` 把 `buildSnapshotSVG(forceLight)` 传入；深主题下默认导出白底深色字快照，取消勾选则随屏主题。Toast 标注「（浅色）」。

### ③ 继续往「完美」推进（无障碍 + 移动端；缩略图导航既有已验证）
- **无障碍**：工具栏全按钮补 `aria-label`；`#toast`/`#chapterCaption` 加 `role=status`+`aria-live=polite`；新增 `:focus-visible` 全局焦点环；扩展 `prefers-reduced-motion`（关过渡 + `scroll-behavior:auto`）；缩略图容器 `role=navigation` + 画布 `aria-label`。
- **移动端**：主视图（非编辑/背景）单指平移（`window.scrollTo`，不干扰节点点击）、双指捏合调用既有 `setZoom`（CSS `zoom` 0.6–1.8）；仅 `touch` 触发，不破桌面鼠标编辑；编辑模式单指走原指针/框选。
- **缩略图导航**（上轮已具备）：点击任意位置平移主视图 + 实时青色视口矩形，本轮一并验证通过。

## 验证（playwright-core 无头 Chrome，0 控制台/页面错误）

| 项 | 结果 |
| --- | --- |
| 库加载 / 深浅快照配色 | ✅ |
| 浅色开关（勾选→浅 / 取消→深） | ✅ |
| 5 种纸型 PDF + `show ok` Toast | ✅ |
| 章节卡：暂停保持 / 非暂停淡出 + `aria-live=polite` | ✅ |
| 缩略图点击导航（滚动 0 → 1192） | ✅ |
| 无障碍：工具栏全 `aria-label` / `:focus-visible` / `prefers-reduced-motion` | ✅ |
| 触摸：单指平移改 scrollY / 双指 zoom 1→1.8、`hasTouch` 加载 0 错误 | ✅ |

**10/10 PASS**

## 产出文件
- `D:\TRAE AI\claude-code-workflow\claude-code-workflow.html` — 主交付（已更新）
- `D:\TRAE AI\claude-code-workflow\e2e-regression.mjs` — 新增回归套件
- `D:\TRAE AI\claude-code-workflow\README.md` — 新增「体验打磨续（第二十五轮）」小节
