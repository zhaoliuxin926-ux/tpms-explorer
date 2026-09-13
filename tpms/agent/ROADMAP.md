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

### M2 工具注册层 — ✅ 已完成（2026-09-05；本节 2026-09-12 状态修正，原"未开始"为过时口径）
- 交付：`tools.schema.json`（tpms_list / tpms_estimate / tpms_mesh / tpms_scenario / tpms_design_verify 五工具，枚举与数值钳制范围与 CLI 实际校验逐项对齐；第五工具为 2026-09-12 M3→M4 桥接增补）+ `schema_check.mjs`（现 87 断言）
- 验收：nl-agent 参数类意图 100% 覆盖；每个数值参数都有硬边界；schema_check+selftest 自 2026-09-10 起转正进 run_ci_suite 调度（39→41 门）。过程与口径详见下方 B-t2

### M3 LLM 接入 — ✅ 全线达成（2026-09-12 真实模型回归 34/34）

> 【2026-09-12 验收】OpenAICompatProvider 接入智谱端点（key 走 env 不入库）+ llm_regression.mjs
> 34 条中英指令回归：**glm-4.6 34/34 全 PASS**（glm-4-flash 经济档 29/34，弱项全被拦截器安全兜住）。
> 对抗三样例（路径穿越/越界孔隙率/越界分辨率）两模型均拒绝或自钳制，零透传。
> 回归产出修复：SYSTEM_PROMPT 工具选择强化（杜绝幻觉文件名）、schema 别名对照表
> （diamond=Schwarz D 等）、nl-agent Schwarz D 别名 + 门禁 +2（42/42）、
> libuv win/async.c 断言根治（exitCode 排空替代 process.exit）。M0-M5 全线打通。
- **已交付**：`llm-provider.mjs`（LLMProvider 抽象 + OllamaProvider + MockProvider + validateToolCalls 拦截器）+ `llm-agent.mjs`（自然语言 → tool calling → CLI 执行循环）+ `llm_provider_selftest.mjs`（15/15，离线不依赖 Ollama）
- 铁律落地：LLM 产出逐槽位过 schema 钳制（enum/minimum/maximum/未知属性/未知工具/缺必填全拦截）；拦截失败 exit 2
- 用法：`node llm-agent.mjs --provider ollama --model qwen2.5:7b "设计一个孔隙率 75% 的 Gyroid 骨支架"`（需本地 ollama serve）
- 剩余：≥30 条中英文设计指令真实模型回归（需 Ollama 进程）；越界意图 100% 钳制验证

### M4 闭环驱动器 — ✅ 已完成（2026-09-12，tpms-driver.mjs）

> 闭环：propose→执行→读 verify 结构化输出→LLM 有界策略选修复（apply_repair：action enum+patches 槽位，M3 同源拦截器钳制）→确定性应用→重跑。梯内修复仍由 verify 确定性梯完成，驱动器接管梯外（换族/降周期/换容器/改模式/参数修正）与不可达宣告。
> 验收：Mock 离线自检 6/6（参数修正/梯外 R120/降周期/不可达 exit3/拦截器拒绝 exit2/轮数耗尽 exit4，原始文件零改写）+ 真实 glm-4.6 抽测 2/2 收敛 PASS（fcks R96→换族 gyroid R128 两轮；gprime k6 R96→periods 5 失败后自动换族 diamond 三轮）。
> 顺带修复 R128 扩容第三处漏点：verify LADDER/钳制 96→128（fcks R120 梯外修复曾被静默降回 96）。退出码 0/2/3/4。
- 目标：propose → 执行 → 读门禁/审计结构化输出（CI RESULT 行）→ 修正重跑 循环
- 成功标准：注入带故意缺陷的初始方案，Agent 在有限轮内凭门禁反馈收敛全绿，全程无人工干预
- **M3→M4 桥接（2026-09-12，tpms_design_verify 第五工具）**：NL 入口直连闭环——llm-agent 新增 tpms_design_verify 工具（槽位=design JSON 契约：type/porosity 必填 + material/periods/resolution/container/mode/isoGrad/out 可选），runDesignVerify 确定性写 `tpms-design-<type>.json`（文件名由已钳制白名单 type 派生，无路径注入面）→ spawn tpms-driver（provider 选项转发，TPMS_DRIVER_MOCK_DECISIONS 经 env 透传）→ 退出码透传（driver 4=轮数耗尽为 llm-agent 新增合法退出码）。mock 真实执行守卫保留 + `TPMS_ALLOW_MOCK_EXEC=1` 显式逃生门（离线闭环回归：mock 槽位 + mock 修复决策 + 真实 verify 执行）。验收：schema_check 72→87 断言全绿（enum 逐项对拍 + driver TYPES 静态哨兵 + 离线端到端四例：直通收敛/参数层拒→patch→2轮收敛/越界拦截/守卫保持）；llm_provider_selftest 33/33（工具数 5）；selftest 47/47。llm_regression G1-G3 闭环意图用例已登记（37 条），真实模型验收待 key（用户侧）。

### M5 骨支架场景模板 — ✅ 已完成（2026-09-07，scenario 命令）
- 交付：`tpms.mjs scenario --design 方案.json`——设计意图 JSON → Gibson-Ashby 解析预测 → exact 孔隙率求解（水密门 fail-closed）→ 水密 STL（mm）+ Abaqus INP（体素 C3D8+PBC 压缩工况，buildVoxelModel+buildAbaqusInp）→ 验证报告 MD+JSON（参数表/孔隙率双口径[网格实测 vs 体素分位]/Gibson-Ashby 文献带对比/交付物 sha256 指纹/诚实边界声明）。exit 0 必伴随四件交付物；exit 3 = 参数层结构化拒绝（与 verify 同构）或构建失败
- 口径事实：INP 体素孔隙率走 buildVoxelModel 内部体素分位二分（targetPorosity 口径），与 STL 网格实测口径并列披露随 R 收敛；材料泊松比为 CLI 确定性常数表（tc4=0.34/polymer=0.4/thermal=0.3）+ 报告披露；力学预测为解析工程口径非 FEA（报告内声明，schema description 同步声明勿向终端用户宣称仿真精度）
- 注册：tools.schema.json 第四工具 tpms_scenario（design 单参数，值全部入 JSON 文件）+ nl_agent 语义覆盖升级（run-simulation/preset-* → 🔶 scenario 部分覆盖）；schema_check 30→40 断言（含退出码分层/参数越界逐点/UNKNOWN_FLAGS 拒绝）+ 守卫基线 40；selftest 40→47（端到端交付/双口径 trace/INP 结构/诚实边界/拒绝语义）
- 验证：selftest 47/47 + schema_check 40/40 + 全量 39 门绿；实测冒烟 gyroid p0.65 tc4 R64×6：四件交付、网格实测 64.23%（偏差 0.77pp）、体素 64.99%、E*=5.12 GPa 带内
- ~~剩余：M3 LLM 接入（等 key）~~ ✅（2026-09-12 智谱端点 34/34 验收，Agent 闭环达成）

