# 第二十七轮 · 键盘平移 + 视图状态 URL 化 + 帮助内搜索

> 用户指令「全部执行」——落实上一轮结尾给出的三项方向。全部落 `claude-code-workflow.html`，并经真实浏览器 E2E 跑通。

## 1. 键盘平移画布

- `W` / `S`（或 `Shift` + `方向键`）上下平移当前视图，调用 `window.scrollBy`。
- 普通 `方向键` 仍用于聚焦阶段，二者零冲突：新分支放在 keydown 链中 `Delete/Backspace` 之后、阶段聚焦之前，用 `!e.ctrlKey && !e.metaKey && !e.altKey` 守卫避免误触编辑/快捷键。
- 布局说明：本图是竖向长图、`body` 设 `overflow-x:hidden`，因此横向不滚动——`A`/`D` 作为同族键保留（无横向溢出时安全 no-op，不报错），平移实际作用于纵向。
- 帮助浮层「导航 / 演示」补一行：`W / S 或 Shift + 方向键` → 上下平移画布。

## 2. 视图状态写入 URL hash（可分享 / 书签直达）

新增三个函数：

- `readViewHash()`：解析 `location.hash` 的 `z / x / y / p / g`，落到 `_pendingZoom / _pendingScroll / _pendingPhase / _pendingGroup`。
- `writeViewHash()`：`scheduleHash()` 防抖（250ms）后经 `history.replaceState` 把当前 `缩放 / 滚动 / 聚焦阶段 / 选中分组` 回写 hash（不污染历史）。
- `applyPendingView()`：启动与刷新时解析 hash 还原视图；`setZoom / focusPhase / selectGroup / 滚动` 都触发 `scheduleHash`，实时同步。

两个关键修复：

- `history.scrollRestoration = 'manual'`：否则浏览器在 `reload()` 时会把滚动位恢复到刷新前，覆盖 hash 指定的位置。
- 还原滚动用 `window.scrollTo({ top, left, behavior: 'auto' })`：绕过全局 `scroll-behavior: smooth`，保证刷新瞬间到位。

效果：`#z=1.5&x=20&y=260` 可直达某缩放/滚动位置；`#p=2` 直达聚焦阶段 2；`#g=<id>` 直达召回某分组。

## 3. 帮助浮层内 `Ctrl / ⌘ + F` 筛选快捷键

- 帮助浮层顶部新增筛选输入框（`.hp-search`）。
- 浮层打开时按 `Ctrl / ⌘ + F` → 聚焦并全选该框（全局 keydown 在 `helpOpen` 分支优先拦截）。
- 输入实时过滤：不匹配的 `.hp-row` 加 `.hidden`、空章节 `.hp-sec.hidden` 收起、全无命中显示「没有匹配的快捷键」。
- `Esc`：框内有内容时清空筛选，否则关闭浮层。
- 帮助浮层「搜索 / 视图」补一行 `Ctrl / ⌘ + F`。

## 验证（真实浏览器 E2E）

`e2e-regression.mjs` 由 11 项扩为 **14 项**，新增：

| 用例 | 实测 |
|---|---|
| `KEYBOARD_PAN` | `S` 300→440、`W` 440→300、`Shift+↓` 300→440、`Shift+↑` 440→300、横向 `D` 安全保持 `scrollX=0` ✅ |
| `URL_HASH_VIEW_ZOOM` | 导航 `#z=1.5&x=20&y=260` → `zoomLabel=150%`、`scrollY=260`、`hash` 含 `z=1.5` ✅ |
| `URL_HASH_VIEW_PHASE` | 导航 `#p=2` → 阶段 2 带 `demo-active`、`hash` 含 `p=2` ✅ |
| `HELP_SEARCH` | 打开帮助、`Ctrl+F` 聚焦输入框、键入「撤销」后 38 行中仅 1 行可见其余 37 隐藏、`Esc` 清空后全部恢复 ✅ |

**总览：14/14 PASS，0 控制台/页面错误。**

## 改动文件

- `claude-code-workflow/claude-code-workflow.html` — 键盘平移、URL hash 视图、帮助内搜索
- `claude-code-workflow/e2e-regression.mjs` — 新增 4 项用例（共 14 项）
- `claude-code-workflow/ROUND27-OVERVIEW.md` — 本轮概览（本文件）
- `claude-code-workflow/README.md` — 新增「第二十七轮」小节 + 14 项 E2E blockquote
- `D:\TRAE AI\.workbuddy\memory\2026-07-24.md` — 工作日志追加

## 一个待办（可选，不影响功能）

身份初始化文件 `BOOTSTRAP.md` 仍在（系统的「出生证」流程，需你告知：希望怎么称呼我、你的名字/城市、偏好什么风格）。它一直没动是因为你这几轮都在推进可视化工作。想顺手办了就一声，我按你的偏好填好 `SOUL.md`/`IDENTITY.md`/`USER.md` 再删它——不急。
