# DeepSeek 开源全景调研（2026-11-15 · 用户指令：看完告诉要做什么）

## 全景（47 仓库四分类）

| 类 | 代表 | 与 tpms 相关度 |
|---|---|---|
| Agent/harness | deepseek-harness 281k★（11-13 活跃）/ dsh-superagent-prototype 23k★ / awesome-deepseek-agent 6.4k★ / chat-demo 2k★ | **直接相关** |
| 模型 | V3 104k★/R1 92k★/Coder/OCR/Janus/VL/Math/Prover | 间接（用 API 不自部署） |
| 推理基础设施 | FlashMLA/DeepEP/DeepGEMM/DeepInfer 26k★/3FS/smallpond/DualPipe/EPLB/TileKernels/DeepJIT/DeepSpec | 无关（无训练/推理需求） |
| 3D 生成 | DreamCraft3D 3k★（ICLR 2024 文生 3D） | 概念交集（生成式 vs 参数化，登记不立项） |

## 深读一：deepseek-harness（MIT，架构文档全文）

核心=Cordis 插件框架（一切皆插件，注册=可逆 effect，无特权核心）+ Profile/Bundle 组合（web/headless/sdk/acp 多入口 YAML 分层 patch）+ 三层事件域（Session durable/Agent live/Capability seam）+ **"Model-visible means logged"**（模型可见上下文必须可从持久日志重建）+ 能力 seam 三角色（Definition/Provider/Consumer）。

**裁定：Cordis 插件化不引入（11-11 裁定维持）**——tpms 零后端单页+50 门锚结构，引框架=拆散门禁锚；单平台不需要 provider swap。可吸收：①扩展者文档表（"新行为挂哪"Goal→Mechanism 一张表）②Model-visible means logged（history 从 session 日志投影派生）。

## 深读二：dsh-superagent-prototype（MIT，哲学+架构）

核心哲学=**注意力经济学**："Take as little human attention as possible"——agent 只在被请求/书面规则允许时行动；只在人必须行动时说话；一次只问一个结构化具体问题；**按影响停止不按努力停止**；诚实汇报（草稿标记未完成/失败报失败/极限不绕过）。文档=000-008 编号顺序阅读体系（每篇只依赖前篇）；tests 80+ spec（测试密度极高）。

**对照 tpms：设计方向同构验证**——M4 修复轮上限+declare_unreachable="按影响停止"；system prompt 诚实条款="报告诚实"；Per-Prompt 预算=注意力经济学的资源面。可吸收：①编号顺序文档体系 ②结构化单问题交互（产品级，低优先）。

## 行动清单（按价值排序）

1. **立即做**：docs/agent-architecture.md——吸收两家之长（harness 的 Goal→Mechanism 扩展点表+superagent 编号顺序体系），显式化 tpms agent 线五子系统（工具面/预算/会话/桥/daemon）扩展点。纯文档零风险。
2. 待用户：Gemini 代贴（CFD 三问）；DeepSeek/LLM key；COMSOL license。
3. 登记不立项：Cordis 插件框架；DreamCraft3D 生成式路线；推理基础设施全家。

---

## 续篇：数字生命卡兹克（KKKKhazix）开源全景与三方融合落地（2026-11-16）

通过 GitHub API 对 `KKKKhazix` 开源矩阵（4 仓库总计 4.3 万+ ★）完成交叉对照，提炼并落地三项机制至本仓：

| 对标项目（Star） | 核心机制 | 在 tpms-explorer 的落地动作（2026-11-16） |
|---|---|---|
| `khazix-skills/neat-freak` (22.3k ★) | 三层文档/规则/记忆对齐防脑腐 | 升级 `tpms/.verify/docs_consistency_check.mjs`：把 `PROJECT_SUMMARY.md` / `PROJECT_INVENTORY.md` 的门数、诚实边界条数、`RELEASE_NOTES` 份数及 `gen-boundary-table.mjs --check` 动态锁入 CI（保持 349 断言恒定） |
| `khazix-skills/leader` + `agent-autoloop` (5.6k ★) | 目标七问（完成态/反作弊/未知挂起）+ 事件溯源 + TTL 跳数熔断 | 固化 [plans/2026-11-16_EXPL塑性段与上机正交实验_目标任务书.md](../../plans/2026-11-16_EXPL塑性段与上机正交实验_目标任务书.md)，为 Explicit 塑性段批跑设定 `ALLKE/ALLIE < 10%` 硬判据、TTL=3 熔断与 `jobs.jsonl` 溯源格式 |
| `human-writing` / `khazix-writer` (4.6k ★) | 去 AI 腔硬规则 + 真实数据叙事 | 撰写系列第五篇技术博客 [docs/blog/2026-11-16-multifidelity-calibration.md](../../docs/blog/2026-11-16-multifidelity-calibration.md) 并同步 `publish/` 粘贴版与双语 README 入口 |