### v9.0 长程演进（2026-09-13 立项）

- [x] **方向三 experimental-fit** ✅（2026-09-13）：experimental-fit.ts（ISO 13314 标定反演）+ 门禁 43（18 断言）+ UI 卡片「试验曲线反演」（grp-sim 第 9 sect，文件拖拽/canvas 曲线/GA 实时对标；check_expfit_card.mjs 冒烟 4/4）。真实数据回填待试验机上机（PHYSICAL_TESTING_PROTOCOL.md §六 CSV 格式）
- [x] **C5 方向二（v9 旗舰）：任意解剖流形 STL 保形填充** ✅（2026-09-13：门禁 44 十断言全绿——SDF 解析对照 med 0.0003-0.0006、加权穿越符号 100%、相对水密（mesh nm 403 ≤ cube 1668）、贴合 max 0.0289≤半格口径、倒角壳 1.35×；详见下方 C5 收官注）——外部封闭三角网格输入（流形/水密自检）→ BVH 加速符号距离场 SDF_casing → 体素容器抽象扩展（cube/cylinder → 任意网格）→ Smooth-Max 场层过渡自愈（圆柱体验证过的算子复用，注：2026-09-06 曾证伪其解决 cylinder+diamond 薄壁自触的能力，此处用于**边界贴合倒角**是不同问题域）→ 门禁 44（非凸多面体+解剖骨切口用例，断言边界贴合度与水密性）。工程量大，独立长会话攻坚
- [ ] 方向一（真实 Agentic CAE 闭环）：待 TPMS_LLM_API_KEY + Abaqus 无头可用性验证（双阻塞）

## 究极对抗审查轮 v2（2026-09-13 · 4 红队 + 补位 · 5C+20M 全修 · df2a429/2cb5919）

- **红队 A（C5 引擎）3C+4M+6m**：CLI --container-mesh 假实装追认与真落地（1314fc7 补丁静默失败——node -e replace 未命中仍打印 success+门禁不覆盖 CLI flag 路径；本轮实装+端到端验证 box exit0/torus 碎片区 fail-closed）；融合 bump 内侧化（原 (0,blendH) 带恒实体穿壁壳 0.38——C5b 断言验证 soft 穿壁 0.0290）；导出重建第三注入点；M-1 容器格点下限；M-3 audit SDF memo；MINOR 四项。穷尽性声明：桶 ring 早停数学证明成立/weld 大坐标无误合并/扫描线对称平衡
- **红队 C（Agent 面）2H+7M+5L**：路径狱整串 ./.. 放行+EISDIR 崩溃被吞成结构化不可达（语义污染）；isoGrad 校验死代码（出口检查在校验前——非法渐变静默丢失照常交付）；REPAIR_TOOL 口径分裂统一；verify json fail 曾 exit0 假成功；workFile 语义反转；exit1 裸崩×4；容差 3pp 如实；LADDER 非档位先降后升；workFile pid；哨兵扩全槽位；maxRounds 拒非法。历史已修 5/5 交叉验证真修好、拦截器 17/17 无旁路
- **红队 D（门禁资产）2H+7M+5L**：空输出恒真链（vertCount=0 三断言零迭代全绿——变异实证后加非空前置）；基线守卫不防中和（三变体穿透——加比较器活性探针）；C3 松弛 cap800；计数口径三处；exit 前泄漏 chrome。异常短路 5 变体 fail-closed 验证通过
- **红队 B（experimental-fit）停滞→主会话按预判四攻击面补位**：S2 无平台坍塌命中（σpl 病态畸高 6×→物理不变量守卫）；S3 超长 Toe+30σ 毛刺三轮六方案实测终审为信息论 SNR 边界（毛刺斜率幅≥E* 时任何窗口统计不可辨识——工程正解=上游信号调理，详见 bugs.md S3 节全部实测数据）；R² 信号质量门留为正资产；S1/S4 防御在位
- **门禁反作弊升级**：conformal 10→12（非空前置×3+soft 穿壁）/expfit 18→19（活性探针）/schema_check 87→92（REPAIR_TOOL 全槽位哨兵+TYPES 第三副本对拍）；全量 44/44 复验绿
- **坑手册沉淀**：无命中断言的 replace 即隐患；功能宣称必须指认一条当时跑过的命令

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

## 能力对齐轮（2026-09-09 · 渐变等值场 UI 全链）

CLI 侧 C1/C2 能力补齐到浏览器 UI：构型设计组新增「渐变支架（C1）」控件组（开关+底部/顶部偏移+过渡带三滑条），state.isoGrad 全套（clone/setState Patch/DEFAULT）、main.ts 构建 params 映射（core/iso-grad.ts 共享折线语义单一来源）+ cacheKey 纳入渐变形状 + syncUI 控件同步 + url-params 分享序列化/恢复（ig/igH/igS/igB 全 clamp）+ 声子/组织/渗透禁用集扩展。开启时 targetPorosity 二分停用（互斥守卫），iso 走 baseIso 基准。验证：ui_jump 7/7（高亮迁移修复后计数 25→26 同步）、state_url 12/12、39/39 门绿、CI success（1237bbd）。

## 三阶段计划（结合 M0-M5）

### 阶段 A · 巩固与门面（现在 ~ 2 周）
- [x] A1 平台级修复 3 项（2026-09-13 收敛勾选，三项均已于既往轮次完成）：stl-exporter 定向翻转 ✅（2026-09-05：orientConsistently 全局传播 + parity_math 全局定向门禁化）、poincare 延拓斜率改真导数 f'(rC) ✅（2026-09-05：mapPoint 真导数 + py 镜像断言钉住）、F-2 类头注宣称对齐 ✅（2026-09-10：18 处头注全部对齐实现）——验证口径由"全量 39/39 绿"演进为**全量 42/42 绿**（2026-09-12 本机全量复验 + CI run 34702020524 三平台 success）
- [x] A2 孔隙率解析映射（2026-09-05）：`mesh` 命令默认 `--porosity-solver exact`——解析积分求根（确定性 LCG MC）+ 网格实测一轮割线（变差回退直出）。实测：R96 diamond 0.26pp / gyroid p0.5 1.96pp；R48 立方对称族 1.3~4.3pp；高谐波族（iwp/frd/lidinoid/splitp）R48 网格表示物理受限 8.7~23pp（legacy 二分对照 17.9~27.7pp，多数改善），>5pp 时输出升级分辨率提示。验收口径修订依据：R48 网格对 iso 的响应含顶点投影混沌敏感性（比例损耗因子实测漂移 ρ 0.94~1.72），R96 下割线后 ≤0.3pp
  - 对标源码事实：RegionTPMS 为 Mathematica notebook（非 Python），方法 = NIntegrate(Boole) 解析体积分 + bisection 反解——与本项目实现的"解析 MC 求根"同构
  - selftest 29/29（新增 R96 ≤1pp 断言 + solver 默认值检查）
