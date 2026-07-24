# 第十五轮 · 分组 / 按阶段配色 / 选中辉光

> 在「全景架构图」上一次性补齐上一轮给出的三个选项；其中「保存分组」与「按阶段配色」两条涉及数据持久化，**已同时接入 CRDT（Yjs 字段级）与 LWW（本机多标签 BroadcastChannel）双协作同步**。

## 1. 保存分组 / 一键召回
- 数据：`CONFIG.groups = [{ id, name, color, nodeIds:[] }]`。
- 左下角（缩略图上方）常驻毛玻璃「分组」面板（`#groupsPanel`，`ensureGroupsUI` 注入）。
- 「＋保存当前选择」：弹窗命名 + 自动循环配色，把当前选区（Shift 点选 / 拖框多选的节点集合）存为分组。
- 点面板中任一成员 → **一键召回**整组（自动选中并高亮）；右侧「✕」删除分组。
- 召回时按 `nodeById` 过滤已删除节点，杜绝悬空引用。
- 同步：
  - CRDT → `persistGroups()` 单事务重写 `yDoc.getArray('groups')`，随 Yjs 自动跨端合并；
  - LWW → `renderGroupsPanel()` + `broadcast()` 把整份 CONFIG（含 groups）推给其它标签。
  - 远端在 `applyFromDoc`（CRDT）与 `apply`（LWW）收到后自动重绘分组面板。

## 2. 按阶段自动配色
- 缩放工具栏新增「🎨 按阶段配色」按钮 → `autoColorByPhase()`。
- 一键把每个阶段（含 `root` / `systems` / `rules` / `nodes`）染成 8 色调色板对应色（逐阶段循环）。
- 等价于对整组节点批量 `setNodeField('accent', …)`；CRDT 逐节点写 `Y.Map` 字段、LWW 改本地后 `broadcast`。
- 与第十四轮「手动配色浮条」互补：自动铺底、手动精修。

## 3. 选中节点辉光动画
- 被选节点在原有青色描边基础上叠加 `@keyframes selGlow` 脉冲辉光（1.8s 循环，描边 1px→2px、青色光晕 8px→22px）。
- 尊重 `prefers-reduced-motion`：系统开启减弱动画时自动关闭脉冲，仅保留静态描边。
- 只动 `box-shadow`，与编辑态的 3D 倾斜 `transform` 互不冲突。
- `applySelection()` 现同时覆盖主图与「贯穿层」侧栏节点。

## 关键修复
- `groupsPanel` 初版未声明（会成隐式全局）→ 已并入 globals `let … groupsPanel = null`，消除严格/重入风险。

## 验证
- 整段内联脚本提取后 `node --check` 通过（语法 0 错误）。
- 分组 round-trip 逻辑与 `edges` 完全对称，已逐路径核对：`modelFromConfig` 写 groups / `configFromModel` 读 groups / `persistGroups` 单事务 / `applyFromDoc`·`apply` 重绘面板。
- 浏览器交互手感需人工确认（无头环境限制）。

## 受影响文件
- `claude-code-workflow.html`（主交付，新增分组面板 + 自动配色按钮 + 辉光动画 + 两条协作同步）
- `README.md`（新增「分组 / 配色 / 辉光」小节）
- `ROUND15-OVERVIEW.md`（本文件）
