# 第十三轮 · 导航与视图（claude-code-workflow.html）

作为高级开发工程师，给「全景架构图」补上专业编辑器标配的导航能力——两项均为**纯只读 + 独立交互**，不触碰已有的拖拽 / 连线 / 协作（awareness）逻辑，零回归风险。

## 1. 缩略图导航 Minimap
- 左下角常驻毛玻璃小卡（与右下角在线面板对称），`<canvas>` 实时绘制全部节点 + 青色视口框。
- `contentBox(pad)` 用各 `.box` 的 `getBoundingClientRect` + `scrollX/Y` 求内容包围盒（页面用 CSS `zoom`，rect 已含缩放）；`drawMini` 按统一 scale 画圆角节点与视口框。
- 滚动 / 缩放 / 拖拽节点 / 窗口尺寸变化 → 经 `scheduleMini`（rAF 节流）重绘。
- 点击或按住拖拽缩略图（pointer capture）→ 主视图滚动到对应内容坐标中心；「✕」可隐藏。

## 2. 适应屏幕 Fit-to-view
- 缩放工具栏新增「⤢ 适应」按钮：`fitView()` 按内容包围盒与视口自动算缩放（0.6–1.8，复用 `setZoom` 的 CSS `zoom`），再把主视图滚到内容中心，一键看清整图。

## 验证
- 整段内联脚本提取 `node --check`：60,178 字节，**0 错误**。
- 浏览器交互实测需人工（无头环境限制）；已逐路径核对 init 顺序、函数提升、`miniCtx` 守卫、CRDT 异步 `renderDiagram` 发生在 `ensureMinimap` 之后。

## 文件
- 主交付：`claude-code-workflow.html`（单文件，默认即生效，无需后端）
- 说明：`README.md`（已补「导航与视图」小节）
