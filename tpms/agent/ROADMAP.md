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
- [x] A2 孔隙率解析映射（2026-09-05）：`mesh` 命令默认 `--porosity-solver exact`——解析积分求根（确定性 LCG MC）+ 网格实测一轮割线（变差回退直出）。实测：R96 diamond 0.26pp / gyroid p0.5 1.96pp；R48 立方对称族 1.3~4.3pp；高谐波族（iwp/frd/lidinoid/splitp）R48 网格表示物理受限 8.7~23pp（legacy 二分对照 17.9~27.7pp，多数改善），>5pp 时输出升级分辨率提示。验收口径修订依据：R48 网格对 iso 的响应含顶点投影混沌敏感性（比例损耗因子实测漂移 ρ 0.94~1.72），R96 下割线后 ≤0.3pp
  - 对标源码事实：RegionTPMS 为 Mathematica notebook（非 Python），方法 = NIntegrate(Boole) 解析体积分 + bisection 反解——与本项目实现的"解析 MC 求根"同构
  - selftest 29/29（新增 R96 ≤1pp 断言 + solver 默认值检查）
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


---

## 阶段 B 细化 · 发表与智能双轨（2026-09-05 定稿，4~8 周）

> 战略判断：一人项目的最大风险是范围失控。阶段 B 砍掉阶段 C 全部推迟项与 surface-nets 根因修复（只做量化审计），
> 收敛到两条主线——**SoftwareX 投稿**（研二时间窗口 + RegionTPMS 同刊 31+ 引用先例 + 投稿 deadline 是天然收敛动力 +
> 审稿要求恰好倒逼可复现性补全）与 **Agent 双轨 M2/M3/M4**（求职作品集主线，M2 无需 key 可立即开工）。

### B-t1 投稿包（第 1~2 周，最高优先）
- [ ] B1.1 **LICENSE 文件**（当前缺失 = 法律上保留所有权利，投稿硬阻断）：选 MIT 或 CC-BY-4.0+MIT 双许可——验证：根目录 LICENSE 存在且 README 徽章更新
- [ ] B1.2 手稿更新到当前事实：MANUSCRIPT/main.tex 停在 v5 口径——补 exact 孔隙率求解器（0.26pp@R96）、全局定向传播（misoriented=0 由构造）、39 门禁/1000+ 断言验证体系、CLM 与 tsc/vite 工具链；补"诚实边界"节（网格体积损耗数据、高谐波曲面 R48 极限）——验证：稿件中每个数字可溯源到门禁或审计脚本
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
- [ ] B4.2 失败升级语义：不可收敛时输出结构化诊断报告（非静默放弃）——验证：注入不可达目标（如 p=0.999@R48）能在 2 轮内判定并报告

### B-t5 质量债穿插清偿（不占主线，随审随修）
- [x] B5.1 体积损耗量化审计 ✅（2026-09-05）：`tpms/.verify/volume_loss_audit.mjs`（8 曲面 × R{48,64,96} × p 4 档 = 32 组合，独立运行不进 CI 调度）。**量化发现**：损耗 iwp R48 p0.65 最差 18.5pp、gyroid/lidinoid 最优 0~0.4pp，总体随 R 收敛；单胞/多周期解析口径差 1.7pp、网格与解析差 9~11pp（R48）——根因（场采样域一致性/投影体积收缩）登记 bugs.md 待平台级深挖
- [ ] B5.2 cylinder+diamond R64 非流形（nm 740）：定位封盖/容器交线机制——验证：该工况水密门通过或输出结构化不可达报告
- [ ] B5.3 stl-exporter 定向一致性进 parity_math 门（字节级有向配对，当前仅 selftest 覆盖）——验证：parity_math 新增断言绿
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

## 下一步（更新）
1. **用户操作**：署名三项（作者拼写/单位/LICENSE 版权行）→ Editorial Manager 注册提交 → 回填投稿号。
2. B-t3 LLM 接入（等 key）。
3. 可选深水区：surface-nets 场离散原子化（R48/k6 仅 1165 互异场值）的分辨率补偿、lidinoid 高孔隙拓扑、cap 段 Map→TypedArray（再省 1.2s/R96）。

