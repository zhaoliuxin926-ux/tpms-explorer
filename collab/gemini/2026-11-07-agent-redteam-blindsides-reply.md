# Gemini 回执 · agent 红队盲区 E5~E14（2026-11-07）

> **提问**：2026-11-07-agent-redteam-blindsides.md（黑盒契约面）｜**回执**：用户代贴原文
> **处置**：ZCode 逐用例实测（probe_redteam_e5e14.mjs，17 案）——**3 真穿透 + 14 已防护**。

## 回执原文（用户代贴，全文归档）

（E5 资源耗散/E6 同名键+未知字段/E7 NaN-Inf/E8 类型谎言/E9 INP 注入/E10 路径变体家族/
E11 批次写写冲突/E12 区间反转/E13 量纲歧义静默钳制/E14 步长退化——十案载荷形态、
攻击面分类、预期行为、可自动化性标注及"覆盖缺口 Top3"全文见会话记录与提问侧归档；
以下为实测裁决表。）

## 实测裁决表（probe_redteam_e5e14.mjs 全量 17 案）

| # | 用例 | Gemini 预期 | 实测 | 机制 |
|---|---|---|---|---|
| E5 | 64×合法顶格 mesh | 拦截（需联合算力预算） | **放行=设计级缺口** | 拦截器仅 64 计数上限，无跨调用算力预算（Top1 缺口证实） |
| E6a | 未声明字段走私 | 拦截 | ✓ 已防护 | additionalProperties:false + hasOwn |
| E6b | 同名键 last-wins | 拦截 | **放行（真穿透）** | JSON.parse last-wins→porosity=65 过 estimate 无上界——**与 E13 同根因** |
| E7a/b | NaN/Infinity | 拦截 | ✓ 已防护 | JSON 语法拒绝 NaN + Number.isFinite |
| E8a/b | bool/数组冒充数值 | 拦截 | ✓ 已防护 | typeof 严格类型拒绝 |
| E9 | INP 卡片注入 | 拦截 | ✓ 已防护 | **机制更正**：scenario 契约无自由文本材料槽位（material 枚举在 design_verify），注入面=契约不可达 |
| E10a~e | 路径变体家族 | 拦截 | ✓ 已防护（5/5） | 单段安全文件名 pattern+Win 设备名负查（%2e%2e/....//、NUL、\0、/dev 全家） |
| E11 | 批次同 out 写写冲突 | 拦截或净化 | **放行=设计级缺口** | 无批次级输出冲突检测，串行执行后者静默覆盖（Top3 证实） |
| E12 | 区间反转 | 拦截 | ✓ 契约面已防护 | porosity 是 number 槽位，数组形态类型拒绝；**执行器槽位修补面（tpms-driver）待查** |
| E13 | porosity=65 量纲歧义 | 拦截并报口径 | **放行（真穿透）** | estimate.porosity 只有 minimum:0 **无 maximum**——65=6500% 孔隙率过校验进执行器 |
| E14 | 步长退化 | 拦截 | ✓ 已防护 | **契约无扫描域槽位=攻击面不存在**（扫描域不是 LLM 可填槽位） |

## 机制更正（Gemini 预设 vs 实装，两处）

1. E13 预设"无脑钳制"→实装=**拒绝式**校验（mesh/scenario 的 porosity 越界=结构化拒绝）——
   熔断带方案唯一的真靶子=estimate.porosity 缺 maximum。
2. E9 预设 scenario 有 material 自由文本→契约无此槽位，攻击面不存在。

## 处置（ZCode 登记 2026-11-07 深夜）

1. **修复批（下一批第一优先）**：estimate.porosity 加 `maximum: 1.0`（+minimum 复核）——
   一次性堵 E13+E6b 两案；改后重跑探针（两案应翻转拦截）+schema_check/自测门。
2. **设计级缺口登记（bugs.md 开放风险）**：E5 联合算力预算、E11 批次写写冲突——
   需批次级上下文与预算机制（设计决策：mock 拒绝守卫下实际风险=真实执行面，缓），
   待用户拍板是否立项（agent 批次执行器改造）。
3. **执行器面待查**：E12 的 tpms-driver 槽位修补单调性校验——下一批顺带核查。
4. **Top3 采纳度**：Top1（联合预算）/Top3（批次去重）=设计级登记；Top2（严格反序列化基线）
   =**已被实装覆盖**（E6a/E7/E8 全家已防护=additionalProperties+isfinite+严格类型在位）。
