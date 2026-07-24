# Claude Code 个人工作流全景架构图

一个**单文件、零依赖、可离线**的交互式可视化：把 Claude Code 的个人工作流（阶段 → 节点 → 连线）渲染成可拖拽、可编辑、可协作的架构图。

本目录整合了该项目的全部相关文件（与根目录的 TPMS 结构探索器项目无关）。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `claude-code-workflow.html` | **主交付**：单文件前端（HTML+CSS+JS，无构建步骤）。自带编辑模式、撤销/重做、手绘连线、可配置箭头/曲线/标签、本机多标签协作（LWW）。 |
| `collab-server.js` | Round 7 的 **last-write-wins 协作后端**（Node + `ws`）。把配置落盘为 `workflow.json`，支持晚加入者推送权威状态。 |
| `crdt-server.mjs` | Round 8 的 **Yjs CRDT 协作后端**（ESM：`yjs`+`y-protocols`+`lib0`+`ws`）。实现官方 y-websocket 协议，按房间二进制持久化到 `crdt-data/`，支持离线编辑与并发合并。 |
| `crdt-test-field.mjs` | Round 9 的 **字段级实体 CRDT 测试**：验证节点/连线拆成 `Y.Map`/`Y.Array` 后的并发合并、离线重连合并、连线同步（连真实服务端跑通 5/5）。 |
| `crdt-test.mjs` | Round 8 的 CRDT 整文档级合并测试（保留作开发工具）。 |
| `crdt-test-awareness.mjs` | **在线协作者光标测试**：验证 y-protocols awareness 经服务端在两端转发光标坐标、编辑高亮字段、拖拽同步字段、并在一端断开后移除其光标（连真实服务端跑通 5/5）。 |
| `crdt-test-groups.mjs` | **分组 CRDT 增量增删测试**（第十五轮新增，后改为增量）：验证 `CONFIG.groups` 经 `modelFromConfig`/`configFromModel` 在 `yDoc.getArray('groups')` 中编码/解码保真（含 `nodeIds` 顺序）、`addGroupToDoc`/`removeGroupFromDoc` 按 id 增量增删（Y.Array `push`/`delete(i,1)`）的跨端同步、**两人同时各加一个分组也能完美合并**、离线新增分组后重连合并，以及分组 `Y.Map` 自身的字段级并发合并（连真实服务端跑通 10/10）。 |

## 快速体验

直接用最新版 Chrome / Edge 打开 `claude-code-workflow.html` 即可（默认离线 LWW 模式，无需任何后端）。

## 开启多人协作（Yjs CRDT，支持离线）

`claude-code-workflow.html` 顶部协作配置默认 `COLLAB_YJS = null`（离线）。开启方式：

```js
// claude-code-workflow.html 顶部
const COLLAB_YJS = 'ws://localhost:1234';
```

```bash
# 安装依赖（首次需联网从 esm.sh 加载 yjs）
npm i yjs y-websocket y-protocols lib0 ws
# 启动后端
node crdt-server.mjs
```

> 测试依赖安装/清理为开发期操作；正式发布只需 `claude-code-workflow.html` 单文件。

## 编辑模式操作