- [x] A3 GitHub 门面国际化（2026-09-13 收敛勾选，三项完成一项余留）：英文 README ✅、issue/PR 模板 ✅、topics 标签 ✅（2026-09-06 经 GitHub API 设置并公开复核：tpms/lattice/bone-scaffold/webgpu/additive-manufacturing）——**余项：showcase 截图**（低优先，随手补）
  - [ ] A3 余项：showcase 截图（仓库 README 或 GitHub Social Preview 图）
- [ ] A4 教学素材：LEARNING_PATH 配动画/视频（自制 3 分钟概念动画或嵌入权威视频）——验证：落地页可播放

### 阶段 B · Agent 化与学术化（1 ~ 2 月）
- [x] B1 = M2 tool schema ✅（2026-09-05 完成；本行 2026-09-12 红队 C 核验补勾——tools.schema.json + schema_check 72 断言已转正进 CI 调度，验收即 M2 节）
- [x] B2 = M3 LLM 接入 ✅（2026-09-12 验收翻转，commit 951ce3e/7007486；本行 2026-09-13 收敛勾选）：OpenAICompatProvider 接智谱 + 34 条中英指令真实模型回归 **34/34**（glm-4-flash 经济档 29/34，异常全被拦截器兜住）+ 对抗样例零透传 + 拦截器自检 33/33 纳管 CI——验证标准"30 条中英指令回归、零 LLM 直写数值"超额满足
- [x] B3 = M4 闭环驱动器 ✅（2026-09-12：Mock 6/6+真实 glm-4.6 2/2，见 M4 节）
- [ ] B4 SoftwareX 投稿（对标 RegionTPMS 同刊路径；docs/paper 手稿已在）——验证：获得投稿号；补充审稿人可复跑的门禁证据
- [ ] B5 BENCHMARKS.md 公开基准：解析锚点 + 与文献实验数据（Ti6Al4V gyroid/diamond）对比表——验证：外部用户可一条命令复跑

### 阶段 C · 扩展与社区（3 ~ 6 月）
- [x] C1 第一批（2026-09-08，渐变等值场 isoGrad）：solid_network + z 向分段线性 iso 场（n 平台 + 过渡带，`--iso-grad "v0,v1,...@band"`）——**三区梯度支架验收达标：gyroid R96 三区（±0.12@0.4）水密 nm=0 且解析/实测偏差 0.09pp（≤2pp 线）；R48 dev 0.34pp**；R64 过渡带薄壁自触 nm=56 fail-closed（敏感，与 frd 族同性质）。实现：surface-nets biasAt 逐点偏置（四调用点+投影判据）、exact 求解链透传（缓存 key 掺渐变形状指纹）、scenario design JSON isoGrad 字段（INP 体素模型暂不支持渐变→诚实跳过+报告声明）。语义决策：连续渐变（水密天然保持）优先于 RegionTPMS 式硬拼接（异族界面非水密风险，留第二批）
- [x] C1 第二批（2026-09-09，异族拼接 CLI 化）：跨族水密缝合定案=**复用 Hybrid 凸组合平滑过渡**（F=w·F_A+(1−w)·F_B，linear 权重即两区平台+过渡带，场连续⇒零面闭合），零新机制、纯 CLI 暴露：mesh/solve --hybrid "typeB[:blend[:center[:width[:axis]]]]"（parseHybrid 守卫 + 与 isoGrad/legacy 互斥声明）。验收：GyroidIWP R96 linear 两区拼接 nm=0 水密（dev 0.35pp）；R64 过渡带薄壁自触 fail-closed（同族定性）。异族硬拼接（无过渡）语义已否决——非水密缝合不可行
- [x] C2 第一批（2026-09-08，8→13）：新增 **octo（O,C-TO，Schoen 立方四大族补缺）/ karcher（K）/ fks（Fischer-Koch S）/ fky（Fischer-Koch Y）/ gprime（G′）**——level-set 公式独立抄自 MiniSurf（Hsieh & Valdevit 2020, Software Impacts）官方源码 mengtinh/MiniSurf；全部低谐波（≤2 倍频）健壮族。四方同源同步：权威库/渲染实时求值守卫（防 diamond 梯度静默回退，历史 bug 同款形态）/GPU IR（parity 万点对拍守门）/script-exporter Python+MATLAB A/B 双语；解析锚点断言 8 条（原点精确值+对称性，parity_math 184→223+守卫 223）；schema枚举/CLI/UI 按钮/词表/常数表全链 13 文件。实测：R96 全部水密且孔隙率 ≤0.6pp；fks/fky R48 薄壁自触拒产（nm 9504/4752）已照 frd 同族钉住（schema_check 42→49+守卫 49）
- [x] C2 第二批（2026-09-09，场离散补偿=R128 档位扩容）：BufferPool 场缓冲 1M→2.5M 采样点（+24MB）、RES_CAP_HD 96→128 全链（units 单一来源/CLI 三处/schema maximum/surface-nets 容量闸/mesh_audit 超池红队案例 R110→R140 同步上移）。**Fisher-Koch C(S) 落地**（谐波 3×，四方同源 13 文件+IR sin3/cos3 乘法链+解析锚点 3 条：原点 3/偶对称/循环置换）；parity_math 223→232+守卫、schema_check 49→53+守卫、selftest list 14。实测：fcks R96 nm=10368 拒产（表示极限实锤）、**R128 单次构建探针实测 >36 分钟纯 CPU 仍未完成**（谐波 3× × O(R³) 场+投影差分的本质成本，非微优化量级）——fcks 定案为**预注册曲面**（公式/锚点/IR/schema 描述就绪、R48/R96/R128 均无实用可产分辨率，求解器级性能路径<并行/查表/legacy R128>后开放）；R128 档位的现实受益者=低谐波族高保真交付（gyroid/iwp R128 水密已验证） **【2026-09-10 翻转：本节 fcks 裁决已被证伪——「>36 分钟」实为索引池溢出 NaN 死循环，修复后 R120 水密可产，见下方 fcks 死循环根因轮】**
- [x] C2 第四批（2026-09-11，+fcky）：**Fisher-Koch C(Y)** 落地——MiniSurf 展示方程（document.xml 行 254-257；生成段 379 为另一 4 项简式，与 fky 同规约采展示方程）。与 fky 关系：低频 (ccc+sss) 反号、2 倍频组不变。四方同源 13 文件 + GPU IR（neg·w0·low + w1·hi）+ 解析锚点 4 条（原点 −1 / 循环置换 / 与 fky 低频反号 / (π/2,0,0)=0）。实测：**R48 p0.6 水密可产（nm=0，偏差 0.26pp）**、R96 同样水密——比 fky/fks（R48 拒产）更健壮。parity 264→274、schema_check 64→65、selftest list 18→19、mesh_audit +1 案例、hybrid typeB UI 补齐 19/19。
- [x] C2 第五批（2026-09-11，+cdd）：**Complementary D** 落地——MiniSurf 展示方程（document.xml 行 225-227/345-348），谐波 3× 混合角项展开为 1×·3× 乘积（cos(3x+y)cosz → cos3x·cosy·cosz 等 12 项）。四方同源 + GPU IR（sin3/cos3 恒等式，与 fcks 同款）+ 锚点 2 条（原点 3 / 循环置换）。实测可用域：**R96 p0.6 水密可产（nm=0，偏差 0.16pp）**；R48 fail-closed（nm 18252，与 dprime 同族）；R120 p0.6 仍拒产（nm 41472，iso 落点薄壁）、p0.5 R120 可产。parity 274→282、schema_check 65→67、selftest list 19→20、mesh_audit +1。
- [x] **fcks R128 性能路径裁决翻转（2026-09-11）**：R128 端到端仅 **~14s（k6）/~9s（k2）**——「>36 分钟/求解器级性能路径」主叙事作废（其依据为已修复的索引池 NaN 死循环）。真实约束=薄壁自触拓扑：k6 R128 fail-closed（nm 4896），但 **k2 R128 水密可产（nm=0，偏差 0.13pp，~9s）**——与 gprime/lidinoid 同族「降周期数避坑」。可产域 = R120 k6 ∪ R128 k2。schema_check +2 钉（R128 k2 可产 / R128 k6 拒产）。
- [ ] C2 剩余差集：Slotted P、F、Q*、W（**不在 MiniSurf 清单**，须另寻可靠文献源）；Double 系列已在第三批以展示方程落地
- [ ] C3 与实验数据闭环：micro-CT/力学实验数据接入 ct_reconstruction 与 impact 模块做对比基准——验证：对比报告一键产出
- [ ] C4 社区机制：Discussions、案例 showcase、 CONTRIBUTING——验证：外部 issue 可_triage_

