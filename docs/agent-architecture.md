# Agent 线架构 — 面向扩展者

> 目标读者：要给 tpms Agent 线加行为的开发者（或 AI）。体例吸收 DeepSeek Harness（扩展点表）与 dsh-superagent（编号顺序阅读）两家之长；实现全部零框架依赖，先读 000，每章只依赖前章。

## 000 总览

五个子系统，两条运行面（CLI 与浏览器共享同一套单源核心）：

| 子系统 | 真源文件 | 职责 |
|---|---|---|
| 001 工具面 | `tpms/agent/schema-core.mjs` | 工具 schema、逐槽位校验拦截器、修复菜单 |
| 002 预算与安全 | 同上（validateToolCalls） | Per-Prompt Run 算力预算、写冲突、越界拒绝 |
| 003 会话与指代 | `tpms/agent/session-core.mjs` | 会话结构、双语义锁、确定性指代绑定 |
| 004 桥与双壳 | `tpms-platform/src/core/iframe-bridge.ts` | 驾驶舱壳↔工程壳同源桥、滑动窗 cap |
| 005 本地 CAE 桥 | `tpms/agent/cae-daemon.mjs` | Web→本机求解器（nTop/OF13/ABAQUS/COMSOL） |

铁律：**schema-core 与 session-core 严格禁止 import node:* 与浏览器存储**——CLI 与浏览器双端共享的单一真源，任何平台依赖都会打破同源锁（门禁 agent_bridge_audit G 段钉住）。

## 001 工具面：加一个新工具

现有 6 工具：`tpms_list / tpms_estimate / tpms_mesh / tpms_scenario / tpms_design_verify / tpms_pareto`。

扩展步骤（顺序即依赖）：
1. `tpms/agent/tools.schema.json` 加工具 schema（enum/min/max/additionalProperties:false 全家在位——拦截器按 schema 逐槽位拒绝，**越界是拒绝不是钳制**）；
2. schema-core 的 `validateToolCalls` 自动获得新工具校验（无需改码）；
3. 若是写操作（改视口/落文件）：在 agent-contract 的 `WRITE_TOOLS` 登记（同轮写互斥与视口冲突检测生效）；
4. 给它一个执行体：CLI 侧 tpms-driver / 浏览器侧 agent-contract `BROWSER_TOOL_NAMES` 映射到 main.ts 执行体；
5. 若新增**算力成本**：在 agent-run 的成本表登记（见 002）；
6. 门禁：schema_check（契约对拍）+ nl_agent（词表/回归）+ agent_bridge_audit（同源锁）三处同步锚。

## 002 预算与安全：Per-Prompt Run 窗口

- **窗口层级**：一次用户发送触发的自治 Run（1..maxRounds 跨轮累计，不重置）——CLI 的"单次进程"与 Web 的"单次发送"严格同构。Run 结束交还人类后重置。
- **公式**：Σ periods³ + 512×verify + 各工具登记成本 ≤ 4096；防脚本连发：60s 滑动窗 Σ≤8192（iframe-bridge 执行面同款 cap，绕过 harness 直发 postMessage 亦被封死）。
- **修复循环（M4）**：verify fail → 注入 `apply_repair` 菜单（LLM 只能在 patch_design/declare_unreachable 内选），轮上限 2、patches.periods³ 计入预算；修复应用是确定性代码，不是模型自由执行。
- **扩展成本规则**：新工具必须按"最坏一次调用对主线程/内存的冲击"登记预算权重（参考：mesh=periods³、verify=512）。

## 003 会话与指代：确定性绑定

- 会话结构（schemaVersion + 双语义锁 GEOMETRY_SEMANTICS/BINDING_SEMANTICS）加载即校验，**版本不匹配明确拒绝，不做隐式迁移**——旧语义候选直接执行会得到错误尺度。
- 指代解析 `resolveReference`：白名单肯定句式（"构建第 N 个/第一个"），否定与混参**确定性拒绝**——LLM 不参与指代消解（杜绝臆造参数）。
- 候选→构建映射 `candidateToMeshArgs`：periods=3 + specimenSizeMm=3×单胞 mm（v2 绑定语义）。
- 扩展指代句式：在 AFFIRM_WL 白名单加句式 + nl_agent 门禁加回归案——**先加拒绝测试再加句式**。

## 004 桥与双壳：信号契约

- 开桥双校验（同源+iframe 嵌入）+ 请求-回执 id 配对 + 重活滑动窗 cap（Σ≤4096/60s）。
- 写穿断言：外壳 apply → 工程壳几何/标题变化（一次信号证明 外壳↔桥↔工程壳 全链）。
- 扩展新桥信号：`iframe-bridge.ts` 注册 type → 工程壳处理器 → harness_ui_check 加端到端断言。桥上**禁止**携带 key/凭证（agent_bridge_audit C 段结构审计钉住）。

## 005 本地 CAE 桥：加一种求解器

cae-daemon（127.0.0.1:4830，origin 白名单 localhost only + 路径穿越封堵 + job 白名单 + self-test）。

现有 5 job kind：`preprocess-bl / openfoam-cfd / abaqus-fea / comsol-cfd / pipeline`。扩展步骤：
1. `ALLOWED_JOB_KINDS` 加 kind + `executeJob` 加分支（参数全部过 clampNum 白名单钳制）；
2. 子进程一律 `runSubprocess`（日志流回 job.logs，上限 500 行）；
3. 产物只落 `sim/out`（`resolveSafeOutPath` 封堵穿越；`artifact-raw` 白名单扩展名）；
4. 门禁：agent_bridge_audit J/K 段加断言（daemon 安全面 + 新链路）。

## Z 扩展点总表（Goal → Mechanism）

| 目标 | 挂哪 |
|---|---|
| 加模型 provider（浏览器） | `llm-provider-browser.ts`（OpenAI 兼容 CORS/Ollama；智谱自域白名单=浏览器直连死路，见 CORS 终判） |
| 加一个工具 | 001 五步 |
| 加一种修复策略 | schema-core REPAIR_TOOL + main.ts repairExec 同源映射 |
| 加一种指代句式 | 003 白名单+回归案 |
| 加一个桥信号 | 004 三步 |
| 加一种本地求解器 | 005 四步 |
| 调预算 | agent-run 成本表（登记最坏冲击） |
| 换会话结构 | session-core 版本锁 +1，旧会话明确拒绝 |
| 加门禁 | run_ci_suite 纳管 + 横幅断言数同步（横幅也是宣称载体，勿漂） |

## 门禁地图（改动前先查哪个门测哪个 artifact）

| 门 | 测什么 |
|---|---|
| schema_check | schema↔CLI 契约逐槽位对拍 |
| agent_bridge_audit | 同源锁/E5-E11 复刻/M4 循环真跑/daemon 安全（53 断言满配档） |
| harness_ui_check | 双壳真浏览器 E2E（38 断言） |
| nl_agent_audit | 词表/拦截/回归 48 断言 |
| docs_consistency | 文档数字宣称对拍（改文档必跑） |