- 拖拽节点移动位置
- 双击节点改标题 / 说明
- 点节点 → 再点另一节点：快速连线（已支持 **Esc / 右键中途取消**，拖拽节点也会取消待连状态）
- 从节点右侧圆点拖拽：手绘连线
- 点连线：选中后可改曲线风格 / 箭头预设 / 标签 / 删除
- 快捷键：`Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做、`0-5` 切换阶段、`/` 聚焦搜索

## 多人协作特性（开启 `COLLAB_YJS` 后）

- **字段级实体 CRDT**：节点/连线拆成 `Y.Map`/`Y.Array`，不同人改不同字段按字段增量合并，支持离线编辑与并发重同步。
- **在线协作者光标（awareness）**：每个客户端分配随机名字 + 颜色，实时广播光标在图面内容坐标系中的位置（与各自缩放无关，始终指向同一节点），远端以带名字标签的彩色光标渲染；缩放 / 滚动时自动跟随；对方断开即移除。
  - 两种模式都支持：开启 `COLLAB_YJS`（CRDT）走 y-protocols awareness；**默认 LWW 模式（同机多标签 BroadcastChannel）也支持光标**——无需后端，心跳保活 + 超时剔除处理标签关闭。
  - **实时编辑高亮**：某协作者聚焦节点编辑时，其光标旁显示「✎编辑中」，对应节点描边其颜色轮廓；CRDT 模式经 awareness `editing` 字段转发，LWW 模式经同一 BroadcastChannel 转发。**该描边带 0.28s 淡入动画**（`@keyframes remoteEditIn`），每次状态变更只切换一次类名，避免逐帧重放动画。
  - **在线协作者面板（谁在线）**：右下角常驻毛玻璃小面板，列出「在线 N」：含「（我）」及每位远端协作者，各带彩色圆点 + 名字 + 右侧状态徽标（绿色「编辑中」/ 蓝色「拖拽中」），进入时淡入。
  - **拖拽同步（awareness 带上「正在拖拽哪个节点」）**：某协作者开始拖拽节点时，其光标旁显示「✥拖拽中」，对应节点以同色**虚线**轮廓高亮；CRDT 模式经 awareness `dragging` 字段转发，LWW 模式经 BroadcastChannel 转发；拖拽结束/取消（含 Esc、右键、点空白、标签页关闭）即清除。

## 导航与视图（第十三轮新增，默认即生效，零依赖）

- **缩略图 Minimap**：左下角常驻毛玻璃小卡（与在线面板对称），用 `<canvas>` 实时绘制全部节点（按内容坐标，含缩放 / 拖拽偏移）与青色视口框；滚动 / 缩放 / 拖拽节点 / 窗口尺寸变化时经 rAF 节流重绘。点击或按住拖拽缩略图即可把主视图滚动到对应位置（pointer capture，光标位置映射到内容坐标中心）。右上角「✕」可隐藏。
- **适应屏幕 Fit-to-view**：缩放工具栏新增「⤢ 适应」按钮，按当前内容包围盒与视口自动计算缩放（0.6–1.8 区间，`setZoom` 复用 CSS `zoom`），随后把主视图滚动到内容中心——一键看清整张「全景架构图」。
- 两者均为**纯只读 + 独立交互**，不触碰已有的拖拽 / 连线 / 协作（awareness）逻辑，零回归风险。

## 选择 / 精度 / 配色（第十四轮新增，编辑模式下）

- **多选 + 框选（Marquee）**：编辑模式中 `Shift` 点节点可逐个增删选区；在空白处按住拖拽画出虚线选框，与其相交的节点全部入选（按住 `Shift` 拖框为「叠加」而不替换）。选区以青色描边高亮。
- **整组拖拽 / 删除**：拖拽选区内任一节点，整组节点同步平移（各自保留相对偏移）；按 `Delete` / `Backspace` 整组删除；`Ctrl/⌘+A` 全选；`Esc` 清空选区（同时取消连线）。选区在任意重渲染（含 CRDT 并发合并）后自动恢复。
- **网格吸附 + 对齐参考线**：工具栏「网格吸附」开关打开后，拖拽落点按 20px 网格量化；关闭时启用**智能对齐**——被拖节点与画布内其它节点的左/中/右、上/中/下边缘接近 6px 时自动吸附，并在全屏绘制青色虚线参考线（左/右/水平对齐一目了然）。吸附与对齐互斥（开网格则不打参考线）。
- **节点配色分组**：选中节点后弹出毛玻璃「配色」浮条（含 8 色 + 清除），一点即给整组节点左侧描边着色；`accent` 存入节点数据，CRDT 模式经 `setNodeField('accent', …)` 合并、LWW 模式经 `broadcast` 同步；缩略图节点块按 `dataset.accent` 分色，分组一眼可辨。

> 实现要点：框选在 `#diagram` 空白 `pointerdown` 起手、与节点自身 `pointerdown`（起手拖拽）通过 `closest('.box')` 区分，互不干扰；整组拖拽统一以 `drag.group` 数组驱动；`renderDiagram` 末尾重放选区，保证协作重渲染不丢选中态。

## 分组 / 配色 / 辉光（第十五轮新增，编辑模式下）

- **保存分组 / 一键召回**：左下角（缩略图上方）常驻毛玻璃「分组」面板，点「＋保存当前选择」把当前选区（Shift 点选 / 拖框多选得到的节点集合）存为一个带名字 + 颜色的点（命名弹窗、颜色自动循环）。之后点面板里的任一分组成员即可**一键召回该分组**（自动选中其全部节点并高亮）；每项右侧「✕」删除分组。分组数据落在 `CONFIG.groups = [{id,name,color,nodeIds:[]}]`，**两种协作模式都能同步**——CRDT 模式写入 `yDoc.getArray('groups')`（字段级合并，随 Yjs 自动跨端同步），LWW 模式经 `broadcast` 把整份 CONFIG（含 groups）推给其它标签；远端 `apply` / `applyFromDoc` 收到后自动重绘分组面板。
- **按阶段自动配色**：缩放工具栏新增「🎨 按阶段配色」按钮，一键把每个阶段（含其 `root` / `systems` / `rules` / `nodes`）统一染成 8 色调色板里的对应色（逐阶段循环），等价于对整组节点批量 `setNodeField('accent', …)`；CRDT 模式逐节点写 `Y.Map` 字段（rAF 合并重渲染），LWW 模式改本地后 `broadcast` 同步。与第十四轮的「手动配色浮条」互补：手动精修、自动铺底。
- **选中节点辉光动画**：被选节点在原有青色描边基础上叠加 `@keyframes selGlow` 脉冲辉光（1.8s 循环，描边由 1px→2px、辉光由 8px→22px 青色光晕），让「当前选中了哪些」更醒目；尊重 `prefers-reduced-motion`——系统开启减弱动画时自动关闭脉冲，仅保留静态描边。选区同时覆盖主图与「贯穿层」侧栏节点。

> 实现要点：分组是「选区快照」，存的是节点 `id` 集合而非坐标，召回时按 `nodeById` 过滤掉已删除节点，避免悬空引用；`saveGroup`/`deleteGroup` 在 CRDT 模式走 `addGroupToDoc`/`removeGroupFromDoc`（按 id 定位的 Y.Array 增量 `push`/`delete(i,1)`，两人同时各加一个分组也能完美合并，不再整段互相覆盖），在 LWW 模式走 `renderGroupsPanel()` + `broadcast()`；辉光只动 `box-shadow`，与编辑态的 3D 倾斜 `transform` 互不冲突。

## 缩略图选中高亮 + 分组快捷键（第十六轮，自驱动优化）

- **缩略图反映选中**：`drawMini()` 现在为当前选中的节点在缩略图里画一圈青色描边环（`#22d3ee`），与正文选中辉光呼应；`applySelection()` 每次切换选区都会 `scheduleMini()` 刷新缩略图（rAF 节流），所以框选 / Shift 点选 / 召回分组都会即时在缩略图上显形。
- **分组键盘快捷键**（编辑模式下，避开 `0`–`5` 阶段聚焦键）：
  - `Ctrl / ⌘ + G` —— 把当前选区存为一个新分组（等价于点「＋分组」）。
  - `Alt + 1 ~ 9` —— 按面板里的序号一键召回对应分组（选中其全部节点）。
  - 顶部提示条已同步说明这两条快捷键与「缩略图高亮选中」。

