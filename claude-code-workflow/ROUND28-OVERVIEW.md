# 第二十八轮 · 命令面板 + 视图自动记忆 + 打印样式

**交付时间**：2026-07-24　**状态**：✅ 17/17 E2E 全绿，0 错误

---

## 本轮做了什么（claude-code-workflow.html）

延续「继续往完美推进」路线，一次性落实三项高级交互能力。

### ① 命令面板 `Ctrl / ⌘ + K`
- 懒加载浮层 `#paletteOverlay`（首次打开才建，零首屏成本）。
- 模糊搜索覆盖**全部动作**：适应视图、放大/缩小、深/浅主题、播放演示、帮助、聚焦搜索、导出 PNG/SVG/PDF、撤销/重做、全选、存分组、编辑模式、连线流动、网格吸附、分组巡演、聚焦阶段 0–5、召回分组 1–9、关闭面板。
- `↑↓` 选择、`↵` 执行、`Esc` 关闭；鼠标 hover/点击 同样可用。
- `Ctrl/⌘+K` 在全局 `keydown` **顶部**捕获并 `preventDefault`（避免触发浏览器搜索栏）；面板打开时方向键/回车/Esc 全部收口到面板，不误触其它快捷键。
- 命令 `run` 全部复用既有按钮 `.click()` 与提升的函数声明（`focusPhase`/`selectGroup`/`selectAll`/`toggleHelp`），不引入新逻辑分支，零回归风险。
- 匹配算法 `fuzzyScore`：标题包含优先（1000−位置） → 说明包含（600−位置） → 标题子序列（200） → 否则不显示。
- 帮助浮层「搜索 / 视图」补 `Ctrl/⌘ + K` 一行说明。

### ② 视图自动记忆（localStorage）
- 在既有的 `scheduleHash` 防抖回调里**同步** `saveViewLS()`：把 `缩放(z)` / `滚动(x,y)` / `聚焦阶段(p)` / `选中分组(g)` 写入 `wf-view`。
- 刷新或重开时：若 `location.hash` 为空 → `readViewLS()` 还原视图；**hash 优先级高于 LS**，二者不冲突。
- 与上一轮「URL 深链」互补——不想手动构造链接时，关掉再打开也能回到原处。

### ③ 打印样式增强 `@media print`
- 扩展打印媒体，隐藏全部 chrome：工具栏、缩略图、帮助、命令面板、协作层（`#presencePanel`/`#cursorLayer`）、Toast、章节卡、巡演条、分组面板。
- **关键修复**：旧规则曾把连线层 `#edgeLayer` 误设为 `display:none`，架构图的连线才是重点——本轮改为 `display:block !important` 保留可见。
- `body` 强制白底黑字；`phase/box` 去阴影与毛玻璃；`print-color-adjust:exact` 保留阶段强调色（打印不丢色）；`break-inside:avoid` 避免阶段被分页切断。
- 原生 `Ctrl+P` / 打印对话框输出干净整图，与「📄 PDF」矢量导出形成互补（一个所见即所得、一个矢量可编辑）。

---

## 验证（真实浏览器 E2E）

`e2e-regression.mjs` 由 14 项扩到 **17 项**，新增 3 项全部跑通：

| 用例 | 结果 |
|---|---|
| `COMMAND_PALETTE` | `Ctrl+K` 打开面板；键入「放大」首项命中「放大 10%」；`↵` 执行后面板关闭、`zoomLabel=110%` |
| `VIEW_PERSIST_LS` | 放大至 `130%` 后刷新仍还原 `130%`（hash 为空时回退 LS） |
| `PRINT_STYLESHEET` | `@media print` 运行时模拟（本机 playwright-core 该版本缺 `emulateMediaType`，自动回退静态校验内联样式表含 `.toolbar`/`#minimap`/`#edgeLayer{display:block}`/`background:#fff`，校验通过） |

**总览：17/17 PASS，0 控制台/页面错误。**

> ⚠️ 排查记录：本机 playwright-core 构建里 `page.emulateMediaType` 不是函数（连 `page.context().emulateMediaType` 也缺），运行态 print 模拟会直接 throw，且因未执行到 `browser.close()` 导致 Node 进程**挂死**（Playwright 的浏览器连接会保持事件循环存活）。已修复：① 用 `page.context().emulateMediaType` 并包 `try/catch`；② 失败时**回退为静态校验内联打印样式表**，绝不 throw。教训已写入工作记忆——E2E 中任何可能缺失的 Playwright API 都应 `try/catch` + 静态回退，避免挂死。

---

## 改动文件
- `claude-code-workflow/claude-code-workflow.html` — 命令面板、视图自动记忆、打印样式
- `claude-code-workflow/e2e-regression.mjs` — 新增 COMMAND_PALETTE / VIEW_PERSIST_LS / PRINT_STYLESHEET（17 项）
- `claude-code-workflow/ROUND28-OVERVIEW.md` — 本轮概览
- `claude-code-workflow/README.md` — 新增「第二十八轮」小节
- `D:\TRAE AI\.workbuddy\memory\2026-07-24.md` — 工作日志追加

## 一个可选待办（不影响功能）
身份初始化文件 `BOOTSTRAP.md` 还在（系统的「出生证」流程，需你告诉我怎么称呼我、你的名字/城市、偏好风格）。你点头我就按偏好填好 `SOUL.md`/`IDENTITY.md`/`USER.md` 再删它，不急。
