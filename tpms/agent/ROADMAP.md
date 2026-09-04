# TPMS 专业 Agent 路线图

> 愿景：把 TPMS 平台从"人操作的浏览器工具"升级为"带可机读验收的领域 Agent"——
> 接收自然语言设计目标，自主完成 设计 → 仿真 → 验证 → 报告 闭环。
> 三条铁律：**LLM 不直写数值（一切数值由确定性代码生成或钳制）/ 边界诚实（教学级精度不冒充 Abaqus 级）/ 门禁说了算（结果可不可信由断言体系裁决）**。

## 里程碑

### M0 工具层地基（纯数学命令）— ✅ 已完成（2026-09-04）
- 交付：`tpms/agent/`（tpms.mjs CLI + core-loader.mjs + selftest.mjs）
- 模式：复用 .verify 的 rolldown 临时 bundle 方案在 Node 加载平台 TS 核心
- 命令：`list`（曲面/材料/模型常数）、`estimate`（Gibson-Ashby 力学估算，--json 机器可读）
- 验证：selftest 14/14——常数独立复刻、标度律 ρ̄² 不变量、退化极限 ρ̄→1、Schwarz P 权威公式 1e-12 对拍、4 类非法输入拒绝语义

### M1 几何闭环 — ✅ 已完成（2026-09-04）
- 交付：tpms.mjs 新增 `mesh` 命令——参数 → buildSurface（Surface Nets，Node 内经 rolldown bundle 直跑）→ 水密三硬指标内建门（开放边/非流形边/退化面任一非零即 exit 1 不产 STL）→ buildBinarySTL 落盘（mm 单位）
- 验证：selftest 27/27——水密硬门 + **STL 独立读回复核**（binary STL 字节级顶点配对数开放边，不复用 CLI 内建自检代码路径）+ R96 孔隙率收敛 ≤3pp（实测 1.0pp）+ 3 类参数防呆
- 口径事实（实测登记 bugs.md）：目标孔隙率（体素分位二分）与网格实测（发散体积）存在口径差，随分辨率收敛（gyroid R48 5.4pp→R96 1.0pp；倍频谐波曲面 diamond/splitp 在 R48 达 24-28pp）。CLI 如实报告偏差，>5pp 时提示提高 resolution；线性外推迭代校正因 iso 响应非线性不收敛，未采用
- 边界：misorientedEdges（定向错）为 mesh_audit 容差项非硬门，CLI 内建自检未复刻该指标（与 mesh_audit ok 判定的三硬指标口径一致）

### M2 工具注册层 — 未开始
- 目标：CLI 命令整理为 agent tool schema（JSON Schema，含各参数钳制范围，来源 nl-agent 钳制表）
- 成功标准：schema 覆盖 nl_agent_audit 现有 32 断言的意图类型；每个数值参数都有硬边界

### M3 LLM 接入 — 未开始（需先选定 API provider 并提供 key）
- 目标：LLM tool calling → 只填意图槽位，数值全部落 schema 钳制
- 成功标准：≥30 条中英文设计指令回归，无一处 LLM 直写数值；越界意图 100% 被钳制或拒绝

### M4 闭环驱动器 — 未开始
- 目标：propose → 执行 → 读门禁/审计结构化输出（CI RESULT 行）→ 修正重跑 循环
- 成功标准：注入带故意缺陷的初始方案，Agent 在有限轮内凭门禁反馈收敛全绿，全程无人工干预

### M5 骨支架场景模板 — 未开始
- 目标：第一真实场景固化——"目标孔隙率/力学指标 → gyroid 支架 → 仿真 → Abaqus/OpenFOAM 导出 + 验证报告"
- 成功标准：一条指令产出论文级参数表 + STL/INP + 与 Gibson-Ashby/文献带对比的验证报告

## 约定
- 每个 M 完成时更新本文件状态 + agent_memory/progress.md；新门禁进 .verify 前先在 agent/ 内自检（正式注册门禁会改变 CI 矩阵计数，须单独决策）


---

## 对标研究（2026-09-05 · 开源生态调研）