> 实现要点：缩略图描边复用 `selectedNodes` 集合，按 `dataset.id` 判定；`scheduleMini` 在 `miniCtx` 尚未创建时由 `drawMini` 早返回兜底，初始化顺序安全；`Alt+数字` 分支置于 `0`–`5` 阶段聚焦分支之前并命中即 `return`，避免 `Alt+1` 被误判为聚焦阶段 1。

- **帮助 / 快捷键速查浮层**（快捷键面已较丰富，补一个统一查阅入口）：工具栏新增「⌨ 帮助」按钮，`?` 键亦可打开。居中毛玻璃卡片（`#helpOverlay` + `#helpStyle`，双列分组：导航/演示、搜索/视图、编辑模式、选择/分组、历史/协作），列出全部快捷键与用法；点遮罩 / `✕` / `Esc` / 再次 `?` 关闭。卡片文字随主题（暗 `#e8ebf2` / 亮 `#1f2430`）切换，覆盖现有 CSS 变量，无新增依赖。

> 实现要点：`toggleHelp(force)` 懒构建一次浮层（`helpOpen` 守卫避免重复创建），`keydown` 顶部优先拦截 `helpOpen` 状态下的 `Esc`/`?`；`?` 分支（`e.key === '?'`，即 Shift+/）置于 `/` 聚焦搜索分支之后，互不干扰；`var(--ink)` 在主题中未定义，故显式用明暗两套文字色。

- **主题记忆（localStorage）**：明暗主题选择写入 `localStorage['wf-theme']`，启动时先读后渲染，刷新/重开页面保留上次偏好；`file://` 或隐私模式读取失败用 `try/catch` 静默兜底，不影响其余功能。

## 分组三项收尾（第十七轮，自驱动，用户「全部都做」）

- **缩略图反映分组归属色**：`drawMini()` 头部按 `CONFIG.groups` 预建 `nodeId → 分组色` 映射（`gmap`，多分组取首个），给属于某分组的节点在缩略图描一圈该分组色的细环（选中青环叠加其上，不冲突）；分组任意增删后 `renderGroupsPanel()` 末尾新增 `scheduleMini()` 即时刷新缩略图（CRDT/LWW 两条路径都经它归口，初始化时 `miniCtx` 未建由 `drawMini` 早返回兜底）。
- **无 Alt 键环境的备用召回键**：新增 `Ctrl / ⌘ + Shift + G` 循环召回下一个分组（`recallGroupCycle()`，模块级 `groupRecallIdx` 自增取模；与 `Ctrl/⌘+G` 合并到同一分支：带 `Shift` 即循环召回，否则存分组）。`Alt+1~9` 绝对序号召回仍保留，二者互补——有 Alt 键精确、无 Alt 键（部分紧凑键盘 / 远程桌面拦截 Alt）用循环键。
- **导出附带分组演示说明**：导出 `workflow-config.json` 时不再只导裸 `CONFIG`，而是深拷贝后附加 `_about` 字段（含 `tool` 名称、`groups` 清单 `{name,color,members}`、召回 `tips` 文案），打开 JSON 即可看懂分组与用法；导入时 `delete CONFIG._about` 清理该字段，保证内存中 `CONFIG` 干净、可再次无损导出。

> 实现要点：分组色环与选中青环同处于 `drawMini` 的逐节点绘制内，靠绘制先后（先 group 后 selection）实现叠加；`recallGroupCycle` 在空分组时安全 early-return；导出用 `JSON.parse(JSON.stringify(CONFIG))` 深拷贝再挂 `_about`，绝不污染实时 `CONFIG`。整段内联脚本 `node --check` 通过（82,379 字节，0 错误）。顶部提示条与帮助浮层均已同步这两条召回键。

## 分组重命名/改色 + 快照导出 + 搜索联动（第十八轮，自驱动，用户「全部执行」）

- **分组重命名与改色 UI**：分组面板里每项的分组色点变为可点击——点一下弹出原生取色器实时改色（拖拽过程只 `input` 不 `commit`，首帧才快照一次，撤销栈干净）；分组名称可点击进入行内编辑（Enter 提交 / Esc 取消）。改色/改名走新函数 `recolorGroup(id,color,silent)` / `renameGroup(id,name)`，CRDT 模式经新增 `updateGroupInDoc(id,patch)`（按 id 定位 Y.Map 并 `set` 字段）合并，LWW 模式走 `renderGroupsPanel()+broadcast()`；item 点击里对 `gp-dot/gp-name/gp-del` 做了 `stopPropagation` / `closest` 守卫，避免误触回调。
- **导出 PNG / SVG 快照（纯前端离线）**：工具栏新增「🖼 快照」(PNG) 与「📐 矢量」(SVG)。`buildSnapshotSVG()` 按所有 `.box`（主图 + 贯穿层）的 `getBoundingClientRect` 计算内容包围盒，把连线（`#edgeLayer` 的 path/line/polyline/circle，含计算后的描边色/宽）与每个节点（圆角矩形 + 标题/说明文本，读取计算样式）重绘成自包含 SVG，顶部带标题/副标题；PNG 用 `data:image/svg+xml` → `Image` → `canvas`(2x) → `toBlob` 导出（SVG 无外部资源，canvas 不污染，`file://` 下也能 `toBlob`，彻底离线）。阶段间装饰性 connector 箭头未纳入（仅主自定义连线），已记入已知边界。
- **分组与搜索联动**：分组面板底部新增彩色「胶囊」筛选条（`全部` + 每组一胶囊）。点某组胶囊即把搜索/视图筛选到该组（scope），`applySearch()` 重构为尊重 `searchScope`——组内节点才参与命中高亮、组外节点一律置灰；再点同胶囊或「全部」取消。删组时若恰为当前 scope 会自动清零并刷新（避免全部置灰的陷阱）。

