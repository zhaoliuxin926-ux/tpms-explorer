# 演示视频分镜脚本（demo-tour.webm · 85s 素材）

素材：`docs/screenshots/demo-tour.webm`（1280×800，playwright 录制，`node tpms/.verify/gen_demo_video.mjs` 可复现）。
发布建议：B 站/知乎视频，配音后可加字幕；以下旁白稿按幕对齐时间轴。

| 幕 | 时间轴 | 画面 | 旁白稿（建议） |
|---|---|---|---|
| 1 | 0:00–0:05 | 默认 Gyroid 几何自转 | "这是三周期极小曲面——Gyroid。它在浏览器里实时重建，零安装。" |
| 2 | 0:05–0:15 | 8 族曲面轮播（Diamond→Schwarz P→Neovius→I-WP→F-RD→Lidinoid→Octo→Karcher） | "平台收录 24 族曲面：从经典的 Gyroid、Diamond，到 Fischer-Koch、Slotted P、Q* 等扩展族，一键切换。" |
| 3 | 0:15–0:19 | 孔隙率滑块 75→45，几何实时变疏 | "拖动孔隙率滑块，实体与孔道此消彼长——目标孔隙率经解析求解器校正，实测偏差在 1 个百分点内。" |
| 4 | 0:19–0:31 | radial-grad M(r) 卡：切 Schwarz P→点生成→MT 预览+孔隙率读数 | "这是径向梯度构型：中心致密、边缘疏松，Marching Tetrahedra 提取器保证水密——所见即可打印。" |
| 5 | 0:31–0:37 | 直接层切预览生成（扫描线视图） | "不经三角网格，直接在隐式场上扫描切片——增材扫描路径直接可见。" |
| 5.5 | 0:31–0:40 | radial-grad 卡「导出 STL (HD)」：R96 MT 提取→水密审计门→下载 tpms-radial-grad-K1.5-ta0.2-tb0.322-c3.stl | "一键导出高清 STL——内置水密审计门与 CLI 同标准，不水密即拒绝写盘。" |
| 6 | 0:40–0:46 | 层位 Z 滑块扫过三层断面 | "逐层检查断面拓扑，导出 SVG 或工业 CLI 格式交给切片机。" |
| 尾 | 0:46+ | （录屏素材止；建议补录）CLI 水密输出 + GitHub 首页 | "从数学到交付：44 道 CI 门禁三平台守护。github.com/zhaoliuxin926-ux/tpms-explorer" |

补录建议：幕 7 用 OBS 录终端 `node tpms/agent/tpms.mjs mesh …` 水密输出（屏幕文字最有力）；结尾定格仓库首页（三屏速览图位置）。
