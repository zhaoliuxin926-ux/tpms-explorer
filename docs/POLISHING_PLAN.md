# 下一步打磨计划清单

> 制定日期：2026-10-11。方向：继续打磨功能和 Agent。
> 本清单是后续执行计划；未勾选项均未完成，不代表已有能力或验证结论。

目标：修正现有功能的结果与执行契约，再让 Agent 能准确接续推荐结果，完成有边界的多步任务。

## 执行顺序与依赖

| 批次 | 工作 | 进入下一批的条件 |
|---|---|---|
| 0 | 固定基线、保存最小复现 | 缺陷输入、独立期望和现有输出可以指认 |
| 1 | 桁架正确性；并行修 Agent 入口与压溃重试 | 各项针对性回归通过 |
| 2 | CT、渗透率、LPBF、SVG 修复 | 独立不变量通过，既有功能无回归 |
| 3 | 跨出口验收、试样与基准刷新、文档同步 | 构建产物一致，全量门禁通过 |
| 4 | CLI 显式会话与跨调用指代 | 推荐后退出，再启动构建仍采用同一候选 |
| 5 | 有界多步编排与交付报告 | 每步可追踪，失败或预算耗尽如实结束 |

批次 1 的几何与 Agent 两条线可并行；共享文件改动按依赖合并。新 Agent 能力依赖批次 3 收口。

## 0. 基线与复现准备

- [x] **0-1 固定修复基线。**（2026-10-11：sourceCommit=a9ee569 基线+POLISHING_BASELINE.json S7/S8 全哈希在案；缺陷最小回归输入=strut_exit_audit.mjs 拓扑锚/独立参考/mesh 落面断言组） 记录提交、运行参数和相关产物哈希；将已确认缺陷变为最小回归输入。期望值来自杆集合、解析关系或独立几何构造，避免复用待修函数计算答案。
- [x] **0-2 标记受影响交付物。**（POLISHING_BASELINE.json 登记 S7/S8 八件 sha256+参数，sourceVersion=historical-before-strut-corrections；benchmarks-latest.json strut 行=嵌合体时点铁证） 列出 S7/S8 试样、桁架基准与导出文件。保存旧文件及生成参数，区分历史产物与修正后产物；已有实测对应文件保留原始版本。

验收：每项修复能说明“原输入产生什么错误、修后应得到什么”，并能找到对应旧产物。

## 1. 首批修复：几何与 Agent 两条线

### 1A. 桁架几何与导出一致性（最高优先级）

- [x] **G1 明确晶胞尺度契约。**（定案 cell=2π=一 TPMS 周期：域 [−πk,πk] 恰 k 个 cell、晶格常数=cellSize/k mm 与经典族周期同尺；杆半径 r=w[0]·π 半胞分数（默认 0.25=1/8 胞宽）；旧 cell=2 实为 πk 无理倍 cell=边界截断。k=1/3/5 节点间距实测入 strut_exit_audit A 节） 核对 `mx=πkp`、`cell=2`、毫米换算和杆半径含义，实测 k=1/3/5 的节点间距。明确 `periods` 的物理含义，以及调整后的参数兼容规则。当前已确认口径矛盾，具体改法先取证再决定。
- [x] **G2 修正 Octet 杆拓扑。**（邻接判定改逐轴 |Δ|≤½cell——旧 Manhattan<0.75cell 对真邻接(恰 1.0cell)恒假=角杆全灭；角/面心/杆中点固相+体心空气独立锚+B 暴力参考对拍 1e-16 全绿） 修复角节点↔面心邻接判定，恢复遗漏杆。独立检查每晶胞杆集合、角节点、杆中点、面心与周期平移不变性。
- [x] **G3 修正提取场、投影与法线分派。**（surface-nets useLookup+periodic-surface useLookup+c2New 数值法线三处补 strut 双族——曾漏列=V 场走查表尾项 schwarz（同参数与 schwarz 三角数逐位同=嵌合体实锤）；mesh 内部顶点落真场残差 4e-7 锚） Surface Nets 与周期 RVE 明确声明查表支持的族；双 strut 使用正确场与梯度。检查 CPU 默认路径、直接权威场采样、预览和完整构建的语义一致性。
- [x] **G4 补齐 Python/MATLAB 桁架重建。**（strut_field/strut_truss_field 同源杆集+尺度；TS↔Python↔MATLAB 三端 500 点对拍 ≤1.3e-15；双脚本端到端实跑通过——顺带修掉预存交付 bug：迂曲度辅助 3 元组索引 2D 切片 IndexError=历史导出脚本必崩） 同步定案后的杆集合与尺度，运行生成脚本并对拍采样点。实现前明确拒绝不支持的导出，避免交付执行时才报 `Unsupported type` 的文件。
- [x] **G5 建立跨出口验收矩阵。**（strut_exit_audit.mjs 28 断言/GUARD 24 入 run_ci_suite：A 尺度契约/B 拓扑锚/C 独立参考/D 分派哨兵/E mesh-体素-RVE-脚本五出口；顺带根除 strut 场 commensurate 栅格并列值病——RVE/体素出口改 MC 解析 iso（跨出口 isoUsed 逐位同源），octet STL 非流形=已知边界 fail-closed 钉） 同参数检查 UI/STL、RVE、CAE 体素、直接层切和重建脚本的构型、尺度及固相定义。采样位置与离散误差使用可解释容差，支持域外明确拒绝。