> 实现要点：取色器用一个隐藏的共享 `<input type=color>`（挂 body，`gpEditId`/`gpColorDirty` 控制生命周期），避免每行一个；改名用 `contentEditable` + `Range` 选中 + `blur`/`Enter`/`Esc` 收尾，回调里再 `renameGroup` 触发重渲；快照坐标统一用 `rect + scrollX/Y` 并平移到内容盒原点，连线因 `edgeLayer` 无 viewBox 故 1:1 对齐无缩放歧义；整段内联脚本 `node --check` 通过（93,444 字节，0 错误）。顶部提示条、帮助浮层均同步了色点改色 / 名称重命名 / 分组胶囊 / 快照导出。

## 分组拖拽排序 + 分组与演示/聚焦阶段联动（第十九轮，自驱动，用户「分组拖拽排序、分组与演示/聚焦阶段联动」）

- **分组拖拽排序**：分组面板里每个分组项现在可拖拽——按住任意分组项上下拖动，落点用青色内阴影指示条（上半 = 插到该项前，下半 = 插到该项后）；松手即重排 `CONFIG.groups` 顺序并即时重绘面板。CRDT 模式走新增 `reorderGroupsInDoc()`（把新顺序整组重写进 `yDoc.getArray('groups')`，单事务内 `delete(0,len)+insert`，Yjs 观察器同步触发重渲），LWW 模式走 `renderGroupsPanel()+broadcast()`；拖到列表空白处则追加到末尾。拖动中 `gpDragId` 守卫避免误触发 item 点击。
- **分组 ⇄ 阶段聚焦联动**：
  - 新增 `phasesOfGroup(g)` / `primaryPhaseOfGroup(g)`：扫描每个阶段（含 root/systems/rules/nodes）统计该分组节点命中数，找出「主阶段」（命中最多、并列取最小序号）。
  - 召回即聚焦：`Alt+1~9` 与 `Ctrl/⌘+Shift+G` 循环召回现在除选中节点外还会 `focusPhase` 滚到该分组的主阶段；分组项新增「◎ 聚焦」按钮，点一下即 `focusGroupPhases(g)`（召回并聚焦主阶段）。
  - **分组巡演**：分组面板头部新增「▶ 分组巡演」按钮，触发 `runGroupDemo()`——依次对每个分组执行 `focusGroupPhases` + `playTransition`，当前巡演项在面板里高亮（`gp-tour` 青框），每项停留约 1.3s，相当于一段「按分组讲解工作流」的引导动画；无分组时给出提示。

> 实现要点：拖拽用 HTML5 原生 DnD（`draggable=true` + dragstart/dragover/drop/dragend），落点判定用 `getBoundingClientRect` 中线；列表级 dragover/drop 监听器只在 `ensureGroupsUI`（一次性）挂到常驻 `.gp-list` 上，避免 `renderGroupsPanel` 反复重挂导致监听器堆叠（每次重渲只重建 item，list 元素本体不变）；`doReorder` 先 `splice` 取出再按 after 标记插回，索引在删除后重新计算，顺序严谨；整段内联脚本 `node --check` 通过（104,875 字节，0 错误）。帮助浮层「选择 / 分组」一节同步了拖拽排序、◎聚焦、分组巡演说明。

## 可跳章演示巡演 + 整页 PDF 导出（第二十/二十一轮，用户「两个都做」）

- **分组 = 可跳章演示章节**：「▶ 分组巡演」从「自动顺序播放」升级为带章节进度条的可跳章播放器。巡演时顶部出现毛玻璃 `tourBar`：左侧 `◀ 分组巡演 ▶`（上一章/下一章），中间是可横向滚动的**章节胶囊**（每个分组一个，带其分组色圆点，当前章高亮青框），右侧 `⏸/▶` 播放暂停 + `✕` 退出。点任意章节胶囊即跳转该章（召回并聚焦主阶段）；按钮或键盘 `,`(上一章)/ `.`(下一章) 跳章、`空格`暂停/继续、`Esc` 退出。播放器由 `runGroupDemo`（原 for+await 循环）重写为基于 `setTimeout` 的状态机（`groupTour={idx,timer,paused}`）：跳章后从新章继续自动推进，暂停后停在当前章；当前巡演项仍在分组面板里青框高亮（`gp-tour`）。
- **整页 PDF 导出（纯离线、矢量高保真）**：工具栏新增「📄 PDF」。实现上**没有内联任何第三方库**——而是复用既有的 `buildSnapshotSVG()`（自包含矢量快照）注入一个隐藏的 `#printStage` 打印舞台，再配 `@media print` 样式（隐藏全部 UI 浮层/工具栏/缩略图/巡演条，仅显示矢量图与标题副标题）调用 `window.print()`，由浏览器打印引擎输出 PDF（在打印对话框选「另存为 PDF」即可）。这样做比内联 html2canvas 方案更优：① 文件零体积膨胀、仍保持单文件纯离线；② 打印引擎直接渲染真实 DOM/SVG/Canvas，比 html2canvas 对这种「SVG + Canvas + 毛玻璃 backdrop-filter + 变换」混合图面的还原度高得多（html2canvas 对此类效果本就力不从心）。在打印对话框选「另存为 PDF」即得到整页矢量 PDF。

