# 第十二轮 · 协作体验增强（claude-code-workflow.html）

在原有「在线协作者光标 + 实时编辑高亮」基础上，本轮补齐三项协作体验：

## 1. 编辑高亮淡入动画
- 新增 `@keyframes remoteEditIn`（box-shadow 由 0 扩散到 14px），`.box.remote-editing` / `.box.remote-dragging` 均挂 `0.28s ease both` 动画。
- `renderCursors` 加 DOM-change 守卫：仅在「期望状态 ↔ 当前状态」不一致时改类名，避免逐帧重放动画。

## 2. 在线协作者面板（谁在线）
- 右下角常驻毛玻璃小卡 `#presencePanel`（暗色主题变量化、`presenceIn` 淡入）。
- `renderPresence(list)`：标题「在线 N」 + 「（我）」行 + 各远端行（彩色圆点 + 名字 + 右侧状态徽标：绿色「编辑中」/ 蓝色「拖拽中」）。

## 3. 拖拽同步（awareness 带上「正在拖拽哪个节点」）
- 新增 `setMyDragging(id)`（与 `setMyEditing` 对称）：CRDT 走 `awareness.setLocalStateField('dragging')`，LWW 走 `sendCursor({dragging})`。
- 拖拽起点 `setMyDragging(node.id)`、松手/取消 `setMyDragging(null)`；LWW 的 send/onmessage/heartbeat/beforeunload 全部补 `dragging` 字段；`initCRDT` 初始状态补 `dragging:null`。
- 远端拖拽态：光标标签「✥拖拽中」 + 目标节点同色**虚线**轮廓；面板显示蓝色「拖拽中」徽标。

## 验证
- `node --check` 整段内联脚本：0 错误。
- `crdt-test-awareness.mjs` 连真实 `crdt-server.mjs`：A→B 光标 / B→A 光标 / 编辑字段 / **拖拽字段** / 断开移除 —— **5/5 PASS**。
- 测试依赖（node_modules / package*.json / crdt-data）已清理，脚本保留。

## 文件
- 主交付：`claude-code-workflow.html`（单文件，无需后端即可运行默认 LWW 协作）
- 测试：`crdt-test-awareness.mjs`（5/5）
- 说明：`README.md`（已补第十二轮特性）
