# Claude Code 工作流架构图 · 体验打磨四件套（第二十四轮）

在 Round 22/23（一键直下矢量 PDF + 分组章节简介）已 E2E 跑通的基础上，按用户「全部执行」落实 4 项体验打磨，均落在单文件 `claude-code-workflow.html`，并再次经真实无头 Chrome 端到端验证通过。

## 四项改动

1. **PDF/快照导出成功反馈（轻量 Toast）**
   - 新增 `showToast(msg, kind)`（`kind ∈ ok / warn / err`，左侧色条区分，样式自动注入，浅/深主题通用）。
   - `exportPDFDirect` 成功 `pdf.save` 后提示「PDF 已导出（<纸型>）：<标题>.pdf」；库缺失或 svg2pdf 抛错回退打印时提示告警；`exportPNG` / `exportSVG` 成功与回退各有反馈；打印路径提示「已调起打印对话框，可在目标中选择『另存为 PDF』」。

2. **章节引导卡暂停时保持**
   - `showChapterCaption(g)` 末尾的 3200ms 自动淡出改为 `if (!groupTour.paused) setTimeout(...)`。
   - 巡演暂停（点 `tourBar` 章节胶囊 / ‹ ›，或按空格）时引导卡常驻不淡出，方便逐章讲解；恢复播放或正常巡演仍按时淡出。

3. **PDF 适配标准纸张**
   - 工具栏「📄 PDF」前新增「📄 纸型」下拉（`#pdfSize`）：视图原尺寸 / A4 横 / A4 竖 / Letter 横 / Letter 竖（内联样式，浅深通用）。
   - `exportPDFDirect` 按纸型计算页面尺寸（A4 = 595.28×841.89pt，Letter = 612×792pt）与 `margin = 24` 下的等比缩放 `scale = min((pw-2m)/w, (ph-2m)/h)`，居中偏移后矢量绘制；「视图原尺寸」保持原行为（页面 = [w, h]、scale = 1）。

4. **深色模式 PDF 走浅色快照（省墨）**
   - `buildSnapshotSVG(forceLight)` 的 `forceLight` 从「只翻页面底色」升级为**彻底覆盖所有元素配色**：页面底 `#eef2f8`、框底强制 `#ffffff`、标题文字强制 `fg(#1f2430)`、`snapshotSvgShapes` 收到 `forceLight` 后连线/箭头统一 `#64748b`（避免深色连线在浅底上消失）。
   - `exportPDF` 与 `exportPDFDirect` 均传 `forceLight = true`，**屏幕仍按用户主题显示**，PDF 得到一致白底深色文字的省墨版本。

## 验证（playwright-core 无头 Chrome，0 控制台/页面错误）

| 项 | 结果 |
| --- | --- |
| 库加载 | `window.jspdf` ✅ `window.svg2pdf` ✅ |
| 快照配色 | forced 含 `#eef2f8`/`#ffffff`/`#1f2430`（浅）；dark 含 `#0f1422`（深）；二者不同 ✅ |
| 5 种纸型 PDF | 均落盘 `%PDF-` 合法文件、文件名 = `Claude Code 个人工作流全景架构图.pdf`、出现 `show ok` Toast（含对应纸型）✅ |
| 章节卡暂停 | 暂停时 `#chapterCaption` 保持 `show`；非暂停 4000ms 后淡出 ✅ |
| 错误 | 0 ✅ |

**RESULT PASS**

## 产出文件

- `D:\TRAE AI\claude-code-workflow\claude-code-workflow.html` — 主交付（已更新）
- `D:\TRAE AI\claude-code-workflow\README.md` — 新增「体验打磨四件套（第二十四轮）」小节 + E2E 验证说明
