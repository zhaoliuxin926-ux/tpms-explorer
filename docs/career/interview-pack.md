# 求职素材包：TPMS Explorer 项目（AI 应用开发岗对齐版）

> 自用素材，不进站点导航。三个部分：①简历项目描述（中英，两档长度）②面试深挖问题+回答弹药（全部来自真实工程实录，附证据锚点）③口述脚本（中/英 2 分钟版 + 中文 5 分钟追加）。
> 使用原则：**只讲能被追问三层的故事**——下面每个弹药都标了证据位置，讲之前先跑一遍命令确认数字仍是当前值。

---

## 一、简历项目描述

### 中文 · 一段版（简历主项目栏）

**TPMS Explorer — 浏览器端三维曲面设计平台 + LLM Agent 闭环**（个人项目，2026.07–至今）

用 TypeScript/three.js 构建三周期极小曲面（TPMS）生成式设计平台：26 族构型（24 族 level-set 曲面（经典解析式 + 文献/数据集系数转录）+ 2 族桁架（BCC/Octet，杆=胶囊 SDF 周期场，覆盖弯曲/拉伸主导力学谱两极））、实时 WebGL 渲染、一键交付水密 STL / Abaqus / OpenFOAM 工业文件（G-code 原生切片已进导出中心（单壁+扫描填充，非工业全特征切片））、Pareto 多目标前沿探索器（骨支架三难权衡 26 族×孔隙率×密度扫描→非支配前沿→点击写回设计参数）；为平台构建 LLM Agent 闭环——自然语言进入可验证交付链（dry-run 槽位回归 40 条，glm-5.3-flash 双轮 40/40×2（n=2，勿称确定性；端点×模型矩阵 6/6 在案）；端到端另有 Mock 6/6 + 真实抽测 2/2），核心是自研 tool-calling 安全层：JSON Schema 逐槽位校验拦截器（越界拒绝，非钳制）+ 113 断言（GUARD 98）契约对拍门禁 + 退出码分层契约。全仓 46 道 CI 门禁（1000+ 断言、三平台矩阵）。多轮真机走查+红队审查：v2 轮曾抓出 5 Critical+20 Major、寿极 v3 轮 0C+10M+20m，均按轮次入账修复；当前发布态无未关闭 Critical。

### 中文 · 两句版（多项目简历/一句话场合）

为科研级几何平台自建 LLM Agent 安全层（schema 逐槽位校验拦截器——越界拒绝非钳制 / 契约对拍门禁 / 有界修复闭环，对抗指令零**非法执行**，fail-closed 三形态：平台拒/模型拒/模型改发合法值），并配套 46 道 CI 门禁的验证体系——理念：LLM 产出按不可信输入处理，确定性代码守住交付物。技术叙事见博客《44 道门禁》《LLM Agent 的安全架构实录》。

### English · one-paragraph (for English resume)

**TPMS Explorer — Browser-based TPMS design platform with an LLM agent loop** (personal project, Jul 2026 – present). Built a generative-design platform for triply periodic minimal surfaces (26 families — 24 level-set TPMS (classical closed forms + transcribed literature/dataset coefficients) + 2 strut trusses (BCC/Octet as capsule-SDF periodic fields, covering both ends of the bending/stretch-dominated mechanics spectrum); real-time WebGL; watertight STL / Abaqus / OpenFOAM export; a Pareto front explorer for the bone-scaffold trilemma with click-to-write-back design parameters) in TypeScript + three.js, plus an LLM agent that turns natural language into a verifiable delivery chain (dry-run slot-level regression 40 cases, two-round 40/40×2 on GLM-5.3-flash (n=2, not deterministic; 6/6 endpoint×model matrix on record); end-to-end separately Mock 6/6 + real-model spot checks 2/2). Core contribution: a tool-calling safety layer — per-slot JSON-Schema validating interceptor (out-of-range is rejected, not clamped), a 113-assertion (guard 98) contract-parity gate, and exit-code-tiered rejection semantics — inside a 46-gate, 1000+-assertion, 3-platform CI matrix. Multi-round walkthrough + adversarial review tallied per round (v2 once found 5 Critical + 20 Major, all fixed; later round 0C+10M+20m); no open Critical at release.

### English · two-sentence (multi-project resume)

Built an LLM-agent safety layer for a research-grade geometry platform (per-slot JSON-Schema validating interceptor — reject, not clamp / contract-parity gate / bounded repair loop; adversarial prompts yield **zero illegal executions**, fail-closed in three forms: platform reject / model reject / model self-corrects to a legal call), backed by a 46-gate CI system — thesis: treat LLM output as untrusted user input and let deterministic code own the deliverable. Narrative: *44 Gates* and *Agent Safety Architecture* (tech blogs).