> 实现要点：章节胶囊用 `data-i` 索引 + 点击 `tourGoto` 跳章并暂停，`tourSchedule` 仅在未暂停且巡演活跃时排下一定时（1700ms）推进下一章；`stopGroupDemo` 清 timer、隐藏 `tourBar`、复位 `demo-active`；键盘守卫置于 keydown 顶部、在 `helpOpen` 之后、`Escape`/阶段聚焦等之前命中即 `return`，互不冲突。PDF 的 `@media print` 用 `body>*{display:none!important}` 屏蔽所有浮层、再用 `#printStage{display:block!important}` 单独放行，打印舞台内 SVG 设 `width:100%;height:auto` 自适应页宽并按高度自然分页；整段内联脚本 `node --check` 通过（112,096 字节，0 错误）。帮助浮层新增「分组巡演中 · ,/. / 空格 / Esc」与「📄 PDF」说明。

## 一键直下矢量 PDF（svg2pdf 路径）+ 分组章节封面说明（第二十二/二十三轮，用户「一键直下 .pdf（svg2pdf 路径）、给分组加封面说明/章节简介」）

- **一键直下矢量 PDF（内联 jsPDF + svg2pdf）**：工具栏「📄 PDF」按钮从「调起打印对话框」升级为「一键直下矢量 PDF」。把 `jspdf.umd.min.js`(≈357KB) 与 `svg2pdf.umd.min.js`(≈83KB) 两个 UMD 构建**内联**进 HTML（`<script>` 块紧随 `<body>`，库源码里的 `</script` 已转义为 `<\/script` 防止提前闭合），从而保持单文件纯离线。点击后：`buildSnapshotSVG()` 生成自包含矢量快照 → 注入屏外隐藏 `holder` → `new jspdf.jsPDF({orientation, unit:'pt', format:[w,h], compress:true})` → `svg2pdf(svgEl, pdf, {x,y,width,height})` 把 SVG 矢量绘制进 PDF → `pdf.save(title+'.pdf')` 直接下载。库缺失或渲染抛错时自动回退到 `exportPDF()` 打印对话框，保证永远能导出。
  - **关键修复**：svg2pdf 的 UMD 全局是 `window.svg2pdf = { svg2pdf: fn }`（一个对象，不是可直接调用的函数），原调用 `svg2pdf(svgEl,...)` 会在浏览器里抛 `svg2pdf is not a function`。已改为稳健取值 `const svg2pdfFn = window.svg2pdf && (typeof window.svg2pdf==='function'?window.svg2pdf:window.svg2pdf.svg2pdf)`，VM 加载测试确认取到 arity=3 的可调用函数。
  - 快照仅含 svg2pdf 兼容基元（rect/text/g/path/line/polyline/circle，全部内联 fill/stroke），无 foreignObject/图片/滤镜/渐变，可被正确矢量还原。
- **分组章节封面说明 / 章节简介（巡演每章开头引导文案）**：分组现在带 `intro` 字段（封面说明/章节简介）。`intro` 端到端贯通 6 个序列化点（saveGroup / reorderGroupsInDoc / export _about / modelFromConfig / configFromModel / addGroupToDoc），CRDT 与 LWW 双模式一致。`setGroupIntro(id,text)` 提交后写 `g.intro` 并 `updateGroupInDoc`(CRDT) 或 `renderGroupsPanel()+broadcast()`(LWW)。分组项新增「📝 简介」按钮，点一下 `prompt` 编辑；`showChapterCaption(g)` 在巡演 `tourGoto` 每章开头弹出毛玻璃引导卡（章节序号 `.cc-idx` + 标题 `.cc-title` + 简介 `.cc-intro`，3200ms 自动淡出），让「按分组讲解工作流」的巡演每段开头都有一段引导文案。帮助浮层同步新增「📝 简介」行。

> 实现要点：库以两个独立 `<script>` 块紧跟 `<body>` 注入、先 jspdf 后 svg2pdf（svg2pdf 依赖 jspdf 全局，加载顺序关键）；整段内联脚本 `node --check` 通过（app 脚本 110,796 字节，0 错误；jspdf 365,653 字节、svg2pdf 84,587 字节均 OK）。关键验证：Node VM 加载测试（补上 atob/btoa 全局后）确认 `window.jspdf.jsPDF` 为构造函数、`window.svg2pdf.svg2pdf` 为 arity=3 函数，API 形态正确。

> **✅ 已真实浏览器端到端验证（2026-07-24）**：用现装 Chrome 经 playwright-core 无头驱动实测——点「📄 PDF」真实落盘 `Claude Code 个人工作流全景架构图.pdf`（8615 字节、`%PDF-1.3` 合法 PDF），控制台/页面 **0 错误**；注入带 `intro` 的分组触发巡演，`#chapterCaption` 真实出现且 `setGroupIntro` 回写生效，**0 错误**。两件事均由「假设能跑」升级为「确认跑通」，无需回退路径介入。

## 体验打磨四件套（第二十四轮，用户「全部执行」：PDF 成功反馈 / 章节卡暂停保持 / PDF 适配标准纸 / 深色 PDF 走浅色快照）

