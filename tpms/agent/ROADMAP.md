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

### M1 几何闭环 — 未开始
- 目标：CLI 内完成 参数 → 体素场 → 网格 → STL，不经浏览器
- 途径：把 surface-nets / webgpu-evaluator 的 CPU 回退路径经 core-loader 暴露（注意 evaluator 依赖 equation-parser 无扩展名导入，bundle 已验证可解）
- 成功标准：产出的 STL 过 mesh_audit 同款水密检查（开放边 = 0）；体素孔隙率与目标孔隙率偏差在平台审计口径内

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