---

## 二、面试深挖弹药（按被问概率排序）

### Q1 "LLM 应用怎么保证不乱来？"（必问，主线故事）

要点链：**LLM 产出 = 不可信用户输入** → tool call 逐槽位过 schema 校验（enum/min/max/未知属性/未知工具/缺必填，任一命中 exit 2 不达执行层；越界是拒绝不是钳制）→ schema 与 CLI 实际校验由 113 断言（GUARD 98）门禁逐项对拍（防两份清单漂移）→ 真机回归分三层语义：拦截器保证"错的不执行"（确定性）、40 条 dry-run 槽位回归保证"好的能通过"（统计性，glm-5.3-flash 双轮 40/40×2（n=2，勿称确定性））、对抗指令四模型零**非法执行**（三形态：平台拒绝/模型拒绝/模型改发合法值；拦截器动作由离线 40 断言单独计量，不把模型自觉算进护栏战果）。
杀手锏补充：**Agent 面红队两轮（实录 2H+7M+5L），下为六个代表性打穿**——路径穿越正则首字符放行整串 `..`；崩溃被错误处理包装成"结构化拒绝"（语义污染）；校验函数存在但不在执行路径（校验死代码）；同一槽位两份 schema 口径分裂致链路中断；`in` 原型链键误判（应 `Object.hasOwn`）；JSON 解析失败分支曾 exit 0。**没有一条是 LLM 骗过了系统，全是确定性代码自己的缝**——LLM 只是高频模糊测试器。
证据：`node tpms/agent/llm_provider_selftest.mjs`（40 断言离线可跑）+ 博客二。

### Q2 "最难的 bug 是什么？"（讲这个：SDF 顶点区距离反转）

故事：任意解剖流形保形填充功能里，点到三角形距离函数（Ericson《Real-Time Collision Detection》标准实现）B 顶点区条件写反（`d4≤d3` 误为 `d3≤d4`）——越界到 B 外侧时返回查询点自身，远壁距离被低估（0.72→0.34）。两种独立加速结构（BVH 与暴力）**同错**，因为共享同一个原语——**对拍失效的经典形态：两条路径同源，对拍无意义**。破案签名："比顶点级暴力下界还近"在物理上不可能。修复后远壁距离 0.34→0.72 全链一致。
引申观点：单元测试过 ≠ 实现对——参考实现也要先被质疑；**共享原语的对拍是假对拍**。

### Q3 "性能优化做过什么？"（三个有数字的）

1. 自写静态服务器无 gzip：公网首屏 5–7s，静态资源 gzip 后体积显著下降（当前构建首屏 ~283KB gzip（three.js 分包 ~182KB + 自研主包 ~101KB/268KB raw，2026-09-25 动态分包后）），首屏回到 1s 内。
2. **真实规模 STL 可用性攻坚（2026-10，三连修，最有故事的一题）**：用 81920 三角球（CT 解剖壳典型量级）实测上传路径，发现(a) SDF 进度正常走到 79% 却被固定 180s 看门狗在完成前一刻杀掉——真实文件 100% 失败而全部门禁绿（冒烟只用 12 三角玩具盒永远撞不到墙）；改活跃度看门狗（进度在跳就永不大限，真卡死=停更 180s 才杀），82k 实测 166s 完整走通。(b) 修完上传又测"调参数"：每个新分辨率档全量重算 O(采样×三角)，拖一下滑块等 103s；利用 SDF 场只依赖几何的事实做降档三线性重采样（HD 档算一次、更小档即时供给），同操作从 103s 到即时；误差用离线对拍钉死口径（1.37×格距/零符号翻转，首版"半格距"宣称被自家对拍抓回修正——诚实口径本身是叙事点）。(c) 修完降档又测"反向拖大"（升档）：取证抓到三缺陷叠加——①l2 档与 HD 档同时缓存 miss 各起一个 Worker 全量并行互拖（状态栏双档号交错闪烁，5120 三角 167s，82k 外推 20 分钟）；②"档未就绪就跳过重建"的旧守卫把降采样成功的结果一并丢弃——拖动后三级重建全部 no-op，屏幕定格旧帧全程零视觉反馈；③裸百分比无 ETA，82k 升档走到 10% 时用户无从判断该等 20 分钟还是已经死了。三连修：升档态 l2 让位 HD（单 Worker）+降采样命中继续重建（低清帧即时上屏）+实测外推 ETA（elapsed×(1−p)/p，82k 全程如实报"~20 分钟"——比最初交接预估多一倍，规模外推超线性）。方法论钩子：门禁全绿 ≠ 真实输入规模可用，测试输入的规模代表性本身是被审计维度；新机制（降采样）落地后必须复审旧守卫（未就绪 return）是否误伤新路径；"缓存 miss 补算"类机制加档位必须推演多入口同时 miss 的并行形态。三修复已固化成永久回归探针（run_all 第 18 套件 7 项：升档单 job 档号唯一+ETA 断言入 CI）。
3. （跨项目迁移，非本仓数字，不主动讲）瓦片预烘焙：Canvas `drawImage` 每帧约 400 次→启动烘焙约 25 次/帧。若被追问命令，如实说明出处在其他项目；本项目请讲 GPU 三段实测。