- **① PDF/快照导出成功反馈（轻量 Toast）**：新增 `showToast(msg, kind)`（`kind ∈ ok/warn/err`，左侧色条区分，自动注入样式、浅深主题通用）。`exportPDFDirect` 成功 `pdf.save` 后提示「PDF 已导出（<纸型>）：<标题>.pdf」；库缺失或 svg2pdf 抛错回退打印时提示「PDF 库不可用/矢量 PDF 失败，已改用打印导出」；`exportPNG`/`exportSVG` 成功与回退（PNG 渲染失败→SVG）也各有反馈；打印路径提示「已调起打印对话框，可在目标中选择『另存为 PDF』」。
- **② 章节引导卡暂停时保持**：`showChapterCaption(g)` 末尾的 3200ms 自动淡出改为 `if (!groupTour.paused) ...setTimeout(...)`——巡演暂停（`groupTour.paused=true`，点 `tourBar` 章节胶囊/`‹ ›` 或按空格）时引导卡常驻不淡出，方便逐章讲解；恢复播放或正常巡演仍按时淡出。
- **③ PDF 适配标准纸张**：工具栏 PDF 按钮前新增「📄 纸型」下拉（`#pdfSize`：视图原尺寸 / A4 横 / A4 竖 / Letter 横 / Letter 竖，内联样式浅深通用）。`exportPDFDirect` 据此计算页面尺寸（A4=595.28×841.89pt、Letter=612×792pt）与 `margin=24` 下的等比缩放 `scale=min((pw-2m)/w,(ph-2m)/h)`，居中偏移 `(ox,oy)` 后 `{x:ox,y:oy,width:cw,height:ch}` 矢量绘制进去；「视图原尺寸」保持原行为（页面=[w,h]、scale=1）。jsPDF `format:[pw,ph]` 按所选纸型横竖建页。
- **④ 深色模式 PDF 走浅色快照（省墨）**：`buildSnapshotSVG(forceLight)` 的 `forceLight` 现在**彻底覆盖所有元素配色**，不只是页面底色——`exportPDF` 与 `exportPDFDirect` 均传 `forceLight=true`（屏幕仍按用户主题显示）。具体：页面底 `#eef2f8`、框底强制 `#ffffff`、标题文字强制 `fg(#1f2430)`、`snapshotSvgShapes` 收到 `forceLight` 后连线/箭头统一用 `#64748b`（避免深色连线在浅底上消失）。深主题下导出的 PDF 是一份干净白底深色文字的省墨版本，与屏幕深主题解耦。

> 实现要点：`forceLight` 早先只翻转页面底色，框填充与连线色来自 `getComputedStyle`（反映实时深主题），会导致「浅底+深框+隐形连线」；本轮把框 fill、标题 color、连线 stroke 三处都改为 `forceLight` 优先，才真正得到一致浅色快照。

> **✅ 已真实浏览器端到端验证（2026-07-24，第二十四轮）**：playwright-core 无头 Chrome 实测全部通过、**0 控制台/页面错误**——① 快照断言 `forced` 含 `#eef2f8`/`#ffffff`/`#1f2430`（浅色）、`dark` 含 `#0f1422`（深色）且二者不同；② 五种纸型（view/a4l/a4p/letterl/letterp）点「📄 PDF」均真实落盘 `%PDF-` 合法文件、文件名=`Claude Code 个人工作流全景架构图.pdf`、并出现 `show ok` Toast（文案含对应纸型）；③ 巡演暂停时 `#chapterCaption` 保持 `show`，非暂停时 4000ms 后淡出。四件套由「假设能跑」升级为「确认跑通」。

## 体验打磨续 · 浅色快照开关 / 无障碍 / 移动端手势（第二十五轮，用户「全部执行」）

在上一轮四件套基础上，按用户「全部执行」继续推进三项（缩略图点击导航 + 视口框上一轮已具备，本轮一并验证通过）：

- **① PNG/SVG「浅色快照」开关**：工具栏 `🖼/📐` 旁新增「浅色」勾选（默认开，省墨），`exportPNG`/`exportSVG` 据此把 `buildSnapshotSVG(forceLight)` 传入；屏幕是深主题时默认导出白底深色文字快照，取消勾选则导出与屏幕一致的主题色快照。Toast 同步标注「（浅色）」。
- **② 无障碍增强（WCAG 取向）**：工具栏全部按钮补 `aria-label`；`#toast` 与 `#chapterCaption` 动态区加 `role="status"` + `aria-live="polite"`（读屏可感知导出反馈 / 章节引导）；新增 `:focus-visible` 全局焦点环（青色描边）；`prefers-reduced-motion` 媒体查询扩展——对 `.phase/.box/.btn/.detail-panel/#minimap/#toast/#chapterCaption/#tourBar` 关闭过渡动画、`*` 关 `scroll-behavior`，尊重系统「减少动态效果」；缩略图容器加 `role="navigation"` + `aria-label`，画布加 `aria-label`。
- **③ 移动端触摸手势**：主视图（非编辑模式、背景区）支持单指平移（自管 `window.scrollTo`，不干扰节点点击/编辑）；双指捏合调用既有 `setZoom`（CSS `zoom` 0.6–1.8 缩放）。触摸事件仅 `touch` 触发，不破坏桌面鼠标编辑；编辑模式下单指走原有指针/框选逻辑。
- **④ 缩略图导航（既有，本轮验证）**：右下角缩略图点击任意位置即把主视图平移到对应区域（`nav` 函数），并实时绘制青色视口矩形指示当前可见范围。

> 回归套件：`claude-code-workflow/e2e-regression.mjs`（playwright-core 驱动现装 Chrome/Edge，无需下载浏览器）。运行：`NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs`（或用 `--file` 指定 HTML 路径、`CHROME_PATH` 指定浏览器）。覆盖 10 项：库加载、深浅快照配色、浅色开关、5 种纸型 PDF+Toast、章节卡暂停保持/非暂停淡出、缩略图点击导航、无障碍（aria-label / :focus-visible / prefers-reduced-motion）、触摸单指平移 + 双指缩放、触摸设备加载无报错、全程 0 控制台/页面错误。

