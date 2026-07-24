# 第十九轮 · 分组拖拽排序 + 分组与演示/聚焦阶段联动

**文件**：`claude-code-workflow/claude-code-workflow.html`（单文件，离线可用）
**验证**：整段内联脚本 `node --check` 通过（104,875 字节，0 错误）

## 一、分组拖拽排序
- 分组面板里每个 `.gp-item` 现在可拖拽（`draggable=true`），按住上下拖动即可重排顺序。
- 落点用青色内阴影指示条提示：鼠标在项中线**上半** = 插到该项**前**，**下半** = 插到该项**后**；拖到列表空白处则追加到末尾。
- 松手即重排 `CONFIG.groups` 并即时重绘。
- 协作同步：
  - CRDT 模式 → 新增 `reorderGroupsInDoc()`：单事务内把新顺序整组重写进 `yDoc.getArray('groups')`（`delete(0,len)+insert`），Yjs 观察器自动重渲跨端同步。
  - LWW 模式 → `renderGroupsPanel() + broadcast()`。
- 关键修正：列表级 `dragover/drop` 监听只在 `ensureGroupsUI`（一次性）挂到常驻 `.gp-list`，避免 `renderGroupsPanel` 反复重挂导致监听器堆叠。

## 二、分组 ⇄ 阶段聚焦联动
- 新增 `phasesOfGroup(g)` / `primaryPhaseOfGroup(g)`：扫描每个阶段（含 root/systems/rules/nodes）统计该分组节点的命中数，挑出「主阶段」（命中最多、并列取最小序号）。
- **召回即聚焦**：`Alt+1~9` 与 `Ctrl/⌘+Shift+G` 循环召回，现在除了选中节点，还会 `focusPhase` 滚到该分组的主阶段。
- **◎ 聚焦按钮**：每个分组项新增「◎」按钮，点一下 = `focusGroupPhases(g)`（召回并聚焦主阶段）。
- **▶ 分组巡演**：分组面板头部新增「分组巡演」按钮，触发 `runGroupDemo()`——依次对每个分组执行 `focusGroupPhases + playTransition`，当前巡演项在面板里以青框（`gp-tour`）高亮，每项停留约 1.3s，相当于一段「按分组讲解工作流」的引导动画。无分组时给出提示。

## 三、文档同步
- 帮助浮层「选择 / 分组」一节补充：拖拽排序、◎ 聚焦、分组巡演说明。
- `README.md` 新增「第十九轮」小节。

## 已知边界
- 分组节点若只分布在「贯穿层」侧栏而未落在任何阶段主区，`primaryPhaseOfGroup` 返回 -1，此时聚焦不触发（仅召回选中），属预期行为。
- 阶段间装饰性 connector 箭头仍不纳入快照（与第十八轮一致）。
