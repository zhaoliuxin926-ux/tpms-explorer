# TPMS Explorer v8.0.0-agentic-loop Release Notes（双语）

> 发布日期：2026-09-12 ｜ 前置版本：v7.0.0-generative-biophysics
> 里程碑：**42 道 CI 门禁 · 1000+ 断言（三平台矩阵，全绿）** ｜ 曲面族 **20** ｜ **Agent 路线 M0-M5 全线打通**

---

## 中文

v8.0 的主线是「**曲面库扩容收官 + Agent 闭环真实模型验收 + 平台正确性深修**」：TPMS 曲面族 14→20（MiniSurf 官方源码逐字转录 + 四方同源 + 可用域量化钉住）；自然语言 Agent 走完 M0-M5 全线——真实 LLM（智谱 GLM）tool calling 34 条中英指令回归 34/34，schema 拦截器对越界/注入零透传；同轮根治两类平台级正确性缺陷（Kozeny-Carman 量纲混用、索引池溢出死循环）。

### Stage I — 曲面族 14→20（C2 第三/四/五批）
- 新增 **dprime(D′) / dp(Double P) / dd(Double D) / dg(Double G) / fcky(Fisher-Koch C(Y)) / cdd(Complementary D)**——全部低谐波（≤2 倍频）、MiniSurf `document.xml` 原文逐字转录（Hsieh & Valdevit 2020），红队 20/20 公式对拍 + 10 万随机点 max diff 0.000e+0；
- 每族 22 文件四方同源（权威库/渲染查表/GPU IR/Python+MATLAB 导出双语 A+B 侧/UI/词表/逆向与物理估值表/CLI/schema/benchmarks）；
- **可用域透明化**：全部拒产组合以实测 nm 数钉进 schema_check（dprime R48 nm 18252、gprime k6 R96 nm 19080、lidinoid p0.75 k6 R96 nm 10368 等），tools.schema.json 给出降周期数/升分辨率的避坑指引；dg 的 iso 求解域钳制偏差如实披露。

### Stage II — Agent M0-M5 全线打通（M3 真实模型验收）
- **M3 LLMProvider**：统一 Provider 抽象 + 三实现（Ollama 本地 / OpenAI 兼容端点——智谱·DeepSeek·LM Studio / Mock 离线回归）；key 走环境变量不入库；
- **验收回归器 llm_regression.mjs**：34 条中英指令（基础构建/曲面族别名/参数槽位/estimate/list/scenario/对抗三样例/模糊与多目标），全部 --dry-run 槽位语义断言；
- **验收数据**：glm-4.6 **34/34 全 PASS**；glm-4-flash 29/34（经济档，全部异常被拦截器安全兜住）；路径穿越/越界孔隙率/越界分辨率零透传；
- **铁律实证**：LLM 只填槽位，一切数值由 schema 拦截器钳制或拒绝（越界 porosity 1.2 被自钳制、resolution 500 被拒绝）、CLI 确定性执行；
- 回归驱动的修复：SYSTEM_PROMPT 工具选择强化（scenario design 必填真实文件，杜绝幻觉文件名）、schema 别名对照表（diamond=Schwarz D 等）、nl-agent Schwarz D 词表 + 门禁。

### Stage III — 平台正确性深修（两类平台级缺陷）
- **Kozeny-Carman 量纲混用修复**：`(1−ε)²` 因子属每固相比表面 S_s 约定，误用于 bulk Sv 入参 → 渗透率被系统性低估 `(1−ε)²` 倍（φ=0.7 时 11×）。permeability.ts 与 inverse-design κ\* 同步修正；native_cae 新增 F 节 FD-Darcy vs K-C 对拍（实测比 1.22–1.39 ∈ [0.3,3]，旧公式下 4.4–5.8 越界——测试有区分力）；
- **fcks 索引池溢出死循环**：BufferPool MAX_INDICES=6M（R≤96 时代尺寸）在 fcks R120（需 6.174M）溢出——pushTri OOB 写静默截断 + 边键 OOB 读 undefined→NaN → 分组循环 `NaN!==NaN` 死循环（曾误登记「>36 分钟本质成本」并据以错判 fcks 为预注册曲面）。修复：MAX_INDICES 6M→9M + pushTri/P7 顶点/8c 封盖三处显式容量守卫。**裁决翻转：fcks R120 水密可产（nm=0，偏差 0.35pp，21.6s）**；
- **nl-agent 词表劫持修复**：「Double Diamond」曾被 diamond 子串静默路由、「Schwarz D」别名缺失——词表前移 + 全名变体 + 别名扩展，nl_agent_audit +2 断言（42 断言）。