### Q4 "CI 怎么组织的？跨平台踩过什么坑？"

46 道门禁三平台矩阵（Ubuntu/Windows/macOS），1000+ 断言。核心机制：行为级断言（rolldown 把真实 TS 源码打包进测试进程，禁 mock 数学）、最小断言数守卫（防"断言集体跳过仍绿灯"）、fail-closed 交付门（水密三硬指标任一非零拒产 STL）。
跨平台坑实录（挑两个讲）：win32 假设六层剥离（.cmd shim/路径分隔符/chromePath/swiftshader/404 形态/python 漂移+CRLF）；"本地假绿"三形态——改 UI 不重建部署目录=CI 测旧站；分支 workflow 只在 main 触发=长活分支 21 提交零次真 CI 无人发现。
证据：博客一 + `npm run test:all`。

### Q5 "为什么自己写门禁，不用现成测试框架？"（理念题）

不是不用（playwright/node:test 都在用），而是**门禁的产品定义**：断言对象是"用户拿到的交付物行为"而非"代码单元"。举例：STL 交付门禁会**独立读回二进制字节**复核顶点配对，不复用生成器的自检代码——因为最贵的事故就是复刻品与真品漂移（查表版 diamond 公式差一个符号，2 万点 maxDiff 2.91，屏幕所见与导出物是两张曲面）。

### Q6 "AI 怎么用在工作流里？"（诚实版）

AI 结对为主力（生成/重构/探针），但配套两条纪律：**功能宣称必须指认一条跑过的命令**（曾抓出 CLI 假实装——补丁静默失败+门禁不覆盖该 flag 路径）；**性能/架构属性宣称须 grep 调用点核实**（"Worker 异步执行"实为主线程同步）。AI 也当红队——对抗审查按轮入账：v2 轮（2026-09-13）4 路红队 5C+20M 全修；寿极 v3 轮（09-16）0C+10M+20m 全修；Agent 面另有两轮 2H+7M+5L。当前发布态 open Critical=0。其中"空输出恒真断言"（vertCount=0 三断言零迭代全绿）就是变异测试实证抓出的。

### Q7 领域题备胎（材料背景加分项）

- 为什么 TPMS 适合骨支架：孔隙连通（营养输送）、比表面积、Gibson-Ashby 标度律 ρ̄² 可解析预测力学响应。
- 目标孔隙率 vs 实测偏差：iso 二分格点分位与发散体积口径差，随分辨率收敛（gyroid 口径 R48 5.4pp→R96 1.0pp（iso 二分格点分位 vs 发散体积的口径差，非 BENCHMARKS 目标偏差）；倍频谐波族 R48 可达 24–28pp 为已登记可用域事实），CLI 如实披露双口径——**不粉饰口径差本身就是可信度卖点**。
- 26 族怎么来的：24 族 TPMS 曲面=经典文献解析式 + CC BY 数据集系数（含 Fourier fit）逐字转录（另 2 族桁架为胶囊 SDF 杆阵，无转录问题）。**两层保真分开讲**：①实现保真＝四方互拍（TS/Python/MATLAB/GPU IR，容差 1e-9~1e-12；GPU f32 另门口径 ≤1e-6）防转录/移植错——注意这只证明四份实现一致（Q2 金句「共享原语对拍是假对拍」的反面教材：故互拍之外还有解析锚点/文献基准）；②模型保真＝与文献基准、解析特例、BENCHMARKS 对账。

### Q8 "最近新增的大功能？"（2026-10 双功能批：桁架双族 + Pareto 前沿探索器）