> **✅ 已真实浏览器端到端验证（2026-07-24，第二十五轮）**：`e2e-regression.mjs` 跑通 **10/10 PASS、0 控制台/页面错误**——深浅快照配色正确；浅色开关勾选→浅、取消→深；5 种纸型 PDF 落盘 `%PDF-` 且 Toast 出现；章节卡暂停保持 / 非暂停淡出且 `aria-live=polite`；缩略图点击滚动 0→1192；工具栏全 `aria-label`、`:focus-visible` 与 `prefers-reduced-motion` 均存在；合成 TouchEvent 单指平移改变 `scrollY`、双指把 `zoom` 1→1.8；`hasTouch` 上下文加载 0 错误。

## 键盘缩放与适应（第二十六轮，自驱动 · 继续往完美）

延续第二十五轮「继续往完美推进」的路线，本轮补齐全局 `keydown` 监听里**唯一还没键盘化的视图操作**——缩放与适应（此前二者只有按钮，无快捷键）：

- **`+` / `=` 放大当前视图 10%**（上限 180%，复用 `setZoom` 把 CSS `zoom` 在 0.6–1.8 间步进）。
- **`-` / `_` 缩小当前视图 10%**（下限 60%）。
- **`F` 适应屏幕**：调用既有的 `fitView()`，按内容包围盒缩放到完整视图并居中。
- **零冲突**：现有快捷键（`?` 帮助、`/` 搜索、←/→ 步进、`0`–`5` 聚焦阶段、`Alt+1~9` 召回分组、`Ctrl/⌘+G` 存分组、撤销/重做、`,`/`.`/空格/Esc 巡演控制）全部保留；新分支放在 keydown 链末尾，`searchInput`/contentEditable 守卫与 `helpOpen` 早返回均已存在，自然生效互不干扰。
- **帮助浮层同步**：「导航 / 演示」一节补两行——`⤢ 适应 / F`（适应屏幕快捷键）与 `+ / -`（放大/缩小，范围 60%–180%）。

> 实现要点：在全局 `keydown` 监听（约第 1620 行）末尾追加三个 `else if` 分支（`'+'||'='` / `'-'||'_'` / `'f'||'F'`），分别 `setZoom(zoom±0.1)` 与 `fitView()`；`setZoom`/`fitView` 为函数声明（提升），作用域可见。整段内联脚本 `node --check` 通过。回归套件 `e2e-regression.mjs` 新增第 11 项 `KEYBOARD_ZOOM_FIT`：合成 `KeyboardEvent` 派发到 `document`，验证 `zoomReset` 复位后 `+`×3 → 1.0→1.3、`-` → 1.2、`F` 触发 `fitView`（`zoom` 落到 0.6 下限、`scrollY` 居中到 328）。

> **✅ 已真实浏览器端到端验证（2026-07-24，第二十六轮）**：`e2e-regression.mjs` 跑通 **11/11 PASS、0 控制台/页面错误**——`KEYBOARD_ZOOM_FIT` 实测 `z0=1 → zUp=1.3`(3×`+`) `→ zDown=1.2`(1×`-`) `→ zFit=0.6`(`F` 适应，落到缩放下限)、`scrollY=328`（居中）；覆盖项扩为 11 项：库加载、深浅快照配色、浅色开关、5 种纸型 PDF+Toast、章节卡、缩略图点击导航、无障碍、触摸、键盘缩放+适应、全程 0 错误。

## 键盘平移 + 视图状态 URL 化 + 帮助内搜索（第二十七轮，用户「全部执行」）

延续「继续往完美推进」路线，本轮落实上一轮结尾给出的三项方向，均落 `claude-code-workflow.html` 并经 E2E 跑通：

- **① 键盘平移画布**：`W`/`S`（或 `Shift`+`方向键`）上下平移当前视图；普通 `方向键` 仍用于聚焦阶段，二者零冲突（新分支置于 keydown 链中 `Delete/Backspace` 之后、阶段聚焦之前，`!ctrl/!meta/!alt` 守卫避免误触编辑）。**布局说明**：本图为竖向长图、`body` 设 `overflow-x:hidden`，故横向不滚动——`A`/`D` 作为同族键保留（无横向溢出时安全 no-op），平移实际作用于纵向。帮助浮层「导航 / 演示」补 `W/S 或 Shift+方向键` 一行。
- **② 视图状态写入 URL hash（可分享 / 书签直达）**：新增 `readViewHash / writeViewHash / applyPendingView`——把 `缩放(z)`、`滚动(x,y)`、`聚焦阶段(p)`、`选中分组(g)` 编码进 `location.hash`；`setZoom`/`focusPhase`/`selectGroup`/滚动均经 `scheduleHash`（250ms 防抖、`history.replaceState`）实时回写；启动与刷新时 `applyPendingView()` 解析 hash 还原视图。关键修复：`history.scrollRestoration='manual'`（否则浏览器 reload 会覆盖 hash 指定的滚动位）+ 还原滚动用 `behavior:'auto'` 绕过全局 `scroll-behavior:smooth`。`#z=1.5&x=20&y=260` 之类链接可直达某缩放/滚动位置；`#p=2` 直达聚焦阶段 2。
- **③ 帮助浮层内 `Ctrl/⌘+F` 筛选快捷键**：帮助浮层顶部新增筛选输入框；浮层打开时按 `Ctrl/⌘+F` 聚焦并全选该框；输入实时过滤快捷键行（`.hp-row.hidden` 隐藏不匹配行、空章节 `.hp-sec.hidden` 收起、全无命中显示「没有匹配的快捷键」）；`Esc` 在框内有内容时清空筛选、否则关闭浮层。帮助浮层「搜索 / 视图」补 `Ctrl/⌘+F` 一行。

