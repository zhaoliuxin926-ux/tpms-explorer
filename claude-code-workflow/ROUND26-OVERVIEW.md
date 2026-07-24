# 第二十六轮 · 键盘缩放与适应（Keyboard Zoom & Fit）

> 延续「继续往完美推进」路线，补齐全局快捷键里唯一还没键盘化的视图操作。

## 改动（claude-code-workflow.html）

1. **键盘缩放 + 适应**：全局 `keydown`（约 L1620）末尾新增三个分支：
   - `+` / `=` → `setZoom(zoom + 0.1)`（放大，上限 180%）
   - `-` / `_` → `setZoom(zoom - 0.1)`（缩小，下限 60%）
   - `f` / `F` → `fitView()`（复用既有适应屏幕逻辑）
   - 与现有快捷键（`?`/`/`/←/→/`0`-`5`/`Alt+1~9`/`Ctrl+G`/撤销重做/巡演控制）零冲突；`searchInput`/`contentEditable` 守卫与 `helpOpen` 早返回已存在，自然生效。
2. **帮助浮层同步**：「导航 / 演示」一节新增
   - `⤢ 适应 / F` —— 适应屏幕（F 为键盘快捷键）
   - `+ / -` —— 放大/缩小（每次 10%，范围 60%–180%）

## 验证（playwright-core 无头 Chrome/Edge，e2e-regression.mjs）

新增第 11 项 `KEYBOARD_ZOOM_FIT`（合成 `KeyboardEvent` 派发到 `document`）：

| 动作 | 结果 |
| --- | --- |
| `zoomReset` 复位 | `z0 = 1.0` |
| `+`、`+`、`+` | `zUp = 1.3` ✅ |
| `-` | `zDown = 1.2` ✅ |
| `F`（适应） | `zFit = 0.6`（落到缩放下限）、`scrollY = 328`（居中）✅ |

**总览：11/11 PASS，0 控制台/页面错误。**

覆盖项：库加载 · 深浅快照配色 · 浅色开关 · 5 种纸型 PDF+Toast · 章节引导卡 · 缩略图点击导航 · 无障碍 · 触摸手势 · 键盘缩放+适应 · 全程 0 错误。

## 运行

```bash
NODE_PATH="<含 playwright-core 的 node_modules>" node e2e-regression.mjs
# 或：node e2e-regression.mjs --file "D:/path/to/claude-code-workflow.html"
```

## 结论

视图缩放与适应现在既有按钮、也有键盘快捷键（`+`/`-` 缩放、`F` 适应），与既有快捷键体系零冲突、帮助面板已同步说明。单文件工具在「编辑/协作/分组/导航/导出/无障碍/移动端/键盘」各维度均达成可用、可验证、零回归的状态。