验收关口：

1. 角节点和杆中点属于预期固相，周期相邻关系正确。
2. 双 strut 不再走 Schwarz 提取场或 Diamond 法线；已支持经典族结果无回归。
3. 同一设计跨出口表示同一结构，单位与参数含义一致。

主要文件：[strut-bcc.ts](../tpms/tpms-platform/src/core/strut-bcc.ts)、[strut-octet.ts](../tpms/tpms-platform/src/core/strut-octet.ts)、[surface-nets.ts](../tpms/tpms-platform/src/geometry/surface-nets.ts)、[periodic-surface.ts](../tpms/tpms-platform/src/geometry/periodic-surface.ts)、[script-exporter.ts](../tpms/tpms-platform/src/export/script-exporter.ts)。

### 1B. Agent 入口与 UI 重试（可并行）

- [x] **A1 修复嵌套必填校验。**（tools.schema isoGrad required:[values]+validateValue 嵌套 required 递归（数组内深层独立小 schema 钉）；mock 真实执行入口 exit2 无 TypeError——llm_provider_selftest 43→69 断言） 两处 `isoGrad` schema 要求 `values`，递归 validator 检查嵌套 `required`。空对象、仅 band 和缺字段均结构化拒绝；合法 values 保持可执行。非法输入退出码为 2，不出现裸 TypeError。
- [x] **A2 收口 Provider 正文超时。**（三 Provider 计时器覆盖响应头+JSON 正文+错误正文读取，中止态优先超时语义；本地 HTTP 五形态（正常/慢正文/挂正文/慢错误/正常错误）×3 Provider 全测） 三个 Provider 的计时器覆盖响应头、JSON 正文和错误正文读取。验证立即响应头后挂起、慢错误正文、正常响应；结束后清理计时器和请求资源。这是已登记问题的修复。
- [x] **U1 修复压溃拒绝后的重试。**（运行标志/禁按钮移到支持条件检查后——壳模式拒绝不占锁；card_smoke G 段三断言（壳模式可重试/切回实体 NL 启动/运行中拒绝重复+结果后解锁）19/0） 在设置运行标志、禁用按钮前完成支持条件检查。壳模式拒绝后切回实体网络可再次启动；按钮与 NL 入口状态一致。
- [x] **A3 补齐关键语义验收。**（离线：H1 κ 槽位单位锁定+E5 check 钩+modelNote 双出口断言；真实模型：2026-10-11 用户新 key（anthropic 通道）**43/43×2 双轮满贯**——加强断言全过，H1 双槽位/E5 披露钩/F4 values 必填两轮经受，见 LLM_REGRESSION_LIVE.md 2026-10-11 节） H1/H2 比较 E、κ 槽位及单位；E5 检查无上下文指代的披露和实际参数；检查 `modelNote` 在普通输出和 JSON 出口保留。先完成离线用例，再按现有 n=2 标准复验真实模型。

主要文件：[tools.schema.json](../tpms/agent/tools.schema.json)、[llm-provider.mjs](../tpms/agent/llm-provider.mjs)、[llm-agent.mjs](../tpms/agent/llm-agent.mjs)、[llm_regression.mjs](../tpms/agent/llm_regression.mjs)、[main.ts](../tpms/tpms-platform/src/main.ts)。

## 2. 数值与测量修复