### Stage IV — 标定与可用域收官
- **R128 容差标定**：12 代表族（k≤5）全部落在 mesh_audit 相对容差外推内（最紧 frd 定向错 4230/阈 7562），官方标定域正式延伸至 k≤5/R128（r128_tolerance_probe.mjs + 数据表入库）；
- **k=6 标定**：11 案例 4 超阈 → 维持非标定域（lidinoid k6 R96 nm=10368 与旧登记精确同源——勘误「已过时」归因，实为 k6 口径）；
- **cylinder+diamond 深水区定性**：R48-R128 全拒产且非单调不收敛、k2 无效——与 cube 族收敛行为定性不同的独立机制；
- **头注诚实化**：18 处门禁头注宣称与实际断言不一致全部对齐实现（含 K-C 对拍缺口如实登记后补齐）。

### Stage V — 基建与工程卫生
- CI 调度 39→**42 门**：selftest / schema_check / llm_provider_selftest 三项转正进调度（均有「不在调度→静默红」事故史，手动纪律证伪）；
- mesh 构建失败 exit code 对齐 solve 语义（2→3 分裂修复）；selftest list 断言随曲面扩容同步；
- **git 历史清洗**：98MB 门禁残留 STL 经 filter-branch 从 main+polish 全历史剔除（本地包 73.3→40.3MiB，tip 树零变化），gitignore 升级为目录级通配；
- Windows libuv `win/async.c` 断言根治：Agent 网络层 process.exit 改 exitCode 自然排空（undici 句柄竞态）。

### 教训（v8.0 新增）
- **挂死判别法失效边界**：「CPU 时间增长+内存稳定=在计算」对无限循环不成立——死循环同样烧 CPU；挂死排查第一步应加相位桩而非信耗时归因（本例相位桩三级定位仅耗 ~10 分钟）；
- **TypedArray OOB 写零告警**：越界写静默截断、越界读 undefined——出现 NaN 键必查 OOB 读链；容量守卫必须覆盖全部池数组而非只 field；
- **gitignore 按目录类维护**：逐文件补丁会让同类垃圾在第二个目录重演（32MB→98MB 两周两度）；
- **改 UI 源码后必须先重建 docs/platform 再跑本地 UI 套件**——本地全绿 + CI 三平台同红 = 测的是旧站的假绿。

---

## English (condensed)

v8.0 completes the **surface library (14→20 families, MiniSurf-provenance, quantified availability domains pinned in schema)** and the **agentic loop (M0-M5)**: a real-LLM tool-calling agent (Zhipu GLM via OpenAI-compatible endpoint) passes a 34-case bilingual regression 34/34, with the schema interceptor rejecting/clamping every out-of-range and path-injection probe. Two platform-level correctness defects were fixed: a dimensional mix-up in Kozeny-Carman permeability (underestimating κ by (1−ε)², up to 11×) and a BufferPool index-capacity overflow that turned fcks R119+ builds into a NaN-keyed infinite loop (previously mis-diagnosed as "essential cost"; verdict flipped — fcks R120 is watertight-producible in 21.6s). Tolerance calibration extended to R128; k=6 formally out of domain; 18 gate headers aligned with actual assertions; CI schedule grown to 42 gates; 98MB of stray STL blobs purged from git history via filter-branch.

**Verification**: 42-gate CI suite, three-platform matrix, 1000+ assertions; M3 acceptance glm-4.6 34/34; offline interceptor selftest 33/33.
