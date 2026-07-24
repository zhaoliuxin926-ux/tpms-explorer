# Round 22/23 — 一键直下矢量 PDF（svg2pdf 路径）+ 分组章节封面说明

> 交付物：`D:\TRAE AI\claude-code-workflow\claude-code-workflow.html`
> 模式：单文件 HTML / 纯离线 / CRDT(Yjs) + LWW 双协作模式

## 本轮完成的两件事（用户原话：「一键直下 .pdf（svg2pdf 路径）、给分组加封面说明/章节简介让巡演每章开头显示一段引导文案」）

### 1. 工具栏「📄 PDF」→ 一键直下矢量 PDF
- 把 `jspdf.umd.min.js`(365,653B) 与 `svg2pdf.umd.min.js`(84,587B) 两个 UMD 构建**内联**进 HTML（紧接 `<body>` 的两个 `<script>` 块，`</script` 已转义为 `<\/script` 防提前闭合）。保持单文件、纯离线，不依赖外网。
- 点击流程：`buildSnapshotSVG()` 自包含矢量快照 → 注入屏外隐藏 `holder` → `new jspdf.jsPDF({orientation, unit:'pt', format:[w,h], compress:true})` → `svg2pdfFn(svgEl, pdf, {x:0,y:0,width:w,height:h})` 矢量绘制进 PDF → `pdf.save(title+'.pdf')` 直接下载。
- **稳健回退**：取不到 jsPDF/svg2pdf、或渲染抛错时，自动调用 `exportPDF()` 调起打印对话框，永远能导出。

### 2. 分组「封面说明 / 章节简介」+ 巡演每章开头引导卡
- 分组新增 `intro` 字段，端到端贯通 6 个序列化点（saveGroup / reorderGroupsInDoc / export `_about` / modelFromConfig / configFromModel / addGroupToDoc），CRDT 与 LWW 双模式一致。
- `setGroupIntro(id,text)`：提交后写 `g.intro` 并 `updateGroupInDoc`(CRDT) 或 `renderGroupsPanel()+broadcast()`(LWW)。
- 分组项新增「📝 简介」按钮编辑；`showChapterCaption(g)` 在巡演 `tourGoto` 每章开头弹毛玻璃引导卡（`.cc-idx` 序号 + `.cc-title` 标题 + `.cc-intro` 简介，3200ms 自动淡出）。

## 关键修复（重要）
- svg2pdf 的 UMD 全局是 **对象** `window.svg2pdf = { svg2pdf: fn }`，不是可直接调用的函数。原写法 `svg2pdf(svgEl, ...)` 会在浏览器抛 `svg2pdf is not a function`。
- 改为稳健取值：`const svg2pdfFn = window.svg2pdf && (typeof window.svg2pdf==='function' ? window.svg2pdf : window.svg2pdf.svg2pdf)`。

## 验证
- 内联脚本三段 `node --check` 全过（app 110,796B；jspdf 365,653B；svg2pdf 84,587B）。
- Node VM 加载测试（补 `atob`/`btoa` 后）：`window.jspdf.jsPDF` 为构造函数；`window.svg2pdf.svg2pdf` 为 **arity=3** 可调用函数；`new jsPDF()` 正常，含 `.save`/`.output`。
- 快照仅用 svg2pdf 兼容基元（rect/text/g/path/line/polyline/circle，全内联 fill/stroke），无 foreignObject/图片/滤镜/渐变。

## 验证状态（已真实浏览器端到端确认 ✅）
- **2026-07-24 用现装 Chrome 经 playwright-core 无头驱动，对 `claude-code-workflow.html` 做了真实 E2E：**
  - PDF 导出：点 `#pdfBtn` 后真实落盘 `Claude Code 个人工作流全景架构图.pdf`，**8615 字节、`%PDF-1.3` 合法 PDF**，控制台/页面 **0 错误**。
  - 分组章节引导卡：注入带 `intro` 的分组并触发巡演，`#chapterCaption` 真实出现（`.cc-idx=1/1`、`.cc-title=演示分组`、`.cc-intro=这是章节简介引导文案`），`#tourBar` 生成；`setGroupIntro` 回写 `CONFIG.groups[0].intro` 生效。**0 错误**。
- 结论：Round 22/23 两件事均由「假设能跑」升级为「确认跑通」，无需回退路径介入。
- PDF 页尺寸用 `unit:'pt', format:[w,h]`（w/h 取自 px 包围盒），物理尺寸略放大（1px≈0.75pt），比例不变，视觉无碍。

## 文件改动
- `claude-code-workflow.html`：内联两库；新增/修改 `exportPDFDirect`、`svg2pdfFn` 取值、`setGroupIntro`、`showChapterCaption`、分组项「📝 简介」按钮、keydown/help 同步。
- `README.md`：新增「一键直下矢量 PDF + 分组章节封面说明（第二十二/二十三轮）」一节。
- `.workbuddy/memory/2026-07-24.md`：追加 Round 22/23 记录。