### 现有格局
| 项目 | 形态 | 有 | 无 |
|---|---|---|---|
| [RegionTPMS](https://github.com/metudust/RegionTPMS)（SoftwareX 2021，31+ 引用） | Python 脚本 | **解析 C↔孔隙率闭式映射**（exact porosity）、region 分区多相支架 | 交互界面、验证门禁、仿真导出 |
| [microgen](https://github.com/3MAH/microgen) | Python 库 | 周期网格、TPMS 多构型、文档站 | 浏览器交互、验证体系 |
| [TPMSgen](https://github.com/albertforesg/TPMSgen) / [LisbonTPMS](https://github.com/JorgeESantos/LisbonTPMS-tool) / [TPMS-Modeler](https://github.com/danielpmorton/TPMS-Modeler) | Python 脚本 | 基础生成 | 全栈导出、教学、agent |
| [MiniSurf](https://www.researchgate.net/publication/343653603) | 学术生成器 | **19 种曲面** + FEA 向 | 交互、验证 |
| [libfive](https://github.com/libfive/libfive) | f-rep 基础设施库 | 区间算术求值、缓存、Guile/Python 语言 | 应用层、领域验证 |
| [text-to-CAD 生态](https://github.com/topics/text-to-cad)（Zoo/CAD-Coder/verify-loop 系列） | LLM agent | **generate→execute→verify→fix 循环**已成收敛模式 | TPMS/多孔领域验证器 |
| nTop / Gen3D | 商业闭源 | 工业全流程 | 开源、教学 |

### 差异化结论
"**浏览器零安装交互 + 门禁验证文化 + 全栈导出（打印/仿真/论文复现）+ 中英教学 + 领域 Agent**"五合一在现有生态中没有占位者。39 道门禁在开源 TPMS 项目中是独有资产——text-to-CAD 生态收敛出的 verify-loop 模式里，验证器恰是我们的最强件。

### 直接可借鉴
1. **RegionTPMS 的解析 C↔孔隙率闭式映射**：M1 登记的口径差（体素二分 vs 网格实测）的正解路径——解析映射给初值 + 网格实测校验，替代纯二分。它发 SoftwareX 的先例（31+ 引用）同时是我们的发表路径模板。
2. **text-to-CAD 的 verify-loop**：与 M4 闭环驱动器同构，确认路线正确；实现时参考其 execute→measure→fix 迭代协议。
3. **libfive 的区间算术与缓存求值**：M4 大规模循环构建的性能参考。
4. **MiniSurf 的 19 曲面覆盖**：曲面库扩展的目标参照。

---

## 三阶段计划（结合 M0-M5）

### 阶段 A · 巩固与门面（现在 ~ 2 周）
- [ ] A1 平台级修复 3 项：stl-exporter 定向翻转（定向一致性进 selftest 断言）、poincare 延拓斜率改真导数 f'(rC)、F-2 四处头注宣称对齐——验证：新门禁断言 + 全量 39/39 绿
- [ ] A2 孔隙率解析映射：研读 RegionTPMS 源码闭式映射 → 实现解析初值 + 网格实测校验双段式——验证：R48 下 diamond 目标偏差 24pp → ≤3pp，全曲面族 ≤3pp @R96
- [ ] A3 GitHub 门面国际化：英文 README、topics 标签（tpms/lattice/bone-scaffold/webgpu）、issue/PR 模板、showcase 截图——验证：GitHub tpms topic 页可检索到本仓库
- [ ] A4 教学素材：LEARNING_PATH 配动画/视频（自制 3 分钟概念动画或嵌入权威视频）——验证：落地页可播放

### 阶段 B · Agent 化与学术化（1 ~ 2 月）
- [ ] B1 = M2 tool schema：CLI 命令 → JSON Schema（钳制范围源自 nl-agent 钳制表）——验证：覆盖 nl_agent_audit 32 断言全部意图类型
- [ ] B2 = M3 LLM 接入（前置：provider + key）——验证：30 条中英指令回归、零 LLM 直写数值
- [ ] B3 = M4 闭环驱动器（对标 verify-loop 协议）——验证：注入缺陷方案 N 轮内凭门禁反馈收敛全绿
- [ ] B4 SoftwareX 投稿（对标 RegionTPMS 同刊路径；docs/paper 手稿已在）——验证：获得投稿号；补充审稿人可复跑的门禁证据
- [ ] B5 BENCHMARKS.md 公开基准：解析锚点 + 与文献实验数据（Ti6Al4V gyroid/diamond）对比表——验证：外部用户可一条命令复跑

### 阶段 C · 扩展与社区（3 ~ 6 月）
- [ ] C1 region-based 梯度支架（多相分区变孔隙率，骨支架真实需求，对标 RegionTPMS）——验证：三区梯度支架解析孔隙率 vs 实测 ≤2pp
- [ ] C2 曲面库扩展（对标 MiniSurf 19 曲面，补齐族系 + 用户自定义公式的门禁覆盖）——验证：每新曲面 ≥1 解析锚点断言
- [ ] C3 与实验数据闭环：micro-CT/力学实验数据接入 ct_reconstruction 与 impact 模块做对比基准——验证：对比报告一键产出
- [ ] C4 社区机制：Discussions、案例 showcase、 CONTRIBUTING——验证：外部 issue 可_triage_

### 约定（不变）
- 每个 [ ] 完成时勾选并附 commit 号；每完成一件事必须对抗式审查后才算完成；验证标准不满足不得勾选。
