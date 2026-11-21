# context — TPMS 项目上下文

- 仓库：D:\GITHUB\tpms，TPMS 参数化设计与分析平台（用户个人作品集，与导师课题无关）
- 核心：tpms/tpms-platform（Vite+TS 单页）、tpms/agent（CLI/基准/回归）、tpms/.verify（**50 门** CI 门禁）、sim/（ABAQUS/OpenFOAM/COMSOL 仿真管线）
- 平台现状：**26 族**（24 TPMS+strutbcc/strutoctet）；Pareto 全家+26 族画廊；产品号 v1.3.0 稳定序列（功能标签「原型期 vN」双轨）；release notes 在 docs/releases/
- **Agent 面（6 工具满配）**：list/estimate/mesh/scenario/design_verify/pareto；**session-core.mjs 会话与确定性指代单源**（CLI/Web 双端共享，双语义锁）；**DSH 三栏 CAE 工作台+cae-daemon 本地桥**（127.0.0.1:4830，五 job kind）
- 权威口径（2026-11-16 规整）：**50 门**三平台绿；docs_consistency **349**（扫 138 md）；schema_check **113**；llm_provider 104（E5b 跨批累积+水位+软警告 2026-11-22）；nl_agent 48；agent_bridge **53**（满配档）/52（CI 基线）；harness_ui_check **38**；fix_check **30**（B6 卡片行为断言）；llm_driver_selftest 10
- **CFD 标定线（完全自持）**：三层交付=数据（K_scan/k2_scan/k3_prophecy/kc_recompute/k_inf JSON）+权威文档（docs/cfd-calibration.md）+消费件（docs/cfd-k-curve.csv）；口径三层=K_cell（R48 单胞）×0.9594（N=2 实用修正）→K_true=0.442·ε^3.17；K∞=0.1342 mm²（N→∞ 渐近参考）；KC 对照=STL 实测 Sv 口径（CFD/KC=0.52→0.37，真实 Kozeny 9.6→13.5）；FVM 兜底轨=冒烟档（fidelity_warning 护栏）
- **FEA 标定线**：network 双族幂律（gyroid E*=0.9914ρ̂^2.2028 / diamond 0.7871ρ̂^2.0709，STL 实测口径）；**T1 代理认证**：线弹性 E_eff 双点盲测通过（p70 −1.07%/p50 −0.90%，实测 ρ̄ 口径 <0.3%）；Rp0.2/平台=经验外推待 EXPL 链核验；权威文档 docs/fea-calibration.md
- **四级对标**：T1 解析幂律/T3 WSL OF13（K_true=0.11517 mm²，×1000 报告层勘误待拍板；RVE 口径 −22% 披露）/T4 ABAQUS（E_eff 138.29）/**T4 流体侧 COMSOL 闭环（11-21）**（K 双口径双解 0.4% 互证+β≈500-583 真惯性+WSS 窗口 29.4% 终判，口径披露 docs/cfd-wss-window-caliber.md）/T2 浏览器（降阶代理披露）；multifidelity_verification_report.json 在 sim/out/rve_real_fix/
- **平台 UX（11-21 打磨弧）**：拦截三段式卡片（blockCard.ts，导出门硬拦截可行动反馈+B6 行为断言钉 fix_check 守卫 30）+NL 气泡重建指示（elapsed 诚实版）+NL 抽屉 45↔85vh+推荐文案程序化派生（周期上界=128帽/32 常数）+**11-21 走查批 79bc59d**（16 处 aria-label 错贴语义修复+minWallMm/minThroatMm NaN→披露字符串归一）；行动钮重导=awaitNextRebuild 竞态修复范式
- 试样体系：specimens/ 32 件全齐（S1_G60 上机挂起，2026-11-11 用户拍板）
- 智谱 key：Coding Plan 型 key 只经 env 不落盘；三 env 铁律=KEY/BASE_URL/REG_PROVIDER；**CORS 终判**：智谱浏览器直连死路，GO=DeepSeek+OpenRouter+Ollama
- CFD 判断层 skill：openfoam-cfd（~/.zcode/skills/）——v13 语法断代/Anchor 阶梯/量纲地板/近壁离散全部沉淀；CFD 任务开工先读
- 形态拍板：network（solid）终态（拓竹 P1S FDM+PLA+0.2 喷嘴）；sheet 标定链不启动
- 已发布博客：一/二/三双平台（掘金+知乎）；博客四定稿待发
- 仓库当前为 Public（公开作品集+Pages）；内网 IP 与 key 严禁落盘；多设备纪律见 machine-facts.md（新设备第一读）