### 约定（不变）
- 每个 [ ] 完成时勾选并附 commit 号；每完成一件事必须对抗式审查后才算完成；验证标准不满足不得勾选。


---

## 阶段 B 细化 · 发表与智能双轨（2026-09-05 定稿，4~8 周）

> 战略判断：一人项目的最大风险是范围失控。阶段 B 砍掉阶段 C 全部推迟项与 surface-nets 根因修复（只做量化审计），
> 收敛到两条主线——**SoftwareX 投稿**（研二时间窗口 + RegionTPMS 同刊 31+ 引用先例 + 投稿 deadline 是天然收敛动力 +
> 审稿要求恰好倒逼可复现性补全）与 **Agent 双轨 M2/M3/M4**（求职作品集主线，M2 无需 key 可立即开工）。

### B-t1 投稿包（第 1~2 周，最高优先）
- [x] B1.1 **LICENSE 文件** ✅（2026-09-05 已入库 MIT；本行 2026-09-12 核验补勾——根目录 LICENSE 存在，README 许可行+投稿清单均链接）
- [x] B1.2 手稿更新到当前事实 ✅（2026-09-11 完成对齐 v7.0 + 20 族 + 41 门——commit 0037c16/3376066；本行 2026-09-12 红队 C 核验补勾，原"停在 v5 口径"描述过时）
- [ ] B1.3 可复现包：一条命令复跑（`npm run test:all` 已满足）+ 数据/图生成脚本清单——验证：干净 clone → install → test:all 绿（CI 三平台即证据）
- [ ] B1.4 投稿提交——验证：拿到投稿号

### B-t2 M2 工具注册层（第 1 周，与投稿并行）
- [x] B2.1/B2.2 工具注册层 ✅（2026-09-05）：`tools.schema.json`（function-calling 三工具 list/estimate/mesh，枚举与钳制范围与 CLI 实际校验逐项对齐）+ `schema_check.mjs`（26 断言：结构/枚举遍历 8 曲面/数值边界 47·48·96·97 与 12·13/拒绝语义/双层守卫）。nl-agent 语义覆盖：参数类意图（TYPE 8/MATERIAL 3/MODE 2/CONTAINER 2/porosity 双口径）100%；动作类 export-stl ✅，export-3mf/run-simulation/reset/preset-* 4 项如实声明未覆盖（B-t3+/M5）
-     过程修正：①resolution 下限 24→48、periods 上限 16→12（R24 与 periods16 组合产不出水密网格，参数声明对齐物理）②退出码分层 2=参数错误 / 3=构建与水密门失败（LLM 消费方可区分"改输入"vs"升分辨率"）③porosity<0.3 低分辨率下水密门 fail-closed 属网格表示物理极限，schema description 如实声明。selftest 29/29 + schema_check 26/26

### B-t3 M3 LLM 接入（key 到位后 ~1 周）
- [ ] B3.1 provider 选型 + tool calling 接入（铁律：LLM 只填意图槽位）——验证：30 条中英设计指令回归、零 LLM 直写数值
- [ ] B3.2 失败语义：越界意图 100% 钳制或拒绝并引用 schema 字段——验证：对抗指令集（越界/注入/歧义）

