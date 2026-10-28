# Agent 执行可靠性收口 + 基准/现态文档刷新（2026-10-19 批次）

来源：Codex 审计 2026-10-19（报告：`C:/Users/qi/.codex/visualizations/2026/10/19/01a152ee-f045-7a52-8806-c21603409f1b/TPMS-status-and-next-steps-2026-10-19.md`），五项第一优先缺陷已由 ZCode 逐条对源码核实 + 关键项一手复现，全部属实。
**2026-10-19 学生裁决（本版修订依据）**：A1 收窄为"复杂指令明确拒绝"；A2 保留 `--max-repairs 0` 等合法边界；A4 沿用 `failed/exit 1` 不新增状态码；A5 注入机制重新落实为可替换执行器+可控慢子进程；B 按实测记录、发版号留待收口。

## 问题定义

Agent 会话/管线的指令可靠性与失败路径不诚实（错绑候选、静默忽略用户参数、早退裸崩、预算穿透、末步失败假成功），加上 S8 解锁后基准与现态文档陈旧。收口后具备发版条件（版本号见批次 C）。

## 根因（已核实，非猜测）

1. **指代错绑**：`agent-session.mjs:125` `instruction.match(ORDINAL_RE)` 只取首个序数；全文无否定词处理 →「不要构建第一个，构建第二个」绑第 1 项；「第一个和第二个都构建」也只绑第 1 项且不披露。
2. **参数静默忽略**：`:132` 歧义守卫只识别孔隙率/百分数；「改成 4 个周期」「换成圆柱容器」不在守卫内，`llm-agent.mjs:137` 直接用候选原值构造 `meshArgs` 绕过用户要求。
3. **早退裸崩**：`agent-pipeline.mjs:112` 的 `finish()` 早于 `:132 outDir`（const）/`:136 repairsUsed`（let）的声明执行 → TDZ ReferenceError，承诺的 stdout JSON 丢失（一手复现在案：`--top abc` → `:196 Cannot access 'repairsUsed' before initialization`）。`top/pick` 等数值参数无预校验。
4. **wall 预算穿透**：`:89 budgetLeft()` 只在调用前检查；`:100` spawnSync 给子进程完整 `subTimeout`（默认 600s）→ 实测 `--max-wall-ms 1000` 跑到 30.8s 才以 budget-exhausted 返回，STL 已写出（Codex probe：journey-review/wall-budget/）。
5. **末步假成功**：`:186-192` overhang 非零退出/超时只给分层 `failed:true`，`:191-192` 无条件 `completed/exit0`。
6. **错误路径回归空洞**：driver_selftest 测试 9 原依赖 octet 拒产验证"不可达链"，S8 解锁后翻转为成功链（42c2f27）——拒产顺延/全拒产/末步失败不再有确定性覆盖；现有 Mock 仅覆盖修复决策队列，无法模拟管线各步骤失败。

## 修复方案（批次 A：可靠性，一个提交）

- **A1 指代解析收窄**（agent-session.mjs，裁决①）：第一版**只接受明确、单一的指代构建指令**。否定词（不要/别/勿/而非/除了/排除…）出现在指令任何位置 → 结构化拒绝；序数指代（中/英）数量 ≠1 → 拒绝并披露检测到的指代数；歧义守卫在孔隙率之外扩展到 `周期|periods|容器|container|分辨率|resolution`，附带新参数一律拒绝并解释。不做子句级否定范围推断。**周期/容器的参数覆盖解析留待后续独立批次**（本批只求不静默误执行）。
- **A2 早退结构化 + 参数校验**（agent-pipeline.mjs，裁决②）：`outDir/built/repairsUsed` 等报告状态声明前置到 Step 1 之前。参数校验保留既有合法边界：`max-repairs 0` 合法（既有测试依赖）、各 `max-*` 按语义校验非负/正整数；`top` 范围校验；`pick` 正整数 + 推荐返回后候选越界校验。非法输入统一返回 stdout JSON + exit 2。所有提前退出路径输出一致结构化报告。
- **A3 预算钳制**：spawnSync `timeout = min(subTimeout, 剩余 wall 预算)`；子进程因 wall 预算被杀（status=null 且超时值为预算所钳）→ 归类 `budget-exhausted/exit 4` 而非 failed，保留已产生成果并如实报告。
- **A4 末步语义**（裁决③）：悬垂审计失败 → 保留已交付 STL，报告明确失败步骤与退出码，整体 `failed/exit 1`；总预算耗尽继续 `exit 4`。**不新增** `completed-with-failures/exit 5`。
- **A5 可替换执行器 + 确定性回归**（裁决④）：管线 tpms 子进程入口支持 env 覆盖（默认真实入口不变）；selftest 运行时生成临时夹具脚本（pareto 返回罐头推荐/mesh 按脚本化退出码与延迟/overhang 可控失败），补齐错误路径链：推荐失败、拒产顺延、全拒产（exit3 语义）、wall 预算耗尽、末步失败（exit1 语义）。预算断言基于**可控慢子进程**（如 1s 预算 + 数十秒慢步骤 → 断言 budget-exhausted/exit4 且实际耗时至多数秒），不依赖真实网格耗时。

## 批次 B：基准与现态文档（一个提交，裁决⑤）

- `benchmarks.mjs:94-95` 模板 24 族/46 门 → 26 族/48 门（**先改生成器再重跑**——该文件注释里刻着"生成器每次重算冲掉手修"的教训）。
- `benchmarks.mjs --md BENCHMARKS.md` 重跑（~15 分钟）——**按实测如实记录**成功/拒产/超时，不预设 Octet R48/R96 两格必成功。
- `YOUR_10_MIN.md`：18 件→32 件；40/40×2→43/43×2（n=2 双轮）。
- `ROADMAP.md`：清已完成待办（博客二/三已发、回归扩容已完成）。
- 博客四补 S8 解锁结局（`docs/blog/2026-10-05-strut-sdf-to-specimen.md` + publish 镜像 sync-publish）：旧结局停在"非流形 190,656 拒产受阻"，需续焊接解锁 + 已知边界（焊接候选无长度门限等已登记风险）。
- 数字改动连带：docs_consistency_check 全跑，命中正向钉/禁句则按纪律连带 README 双语与断言集。

## 批次 C：收尾（用户侧/拍板项，不在本批自动执行）

- 提交 0：博客三读者补充（工作区 2 个未提交文件，已过 sync+docs 门核实）单独成提交；`plans/` 不跟踪入库。
- A、B 各一提交；本地全量 48 门实跑绿后推送（接棒纪律）。
- 发版：版本号**暂不锁定**——收口时核对既有稳定 `v1.x` 双 tag 规则后定；S1_G60 上机为用户侧拍板项。

## 素材

- Codex 详细报告 + probe JSON（reference-probes.json / wall-budget/）
- 本仓 agent_memory/progress.md（10-12 七段交接终态）、铁律速查

## 交付物

- 批次 A/B 的代码修复、新增回归、再生基准与文档；进度与验收记录进 agent_memory。

## 验证标准

- A1-A4 新增用例全绿；`--top abc` 输出结构化 JSON（exit 2，非裸崩）；慢子进程预算探针返回 budget-exhausted/exit4 且耗时与真实网格无关。
- llm_driver_selftest / llm_provider_selftest / schema_check / strut_exit / docs_consistency / sync-publish --check 全绿。
- 推送前本地全量 48 门实跑绿。