- [x] **N1 统一 Otsu 分类端点。**（单一实现入 ct-reconstruction，bone-morphometry 复用；严格 >threshold 进固相——40/200 双峰各半=50%（旧 >= 得 100%）、灰度↔binary 等价、空输入 throw、单峰常数=该值且全背景；ct 审计 15/0+bone 审计 21/0 含新锚） CT 与骨形态模块统一阈值含义。40/200 双峰各半应得到 50% 固相；灰度与对应 binary 输入结果一致。均匀灰度、空输入和全实心情况返回有定义的有限结果或明确拒绝。
- [x] **N2 修复 FD-Darcy 出口流量。**（流量积分只认真实流体出口邻接 isFluid(z=R−1)——封死出口 κ=0 精确、中段封死 κ=1e-11 级（开放管百万分之一以下）；开口单/双管解析锚原样通过；native_cae 审计 22/0） 流量积分检查真实流体出口邻接。开口单管与双管保持解析关系；封死出口或中段时流量近零，不能因封堵而增加渗透率。
- [x] **N3 修复 LPBF 换道量纲。**（yLaser 统一格数口径 laserLaneCells——旧 (pass·格数)%(N·dx) 米制取模恒 0=激光永不换道全叠印 y=0；N32·dx25µm 首三道 y=2/4/6 格+dx40µm 组 1/2/3+域回绕锚；能量台账 ≤0.5% 保持；lpbf 审计 21/0） 统一网格坐标与米制坐标。N32、dx25µm 的前三次换道应为 y=2/4/6 格，并检查另一组尺度参数；同时保留能量台账验证。此项不扩大 LPBF 的物理精度宣称。
- [x] **N4 修复 SVG 交点判断。**（edge 逐边自身端点判定——旧恒查 onPlane[0]/[1]：(b,c)/(c,a) 边拿错顶点=顶点接触生假段；规则定案：贴面顶点半开约定（对侧严格为负才计入）+共面边跳过由邻接三角补足；parity_math +5 运行时行为锚 332→337（此前仅静态断言=该缺陷四轮漏网根因）） 每条边按自身端点判断。平面仅接触一个顶点时不生成线段；正常相交、共面边和顶点顺序置换得到一致截面，明确共面三角形的处理规则。

主要文件：[ct-reconstruction.ts](../tpms/tpms-platform/src/geometry/ct-reconstruction.ts)、[bone-morphometry.ts](../tpms/tpms-platform/src/physics/bone-morphometry.ts)、[lbm-permeability.ts](../tpms/tpms-platform/src/physics/lbm-permeability.ts)、[lpbf-thermo-mechanical.ts](../tpms/tpms-platform/src/physics/lpbf-thermo-mechanical.ts)、[svg-slice-exporter.ts](../tpms/tpms-platform/src/measure/svg-slice-exporter.ts)。

## 3. 验收与交付收口

- [x] **V1 刷新桁架试样与基准。**（S7 四件真场重生成：水密+0.19pp+逐位确定 42.9MB/件，嵌合体旧件归档；S8 受阻后**同日焊接解锁**：非流形短边焊接（9b）根治 12 杆结点投影重合——四件重生成水密 0.88pp 42.2MB 逐位确定，S7 免重生成（bcc nm=0 焊接 no-op 字节级不变实证）；基准真场重跑（octet 行为焊接前拒产快照，注记指引重跑刷新）；代理适用性维持（octet C1=1.2 线性律披露保留））
- [x] **V2 更新回归覆盖。**（批次 1-2 已并入：strut_exit_audit 28 断言+ct/bone/native_cae/lpbf/parity 五审计新锚；**变异验证五连**：G3 嵌合体回退→3 红（场残差 1.16+静态哨兵+octet exit0 三重抓）/G2 Manhattan 复发→4 红/N1 端点→3 红/N3 接线→初漏抓→补 simulateLPBF↔laserLaneCells 接线哨兵后红（真缺口实证）/N4 原版缺陷→顶点接触锚红） 将缺陷探针纳入合适的既有门；加入独立杆拓扑、分类结果、零通量、换道位置和截面交点断言。对关键断言验证其能识别原缺陷。
- [x] **V3 完成源码与部署验收。**（每批 tsc 0+build+dist 部署+删 .map；5ff305e CI 三平台 SUCCESS（47 门权威）；本批 docs 性改动走 e138031 及后续提交） 类型检查、生产构建、部署产物对拍与针对性门通过；合并后跑全量 46 门并核对三平台结果。修改源码后同步 `docs/platform`，发布产物排除 `.map`。
- [x] **V4 同步现态文档。**（README strut 行含 octet 边界+BENCHMARKS 真场+HONESTY_BOUNDARIES §一.17+ROADMAP/YOUR_10_MIN 试样口径 28 可打印+S8 受阻+specimens/README 重写+interview 弹药更新（批次 1）；Release Notes 时点快照不动） 更新 README、项目总览、路线图、基准和诚实边界的受影响内容；统一族数、回归数、Provider 与完成状态。历史 Release Notes 继续保留时点快照。

本阶段完成条件：已确认的 10 项问题逐项有修复及验证证据；任何尚未完成项明确列出，不以现有测试全绿替代缺陷验收。此后再进入新增 Agent 能力。

## 4. Agent 最小会话交付

这是新功能，现有单轮 CLI 模式保持兼容。