### B-t4 M4 闭环驱动器（~2 周）
- [x] B4.0 mesh 内环自校正 `solve` 命令 ✅（2026-09-05，B4.1 的第一块）：解析求根起点 → 网格实测 → 两点割线（数值历史）→ 收敛 ≤tol 交付 / 不可达时结构化诊断 exit 3（stall/iso_boundary/non_manifold 三类原因 + suggestions 升分辨率建议 + best 备选）。实测：diamond R48 p0.65 三轮收敛 0.05pp；splitp R48 tol=0.05pp 触发 stall 判定输出 best=0.18pp 备选而非静默放弃。selftest 34/34（收敛/产出/不可达诊断/2 项防呆）。
- [x] B4.1 跨门禁 verify-loop ✅（2026-09-05，147814b）：`verify` 命令——设计方案 JSON → 四道检查（参数合法性/构建水密/孔隙率偏差/物理合理性）→ 失败按有限策略自动修复（孔隙率偏差升分辨率 R48→64→96 优先、已达上限用解析斜率割线微调；水密失败升档）→ pass 必伴随 STL+指标交付 / fail 必伴随结构化诊断+suggestions（exit 0/3 语义分层）。实测：diamond p0.65 R48 起步 5 轮升档收敛 PASS；porosity=1.5 坏方案参数层结构化拒绝。对标确认：text-to-CAD 生态 generate→execute→verify→fix 模式已在领域内落地
- [x] B4.2 不可达判定显式用例 ✅（2026-09-05）：iwp R48 tol=0.0005 → stall 于 4 轮（≤max-rounds），best=23.1pp 表示极限如实报告；verify 的水密检查补 misoriented 观测字段。selftest 35/35→execute→verify→fix 循环（读门禁 RESULT/GUARD 结构化输出，对标 text-to-CAD verify-loop）——验证：注入带缺陷初始方案（如孔隙率偏差超限、水密门失败），N≤5 轮自动收敛全绿（B4.0 已覆盖 mesh 内环；剩余为跨门禁 verify-loop）
- [x] B4.2 失败升级语义 ✅（2026-09-12 定案并入上条：不可收敛的结构化诊断已由 solve exit-3（stall/iso_boundary/non_manifold + suggestions + best 备选）与 verify 三类检查覆盖，iwp R48 tol=0.0005 stall 诊断即显式用例。原验收示例"p=0.999@R48 不可达"不当——实测 2 轮 PASS（99.95% 可达），该目标并非不可达）

### B-t5 质量债穿插清偿（不占主线，随审随修）
- [x] B5.1 体积损耗量化审计 ✅（2026-09-05）：`tpms/.verify/volume_loss_audit.mjs`（8 曲面 × R{48,64,96} × p 4 档 = 32 组合，独立运行不进 CI 调度）。**量化发现**：损耗 iwp R48 p0.65 最差 18.5pp、gyroid/lidinoid 最优 0~0.4pp，总体随 R 收敛；单胞/多周期解析口径差 1.7pp、网格与解析差 9~11pp（R48）——根因（场采样域一致性/投影体积收缩）登记 bugs.md 待平台级深挖
- [x] B5.2 cylinder+diamond R64 非流形（nm 740）：定位封盖/容器交线机制——✅ 定案（2026-09-08 诊断轮）：**"容器交线"假设被空间分布取证否定**（nm 边全域分布不贴壁）；单一根因=亚体素薄壁自触（详见 bugs.md 诊断定案）。修复裁决：nudge 探针证伪（iso 邻域平台状）+ 真拓扑修复成本超收益（v2 先例）→ fail-closed 为正确行为，触发域钉进 schema_check/tools.schema.json；cylinder R96 残余 nm=164 单组合登记延后
- [x] B5.3 stl-exporter 定向一致性进 parity_math 门 ✅（核验：2026-09-05 定向传播根治时已顺带门禁化——parity_math 2d 段"全局定向一致：共享边反向 0 违例"字节级有向配对断言在册并全量绿，ROADMAP 复选框漏勾，2026-09-08 补勾）
- [ ] B5.4 topics 手动添加（push 后）：tpms/lattice/bone-scaffold/webgpu/additive-manufacturing

### 阶段 C（3~6 月，B 交付后再细化——维持原清单：region 分区梯度支架 / 曲面库扩 19 族 / 实验数据闭环 / 社区机制）

---

## 优化推进轮（2026-09-06 · 六项全部落地）

| 项 | 状态 | 实测收益 | commit |
|---|---|---|---|
| surface-nets 投影 k 倍步长修复 | ✅ | iwp R48 固相 +21.5pp；splitp/iwp R48 0.05pp 容差 3 轮收敛（原 stall） | 51c034c |
| solve MC 样本量 120k→30k/40k | ⚠️→✅ | 终审实测 30k 固定种子噪声最差 0.235pp 超 0.12pp 宣称 → 提至 60k（固定种子 ~0.17pp，采样 4.38M→2.2M 仍省 ~0.35s） | a1208c2+终审 |
| iso* 跨进程缓存 | ✅ | 命中省 ~0.2s/次；终审加固：key 掺公式源哈希+权重+样本数（实现变更自动失活）、temp/rename 原子写 | a1208c2+终审 |
| CI 并行化（并发池 4） | ✅ | 全量 420s→294s（1.43×，长尾 run_all ~200s 串行封顶） | f13c75e |
| three.bundle 瘦身 | ✅ | 1.37MB→552KB raw（-60%，gzip 285→139KB），首帧主瓶颈消除 | cc1bba5 |
| 重建下放 Blob Worker | ✅ | 重建窗口 rAF 342 帧（主线程零冻结；同步路径阻塞 1.3-2.2s） | 87e6c80 |
| bindUIEvents 880 行拆分 | ✅ | 8 个区域命名函数 + 调度器，tsc 零错误 | 350f0c4 |

附带修复：UI 布局逃逸复发（f362d46）/混合 TDZ 崩溃（938592b）/深色对比度 1.21:1（7ec0097）/移动端顶栏竖排+浮层收纳+10 aria-label（7ec0097+f48719c）/verify 19 断言（Worker 守卫）。
新登记待攻：lidinoid p≥0.7 体素拓扑非流形（legacy 同病）。

## 优化轮独立终审（2026-09-06 · 双线子代理 · 全部发现已修复）

六项优化 commit 首次经独立终审（前端线/算法工具线并行）。裁决：51c034c / a1208c2 / cc1bba5 / 87e6c80 PASS-with-findings，f13c75e / 350f0c4 PASS。**0 CRITICAL，3 MAJOR（2 修复 + 1 范围外），7 MINOR（5 修复 2 登记）**。

