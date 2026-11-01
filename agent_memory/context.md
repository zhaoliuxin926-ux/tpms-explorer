# context — TPMS 项目上下文

- 仓库：D:\GITHUB\tpms，TPMS 参数化设计与分析平台（用户个人作品集，与导师课题无关）
- 核心：tpms/tpms-platform（Vite+TS 单页，WebGPU/Three.js）、tpms/agent（CLI/基准/回归）、tpms/.verify（48 门 CI 门禁）、sim/（ABAQUS 高保真仿真管线）
- 平台现状：**26 族（24 TPMS+strutbcc/strutoctet 桁架）**；Pareto 全家（前沿/约束过滤/hybrid/逆设计推荐）+26 族画廊；产品号 v1.2.0 稳定序列（功能标签「原型期 vN」双轨）；release notes 在 docs/releases/（17 份）
- **Agent 面（六工具）**：list/estimate/mesh/scenario/design-verify/pareto；回归集 43 条 n=2 双轮满贯（含 H 组逆设计意图）；llm_provider_selftest 101 断言
- 权威口径：48 门（run_ci_suite）；docs_consistency **349**（2026-11-01 整理轮后本机=CI 同口径）；schema_check 108；llm_provider 101；nl_agent 48；docs 门 GUARD 下限 313
- 试样体系：specimens/ 32 件全齐（8 组×4 含 S7/S8 桁架对照组）
- **FEA 标定线**：network gyroid 幂律（E*=1.02ρ̄^2.25 / Rp0.2=0.54ρ̄^2.02 / 平台σ=1.64ρ̄^2.41，k≥2 域 ρ̄∈[0.3,0.5]）；权威文档 docs/fea-calibration.md；diamond 阶段定稿（三点 E* 候选数据暂缓入库，主公式暂缓）；条件匹配探针 probe_dt_fea_matched.mjs 活跃
- 智谱 key：用户 2026-10-06 起的 Coding Plan 型 key 只经 env 不落盘；三 env 铁律=KEY/BASE_URL/REG_PROVIDER
- 已发布博客：一/二/三双平台（掘金+知乎链接在 README+job_narrative）；博客四定稿待用户择期发
- 仓库 2026-11-01 历史清洗 force push 后已转私有；宿舍机对齐纪律见 machine-facts.md