- [x] **S1 增加显式 CLI session。**（agent-session.mjs：带版本 JSON+原子写 tmp+rename；首跑新建/续跑严格校验；损坏/版本不兼容 exit2；API key 绝不入会话（内容只来自工具结果 by construction，断言钉）） 保存有版本的推荐集、完整参数、执行结果和稳定结果 ID；原子写入，不保存 API key。进程退出后能恢复；损坏或不兼容文件明确拒绝。
- [x] **S2 绑定跨调用指代。**（确定性绑定先于 provider——"第 N 个/刚才的方案/first"正则解析到最近推荐集候选，type/porosity/periods 直读构造 tpms_mesh（R96），产物名含 rec-cand 溯源；缺结果/越界/指代+新参数歧义全部 exit2 结构化拒绝，绝不静默构建另一方案；最小旅程实测：推荐→退出→同会话构建第一项→参数/STL/执行记录核对全过） “第一个”“刚才的方案”解析到当前 session 中明确的推荐结果，再确定性提取参数；缺结果、歧义或已失效结果明确说明，不能静默构建另一个方案。
- [x] **S3 检查结果与来源。**（执行记录含 fromRecommendation/candidateIndex/完整 args/artifacts/resultDigest（水密+孔隙率+字节）；几何语义标签 GEOMETRY_SEMANTICS 随会话落盘，语义变化（如 strut 真场修正）加载即拒；代理口径（解析近似非 FE）随候选快照；变异验证：ordinal 解析破坏→3 红+复绿 82/0） 记录候选来源、采用参数及产物位置；几何语义版本变化后旧候选不能未经核对直接当作当前结果。目标由代理模型估算时继续披露其口径。

最小验收旅程：第一次推荐→退出进程→第二次带相同 session 构建第一项→核对完整参数与最终文件。会话能接续后，再增加单次调用内的组合任务。

## 5. Agent 有界多步任务

- [x] **T1 串联已有确定性能力。**（agent-pipeline.mjs：tpms_pareto→候选选取（水密门失败按修复预算顺延，实测 octet 拒产→diamond 成功链）→tpms_mesh R96 水密验收→overhang 悬垂审计——全链复用现有 CLI 零新增数值内核；--session 可选接批次 4 会话记录） 用户明确要求组合任务时，支持“推荐→选取→构建→水密验收→可打印性报告”。复用现有 CLI/driver，不新增重复数值内核。
- [x] **T2 补齐工具历史兼容。**（Anthropic 通道 assistant.tool_calls→tool_use 块+tool 角色→tool_result 块（ID 关联保留）；本地 HTTP 捕获请求体断言映射形态；真实通道抽测 glm-5.3-flash 带工具历史 200+基于结果的文本总结；llm-agent --max-rounds 有界编排每轮重新过 schema 拦截器；Mock rounds 顺序确定性测试） 现有 OpenAI、Ollama、Anthropic 通道保留工具调用 ID 与结果关联；每轮重新经过 schema 校验。用 Mock 和本地 HTTP 检查顺序及协议形态，再抽测真实通道。
- [x] **T3 设置执行预算与失败语义。**（管线五预算：max-steps/max-tool-calls/max-wall-ms/subprocess-timeout/max-repairs（off-by-one 实测修正：0=只试首选）；耗尽 exit4+已完成步骤+最后诊断+未完成原因；全候选拒产 exit3 fail-closed 已试 N/M 注记；LLM 轮数硬帽 8+耗尽不虚报完成） 限制步骤、工具调用、总时长、子进程时长与修复次数；预算耗尽时返回已完成步骤、最后诊断和未完成原因，避免无限重试或虚报完成。
- [x] **T4 交付任务状态与报告。**（pipeline-report.json+stdout：每步输入/输出/exit/耗时+产物清单+预算用量；三层口径分开标注（代理推荐=解析近似非 FE/网格验收=水密+孔隙率实测/物理可打印性=悬垂工程阈值）；失败保留可核对阶段结果） 展示当前步骤、已采用参数、产物和验收结果。失败后保留可核对的阶段结果；最终报告区分代理推荐、网格验收与物理估算。
- [x] **T5 跑用户旅程回归。**（成功链/不可达链/预算耗尽链三态=llm_driver_selftest 7-10 四断言（6→10）；会话旅程+拒绝族=llm_provider_selftest 13 锚；编排两轮收束/耗尽/单轮兼容=selftest 5 锚——87/0+10/0；变异验证：会话 ordinal 破坏 3 红） 覆盖推荐后采用、指定候选、无会话指代、非法参数、超时、验收失败修复、预算耗尽；同时检查工具选择、关键槽位、实际执行和产物。

本阶段完成条件：成功与失败两条链路均可追踪，每一步都能说明采用了什么输入、产生了什么结果；原有单轮调用仍可使用。

## 每批完成记录

执行时在对应任务旁记录：修复提交、关键验证结果、受影响产物和残留事项。只勾选已完成验收的项。

当前范围：先 CLI 会话，再多步任务。教学版功能维持冻结；浏览器内带 key 的多轮助手、额外模型协议、曲面扩族、研究级求解器升级和 main.ts 大拆分暂不列入本轮。

