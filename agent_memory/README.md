# agent_memory — 跨设备交接层（随仓库跟踪）

本目录是项目的**唯一现役记忆层**（2026-10-26 多设备定案入库；2026-11-01 全仓整理后，历史残留目录 `tpms/agent_memory/` 已删除收编）。

## 文件分工

| 文件 | 用途 |
|---|---|
| progress.md | 当前任务进度：正在做什么、已完成、卡点、下一步（旧内容归档到 archive/） |
| context.md | 项目级上下文：目标、目录结构、技术栈、约束 |
| bugs.md | 问题与风险：§一 已定案边界（gen-boundary-table.mjs 的生成源）+ §二 开放风险 |
| machine-facts.md | 跨设备机器事实（新设备第一读） |
| interview_prep.md | 求职面试考点（2026-11-01 自 tpms/agent_memory/ 收编入库） |
| job_narrative.md | 求职叙事+投递清单（同上收编；docs_consistency 门禁 optional 扫描目标） |
| taskflow-e2e-2026-10-25.md | 批八任务流五步端到端走查报告（验收凭据） |
| archive/ | 历史归档（docs_consistency 链接扫描排除域） |

## 关键规则

- **改诚实边界只改 bugs.md §一**，然后 `node tpms/agent/gen-boundary-table.mjs` 重生 `docs/HONESTY_BOUNDARIES.md`，`--check` 验证。
- 三个记忆文件只保留当前有效信息；文件过长压缩为摘要，旧内容归档到 archive/。
- 敏感串扫描已过（无凭证/无 key 模式）；新增内容保持此纪律。
- agent_memory/** 不在 CI 触发路径（收尾 push 不触发 25 分钟全量 CI）。
