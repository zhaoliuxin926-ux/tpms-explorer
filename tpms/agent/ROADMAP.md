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
| solve MC 样本量 120k→30k/40k | ✅ | 采样 4.38M→1.1M（省 ~0.7s/次），收敛性不退化 | a1208c2 |
| iso* 跨进程缓存 | ✅ | 命中省 ~0.2s/次（.iso-cache.json 确定性落盘） | a1208c2 |
| CI 并行化（并发池 4） | ✅ | 全量 420s→294s（1.43×，长尾 run_all ~200s 串行封顶） | f13c75e |
| three.bundle 瘦身 | ✅ | 1.37MB→552KB raw（-60%，gzip 285→139KB），首帧主瓶颈消除 | cc1bba5 |
| 重建下放 Blob Worker | ✅ | 重建窗口 rAF 342 帧（主线程零冻结；同步路径阻塞 1.3-2.2s） | 87e6c80 |
| bindUIEvents 880 行拆分 | ✅ | 8 个区域命名函数 + 调度器，tsc 零错误 | 350f0c4 |

附带修复：UI 布局逃逸复发（f362d46）/混合 TDZ 崩溃（938592b）/深色对比度 1.21:1（7ec0097）/移动端顶栏竖排+浮层收纳+10 aria-label（7ec0097+f48719c）/verify 19 断言（Worker 守卫）。
新登记待攻：lidinoid p≥0.7 体素拓扑非流形（legacy 同病）。

## 下一步（更新）
1. **用户操作**：git push（40+ commit）→ 署名 → topics → Editorial Manager 提交。
2. B-t3 LLM 接入（等 key）。
3. 可选深水区：surface-nets 场离散原子化（R48/k6 仅 1165 互异场值）的分辨率补偿、lidinoid 高孔隙拓扑、cap 段 Map→TypedArray（再省 1.2s/R96）。