| 发现 | 级 | 处置 |
|---|---|---|
| 87e6c80 hybridAlpha 未注入 Worker——教学版启用混合必"构建失败"（同步路径本正常，属 Worker 化回归） | MAJOR | ✅ WORKER_SRC 注入 hybridAlpha.toString()；free-vars 分析确认无其他自由变量 |
| 87e6c80 同步回退死代码：lastRequestSafe() 在置空后读取 → 无 Worker 环境（CSP/旧 webview）全瘫 | MAJOR | ✅ 快照后再置空；verify 新增"禁 Worker 仍渲染"回归门 |
| f362d46（范围外）误删 #structure-desc 唯一幸存元素 → 结构按钮/预设/URL 恢复三链路 TypeError 不重建 | MAJOR | ✅ field-note 恢复 id；探针实证 0 pageerror + 重建触发 |
| a1208c2 MC 30k 噪声 0.12pp 宣称失实（实测固定种子 0.235pp/跨种子 0.49pp） | MINOR | ✅ 提至 60k + 文档口径纠正 |
| a1208c2 iso 缓存无版本指纹/非原子写 | MINOR | ✅ key 掺 tpms-functions.ts 哈希+W+样本数；temp+rename |
| f13c75e 门无超时 + spawn error 无监听（挂死门拖死全池） | MINOR | ✅ 20min 超时强杀 + error handler |
| cc1bba5 bundle 重建脚本未入库（复现性只靠 prose） | MINOR | ✅ build_three_bundle.mjs 入库 docs/vendor（与产物 md5 逐位一致） |
| 87e6c80 Worker onmessage 组装区在 try 外 + verify 第 19 断言强度中等 | MINOR | ✅ 组装区纳入 try + verify 19→22 断言（混合路径/无 Worker 回退） |
| 51c034c manifold_audit 0.057° 新阈值余量仅 ~22%、单案例标定（重合顶点型退化仍拦截） | MINOR | 📋 登记不修（bugs.md） |
| 51c034c k 修复副作用：frd R48/R64 p0.6 薄壁自触 nm 20736/3840 fail-closed（R96 可构建；schema_check 不在 CI 调度致漏检） | MINOR | ✅ schema_check frd 案例钉住已登记拒产+R96 可构建，守卫 30 断言 |

数学复核：k 修复 stepN=fC/(k·len2) 独立推导吻合（len2=|g|² 平方口径核对无误）；守卫阈值乘 k 量纲一致；全库无其他同型单位错误。bundle 37 键对账全命中、shim computeVertexNormals 与真 THREE 对拍 0 差异、bindUIEvents 8 函数体逐字一致。缓存命中/未命中 solve 输出逐字节一致。

## CI 三平台转绿轮（2026-09-06 · 用户首次 push 触发 · 六层存量缺陷清零 + flake 加固层）

GitHub Actions 三平台矩阵自门禁 rolldown 化以来从未绿过（上次 push 早于 9/5，无人触发故无人知晓）；用户 push 后 run34-44 连续十红，逐层日志取证修复，run 45 首次三平台全绿。投稿"干净环境可复现"证据链自此为真。

**flake 加固层（run48-56，午后 GitHub runner 系统性慢化 3-6 倍背景）**：
| 层 | 根因 | 修复 |
|---|---|---|
| 7 | verify 16 处 networkidle 慢机永不达成 | → domcontentloaded + 条件等待全覆盖（b91d16b） |
| 8 | page.screenshot 30s 超时（swiftshader 合成器慢机不出帧，headless-gpu 老坑） | 截图降级产物非判据：15s+catch（8d9d172） |
| 9 | 导航单次失败即崩（失败形态漂移：networkidle→screenshot→reload） | goto/reload 统一 3 次重试（98b65a5） |
| 10 | **探针 A 实锤 python http.server 在 windows 裸并发丢 49%**（diag_server_windows.mjs SERVER-LAYER；旧"六连绿"是页面轻的假象）；探针 B node+Chromium 30 次零失败 | 三平台统一 node static-server（72e1d8a 分派错误已回撤，04894cc） |
| 11 | run54 重门 1200s 被强杀（runner 高峰慢化） | STEP_TIMEOUT 1800s（04894cc） |
| 12 | run55 run_all 启动即崩（join→path.join 被批量改写回退） | 一行修复（7b06780） |
| 13 | **verify 无声挂死真根因（run56-58 三平台 1800s 零输出）= reloadRetry 无限自递归**——98b65a5 批量 sed 把函数体内的 page.reload 也替换成自身；async 自递归不爆栈不抛错=永久挂起。此前两度误诊：本地 30min 挂起归因"环境"、CI 归因"runner 劣化"（重门超时确属 runner，verify 挂死纯属本 bug） | 修为 page.reload+防复发注释（6f94387）；本地 5min 硬超时 22/22 实证 |

**教训补：⑥批量文本替换会命中函数自身定义体**——包装函数改名时函数体内的原调用必中招；替换后必须目检新函数体（或 grep 自引用）；async 无限自递归的形态是"零输出静默挂起"，与"慢"难区分，判别法=本地加硬超时跑一次。

教训沉淀：①本机全绿 + CI 全红可共存数日——内核/门禁改动后必须在真 CI 上复验；②node 门禁链路里每一个 python/平台假设（路径分隔符、命令存在性、解释器版本、行尾）都是潜在 CI 假红；③条件等待必须按测试语义选目标（onboarding 等卡、渲染等 stats），固定 sleep 在 2 核慢机上是抛硬币；④逐字比较文件前先归一化行尾；⑤失败输出别过滤太狠（崩溃栈不在 FAIL 行里）；⑥**平台分派要用探针数据不能用历史绿run 归因**（页面负载变化会让"稳定组合"翻车）；⑦runner 性能是第三个变量——代码不变也可能全红，超时上限要按最坏 Runner 日校准。