桁架线一句话：**标量场是最低公约数接口**——杆写成胶囊 SDF 周期场后，求解器/重建/导出/NL 全链零架构改动自动支持；但交付前复查抓到**水密掩盖的几何错位**（杆端点表用了几何域坐标而场函数给的是弧度域——错位后依然是"一坨自洽、水密、可渲染的某种结构"；这是本项目第三次撞上"水密 ≠ 几何正确"）——正解顺带解锁 cellSize 联动。标定线的诚实点：Octet 桁架是拉伸主导（E\*∝ρ̄ 线性律），硬套 Gibson-Ashby ρ² 框架只能得到单点等效切线——平台**不做假装适配的硬拟合**，源码披露漂移边界；后来 M5 工业链实测 E\*=16.17GPa 超文献带，正是预埋披露解释了偏差（形状律偏差现形，不是惊喜也不是事故）。
Pareto 线一句话：骨支架三难权衡（E↑力学×κ↑传质×Sv↑生物活性）——26 族×孔隙率×密度毫秒级解析代理扫描→非支配前沿→点击写回；约束过滤的数学坑：**必须在可行子集上重算前沿**（简单筛原前沿是错的——被支配者在支配者被剔除后可能浮出）。
证据：`node tpms/agent/tpms.mjs mesh --type strutoctet --porosity 0.7 --out o.stl --json`（167,760 三角水密）+ `estimate --type strutbcc`（C1=0.06 Deshpande-Fleck 文献域中值）+ ml_pareto_audit 9 断言 + 博客四（drafts/ 待定稿）。

---

## 三、口述脚本

### 2 分钟版（开场自我介绍后）

"我最重要的个人项目是 TPMS Explorer——一个浏览器端的三维曲面设计平台，面向骨支架和增材制造场景：26 族构型（24 族 TPMS level-set 曲面 + 2 族桁架），实时渲染，一键交付可打印的水密 STL 和 Abaqus/OpenFOAM 文件。工程上两条主线：一是**验证体系**，46 道 CI 门禁、三平台、1000 多条断言，核心是行为级断言和 fail-closed 交付门；二是 **LLM Agent 闭环**——自然语言进入可验证交付链，dry-run 槽位回归 glm-5.3-flash 双轮 40/40×2（n=2，勿称确定性）。Agent 这条线我最有心得的是安全问题：LLM 产出按不可信输入处理，自研了 schema 逐槽位校验拦截器（越界拒绝）和 113 断言契约对拍门禁，Agent 面红队两轮、六个代表性打穿全修；项目多轮红队按轮入账（含 v2 轮 5C+20M 全修），当前发布态无未关闭 Critical。关键工程数字都附复现命令。"

### 2-minute English (after the opener)

"My most important personal project is TPMS Explorer — a browser-based 3D surface design platform for bone-scaffold and additive manufacturing: 26 families (24 TPMS level-set surfaces + 2 strut trusses), real-time rendering, one-click watertight STL and Abaqus/OpenFOAM export. Two engineering tracks: first, a **verification system** — 46 CI gates, 3 platforms, 1000+ assertions, centered on behavior-level checks and a fail-closed delivery gate; second, an **LLM agent loop** — natural language into a verifiable delivery chain, dry-run slot regression two-round 40/40×2 on GLM-5.3-flash (n=2; not deterministic). On the agent side I care most about safety: treat LLM output as untrusted input. I built a per-slot JSON-Schema validating interceptor (reject, not clamp) and a 113-assertion contract-parity gate; two agent-face red-team rounds produced six representative breaches, all fixed. Project-wide reviews are tallied per round (v2 once 5 Critical + 20 Major, all fixed); no open Critical at release. Every engineering number I cite has a reproduce command."

### 5 分钟版追加（按面试官兴趣展开）

- 问工程细节 → Q1 红队六洞（可白板画拦截器位置）
- 问 debug 能力 → Q2 SDF 条件反转（"共享原语对拍是假对拍"金句收尾）
- 问 DevOps → Q4 三平台矩阵 + 本地假绿三形态
- 问业务感 → Q7 口径差披露（"科研工具交付错误几何比不交付更贵——一个不水密的骨支架 STL 浪费一周打印时间"）

---

## 四、证据锚点速查（面试前刷新数字用）

```bash
# 以下均在仓库根执行
node tpms/agent/schema_check.mjs --fast   # 面试前 ~30s：契约/静态/拒收（GUARD 40）（跳过几何探针）
node tpms/agent/selftest.mjs              # 50 断言
node tpms/agent/llm_provider_selftest.mjs # 40 断言（离线，GUARD 37）
node tpms/agent/tpms.mjs list --json      # 26 族（24 TPMS + 2 桁架）
node tpms/.verify/docs_consistency_check.mjs  # 文档数字一致性 332（秒级，GUARD 313）

# 完整几何对拍（含 R48–R128 探针，约 5–10 min）——展示/归档用，不必临场
node tpms/agent/schema_check.mjs          # 113 断言（守卫基线 98）
cd tpms/tpms-platform && npm run test:all   # 46 门本地全量（三平台矩阵在 GitHub Actions）
```

博客：《44 道门禁》`docs/blog/2026-09-16-44-gates.md` ｜ Agent 架构 `docs/blog/2026-09-17-agent-architecture.md`。