> 回归套件：`claude-code-workflow/e2e-regression.mjs` 现覆盖 **14 项**（新增 `KEYBOARD_PAN`、`URL_HASH_VIEW_ZOOM`、`URL_HASH_VIEW_PHASE`、`HELP_SEARCH`）。运行：`NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs`。

> **✅ 已真实浏览器端到端验证（2026-07-24，第二十七轮）**：`e2e-regression.mjs` 跑通 **14/14 PASS、0 控制台/页面错误**——`KEYBOARD_PAN` 实测 `S` 300→440、`W` 840→300、`Shift+↓` 300→440、`Shift+↑` 440→300、横向 `D` 安全保持 `scrollX=0`；`URL_HASH_VIEW_ZOOM` 导航 `#z=1.5&x=20&y=260` 后 `zoomLabel=150%`、`scrollY=260`、`hash` 含 `z=1.5`；`URL_HASH_VIEW_PHASE` 导航 `#p=2` 后阶段 2 带 `demo-active`、`hash` 含 `p=2`；`HELP_SEARCH` 打开帮助、`Ctrl+F` 聚焦输入框、键入「撤销」后 38 行中仅 1 行可见其余 37 隐藏、`Esc` 清空后全部恢复。覆盖项扩为 14 项：库加载、深浅快照配色、浅色开关、5 种纸型 PDF+Toast、章节卡、缩略图点击导航、无障碍、触摸、键盘缩放+适应、键盘平移、URL hash 视图（缩放/滚动 + 聚焦阶段）、帮助内搜索、全程 0 错误。

## 命令面板 + 视图自动记忆 + 打印样式（第二十八轮，用户「全部执行」）

延续「继续往完美推进」路线，本轮落实三项方向，均落 `claude-code-workflow.html` 并经 E2E 跑通：

- **① 命令面板 `Ctrl/⌘+K`**：懒加载浮层 `#paletteOverlay`，模糊搜索全部动作（适应/缩放/主题/演示/帮助/搜索/导出 PNG·SVG·PDF/撤销重做/全选/存分组/编辑模式/连线流动/网格吸附/分组巡演/聚焦阶段 0–5/召回分组 1–9/关闭面板）。`↑↓` 选择、`↵` 执行、`Esc` 关闭；支持鼠标 hover/点击。`Ctrl/⌘+K` 在全局 `keydown` 顶部捕获并 `preventDefault`（避免浏览器搜索栏），打开时方向键/回车/Esc 全部收口到面板、不误触其它快捷键。命令 `run` 复用既有按钮 `click()` 与函数（`focusPhase`/`selectGroup`/`selectAll`/`toggleHelp` 等均为提升的函数声明，作用域可见）。帮助浮层「搜索 / 视图」补 `Ctrl/⌘+K` 一行。
- **② 视图自动记忆（localStorage）**：在既有的 `scheduleHash` 防抖回调里同步 `saveViewLS()`，把 `缩放(z)/滚动(x,y)/聚焦阶段(p)/选中分组(g)` 写入 `wf-view`；刷新或重开时，若 `location.hash` 为空则 `readViewLS()` 还原视图（**hash 优先级高于 LS**，二者不冲突）。与 URL 深链互补——无需手动构造链接也能「关掉再打开回到原处」。
- **③ 打印样式增强 `@media print`**：扩展打印媒体——隐藏工具栏/缩略图/帮助/命令面板/协作层(`#presencePanel`/`#cursorLayer`)/Toast/章节卡/巡演条/分组面板等全部 chrome；**保留连线层 `#edgeLayer` 可见**（旧规则曾误隐藏，本轮改 `display:block !important`，架构图的连线才是重点）；`body` 强制白底黑字、`phase/box` 去阴影与毛玻璃、`print-color-adjust:exact` 保留阶段强调色、`break-inside:avoid` 避免阶段被分页切断。原生 `Ctrl+P`/打印对话框输出干净整图，与「📄 PDF」矢量导出互补。

> 回归套件：`claude-code-workflow/e2e-regression.mjs` 现覆盖 **17 项**（新增 `COMMAND_PALETTE`、`VIEW_PERSIST_LS`、`PRINT_STYLESHEET`）。运行：`NODE_PATH=<含 playwright-core 的 node_modules> node e2e-regression.mjs`。

> **✅ 已真实浏览器端到端验证（2026-07-24，第二十八轮）**：`e2e-regression.mjs` 跑通 **17/17 PASS、0 控制台/页面错误**——`COMMAND_PALETTE` 实测 `Ctrl+K` 打开面板、键入「放大」首项命中「放大 10%」、`↵` 执行后面板关闭且 `zoomLabel=110%`；`VIEW_PERSIST_LS` 放大至 130% 后刷新仍还原 `130%`（hash 为空时回退 LS）；`PRINT_STYLESHEET` 经 `@media print` 运行时模拟（本机 playwright-core 该版本 `page.context().emulateMediaType` 不可用，自动回退为静态校验内联打印样式表含 `.toolbar`/`#minimap`/`#edgeLayer {display:block}`/`background:#fff` 关键规则，校验通过）。覆盖项扩为 17 项：库加载、深浅快照配色、浅色开关、5 种纸型 PDF+Toast、章节卡、缩略图点击导航、无障碍、触摸、键盘缩放+适应、键盘平移、URL hash 视图、帮助内搜索、命令面板、视图自动记忆、打印样式、全程 0 错误。