| 层 | 根因 | 波及 | commit |
|---|---|---|---|
| 1 | 40 门自带打包引导硬编码 `rolldown.cmd` | Linux/macOS 每门 0.0s 秒崩 | 762520d |
| 2 | playwright 只装在本地 gitignored 目录；numpy 缺失 | 5 个 UI 套件 ERR_MODULE_NOT_FOUND；2 个 codegen 门 | 2fd0cde |
| 3 | 6 脚本硬编码 Windows chromePath；verify 固定 1.5s 等待慢机不够 | ui_jump_check + run_all | 9e1254b |
| 4 | fix_check 固定 2.5s 早于工程版 init（750ms 引导延时未到即采样） | fix_check B3 链 | 99183a7 |
| 5 | run_all 静态服务器强制反斜杠路径（win32 假设）→ 非 win `--directory` 指向不存在目录，**监听正常但全部 404**，5 套件拿空页（ready:complete 无 canvas 零报错） | run_all 全部子套件 | 5eb6322 |
| 6a | Chrome≥137 需 `--enable-unsafe-swiftshader`（旧旗标被忽略→软件 WebGL 创建失败→boot-error 兜底→引导卡 DOM 不存在） | verify/fix_check 时红时绿 | 8e2b8bd |
| 6b | WGSL 逐字比较撞 windows autocrlf（CRLF vs LF 差值=行数）；`python` 命令 macos 不存在（5 处 spawn）；numpy 装进与 spawn 不同的解释器 | webgpu_parity/gpu_plasticity/hybrid/custom_equation | a338fd2 |
| 7 | UI 门禁静态服务 python 依赖链终结：零依赖 node static-server.mjs（手工解析 req.url——`new URL('//app.html')` 协议相对陷阱恰为 BASE 尾斜杠拼接形状）；fix_check 顶栏按钮 DOM click（loading 覆盖层拦截 hit-test） | run_all/ui_jump/ui_mobile/fix_check | df60c1f + c218541 |

收官证据：**run 45 三平台全 success**（ubuntu/windows/macos）https://github.com/zhaoliuxin926-ux/tpms-explorer/actions/runs/34025777466 。本机每步均有对应套件复验（run_all 6/6、verify 22/22、fix_check 23/23、webgpu_parity 43/43、ui_jump 7/7）。

教训沉淀：①本机全绿 + CI 全红可共存数日——内核/门禁改动后必须在真 CI 上复验；②node 门禁链路里每一个 python/平台假设（路径分隔符、命令存在性、解释器版本、行尾）都是潜在 CI 假红；③条件等待必须按测试语义选目标（onboarding 等卡、渲染等 stats），固定 sleep 在 2 核慢机上是抛硬币；④逐字比较文件前先归一化行尾；⑤失败输出别过滤太狠（崩溃栈不在 FAIL 行里）。

## fcks 死循环根因轮（2026-09-10 深夜，P3 悬崖取证）
- **根因铁证（相位桩+子相位桩+进度桩三级定位）**：fcks R119+ 构建挂死非「谐波 3× × O(R³) 本质成本」，而是 **BufferPool MAX_INDICES=6M 溢出**——R128 扩容轮只扩场缓冲漏了索引/顶点池。fcks R120 需 6.174M 索引：pushTri OOB 写静默截断（TypedArray 无越界错）→ 8c 边键构建 OOB 读 undefined→NaN → 分组 while NaN!==NaN 永假 → i 冻结在 6,000,000 整数死循环（~2500 万转/秒纯烧 CPU）。
- **修复**：MAX_INDICES 6M→9M（覆盖 3M 三角）+ pushTri 显式容量守卫（溢出抛结构化错误，fail-closed 与池不变量一致）。
- **裁决翻转**：fcks R120 p0.6 实测 **水密可产 nm=0，偏差 0.35pp，端到端 21.6s**——「预注册曲面/无实用可产分辨率/求解器级性能路径挂起」三项裁决全部作废；新可用域=R48/R96(nm 10368)/R128(nm 4896) 拒产夹 R120 中段孔隙率可产带（红队复测 p0.5/0.6/0.7 均 nm=0）。schema_check +R120 修正钉；tools.schema/BENCHMARKS 同步。
- **教训**：①「CPU 时间增长=在计算」判别法对无限循环失效（死循环也烧 CPU）——挂死鉴别须加相位桩；②TypedArray OOB 写零告警是静默截断源，容量类守卫必须覆盖全部池数组而非只 field。

## 登记缺陷清欠轮（2026-09-10）
- **R128 容差标定收官**：官方容差矩阵标定域 k≤5/R≤96 → **正式延伸至 k≤5/R128**。新探针
  `.verify/r128_tolerance_probe.mjs`（独立运行不进 CI，同 volume_loss 先例）：12 代表族案例
  （gyroid k{1,2,3,5}/diamond/schwarz shell/gradshell z/倍频三族/lidinoid/splitp）在 mesh_audit
  相对容差外推下 12/12 PASS——最紧 frd 定向错 4230/阈 7562（44% 余量）、体积最差 iwp −4.53%/阈 12%；
  R128 单案例构建仅 1.6~4.4s。数据表 r128_tolerance_table.json。
- **gprime 拒产域钉住**：默认周期数 k=6 R96 p0.6 fail-closed（nm 19080，B5 基准一致）；k=2 R96
  可产（nm=0，偏差 0.2pp）——"择 band 可避"量化为**降周期数可避**。schema_check 55 断言（时点值；2026-09-12 红队后为 75）
  （+3 gprime 案例）+ tools.schema.json 量化声明。
- **C-9 修正**（digital_twin 门禁）：D 节坍塌断言二择一 `collapsed||allConverged` 收紧为严格
  `collapsed===true`（场景实测确定性坍塌 strain=0.018；旧写法放过"坍塌停止发生"回归），
  坍塌应变窗口断言改无条件执行。
- **C-7 修正**（hierarchical 门禁）：E 节 vm/壁厚因子改用平台导出 stressAt/stressThicknessScale
  （旧本地复刻=冻结副本，平台公式漂移审计仍绿）；变异测试实证有牙（平台公式反向→17/1 红）。
- **bugs.md 过时条目清理**：poincare 斜率公式/stl 定向传播/Tb.Th 头注/buffer-pool normals 四项
  实为 2026-09-05 轮已修，登记滞后。

## 究极对抗审查轮（2026-09-12 · 3 路红队 + 主会话补查 · 全部发现已修复）

3 路并行红队（A: M3 LLM 层 / B: fcky/cdd 四方同源 / C: 文档声明一致性+UI 回归），攻击脚本在 %TEMP%\tpms-audit2，仓库零写入。**1 CRITICAL + 8 MAJOR + 12 MINOR，全修**。

