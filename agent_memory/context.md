# context — TPMS 项目上下文

- 仓库：D:\GITHUB\tpms，TPMS 参数化设计与分析平台（用户个人作品集，与导师课题无关）
- 核心：tpms/tpms-platform（Vite+TS单页，WebGPU/Three.js）、tpms/agent（CLI/基准脚本）、tpms/.verify（CI 门禁）
- 平台现状（2026-10-06 会话终态，第 72 批）：**26 族（24 TPMS+strutbcc/strutoctet 桁架）**；Pareto 全家（前沿/约束过滤/hybrid/**逆设计推荐**）+26 族画廊；**v9.3.0-strut-pareto+v1.1.0 双 tag 已发布**（@f34dcdb，Release=Latest，线上验收过）；深水风暴关闭（探针常驻）
- **Agent 面（六工具）**：list/estimate/mesh/scenario/design-verify/**pareto**（CLI `pareto --target-e/--target-k` 与 UI 同源）；指代披露三层修（提示词纪律+模型备注通道 modelNote+E5 用例）；回归集 **43 条 n=2 双轮满贯**（含 H 组逆设计意图）；42 条口径满贯矩阵 4/4
- 权威口径：46 门；schema_check 113（GUARD 98）；llm_provider 43；nl_agent 48；docs_consistency 349（本机）/331（干净 clone 稳态）；ui_jump 12（含画廊双污染钉）；ml_pareto 16
- 试样体系：specimens/ **32 件全齐**（8 组×4 含 S7/S8 桁架对照组；exporter 默认墙 1200s——strutoctet k8 R96 单件实测 8m13s）
- 智谱 key：**用户新 key（2026-10-06 起"以后都用这个"，Coding Plan 型——paas/v4 报 1113）**只经 env 不落盘；三 env 铁律=KEY/BASE_URL/**REG_PROVIDER**（漏第三个=openai 协议打 anthropic 端点全 FAIL）；合规边界不变
- 已发布博客：一/二/三双平台（掘金+知乎链接在 README+job_narrative）；博客四定稿待用户择期发（publish 粘贴版+摘要文案已备）
- 关键坑（本会话新增）：切族 setState 重置 state.weights（多族遍历须 getDefaultWeights 解耦——连同 hybrid/thickness 全解耦）；schema 禁句哨兵单向性（断言数涨须翻转）；新写回路径四件套（updateBadges 第三件）；慢 runner 时序断言=更少生成次数而非更大窗口；CI 接棒纪律（中间 run 环境性红由最后 push 的 SUCCESS 超越，绝不 rerun 中间）
