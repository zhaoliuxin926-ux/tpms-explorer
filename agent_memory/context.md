# context — TPMS 项目上下文

- 仓库：D:\GITHUB\tpms，TPMS 参数化设计与分析平台（用户个人作品集，与导师课题无关）
- 核心：tpms/tpms-platform（Vite+TS 单页，WebGPU/Three.js）、tpms/agent（CLI/基准/回归）、tpms/.verify（48 门 CI 门禁）、sim/（ABAQUS 高保真仿真管线）
- 平台现状：**26 族（24 TPMS+strutbcc/strutoctet 桁架）**；Pareto 全家（前沿/约束过滤/hybrid/逆设计推荐）+26 族画廊；产品号 v1.2.0 稳定序列（功能标签「原型期 vN」双轨）；release notes 在 docs/releases/（17 份）
- **Agent 面（六工具）**：list/estimate/mesh/scenario/design-verify/pareto；回归集 43 条 n=2 双轮满贯（含 H 组逆设计意图）；llm_provider_selftest 101 断言
- 权威口径：**50 门**（run_ci_suite，2026-11-12 harness_ui_check 纳管 49→50）；docs_consistency **349**（2026-11-01 整理轮后本机=CI 同口径）；schema_check **113**（2026-11-11 实测，108 旧口径作废）；llm_provider 101；nl_agent 48；agent_bridge **53**；harness_ui_check **38**；docs 门 GUARD 下限 313；**契约校验核单源 schema-core.mjs**（2026-11-11 方向 A 抽离：validateToolCalls/预算/写冲突/REPAIR_TOOL，CLI 与 Web 同源；CORS 终判=智谱浏览器直连死路/DeepSeek+OpenRouter GO）
- **NL 助手 LLM 合流（方向 A·2026-11-11 A2/A3-M4 落地）**：Web 端 BYO key 三通道（OpenAI 兼容 CORS 端点/Ollama 本地/无 key 规则兜底）；浏览器注册面=6 工具满配（list/estimate/mesh/design_verify + **tpms_pareto** 逆设计 832 点扫描 + **tpms_scenario** 场景模板）+**M4 有界修复菜单浏览器版**（verify 失败→apply_repair 同源菜单/轮上限 2/declare_unreachable/patches 计入预算）；Per-Prompt Run 预算窗口+170s 双层超时；**会话确定性指代 session-core.mjs 单源**（CLI/Web 双端共享，双语义锁）；新门 agent_bridge_audit **53 断言**（同源/E5-E11 复刻/Key 零泄漏/M4 循环+pareto/scenario 工具面/会话绑定/ABAQUS 反演/多物理场/cae-daemon 安全与 BL-COMSOL-nTop-RVE 链）
- **DSH CAE 工作台+本地桥（2026-11-13/14 Phase 4-5）**：harness-cae-dsh.ts 三栏工作台（Rail/Sidebar/Split Dock/斜杠菜单）+ cae-daemon.mjs（127.0.0.1:4830，origin 白名单/路径穿越封堵/job 白名单/self-test，五 job kind）+ p1_bl_mesh 三轨 BL（ntop/gmsh-bl/snappy-bl）+ p3_openfoam_solve（WSL OF13 主轨+FVM Brinkman 兜底，双流速 Forchheimer/WSS 成骨窗口）+ p4_comsol_setup（COMSOL 6.2 Java）+ ntop_builder（nTopCL 6.3.3 .ntop 容器合成）+ 四级保真度对标矩阵（T1 解析/T2 浏览器/T3 本地 CFD/T4 工业多物理场）；**11-11"微内核+本地桥不立项"裁定已被本批次事实翻转（用户 11-13/14 接手指令确认继续）**
- 试样体系：specimens/ 32 件全齐（8 组×4 含 S7/S8 桁架对照组）
- **FEA 标定线**：network 双族幂律已换代入库（2026-11-04：gyroid E\*=0.9914ρ̄^2.2028 / diamond 0.7871ρ̄^2.0709，STL 实测口径+NOMINAL_TO_MEASURED 映射，三消费点单源连带）；强度侧 gyroid（Rp0.2=0.54ρ̄^2.02/平台σ=1.64ρ̄^2.41，Explicit）；权威文档 docs/fea-calibration.md（p50 放行证据链+传递修正因子 η(ρ̄)）；条件匹配探针 probe_dt_fea_matched.mjs 活跃
- 智谱 key：用户 2026-10-06 起的 Coding Plan 型 key 只经 env 不落盘；三 env 铁律=KEY/BASE_URL/REG_PROVIDER
- **CFD 判断层 skill**：openfoam-cfd（~/.zcode/skills/）——v13 语法断代/Anchor 阶梯/量纲地板/近壁离散全部沉淀（2026-11-08 建），CFD 任务开工先读
- **形态拍板（2026-11-08 用户定）**：拓竹 P1S FDM + PLA → **network（solid）形态**——FDM 0.4 喷嘴壁厚下限裁决（sheet 薄壁 150-200μm 低于 FDM 极限）；sheet 标定链 B/C/D 不启动；老挂账③关闭
- 已发布博客：一/二/三双平台（掘金+知乎链接在 README+job_narrative）；博客四定稿待用户择期发
- 仓库 2026-11-01 历史清洗 force push 后已转私有；宿舍机对齐纪律见 machine-facts.md