### A 路（LLM 层——M3 交付后首次对抗审查）
- **[已修·CRITICAL] validateToolCalls 对 `out`/`design` 路径槽位零校验**——LLM 可控路径穿越任意写/读（mock 实锤 `out:"../x.stl"` 落盘 cwd 之外；数字/布尔 out 亦放行）。修复：schema pattern 路径狱（单段安全文件名 `^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$`）+ validator 实现 pattern/严格 string 校验
- **[已修·MAJOR] OllamaProvider fetch 无超时**（不响应服务端永久挂起）→ AbortSignal.timeout 默认 120s
- **[已修·MAJOR] 标量 arguments**（`"null"`/`"5"`）→ 未捕获 TypeError 裸堆栈 exit 1，或静默吞成空参数真实执行 → parse 后强制 plain-object 校验，结构化 exit 2
- **[已修·MAJOR] isoGrad 对象槽位内容零校验 + runCli 误发 `--isoGrad`**（CLI 只认 `--iso-grad`）→ agent 通道该功能 100% 失败且畸形对象免检 → validator 递归子 schema（values 2~6 个 [-1.5,1.5]、band 0~2、additionalProperties:false）+ runCli 显式映射 `--iso-grad "<v0,...>@band"`
- [已修·MINOR] `'k in props'` 原型链键名绕过未知属性拒绝 → `Object.hasOwn` 全量替换
- [已修·MINOR] mock provider 不带 `--dry-run` 可真实落盘 → 默认拒绝 exit 2
- [已修·MINOR] 数值/布尔强制转换怪象（"75"→75、[5]→5、true→1）→ 严格 typeof 校验
- [登记·待用户决策] llm_provider_selftest 33/33（守卫 30）尚未注册进 run_ci_suite——注册改变 41 门矩阵计数，按本文件约定留单独决策
- 攻击不可行清单（审查深度证据）：spawnSync 数组参数无 shell 注入、原型污染写入、越界数值/未知字段到 CLI、`out:"--resolution=1"` flag 混淆、Ollama 非 200/非 JSON/空 tool_calls、深嵌套 JSON——全部被既有层拦截

### B 路（fcky/cdd 四方同源——公式层全绿）
- **正面结论**：8 处公式出现点逐字符一致（无 diamond 式双定义分裂）；cdd 12 项展开 ≡ 混合角原式 maxdiff 2.22e-15（100 随机+27 角点）；解析锚点独立复核全过（fcky 原点 −1 任意权重、(π/2,0,0)=0、循环置换 ≤1.8e-15）；fcky+fky=2w₁·hi 低频反号恒等式残差 1.3e-15；权重计数 fky/fcky=2、fcks/cdd=1；parity 282 / webgpu 101 / nl_agent 40 / mesh 实跑全绿
- **[已修·MAJOR] script-exporter 应力×hybrid 组合坐标分裂**：Python B 场用变换前坐标（A 场用 Xs）→ 改 `tpms_field(Xs,Ys,Zs,…)`；连带发现 MATLAB 波前/容器 SDF 被 `X=Xs` 就地替换污染（平台语义=物理空间取点）→ 保存 X0/Y0/Z0，波前/容器恢复原始坐标
- [已修·MINOR] 宣称-钉住缺口：fcky "R96 可产"补双钉（R48+R96）；cdd R48 补 nm=18252 数值钉；fcks 宣称带 p0.5–0.7 补 p0.5/p0.7 端点钉——schema_check 72→75
- [登记·平台既有缺口→已闭环 2026-09-12 晚] stress×hybrid 组合在平台渲染路径静默忽略应力——**定案走组合路线**：surface-nets hybridFn 创建点包装 transformByStress（度规坐标 warp、波前留物理域，与脚本侧「A/B 同变换坐标+波前物理空间」定案对齐），四处调用点经创建点统一生效；壳厚 vm 调制（物理域）本就组合。GPU 路径应力开启即回退 CPU 不受影响；单文件版无 stress 不在范围。门禁=hybrid_audit ④ 节（组合水密+网格贴 warped 零面 max 5.28e-4+素场偏移中位 0.379 杀静默忽略+同 iso 孔隙率位移 0.081pp），基线 5→9

### C 路（文档声明一致性 + UI 回归）
- **正面结论**：20 族/41 门/断言数 26 条 claim 全对齐；BENCHMARKS.md 与 benchmarks-latest.json 40 格零漂移；ROADMAP commit 号抽查 8/8 存在；UI !important=7、reduced-motion 在位、C2 active 色 20/20、分组计数 12/8/1/5=26
- **[已修·MAJOR] WORKFLOW_GUIDE TOC 缺二十六~三十 5 章 + 26/31 锚点失效**（emoji slug 尾连字符）→ 程序化重生成 36 项（github-slugger 算法忠实实现）
- **[已修·MAJOR] G-code 导出宣称与实现脱节**（README_EN 工程版清单 + GUIDE 廿四章称导出中心有按钮；实际 UI 从未接线）→ 文档诚实化"引擎+门禁 25 就绪，UI 入口未开放"
- **[已修·MAJOR] COVER_LETTER 39-item → 41-item**
- **[已修·MAJOR] ROADMAP 复选框与事实矛盾 4 处**：B1 补勾（M2 已完成）、B1.2 补勾（手稿 09-11 已对齐）、A3 拆分标注（英文 README✓/issue 模板✓/余 topics+showcase）、schema_check 计数标注时点值
- [已修·MINOR] README 三十五章→三十六；GUIDE「36 门」历史口径标注；focus-visible 宣称 18→实数 17（注释行误计）；构型组徽章 11→12（重建 docs/platform）；run_ci_suite schema_check 标签 71→75；tpms/README run_all 位置描述删除

### 主会话补查
- B4.2 原验收示例探针证伪：p=0.999@R48 实测 2 轮 PASS（99.95% 可达）——结构化诊断已由 solve exit-3 覆盖，并案定案（2026-09-12 晨 0c25426）
- llm-agent mock dry-run 全链路回归 + 红队 A 两攻击复现（穿越写/标量崩溃）封死确认
- llm_provider_selftest 扩容 15→33 断言（守卫 30）：路径狱×5、isoGrad 子 schema×4、标量 arguments×3、原型链键、严格类型×2、逐调用归属、Ollama 超时、mock 守卫 e2e

**验证**：schema_check 75/75 + llm 自检 33/33 + tsc 0 错 + vite build + docs/platform 重建 + 全量 41 门复验。

## 下一步（更新）
1. **用户操作**：署名三项（作者拼写/单位/LICENSE 版权行）→ Editorial Manager 注册提交 → 回填投稿号。
2. B-t3 LLM 接入（等 key）。
3. 可选深水区：surface-nets 场离散原子化（R48/k6 仅 1165 互异场值）的分辨率补偿、lidinoid 高孔隙拓扑。
   ~~cap 段 Map→TypedArray（再省 1.2s/R96）~~ ✅（2026-09-07 性能轮 1748e17：cap 段与 CLI audit 边计数
   Map→pack 排序聚合 + 分位数排序→桶计数 + verify 循环 solveIsoAnalytic 外提，R96 场景全线 -8%~-46%，
   输出指纹逐字节一致，39/39 门绿）

