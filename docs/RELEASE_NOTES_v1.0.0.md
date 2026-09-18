# Release Notes v1.0.0 — Version Epoch Reset & Bimodal Region

**版本代号**：`v1.0.0-stable-epoch`（自 v9.2.0-24families-hardened）

---

## 🧭 版本纪元说明（Version Epoch）

**2026-08 冲刺期发布的版本号（v0.x – v9.2.0，共 12 个 tag）为原型期快照**：当时以"每日战役"节奏推进，版本号被用作里程碑记录而非兼容性契约——三天内 v2.2→v7.0、相邻两天 v8.0→v9.0 的密度即是该时期的实录。这些历史 tag、GitHub Release 与 Release Notes 全部保留、不重写。

**自 v1.0.0 起进入语义化稳定序列**，发布规则（已固化于 `tpms/agent/ROADMAP.md` 约定节）：

- **minor**：用户可见的新能力批次（新曲面族 / 新构型管线 / 新交付格式）
- **patch**：缺陷修复与小改进
- 文档、门禁扩容、独立探针进 main 不发版；**论文对齐绑定 minor 轮**（同轮完成，杜绝账实漂移）
- CI 三平台绿后才打 tag（既有纪律不变）

---

## ✨ 新特性

### 🧩 径向双族分区构型 region（bimodal scaffold）
- **一个域内放两种 TPMS 族**（如外壳 gyroid + 内核 diamond），过渡带 smoothstep 凸组合平滑衔接——凸组合同号不变性保证过渡带不产生额外零等值面
- CLI：`mesh --region-inner <族> [--region-r 0.55] [--region-blend 0.15]`（互斥面与 radial-grad 同清单；两族共享 periods/iso）
- UI 卡（工程版「视图与工具」组）：13 族内区下拉 + r/b 滑块 + MT 一键预览（R48）+ HD STL 导出（R96 内置水密审计 fail-closed），与 CLI **逐位同源**
- **关键实测定案**：两族零面在过渡带拓扑重组为 surface-nets 结构性非流形（CLI 实测 nm 20~52，与 blend 无关）→ 走 Marching Tetrahedra 提取管线（radial-grad 先例同机理）；CLI 可产域矩阵 8/8 watertight（r∈{0,0.4,0.5,0.55,0.7,1}×b∈{0.15,0.2,0.3,0.45,0.6}，孔隙率 0.552~0.558 平滑过渡）
- **退化锚**：rSplit 端点（0/1）= 单族场级字节等价（探针 max|Δ|=0——确定性提取器下即 STL 字节等价）
- 对齐 radial-grad 范围：不进 tools.schema（LLM 工具面）/GPU IR/Python/MATLAB 导出链（先例口径）

### 📚 内容资产（随纪元首发收录）
- **演示视频 v3**（`docs/screenshots/demo-tour.webm`，104.4s）：开场引导浮窗自动关闭修复（旧版全程遮挡画面左上）+ 每幕 SCENE 时间戳实测对齐；**SRT 字幕 13 条**（`demo-tour.srt`，时间戳取自实测标记，B 站可直接挂载）；分镜脚本 v3
- **第二篇技术博客**《从一句话到水密 STL：LLM Agent 的安全架构实录》（`docs/blog/2026-09-17-agent-architecture.md`）：五层信任边界 / 拦截器红队六洞 / 四模型回归的三层验收语义；断言数字当轮实测（schema_check 106 / selftest 49 / llm_provider_selftest 33）
- **求职素材包**（`docs/career/interview-pack.md`）：简历项目描述（中英两档）+ 面试深挖七问（附证据锚点）+ 口述脚本

## 🔧 修复

- `run_ci_suite` 门禁自描述"7 套件"→"9 套件"（radialgrad/region 冒烟并入后的账实对齐）

## 📊 门禁增量

| 门禁 | v9.2.0 | v1.0.0 |
|---|---|---|
| probe_region（分区构型探针：退化锚/解析锚/连续性/同号不变性） | — | **10 断言**（独立探针不进 CI 调度） |
| run_all UI 回归套件 | 8 | **9**（+region 卡冒烟 6 断言） |
| **全量 CI 门** | 44 | **44（三平台）** |

## ⚠️ 透明边界（诚实披露）

- 兼容性：CLI 新增 `--region-inner/-r/-bl` 三个 flag，既有接口零变更；region 功能不进 LLM 工具面（与 radial-grad 同口径），schema_check 断言数不变（106）
- region 分区界面上两族晶胞不追求对齐（跨族晶胞共形匹配是研究级难题，非本功能口径）——过渡带由 smoothstep 权重平滑衔接，界面带实测质量见 probe_region 与 CLI 矩阵
- 演示视频为 headless swiftshader 录制（加载段约 31s 为无 GPU 环境特性，字幕已如实说明）；真机加载远快于录屏
