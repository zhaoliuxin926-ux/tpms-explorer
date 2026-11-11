# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-08 深夜交接 · UI 三批+PWA+CFD 矩阵全落地 · CI 绿）

> **仓库态**：main=b60f0a9（树=图标 SVG 版+清理后），**CI 对 f229d20 三平台绿**（树等价，仅差 agent_memory 进度行）——Pages 供最新版（含 PWA/3 步引导/气泡 mini 卡/SVG 图标）。工作树净。**宿舍机：fetch + reset --hard origin/main**（f229d20 前无重写，本次无碍；bundle 备份两个在 D:\GITHUB	pms-bundle-backup*.bundle 勿删）。
>
> ### 下会话第一优先：anchor 圆柱 snappyHex 实验（近墙策略终判）
> - **判据**：K 误差 vs hex O-grid −1.27% 基线（sim/cfd/anchor1/ 全套脚本在）。snappyHex=v13 原生零安装（cfMesh 已 404+ESI fork 兼容性死路，见下）。
> - **流程**：blockMesh 背景盒 + 圆柱表面 STL（gmsh 面网格导出）+ snappyHexMeshDict（castellated+snap+layers）→ foamRun → K 对账。**若 <0.5%：TPMS 近墙策略定案 snappy 路线**；失败则 cfMesh-ESI fork 兜底或量化偏差披露。
> - 注意：WSL 内 git clone 会挂死——外部仓库克隆走 Windows git 侧再拷入；foamPostProcess -funcs 只认 ETC 目录（采样走 writeCellCentres+python join）。
>
> ### 已拍板（不再问用户）
> - **形态=network（solid）终态**：拓竹 P1S FDM + PLA + 0.2 喷嘴。打印建议单 docs/fdm-print-guide.md（壁圈 2-3/层高 0.08-0.12/免支撑/最细杆 ≥0.5mm 红线）。**首件验证件已生成：specimens/print-verify_k3_G60_24mm.stl**（24mm k3 粗杆），正式标定件 specimens/S1_G60.stl 系 32 件全齐。
> - **sheet 标定链 B/C/D 不启动**（FDM 壁厚下限裁决）。
>
> ### 用户侧行动卡（**2026-11-11 挂起**：用户拍板近期不上机，移出行动卡；CSV 回传→反演+幂律叠图链路保持就绪，随时可恢复）
> ①打印首件验证工艺 → ②S1_G60 上机压缩 → ③CSV 回传（fit-batch 契约）。
>
> ### 工程侧剩余（按需立项，非阻塞）
> - UI：全部三批+图标一致化完成，**无遗留**。LLM E2 超时缓解（小件，需 key 消耗）可选。
> - CFD：snappyHex 实验后=近墙策略定案；K 标定进 0.5% 阈仍需棱柱类方案或量化偏差披露。
> - git 历史清理已完成两遍（count=0）；如需再清同流程（fresh-clone+filter-repo，bundle 先行）。
>
> ### 今晚关键教训（详见下方历史段与 bugs.md）
> 1. **门与 artifact 对应**：verify=冻结教学版 docs/app.html；fix_check=platform（4811）——改 onboarding 前必查。
> 2. **构建**：`cd /d/GITHUB/tpms/tpms/tpms-platform && npm run build`——禁止 build|tail 进 && 链。
> 3. **历史重写**：仓库冻结+fresh-clone+git filter-repo（filter-branch 弃用）。
> 4. **wsl**：内联 bash -c 撕参数——一律脚本文件；外部克隆走 Windows git。
> 5. **git add -A 禁手**（二犯）：提交前 status 明细必查。
> 6. **gmsh**：O-grid 中心块双切向 nArc/arc 中点角 90°+90k/面分类用 getCenterOfMass/体单元必须 3D 物理组。
> 7. **CFD 量纲**：驱动幅度须高于残差地板 3+ 量级；v13 语法外部声称必实测。
>
> ## 工位侧 11-11：Gemini 平台化咨询回执（参照系=deepseek-harness 开源平台；只出回执不立项，既定优先级不变）
>
> - **背景**：用户代贴 Gemini（以 deepseek-harness 开源 Agent 平台为借鉴参照）基于 platform/index.html 的"四大差距"诊断+Sim-Harness 改造建议。ZCode 核实：DOM 事实基本准确（31 抽屉非 29、nl 面板尺寸/单步规则解析属实），**关键勘误=M4 自愈闭环（tpms-driver 有界菜单修复+declare_unreachable）已在 CLI 线生产态**——真缺口是"两线合流"非"从零建"。
> - **裁定**（回执 collab/gemini/2026-11-11-agent-platform-consult-reply.md）：差距1 交互主次=真差距但属产品定位决策；差距2=半真（闭环已在 CLI）；微内核插件化+本地 CAE 桥**不立项**（48 门锚拆散/零后端定位冲突，sim/ 管线已承担真跑）。
> - **收窄路线**：A=Web NL 接 LLM function-calling+浏览器 ToolRegistry（前置卡点：paas/v4 CORS 未实测、key localStorage 纪律需拍板）→ B=harness.html 双壳（A 为前置）→ C 不立项。**用户拍板：本轮不立项，择期 A；既定优先（snappyHex 终判/S1 上机）不变。** 已向 Gemini 出三问（Web 合流最小方案/微内核可证伪判据/双壳移动端不回退）。
> - **第二轮（Gemini 终答已归档处置，`collab/gemini/2026-11-11-agent-platform-gemini-verdict.md`）**：接受全部勘误裁定；Q1 设计基线采纳（单源 schema-core.mjs／`__active_viewport__` 冲突锁／五类错误分类／四门禁增补）——两处修正（vite 路径 `../agent` 非 `../../`；E11 语义"整批拒 vs 重复者拒首个保留"待对齐）+ 一处实质分歧登记（**浏览器 45s 总超时 vs CLI E2 教训 170s thinking 长尾**，立项时用 E2 数据重定）；Q2 三判据（异构本体≥3/协作者>2/首屏 5MB·3s）登记备查；Q3 移动端 38vh/62vh 方案留方向 B。**参照系核实：deepseek-harness 官方仓真实（MIT/Cordis/`npx @deepseek-ai/dsh web`/developer preview），可借鉴 docs/architecture.md 但不引入 Cordis 依赖。**
> - **第三轮定案（同日，用户拍板）**：①S1 上机**挂起**（近期不上机，链路保持就绪）；②**方向 A 插队启动**（"想把 agent 平台做出来"），snappyHex 顺延；③三笔修正定案（E11 对齐 8d1bddb「首个保留/重复者拒」非整批连坐；浏览器总超时 170s+秒表+手动停止；vite 路径 `../agent`）；④**预算窗口定案=Per-Prompt Autonomous Run**（一次发送驱动的 1..maxRounds 跨轮累计不重置，超限熔断该 Run；Run 结束交还人类后重置；防连发滑动窗口 60s≤8192）。设计输入包齐备，A1（schema-core.mjs 抽离+CORS 实测）当日开工。
> - **A1 落地（同日，四门全绿）**：①CORS 终判（五组实测）：**智谱全线=自域白名单，浏览器直连死路**（anthropic 实响 dangerous-direct-browser-access 有 ACAO 回显但 preflight 无 ACA 头）；**GO=DeepSeek（Origin 回显）+OpenRouter（ACAO *）+本地 Ollama**——A2 云通道=任意 CORS 放行的 OpenAI 兼容端点，智谱 key 留 CLI。②**schema-core.mjs 单源抽离**：validateToolCalls（含 E5 预算/E11 写冲突）+schemaToOllamaTools 自 llm-provider、REPAIR_TOOL（REPAIR_TYPES）自 tpms-driver 迁入，零 Node 依赖；llm-provider 转出口保 import 兼容；schema_check 静态锚两处改指 schema-core。③验证：selftest 101/0+schema_check **113/0**（108 旧口径作废）+红队探针 17/17+driver selftest 20/0。④**A2 下一批**=browser provider（OpenAI 兼容 CORS 端点+Ollama+Mock 兜底）+BrowserToolRegistry 六工具映射+NL 面板 BYO key UI+四门禁增补（Per-Prompt Run 预算窗口/170s 超时+秒表停止钮）。
> - **A3-M4 落地（同日，有界修复菜单浏览器版，A2 CI 已三平台 success）**：agent-run 并入 M4 修复模式——design_verify verdict=fail（ToolExecResult.verifyFail 信号）后的下一轮自动注入 apply_repair（REPAIR_TOOL 与 tpms-driver 同源单源，agent-contract 出口）+扩展面校验 validateToolCallsIn；LLM 只能在 patch_design/declare_unreachable 内选，修复应用为确定性代码（main.ts repairExec→mesh 同映射），轮上限 2、patches.periods³ 计入 Per-Prompt 预算。**门禁 E 段**：脚本化 provider 跑真循环三路径（fail→repair→pass 预算精确钉 1032/结构化不可达/越界菜单 periods99 拦截），agent_bridge_audit 16→**23 断言**。验证：build 绿+card_smoke 19/0+fix_check 28/0+docs/platform 重建。**A3 剩余**：pareto 工具（逆设计入口解锁批）+harness.html 双壳（方向 B）+真机联调（Ollama 未装本机，DeepSeek key 待用户）。
> - **A2 落地（同日，NL 助手 LLM 合流上线，九门全绿）**：①新模块四件——`src/core/agent-contract.ts`（TOOLS_SCHEMA/BROWSER_TOOL_NAMES 单源 import `../../agent/`，视口冲突检测）+`src/core/llm-provider-browser.ts`（OpenAI 兼容+Ollama fetch 子集、五类错误分类、首包 15s/总 170s 双层超时、BYO key 只存 sessionStorage/勾选镜像 localStorage 键 `tpms.byo.key`）+`src/core/agent-run.ts`（M3 多轮循环浏览器版：**Per-Prompt Run 预算 Σperiods³+512×verify≤4096 跨轮累计**、maxRounds 4、停止信号）+main.ts 接线（四工具注册表 list/estimate/mesh/design_verify——porosity/periods 面板域钳制披露、out 槽位接 nlPendingExport 文件名、verify 复用 buildVoxelModel+auditManufacturing 结构化诊断）。②浏览器注册面=4 工具（scenario=design 文件槽位浏览器无语义、pareto=逆设计入口阻断中，均留 A3）。③UI：#nl-agent-row（provider 下拉/设置/秒表/停止，无 emoji 工业风）+#nl-cfgrow（端点/模型/Key/记住/保存）；无 key/规则模式走原 parseNL 同步路径（零回归）。④**新门 agent_bridge_audit 16 断言**（同源锁 deepStrictEqual/E5-E11 浏览器复刻/Key 零泄漏结构审计/规则路径钉）入调度——**48→49 门连带 24 处宣称更新**（README 双语徽章+正文、tpms/README、docs 5 份含子目录 interview-pack——非递归 grep 漏网被 docs_consistency 当场抓回）。⑤验证：build 绿+九门全绿（agent_bridge 16/0、nl_agent 48/0、selector 64/0、card_smoke 19/0、fix_check 28/0、guard 2/0、docs 349/0、schema 113/0）+docs/platform 重建+双走查（card_smoke 交互流+像素帧无重叠溢出）。⑥**A3 待办**：pareto 工具+M4 有界菜单驱动器浏览器版+harness.html 双壳（B）+Ollama/DeepSeek 真机联调（需 key/本地服务）。
>
> ---
> ## 以下为 2026-11-07/08 会话历史段（按时间倒序，查阅用）
>

> ## 工位侧 11-08 上午：PWA 应用化+形态闭环+UI 全清单收官

> - **PWA 三件套落地（96f74d2）**：manifest（standalone/主题色/PIL 生成青蓝晶格图标 192/512/maskable）+service worker（/assets/* 内容哈希=cache-first 惰性缓存规避手写清单过期陷阱；html=network-first+离线回退——零后端应用真离线可用）+注册守卫（https/localhost 外静默跳过）。实测：SW registered scope 全站+manifest 200。**手机浏览器访问 Pages→添加到主屏幕即成应用**。门：fix_check 28/28+ui_mobile 4/0+selector 64/0+docs 349/0。
> - **形态拍板闭环**：拓竹 P1S FDM+PLA+0.2 喷嘴→network 终态（杆径进舒适区），打印建议单 0.2 校准（9c47458），首件 print-verify_k3_G60_24mm.stl 已生成（specimens/）。
> - **UI 三批次全清单收官**：批次一+批次二（E5/E11 红队收口+3 步引导+失败建议+重建回执）+批次三（移动端 IA+气泡化+解析 mini 卡）——Gemini §1 清单全项落地。教训两笔：门与 artifact 对应关系（verify=冻结教学版/fix_check=platform）改 onboarding 前必查；git add -A 二犯（禁手升级=status 明细必查）。
> - **CFD 决策矩阵终态**：六路线齐+netgen 进生产；cfMesh 编译中（第七路线=最后候选，完成后自动 anchor 判别）；openfoam-cfd skill 沉淀完毕。
>
> > ## 工位侧 11-08 上午续：近墙第七路线（cfMesh）撞墙——候选收敛到 snappyHex

> - **cfMesh 路线 404**：原 URL creativenvironmentlab/cfMesh 不存在（仓库迁移）；社区版 Codeynamics/cfMesh-Installation-v2406 针对 **ESI v2406** 版本线——对 Foundation v13 兼容性未知，编译地雷区。**WSL 内 git clone 还会挂死（网络，一小时无进展）——外部仓库克隆一律走 Windows git 侧再拷入**。
> - **候选收敛**：snappyHexMesh=v13 原生零安装零兼容风险，升为**首选**（薄壁穿透风险的担忧是 sheet 语境——用户已拍板 network，solid 网络杆件厚，风险显著降低）；cfMesh 降为"若 snappy 失败再验 ESI fork"。
> - **下会话开工批次**：anchor 圆柱 snappyHex 实验（背景 blockMesh+STL surface+snappyHexMeshDict+layers），判据=K 误差 vs hex −1.27% 基线。
>
> > ## 工位侧 11-08 凌晨六/七：netgen 定论+决策矩阵六路线齐（管线决策=netgen 进生产）

> - **netgen 优化器**：K=−8.26%（vs 基线 −13.48%，改善 5.2pp）——近壁质量机制方向再证实但不消除（形状优化治不了格心-壁面距离的结构性）。**管线决策：gen_mesh.py 加 Mesh.Optimize/OptimizeNetgen=1（一行白捡 5.2pp，fa47224）**；K 进 0.5% 阈仍需 Phase 3 的 cfMesh/snappyHex 或量化偏差披露。
> - **决策矩阵终态六路线**：tets −13.48%/snGrad 逐位同/netgen −8.26%/polyDual 崩溃/gmsh 4.15 BL 只支持曲线源（曲面源不存在）/hex −1.27%✓。
>
> > ## 工位侧 11-08 凌晨五：近壁修复路线决策矩阵完成（gmsh BL 曲面源不存在）

> - **最小棱柱实验定论**：本机 gmsh 4.15 的 BoundaryLayer field 只支持曲线源（EdgesList/CurvesList 实测存在），**SurfacesList/FacesList 选项不存在=曲面源 3D BL 不可行**——OCC 路线的 gmsh 原生棱柱层证伪。
> - **四路线决策矩阵终态**：①tets 均匀=−13.5%（加密不消除）②snGrad=逐位同（非旋钮）③polyDual=崩溃④gmsh 3D BL=不支持⑤**hex O-grid=−1.27% ✓（唯一有效，但结构化对 TPMS 曲面壁不通用）**。
> - **TPMS 近壁策略候选收敛**：A) cfMesh（cartesianMesh+BL layers，需装）B) snappyHexMesh（BL 支持但薄壁穿透风险需验）C) 接受量化偏差修正（tet 系统偏差作为标定因子披露——最省但不优雅）。**三候选留 Phase 3 立项拍板**；hex 案例继续作为验证基准。
>
> ## 工位侧 11-08 凌晨四：hex 终审定案——CFD 线闭环（O-grid 78k 误差 −1.27%）

> - **终审数据**：hex O-grid（78k，nRad30/nArc24/nAx60，non-ortho max 39.8）Ubar=0.9866，K=0.9566，**err=−1.27%** vs tet 同量级 −13.5%——同物理/同求解器/同方案，只换近壁结构误差塌缩 10 倍，**tet 近壁梯度高估诊断 100% 实锤，修复路线（结构化/棱柱近壁）验证有效**。Anchor 阶梯完整闭环：隔离→假说→修复验证。
> - **TPMS 实体网格的近壁策略**（下批立项）：gmsh CAD 曲面+BoundaryLayer 棱柱层（OCC 路线，非宿舍证伪的离散 STL 路线），或关键区域 hex/棱柱混合；Anchor-1 的 hex case 已成为可用验证基准（blockMeshDict.hex+createPatchDict.hex+run_hex.sh 入库）。
>
> ## 工位侧 11-08 凌晨三：批次二收尾+E5 预算+git add -A 再犯（CI 守望中）

> - **红队缺口全清零**：E5 联合算力预算落地（validateToolCalls 批次级 Σ periods³≤4096，探针 E5 案转回归断言 17/17+selftest 101/0）；E11 前夜已落地。
> - **UI 批次二落地**：3 步黄金引导（新增 NL 助手发现性步骤+demoType/demoSlice 孤儿清理）+导出失败文案可执行化+NL 重建完成回执。**关键发现：verify 27 项门测的是 docs/app.html（10-02 冻结教学版）而非 platform**——platform 引导改动无门覆盖，缺口登记 bugs.md；verify.mjs 协同改动已回滚（门断言与冻结件一致是对的）。
> - **git add -A 再犯（诚实账）**：hub troubleshooting 已登记过此禁手，仍用它把 wsl 场文件/shots 再度扫入（sim/cfd/.gitignore 子目录相对前缀写错=模式失守的根因）——第二遍 filter-repo 清理（158d8dd 强推，工作仓对齐 count=0）。**禁手升级：提交前 git status 明细必查（登记规则的第二犯=更重的注意义务）**。
> - **hex 判别算例**：blockMesh O-grid 三连修（3D 物理组/arc 中点角 90°+90k/中心块双切向 nArc）后 Mesh OK（non-ortho max 39.8），foamRun 迭代中——tet 近壁高估假说的终审。
>
> ## 🔖 新会话开工指引（2026-11-08 · 全栈绿+历史已重写+CFD 病灶锁定）

> **仓库态**：main=6123e28（重写史+清理登记），**CI 对重写树 completed success**（run 直查实证）——UI 批次一+updateTips 修复+E11 拦截+docs/platform 补交全栈过门。**宿舍机开工：fetch + reset --hard origin/main 即对齐新史**（f8303a4 之后 SHA 全变；bundle 备份 D:\GITHUB	pms-bundle-backup-20261107.bundle 本地勿删）。
>
> ### 三条主线的最新定案
> 1. **CFD（Anchor-1）**：链路全通+四层误差分离终态=**近壁 tet 梯度离散高估 ~18.6%**（剖面 RMS 0.23% 抛物线、snGrad 三方案逐位同=非旋钮、polyDual 崩溃）——修复候选=棱柱近壁层/结构化 hex（网格生成层工作，下一批立项）。
> 2. **agent 红队**：17 案零代码级穿透；E11 已落地（同 out 去重拒绝+探针回归断言 17/17+selftest 101/0）；E5 联合算力预算开放（探针回归位在）。
> 3. **UI**：批次一+updateTips 修复落地；批次二剩余=拦截三段式卡片/重建进度内嵌/3 步引导动线（动 verify.mjs 6 步断言需连门一起改）；批次三=移动端 IA。
>
> ### 铁律新增
> - **构建**：一律 `cd /d/GITHUB/tpms/tpms/tpms-platform && npm run build`（禁止 build|tail 进 && 链——管道吞退出码+cwd 漂移+双事故实证）
> - **历史重写**：仓库冻结（零提交零推送）+fresh-clone+git filter-repo，弃用 filter-branch
> - **wsl**：内联 bash -c 变量赋值会被参数撕裂——一律脚本文件
>
> ## 工位侧 11-08 凌晨二：git 历史清理完成（用户授权，强推 1974710）

> - **清理范围**：wsl_1500_C/U 两场文件从全史移除（filter-repo bundle 副本内重写 9.7s）；旧仓 175MB 松散对象经 reflog expire+gc 清零（终态 pack 67.97MiB/count=0）；**tags 无变化**（v1.2.0 等均在重写点之前）。**bundle 备份：D:\GITHUB	pms-bundle-backup-20261107.bundle（本地勿删，宿舍下次 fetch+reset --hard 对齐新史）**。
> - **过程事故两起（已解）**：①filter-branch 重写期间我并发提交=竞态（723c024 成孤儿）——改 filter-repo fresh-clone 模式绕开；②工作树与 HEAD 脱节——reset 对齐。**教训：历史重写期间仓库冻结（零提交零推送），一律 fresh-clone+filter-repo，弃用 filter-branch。**
> - CI 对 1974710 强推自动重触发（守望中）。
>
> ## 工位侧 11-08 凌晨：snGrad 变体负结果（判别收窄到网格层）

> - **三方案逐位同**（corrected/orthogonal/limited 0.5 全部 Ubar=0.84552759）——近壁 tet 恰好近正交，修正项=0，**snGrad 不是梯度高估的旋钮**；高估=近壁 tet 结构性（格心-壁面距离几何）。polyDualMesh 75 直接 core dump（负结果登记，勿再投料）。
> - **Remedies 收窄**：棱柱近壁层 / 结构化 hex / 壁面函数式梯度校正——都是网格生成层工作（下一批立项）。
>
> ## 工位侧 11-07 深夜七：E11 落地+构建事故修复+变体实验 v2（CI 守望中）

> - **E11 批次写写冲突拦截落地（8d1bddb）**：validateToolCalls 同 out 去重拒绝（保守语义=重复者拒/首个保留）；探针期望值升格为回归断言（E11 拦截/E6b-E13 双口径设计钉）**17/17**+selftest **101/0**。E5 联合算力预算仍开放（探针 E5 案=唯一 out 版保留回归位）。
> - **构建事故（已修复，86e2939 补交）**：6c6da36 的 vite build 在错误 cwd+`build|tail` 管道吞退出码→旧 dist 混入 docs/platform（"1 file changed"=铁证）→CI parity 三平台红。修复链=绝对路径+项目 npm run build+补交重建产物。**新教训：禁止构建管道进 && 链（PIPESTATUS 校验或独立跑）**。
> - **UI 批次一+updateTips 修复全栈在 8d1bddb**（CI 守望中）；变体实验 v2（snGrad ortho/limited 0.5 对照，修掉了 v1 删 0/ 不恢复的缺陷设计）后台跑。
>
> ## 工位侧 11-07 深夜六：Anchor-1 真凶锁定——近壁梯度离散高估（剖面提取定案）

> - **判别结果**：径向速度剖面（writeCellCentres+python join，86 格径向带）**形状 RMS 0.23% 完美抛物线**（a/(2Ū)=0.997）——"profile 压扁"假说证伪；轴心 1.686 vs 理论 2.0=整体缩放因子 0.843。**机制**：全局动量平衡强制离散壁面剪力积分=G·V_fluid（精确），但剖面物理剪力仅 1.073 vs 离散 1.272 → **边界法向梯度被离散高估 ~18.6%=等效附加摩擦**，各向同性加密不消除（曲面壁 tet 边界质量加密不变，err 比 1.144 的解释闭环）。
> - **四层误差分离终态**：源项口径层 ✓（2εG=4νU₀/R 双向一致）/后处理层 ✓/几何层 ✓/**近壁梯度离散层=真凶**。修复候选：棱柱近壁层/polyDualMesh/结构化 hex/snGrad 变体对照（下一批）。
> - **过程教训（wsl.exe+函数对象）**：wsl bash -c 内联变量赋值持续被参数撕裂=一律脚本文件；v13 foamPostProcess -funcs 只解析 ETC 目录（case 级 system/functions 单文件字典也不可达）——后处理采样走 writeCellCentres+python join 绕开整片函数对象沼泽。
>
> ## 工位侧 11-07 深夜五：Anchor-1 双 h 判读=精度不收敛（开放，CFD 线当晚收官）

> - **结果**：K(h0.3)=0.8383（−13.48%）→ K(h0.15)=0.8195（**−15.42%**），误差比 1.144——**单调收敛被证伪，−13.5% 非纯离散误差，存在系统偏差**（两档都收敛到残差地板 5 位数=离散系统的"另一个精确解"）。0.5% 放行阈未达，ε 因子数值判别未达成。
> - **候选嫌疑**（下一批判别）：①线性四面体曲面壁近壁梯度偏置（同壁面剪力积分下 profile 压扁——可提取径向速度剖面验证形状）②snGradSchemes corrected 修正项 ③linearUpwind+steadyState bounded 项 ④polyDualMesh 对照。
> - **判别实验队列**：径向剖面提取（形状判别：抛物 vs 压扁）→ snGrad/低阶方案变体 → polyDualMesh → （必要时）结构化六面体对照。**Anchor 的使命达成：问题在 TPMS 实体之前现形。**
> - **Anchor-1 基建本身定案可用**：网格链/周期对/驱动/后处理全链跑通，问题收敛到"数值方案精度"单层——四层误差分离的第一层（求解+后处理口径层）已由公式对账（2εG=4νU₀/R 双向一致）锁定无恙。
>
> ## 工位侧 11-07 深夜四：红队裁决勘误（a48b2bb，当晚最后一笔）

> - **终版裁决：17 案零代码级穿透**——初判"E13/E6b 真穿透"是**假发现**：探针方 dump 过滤漏看
>   exclusiveMaximum:100+双口径 description（"0~1 小数或 1~99 百分数，>1 自动按百分数解释"），
>   porosity=65 是文档化合法输入；曾当场加 maximum:1.0"修复"=打破合法输入，probe 翻转信号
>   当场暴露，git checkout 撤销。设计级缺口 2 项（E5 联合算力预算/E11 批次写写冲突）登记 bugs.md 待拍板。
> - **方法论（升格纪律候选）**：黑盒探测的"发现"必须先读全契约（含 description 语义字段）再定案；
>   修复后探针期望翻转是双刃剑——翻转=修复生效，也可能=修复打破合法输入，两种都要查。
>
> ## 工位侧 11-07 深夜三：agent 红队 E5~E14 实测（18f0e07）

> - **实测 17 案：3 真穿透 + 14 已防护**（probe_redteam_e5e14.mjs 入库）。**唯一代码级穿透=estimate.porosity 缺 maximum**（E13+E6b 同根因——65=6500% 孔隙率过校验进执行器；修复=加 maximum:1.0，下一批第一优先，改后探针两案应翻转）；**设计级缺口 2**（E5 联合算力预算/E11 批次写写冲突——需批次级上下文，mock 拒绝守卫下实际风险=真实执行面，待用户拍板立项）；E12 的 tpms-driver 槽位修补单调性=执行器面待查。
> - **机制更正两处**：Gemini 预设"静默自钳制"vs 实装拒绝式校验；scenario 无自由文本材料槽位（E9 注入面=契约不可达）。Gemini Top2（严格反序列化基线）已被实装覆盖（additionalProperties+isfinite+严格类型全家在位）。
> - **下一批队列**：①estimate.porosity 上界修复+探针翻转验证+门禁 ②Anchor-1 h0.15 加密轮 ③Anchor-2/3 ④E5/E11 设计决策待拍板。
>
> ## 工位侧 11-07 深夜续：Anchor-1 全链落地（0964ef8，OpenFOAM 线零到一）

> - **环境**：OpenFOAM v13 已在位（WSL /opt/openfoam13 + ~/OpenFOAM/qi-13——"待安装"条目作废，check-before-assume 第三犯）；**下一批=h0.15 加密轮**（约 25 万 tets/40min，目标：ε 因子判别+0.5% 放行阈）；再下一批 Anchor-2（R48 MC-STL 圆柱）/Anchor-3（cyclicAMI 对照）。
> - **Anchor-1 结果（链路级验证 ✓）**：Ubar 收敛平台 0.86455 mm/s（1200 迭代后稳定），K_meas=ν·ε·Ubar/G=0.8383 mm² vs 理论 π³/32=0.9689 → **−13.5%（h=0.3 粗网格 33k tets 离散误差带）**。无因子级/口径级错误（缺 ε 会读 +10%）；**此分辨率下 ε 判别力不足**，量化判据待加密轮。
> - **v13 语法实测定案（回写 plans §7.3）**：meanVelocityForce 不存在（Unknown fvModel）、acceleration=瞬态斜坡型（acceleration.C:80 dU=velocity(t)−velocity(t−dt)，constant=零力）、**正解=semiImplicitSource（volumeMode specific+explicit (G 0 0)+cellZone all）**；fvModel 域选择统一 fvCellZone（selectionMode 已废）；volFieldValue 亦强制 cellZone all；全周期域需 pRefCell/pRefValue；createPatch **同名列=type 不更新陷阱**（"type will remain the same"——必须重命名式）。
> - **量纲教训（登记防再犯）**：域用"米"时 K≈0.969 m²（管半径 π 米），U₀~1e-3 m/s 所需 G=8e-10 m/s² **低于求解器残差地板 4 个量级=源项数值不可见**（表现为流动向零驱动稳态单调衰减）。修法=mm 制（ν=1 mm²/s、G=0.81、U₀~1 mm/s，信号在地板上 6 量级，K 对账数字不变）。**Anchor 类算例的驱动幅度必须放在求解器残差地板之上几个量级。**
> - 入库件：sim/cfd/anchor1/{gen_mesh.py, case/*(9 dicts), run_anchor1.sh, k_check.py}；.msh/run.log gitignore。
>
> ## 工位侧 11-07 深夜：Gemini CFD 路线裁决处置（34b291c）

> - **回执归档+处置表**：collab/gemini/2026-11-07-personal-project-cfd-route-and-governance-reply.md。**Q1 采纳**：个人项目零 institutional 依赖 → **OpenFOAM v13 + gmshToFoam + 端盖平移共形主力**（COMSOL/Fluent 弃用）；一阶网格铁律（C3D10 严禁直转/snappyHexMesh 禁）；K 提取 meanVelocityForce 定 Ubar 反读 pressure gradient；**口径注记登记**：Ubar=全域平均（表面流速）→ K=ν·Ubar/G，回执公式含 ε_eff 隐含孔隙内流速口径，两者不可混用——Anchor-1 已知 K 反推钉死；启动序=Anchor 1-3 阶梯（直管 Poiseuille 解析锚四层误差分离）。**抽验**：v13 模块化语法（foamRun+incompressibleFluid/momentumTransport laminar/nu 运动学）rag-kb 逐条确认 ✓；meanVelocityForce/fvModels KB 未直接命中 → Anchor-1 动手验证。
> - **Q2 执行完毕**：卡片 #3~#18 批量结案 10 张（单行模板注记 `[CLOSED | 个人业余项目-无需导师介入]`，resolved_by=zlx）；hub 三条改造建议（scope 标签/熔断计数只算未闭环/卡 TTL 72h）已提 report_mcp_feedback（id=ab15f4f7，feedback-hub open）。
> - **项目性质记忆入库**：tpms=用户个人业余项目，决策用户唯一拍板；资源问题先给无依赖路径；openclaw 记账照常。后续不再把导师面向动作路由进本项目的行动清单。
> - **下一步（待用户有空）**：Phase 3 启动序第一批=工位机装 OpenFOAM v13 + Anchor-1 直管 Poiseuille case 骨架（几小时级批次，可自主推进，下次会话可开工）。
>
> ## 工位侧 11-07 晚：四问处置收尾+跨机复现验证（4e23fe8 已收入 d93f72a）

> - **4e23fe8 收尾**：Q1 处置表承诺的"Phase 3 方案更新"grep 实证未写入 → plans/2026-10-28 §7.3 补拆分单算+K 双口径+周期对三路径（COMSOL 非共形原生首选/Fluent 路径 A/端盖平移复制路径 B）；fea-calibration.md 两处"sheet 未实现"过时表述同步（生成端已落地、标定线仍 network-only）。
> - **跨机复现验证（d93f72a p3 终态，工位机独立重跑三案）**：sheet k2 R24 s35 dev=0.37pp **逐位匹配**宿舍登记值；network k1 R48 p60 dev=0.01pp **逐位匹配**（宿舍 Q4 验证案口径=k1 R48 实证）；network k2 R24 =0.46pp/剔 1 碎片/L 侧+1 三角（与五轮实验 2687/2688 模式一致）。三案全绿=**f 钳位代码路径跨机确定性成立**。
> - **新数据点（PBC 主力档建议）**：network k1 R24 dev=1.23pp vs k1 R48 dev=0.01pp——k1 单胞对 MC 离散更敏感（周期数少难平均），**Phase 3 k1 口径建议直接 R48**（同理 p0 固相生成端 k1 档也建议 R48 核对）。p3 的"周期自检"三角计数差是信息性非 gate（docstring 明示配对属网格器职责），k1 计数差大=单胞暴露区占比高的邻格效应，非 f 钳位失效。
> - **环境核验**：工位机 trimesh 4.12.2/meshio 5.3.5/gmsh 4.15.2+pymeshfix 在位；mmgs 无 CLI（Q3 mmgs 路线宿舍侧持有，A5 YAGNI 下非阻塞）。
> - **缺省命名纪律补全（82d1aa8）**：p0 修后的同族漏网清掉——p3 双分支补 `_R{n}`（今日复现验证时实锤过一次覆盖）、p2 缺省名嵌入 feats 模式串（sheet 标定批 LE+EXPL 同网格并存将踩中的预定事故，提前拆除）；p1 --lmax 豁免（no-op 旋钮不塑形产物，A5 基线派生命名不破坏）。验证四产物共存+几何统计与档案逐位一致。
> - **p0 固相侧 k1 R48 核对（用户侧挂账外微任务）**：k1 R24 dev=0.57pp → k1 R48 dev=0.21pp——方向与流体侧一致；互补性差定案：同参数 p0 固相（MC 网格=[0,2πk] 精确盒）+p3 流体（盒外扩 margin 2 格）两侧不同网格剖同一等值面，0.22pp 和差=离散化口径差非缺陷，力学用 p0 口径、CFD 用 p3 口径各自自洽。
> - **verify 伏击网盲区补全（1f04b83）**：新共享探针模块 `tpms/.verify/ui_diag.mjs`（五探针忠实移植 meshcont 实战版+失败路径 8s 自限防挂死），verify.mjs 五处 `#ob-next` 入口点击 clickDiag 包装（失败即落证再重抛）；顺带发现原版 heap 探针缺陷（Memory.getDOMCounters 无 jsHeapSize 恒 NaN）新模块已改 Performance.getMetrics 修正，meshcont 实战件不动。本地 27/27 无回归。CI 三平台绿（run 42364236614，ubuntu 昨日挂死平台上实证 verify 通过）。
> - **k1/k2 dev 机制问题保持开放（scratch 废弃教训）**：同 R 档 k1 dev=1.23pp vs k2 0.46pp 的机制未定案——scratch 复刻 p3 时 box_sdf/网格为猜测实现，faces 数对拍（6408 vs 真实 8620）当场证伪复刻忠实性，全部数字废弃不作结论。**教训：复刻管线做实验前先逐行对拍源码（与移植探针同款教训同日两犯），faces/节点数是廉价的忠实性对拍锚**。k1→R48 建议不受影响（依据=真实管线实测 0.01pp）。正确做法=直接 import p3.generate_fluid 分步插桩，非复刻。
> - **p3 --maze 单迷宫拆分导出（c5424e3，Q1 拆分单算裁决几何端补全）**：sheet 双迷宫按界面顶点 f 场中位数符号物理判别 G+/G-（边界=等值面 |f|=t，G± 侧 f≈±t），实测 k2 R24 s35：G± f_med=±0.5356（≈±t）、双迷宫体积比 0.9999、单迷宫 comp=1 watertight、周期自检 1376/1376 完全相等（周期对应性最强的单迷宫证据）。dev 口径修正单迷宫参考值。license 无关，Phase 3 求解端就绪件+1。
>
> ## 周期面对应性五轮实验（2026-11-07 晚 · 回答工位自查题 + Gemini Q1 容差裁决修正）

> - **五轮实验链**（f 钳位 → sdf 对称赋值 → g 钳位 → inset×2 → 分阶段计数）全部实测，三个修复假设被证伪（sdf 破缺源/g 钳位破坏盒封闭/inset 放大破缺 1e12 倍），机制终案：
>   1. **f 三向钳位保留**（周期场数学严格化，MC 原始输出的 ±20 差降到 process 后 0）；
>   2. **盒角碎片根因定案**（实验 v5 分阶段计数：process 后两侧本已 2688/2688 逐位对应，-1 差全部来自盒角 (0,0,0) 的 4 三角碎片——`max(f-c, sdf)` 组合把贴壁孔隙格点（f<c、sdf=0）的 g 压成精确 0 → 退化临界剥落）；**碎片已由 keep_dominant_components 滤除，危害清零**；
>   3. **残余非对称**：主域周期面 2687 vs 2688（x=L 侧暴露区多 1 三角，面积差 0.034mm²=0.04%）、L→0 点到面 3 点缺口 max 2.34mm——**工程结论：全局量（K/WSS 直方图）影响 <<0.1% 可安全计算；缺口点局部映射会落空**。
> - **对工位自查题的最终回答**：Gemini 的"5~10% 边长容差"**不能当默认值**——实测缺口 2.34mm ≫ 容差 0.03mm，它豁免的是"两侧独立三角化的离散化间隙"而非 Gemini 假设的"pymeshfix 偏移"（后者被实验证伪：pymeshfix 多数算例不触发）。落地序：①Hausdorff 测对应等级（本实验方法已入库）；②缺口面积占比 <0.1% → 全局量安全；③要 100% 共形走路径 B（端盖平移复制）。
> - inset×2 与 sdf 对称赋值的证伪细节进 p3 源码注释；临时实验脚本已清（实验方法=分阶段计数+精确平面过滤+点到面 Hausdorff，复现路径在案）。

> ## Gemini 四问回执处置（2026-11-07 · 用户代贴，宿舍侧 ZCode 核实落地）

> - **回执归档**：collab/gemini/2026-11-07-dorm-side-consult-reply.md（原文+处置表）。
> - **Q1 采纳（拆分单算）**：双迷宫合算=双压力零空间奇异性风险+对称冗余；K 双口径（K_eff=2×K_single 文献主口径/K_single 单腔保底）进 Phase 3 CSV 契约；COMSOL 非共形周期对原生支持（General Extrusion+容差 5~10% 调优）=首选，Fluent 走 solver 侧 make-periodic GGI（路径 A）/Python 端盖平移复制强制共形（路径 B 记录）。
> - **Q2 采纳（判据级）**：形态拍板判据=打印工艺——金属 LPBF+防应力屏蔽→**network**（壁厚充裕/孔隙单连通）；DLP 陶瓷/树脂+增韧→**sheet**（L 放大 1.5× 补偿孔径）。指数口径调和：理论拉伸 1.2~1.8 / 实测退化 1.6~2.3（与 fea-calibration"文献带 2.0~2.3"系实测口径，勿与理论值混用）。**文献抽验 2/2 通过**（Kapfer 2011 Biomaterials 32:6875 DOI 10.1016/j.biomaterials.2011.05.017 ✓；Bobbert 2017 Acta Biomater 53:572 ✓）——Gemini 本轮引用可信。
> - **Q3 工具在位+首测未达标**：pymmg 装上但 Python 绑定坏，**mmgs 5.7 CLI 可用**；R48 STL（35.9 万面）首测（hausd 0.005/hmax 0.3）：面数 46.6 万不降反升+水密破坏——归一化/曲率驱动参数交互待调参研究（非阻塞：R24 验证档是生产口径）；480× 暴涨的机制解释（薄壁内部无纵深，跨壁拉尺寸场=slivers）比此前表述更精确，采纳。调参方向：hausd 放宽/-nreg 归一化控制/显式尺寸场 .sol。
> - **Q4 已落地验证**：p0/p3 清洗段尾部加 `keep_dominant_components`（network keep=1/sheet 孔隙 keep=2）——实测 p3 network 碎片剔除 comp=1 干净（dev 0.01pp 保持）、sheet 双迷宫 50/50 保留、p0 双模式逐位回归。**碎片根治完成**。
> - 仓库迁移后新路径：**D:\TPMS Workflow\tpms-explorer**（用户 11-07 挪入 Antigravity 工作区目录）。

> ## 物理误读重大更正（2026-11-07 续 · 对抗审查精神延续）

> - **"network gyroid 孔隙域双迷宫"撤回**：trimesh 磁盘级域分解实测——network 孔隙域 = **单连通主域（56,236 面）+ 4 三角 pymeshfix 孤立碎片**，此前 comp=2 的"双迷宫"是把碎片误读为第二迷宫。**物理纠正：network 单侧切割（f<c）孔隙相单连通**（c≠0 仍逾渗）；**真双迷宫=sheet 型独有**（|f|≤t 中面分界两侧），且实测 **50.0%/50.0% 精确对称**（对称提取的几何正确性强证据）。
> - **对骨支架的含义反转**：network 型孔隙单连通=营养液可达全部孔隙（**利好骨支架**，此前"双迷宫利好"说法一并撤回）；sheet 双迷宫=两条独立通道（换热器分流体用途）。拓扑对照表：network 固相✓单连通/孔隙✓单连通；sheet 固相✓单连通片/孔隙✓双迷宫。
> - **p1 多域划网管线落地**：单 volume 假设对双域 STL 必崩（HXT 拒收实测）→ **trimesh 分域→逐域单域划网→meshio 重编号拼接 INP**（Gmsh 端多 volume 路线证伪：STL 顶点合并行为不可控，实测聚出 4 片碎片+两迷宫混杂）。实测 k2 p65 孔隙域：323,570+1 tets 全 PASS（含碎片域 1 单元——已加体积占比 <1% 碎片告警）。**Phase 3 CFD 线前置缺口（流体域体网格）宿舍端补齐。**
> - 教训：连通域计数必须"merge_vertices→split→按体积分布判读"，comp 数≠物理迷宫数（碎片混入）。

> ## 遗留问题解决方案定稿（2026-11-07 · 对抗审查后续）

> - **方案文档入库**：`plans/2026-11-07_sheet管线遗留问题解决方案.md`——问题 A（sheet 网格成本）五条候选路线全部实测/实验定案：**A1 decimation 证伪**（fast_simplification 实测：水密破坏+体积塌 88.5%）、A2 重参数化死路维持、A3 体素法口径代价、A4 粗化证伪（<0.05 暴涨 480×）、**A5 现状采用**。决策=A5（YAGNI）+ 触发条件驱动的 B 案（体素路线，1 批次工作量）。
> - 问题 B（sheet Explicit 兼容性）/C（sheet 力学标定路线）/D（工作台 sheet 选项）处置路径全部写明，依赖关系=老挂账③拍板链式启动，管线零补开发。
> - 附带动作：fast-simplification 已装（宿舍机 Python 环境），decimation 证伪实验留痕可复现。

> ## 对抗式审查（2026-11-07 宿舍侧自查 · 抓到自己三个错误归因 + 一次数据污染）

> - **数据污染事故（已修正）**：p0 缺省文件名不含 R → R48 缺省输出**静默覆盖** R24 同名文件 → 昨日"R24 薄壁划网"实为 **R48 STL（35.9 万面）** 划网——progress 三个结论全部错误归因并反转：
>   1. ~~"sheet 网格成本 7.5×"~~ → **真 R24：197,999 C3D10（network 21.2 万同量级）**，面→体比 2.4×（8.2万→19.8万）与 network 4.1× 同级；
>   2. ~~"薄壁质量劣化（min 0.0097/6929 个<0.05）"~~ → **真 R24：minSICN 0.046 / <0.05 仅 8 个**，与 network（0.057/0 个）同量级——薄壁自适应代价论撤回；
>   3. ~~"lmax 死参数根因=薄壁需细网格"~~ → 现象仍在（R24 STL 下 0.5/0.8 逐位同 197,999）但根因未定位——机制待实验（MeshSizeMax 在 discrete 路线为何管不住内部尺寸）。
> - **修复**：p0 缺省名加 `_R{n}`（network+sheet 双模式，旧命令 --out 显式不受影响）；`--por` help 注明 sheet 模式忽略；旧无 R 文件清理；修复过程引入的 --por/--out 丢失被回归测试当场抓回（对抗审查自身也被审查）。
> - **排除项**：fea-calibration 复现命令与 p2 CLI 逐参一致（--explicit/--mass-dt/--plastic/--contact/--friction 全在位）；**跨机确定性复现实证**——宿舍机 diamond p60 dev=0.89pp 与工位档案逐位一致。
> - **教训（升格为纪律候选）**：产物缺省命名必须含全部自由参数（k/R/por/solid），否则实验输入被静默替换——T1 的"统计域=几何域"教训的文件系统版。

> ## 宿舍侧 11-07 续：sheet 全链路打通（p3 双迷宫实测 + p1 薄壁划网 + p2 装配）

> - **p3 扩 sheet 孔隙域**（--structure sheet）：~~双迷宫 comp=2 实测确认~~ **【更正 2026-11-07 续：network 侧 comp=2 系 pymeshfix 孤立碎片误读（主域+4 三角碎片），真双迷宫=sheet 侧 50.0%/50.0% 精确对称两域（见顶部物理更正段）；"四种组合拓扑"表述作废，正确拓扑对照见顶部】**体积对账 dev 0.37pp@k2 仍有效。
> - **p1 sheet 划网实测（薄壁压力测试）**：~~R24 s35（8.2 万面 STL）→ 159.6 万 C3D10/247 万节点~~ **【更正 2026-11-07 对抗审查：此行是 R48 STL（35.9 万面）污染数据——R48 缺省输出静默覆盖 R24 同名文件】**真 R24：197,999 C3D10/33.2s，minSICN 0.046、<0.05 仅 8 个，与 network 同量级（详见顶部对抗审查段）
> - **⚠ 新发现（重要）：lmax 死参数根因**——`--lmax 0.5/0.8` 产出逐位相同网格：discrete 路线下 **STL 面网格密度直接冻结体网格规模**（MC 面网格比 lmax 细时内部单元被迫跟随加密）。sheet 网格成本根因=MC 面密度非 lmax；**优化方向（后续批次）：MC 后 STL decimation 或 Gmsh 重新参数化路线**（network 也受益）。
> - **p2 装配 OK**（工位侧 LE/EXPL 双模式版兼容 sheet）：bot=10583/top=10596（片顶底截面差异，正常）、ESOLID/NSET/位移字段全在。
> - **状态：sheet 两条管线（力学+流体几何端）宿舍端全部就绪**——单元形态拍板后可立即展开，无需任何补开发。

> ## 宿舍侧 11-07：p0 sheet 模式落地（八坑 #1/#2 正主，测试矩阵全绿）

> - **p0_generate.py 新增 `--structure sheet --solid X`**：绕中面区间提取 `|f|≤t`（八坑 #1 正解：禁中面 offset，鞍点自交根源杜绝）；壁厚由目标固相率二分 t（八坑 #2 纪律：相对密度标定，非名义壁厚——|∇f| 空间变化壁厚天然不均）。network 路径零改动（向后兼容，老命令逐位复现）。
> - **测试矩阵 4/4 全绿**：gyroid sheet k2R24 s35（82,038 面/水密/单域/dev 0.49pp）、薄壁 R32 s25（155,912 面/dev 0.20pp——薄壁自触担忧未触发，t≈0.39 场单位≈1.5 格距 MC 可解析）、R48 s35（dev 0.05pp 分辨率收敛确认）、diamond sheet R24 s35（dev 0.59pp）。
> - **同固相率对照（k2 s35 vs network p65）**：sheet 82,038 面 ≈ network 48,362 面的 1.7×（片双面等值面，几何复杂度高——网格成本提示）；两者固相均单连通（comp=1）。**sheet 孔隙域双迷宫（G+/G- 互不相通）待 p3 扩展实测**（后续）。
> - **意义**：用户"单元形态拍板"（老挂账③）的决策助力件就位——network vs sheet 同固相率对照几何已可生成，待用户拍板后力学线对标即可展开。工位侧 fea-calibration 明确标注"sheet 未实现"的缺口由宿舍侧补上。
> - 宿舍开工纪律执行：fetch+验证祖先关系后 fast-forward（老 clone pull 禁令实测安全——旧 HEAD 是远端历史祖先）。

> ## 🔖 新会话开工指引（2026-11-06 ·P0 双修落地 ·p50 类病灶根除 ·CI 守望中）

> **仓库态**：main=**88af41d CI 三平台全绿**（dispatch run 42071416704 实证）+Pages 绿——发版链达标。Q2 通道已结项（十三档，Gemini 休眠）。
>
> **CI 踩坑记录（rerun 15 分钟墙）**：88af41d 首跑 macos 三次（首跑+两次 rerun-failed-jobs）全部在**精确 15 分 01 秒**处 cancelled（ubuntu/windows 全绿、无 FAIL step、超时配置 90/60min 无涉、昨日同配置 edd1ee1 macos 42min 绿）；workflow_dispatch 触发全新 run 后三平台全绿——**定论=rerun attempt 路径/平台侧怪异行为，代码无恙**。铁律：CI 单平台 cancelled 且无 FAIL step 时先 workflow_dispatch 全新 run 再下结论，rerun attempt 的结论不作数。
>
> ### P0 双修落地（2026-11-06，88af41d）
> - **修 1**（stl-exporter.ts）：`buildBinarySTL` 写前坐标按 **1e-5 mm 十进制格量化赋同值再转 float32**（同 double 必得同 float32；CLI mesh 同走此函数=UI+CLI 双链单点根治）；坐标偏移 ≤5e-6 mm。
> - **修 2**（surface-nets.ts）：场填充循环 **eps_snap=1e-6 保号钳位**——抬升 iso=0 邻域插值分母，根除 sin(π)~1e-16 零点振荡致插值点贴格点 δ~1e-15 的上游退化源（solid 判定语义不变）。
> - **验证**：探针 `probe_p0_vertex_merge.mjs`（入库）——diamond p50 k2 R48 实测**修前分裂指纹 7647 → 修后 0**；parity 337/0、mesh_audit 全过、48 门全套全绿、docs/platform 重建。
> - ASCII STL（buildMultiSolidSTL）天然免疫（toFixed(6) 文本格隐式 1e-6 聚类，Gmsh 按 double 读）——无需改。
>
> ### 老挂账（按价值排序）
> 1. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板；
> 2. （已销账）P0 双修 ✓ 2026-11-06；**LLM 回归 43 条** ✓ 2026-11-06（三轮画像 42/43×2 flash+41/43 满血，E2 超时族定性=thinking 长尾×170s 冲突非拦截器缺陷，`docs/LLM_REGRESSION_LIVE.md` 2026-11-06 节；key 已 hub 留痕，anthropic 通道三件套）。

> **仓库态**：main=**edd1ee1 已推送**（ρ̄=0.3 判别收官，docs-only CI 按设计跳过/Pages 绿）。Q2 提交链：8d20186 落地 → ab14d77 裁定处置 → d45d15d 终审 → 1891b26 R-1 负结果 → 2271e4e 十一档+边界定理 → 3cc99c0 项 d 迁移（CI 双绿）→ 8763e12 交接 → edd1ee1 密度判别封档。
>
> ### 密度均匀性判别收官（2026-11-06，第十二档 `collab/gemini/2026-11-06-d-band-final-seal.md`）
> - **判据分支 2 触发**：R24 p70 探针 E\* η=0.8542/Rp0.2 η=0.7964（<0.90）——ρ̄=0.4 的 0.99 含剥蚀×自锁抵消成分，薄壁端阶梯剥蚀主导（prune 剔 60 岛+18 悬臂 vs p60 的 1 悬臂）。
> - **两点传递修正因子入 fea-calibration.md**：η_E\*=0.9923·(ρ̄/0.4)^0.5206、η_Rp0.2=0.9976·(ρ̄/0.4)^0.7833（R24 标定读数=DT 裸值/η；0.4 以上免修正）；ρ̄=0.5 免测。
> - **附加披露**：p70 薄壁端可解窗收窄（0-3.5% 深塑性长尾 >70min；0-2.5% 提取窗 222s 全收敛）——薄壁端标定读数窗 ≤2.5%。
> - **Q2 全案终结**：五项 a-e 100% 闭环+三连负结果定理化+密度判别封档；R-2 Backlog。
>
> ### 老挂账（按价值排序）
> 1. **p0 双修**（管线轮）：STL 写前顶点预合并+eps_snap 场钳位；
> 2. **LLM 回归 43 条**：需 TPMS_LLM_KEY 三 env；
> 3. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板。
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git fetch origin && git reset --hard origin/main`（未推送提交先 bundle 离线备份——**禁止 push backup-\* 分支**）；hub=导师部署仅工位接入；大文件走文件中心。
>
> ### 铁律速查
> - **平台 src 变更必须同提交重建 docs/platform**（run_ci_suite drift 硬门，流程：`npx vite build && rm -rf docs/platform && cp -r dist docs/platform && find docs/platform -name '*.map' -delete`）
> - 构建规范 cwd（license-headers 按 cwd 解析）；发版链=本地 48 门→推→CI+Pages 同 HEAD 双绿
> - **python 写文件防截断**：`open('w')` 先截断后抛错=清空——长内容用 Write 工具
> - **Gemini 通道**（唯一外部评审，Codex 已停用）：无仓库上下文，出题自包含；collab/gemini/ 归档；分歧 ZCode 交叉实证
> - **node stdout 管道全缓冲**：探针输出 `| tail` 会憋到最后——看中间态用输出文件 Read
> - **audit/探针几何口径先核对 k 数**（k1/k2 不同几何，双比不可跨口径比）
> - abaqus 命令在 `D:/SIMULIA/Commands/abaqus.bat`；git grep 正则通配误报甄别用 -F；bash 绝对路径；改源码 Write/Edit；GBK 乱码≠损坏

> **仓库态**：main=本轮提交（见下）。8d20186（落地）/ab14d77（裁定处置）/d45d15d（终审归档）已 CI 绿。
>
> ### 11-05 深夜增量（R-1 立项执行，第十档 `collab/gemini/2026-11-05-r1-anderson-negative-result.md`）
> - **R-1 AA(m=4) 三护栏实现三版演进**：v1 γ 差分形式（Gemini 规范公式）sanity 只到 59% 距离→v2 **α 直接形式**（约束最小二乘 Σα=1，sanity 精确 3e-12）+守护升级（绝对阈 1.05→**与线搜索最优竞争**——s1 解剖实证绝对阈会接受打断 Picard 0.05 节奏的坏步）。
> - **负结果四层证据链**：①实现正确（sanity 3e-12）②下界保障（s1=9it 逐位同基线）③护栏非瓶颈（极限参数=永不清窗+早启动，s2 平台段 AA 恒输 Picard 1.5-1.7×、it9-22 稳定差）④精度非瓶颈（紧 PCG 1e-8 无改善）。
> - **机制判读**："ratio 0.71 平台"=非线性流形方向持续旋转（范数线性但方向转），AA 仿射外推前提不成立——与 θ 混合负结果同根（瓶颈=非线性方向演化，非可加速的线性谱半径）。
> - **V 形拉平路线清算**：θ 混合/步加密/AA 三连负；R-2（B_L(F) 装配）最后未试路线，立项预期待 Gemini 裁定（第十档两问：旋转流形修正版 AA 是否存在 / R-2 是否降级为架构投资）。
> - `andersonAccel` 参数默认 false 入库（≈90 行，elastic 零漂移，门 27:57/0+门 28:27/0+docs/platform 重建）；生产口径不变。
> - **方法论**：γ→α 形式教训（差分链索引是错误温床，约束最小二乘直接形式更稳）；探针注入必须 Write 直写（shell 嵌套转义 replace 静默失效——flush 放宽实验首跑无效即此坑）。
>
> ### 待用户
> 第十档回执代贴 Gemini（负结果+两问裁定）。

> **仓库态**：main=今日提交（见下），CI 绿。8d20186=Q2 落地主提交（48 门+CI 三平台绿）、ab14d77=裁定处置轮（θ 参数+双负归档）。
>
> ### 11-05 终审（第九档 `collab/gemini/2026-11-05-final-verdict-q2-sealed-r1-roadmap.md`）
> - **Gemini 终审封存通过**：Q1/Q2/Q3 全部交付物+8d20186 生产基线（elastic+maxIter40+prune）封存。
> - **双负结果机制破译**（与实测逐点吻合）：①步加密反直觉=线性收敛谱半径对步长免疫（k_req=ln tol/ln ρ，Δε 约掉）+中间步提交 εp 剥夺割线弹性缓冲（贴屈服面零缓冲）+maxIter 悬崖折半死循环（每级跑满 40it）——steps32 的 s2=29it 实为"跨步割线红利"（第八档归因修正）；②θ 单调劣化=it1-3 边界脉冲伪屈服（软切线在瞬态屈服点挖刚度坑推 U 入非物理模态）+B₀/B_L(F) 几何失配锁死恢复段 0.77 平台（解释 plas=0 段 elastic matVec 仍停滞的反常）。
> - **下期立项路线图**（P2 双曲平滑弃用——与 θ 同族）：**R-1 首选（外环 Anderson 加速 AA(m=4)/L-BFGS**，纯 elastic 内环不动，~25 行外环向量组合，等价非线性 GMRES，ρ=0.98→超线性 15-25it，自动补偿塑性软化+B_L 几何）；R-2 备选（B_L(F) 装配+延迟切线，大重构不启动）。**待用户拍板启动 R-1。**
>
> ### 老挂账（按价值排序）
> 1. **R-1 立项候选**（Gemini 终审推荐，待拍板）：V 形拉平唯一存活路线；
> 2. **p0 双修**（管线轮）：STL 写前顶点预合并+eps_snap 场钳位；
> 3. **LLM 回归 43 条**：需 TPMS_LLM_KEY 三 env；
> 4. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板。
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git fetch origin && git reset --hard origin/main`（未推送提交先 bundle 离线备份——**禁止 push backup-\* 分支**）；hub=导师部署仅工位接入；大文件走文件中心。
>
> ### 铁律速查
> - **平台 src 变更必须同提交重建 docs/platform**（run_ci_suite drift 硬门，流程：`npx vite build && rm -rf docs/platform && cp -r dist docs/platform && find docs/platform -name '*.map' -delete`）
> - 构建规范 cwd（license-headers 按 cwd 解析）；发版链=本地 48 门→推→CI+Pages 同 HEAD 双绿
> - **python 写文件防截断**：`open('w')` 先截断后抛错=清空——长内容用 Write 工具
> - **Gemini 通道**（唯一外部评审，Codex 已停用）：无仓库上下文，出题自包含；collab/gemini/ 归档；分歧 ZCode 交叉实证
> - **node stdout 管道全缓冲**：探针输出 `| tail` 会憋到最后——看中间态用输出文件 Read
> - abaqus 命令在 `D:/SIMULIA/Commands/abaqus.bat`；.inp 手术=只注释 *ELEMENT 段+MPC PIN 非重合节点对
> - git grep 正则通配误报——甄别用 -F 固定串；bash 一律绝对路径；改源码用 Write/Edit；GBK 乱码≠损坏

> ## 🔖 前会话指引（2026-11-05 早 ·Q2 裁定处置轮 ·已折叠）

> **仓库态**：main=本轮提交链见下，工作树净，CI 绿。上一会话链：9a518a5 口径换代 → … → 15f166c/435a497 六档归档（详见下方历史段）。
>
> ### Q2 落地轮成果全账（2026-11-04 晚，第七档=`collab/gemini/2026-11-04-q2-landing-report.md`）
> 五项四落地+一翻案：
> 1. **a) prune v2 生产化 ✅**——`pruneUnloadedVoxels` 入 gpu-plasticity-solver 导出（6-连通 z 贯通主分量+递归死端 k-core），UI voxelizeCurrentTPMS 替换旧"触任意边界"剪除（孤岛+悬臂分项披露）。
> 2. **b) LM+优雅终止 ✅（改进）**——η=5e-4 锚弹性对角+PCG pᵀq≤1e-14·‖p‖²·‖K‖ 优雅终止；**加塑性段门控**（全程挂载实测弹性段 Newton 9→17it 劣化）。
> 3. **c) consistent 切线数学修复+重启用翻案**——**挖出历史潜伏 bug**：旧秩一 w⊗w/(3μ+H) 与真 Jacbian 偏差 45-70%（剪切通道 3.6×；v6.0 起无门禁覆盖）→ sympy+FD 双向验证修复为 **Simo-Taylor 完整式**（c1=3μdγ/σv_tr 偏斜软化+c2=3μ/(3μ+H)−c1，残差 0.015%）；但 **R12 实测矩阵证明修复后 consistent 仍劣于 elastic**（活动集乒乓：NR 解剖 ratio 停滞 0.77 平台/α 恒 1/冻结护栏救不了）→ **wrapper 定案回退 elastic+maxIter40+prune**（s2/s3=29/39it，较 maxIter25 改善 5-11×，极限 ε=7.5% 复现判读轮基线）；K_geo 解绑/冻结护栏/LM 全保留（elastic 零影响）。
> 4. **d) 半项**——R6 更名 "R6 (1-Voxel Locking Regime / Fast Preview)" 披露入 fea-calibration.md+门 28；R16/R24 参照比迁移**暂停**（依赖 V 形拉平未达成）。
> 5. **e) 门禁锚 ✅**——门 28 接住上轮漏网（9a518a5 plateauStress 接 mappedRho 后 gaPrediction 0.1348→0.1281，断言锚漏改——公式级补锚）；门 27 57/0（elastic/geo 零漂移实证）、门 28 27/0、docs 349/0、docs/platform 重建（drift 门）。
> **验收基线四项对账**：V 形拉平 ✗（开放研究项：屈服面正则化/切线混合/混合控制三候选）；外环 5-12 步 ✗（consistent 负结果）；单档耗时 -60% ✗（口径不适用）；参照比上移 ✗（暂停）。——负结果如实回贴 Gemini（第七档五节含三问裁定请求）。
> **可复用方法论**：Voigt 工程剪切的张量内积陷阱（m₃=2×m₁₂，sympy 推导也踩）；FD 对拍（radialReturn 层 δ=1e-7 中心差分）是切线实现的低成本黄金标准；NR 逐迭代解剖（__plasNrDbg 钩子）定位活动集乒乓。
>
> ### 新会话第一优先：Gemini 第七档三问回执处置（用户代贴）
> 裁定①负结果定案 vs 再试一轮收敛工程；②c1 项对 SPD 安全性结论的影响；③V 形拉平三候选优先级。
>
> ### 老挂账（按价值排序）
> 1. **p0 双修**（管线轮）：STL 写前顶点预合并+eps_snap 场钳位（Gemini 核准）；
> 2. **LLM 回归 43 条**：需 TPMS_LLM_KEY 三 env（用户手动 export）；
> 3. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板。
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git fetch origin && git reset --hard origin/main`（未推送提交先 bundle 离线备份——**禁止 push backup-\* 分支**）；hub=导师部署仅工位接入；大文件走文件中心。
>
> ### 铁律速查
> - **平台 src 变更必须同提交重建 docs/platform**（run_ci_suite drift 硬门，流程：`npx vite build && rm -rf docs/platform && cp -r dist docs/platform && find docs/platform -name '*.map' -delete`）
> - 构建规范 cwd（license-headers 按 cwd 解析）；发版链=本地 48 门→推→CI+Pages 同 HEAD 双绿
> - **python 写文件防截断**：`open('w')` 先截断后抛错=清空——长内容用 Write 工具
> - **Gemini 通道**（唯一外部评审，Codex 已停用）：无仓库上下文，出题自包含；collab/gemini/ 归档；分歧 ZCode 交叉实证
> - **node stdout 管道全缓冲**：探针输出 `| tail` 会憋到最后——看中间态用输出文件 Read
> - abaqus 命令在 `D:/SIMULIA/Commands/abaqus.bat`；.inp 手术=只注释 *ELEMENT 段+MPC PIN 非重合节点对
> - git grep 正则通配误报——甄别用 -F 固定串；bash 一律绝对路径；改源码用 Write/Edit；GBK 乱码≠损坏

---

> ## 🔖 前会话指引（2026-11-04 白天 ·Gemini 六档全链 ·已折叠）


> **仓库态**：main=**15f166c 已推送**，工作树净，CI 三平台绿（ce9fe70 run 41803283157 实证；其后 agent_memory/commits 不触发 CI）。本会话提交链：9a518a5 口径换代 → b8a526f Q2 诊断基建 → ca61a80 parity 修复+drift 硬门 → ea41e2f 交接(事故) → ce9fe70 progress 恢复 → 6689dda Q2 判读处置 → bfb568e/55bba4e/15f166c 五~六轮归档。
>
> ### 本会话成果全账（2026-11-04，Gemini 通道首日六轮）
> **三问从出题到定稿一天闭环**（全部归档 `collab/gemini/` 六档）：
> 1. **Q1 网格退化 ✅闭环+落地**——p50 病灶定案（float32 STL 量化 ULP=2^-20≈9.5e-7>Gmsh Tolerance 1e-8 拒合并；双节点对 206/23775 与 1944/26905 坐标互为三轴循环置换）；修复对照实验 |ΔE*|=0.0006%（判据 17 倍余量）→ **p50=373.20 MPa 正式入库**；基线复现档案 0.03%（冻结 STL 确定性重建，病灶值逐位复现）。
> 2. **Q2 体素 FEM 早夭 ✅机制 100% 闭环**——机构铰假说核准（棱邻接=圆柱铰 N_mech=1/角邻接=球铰 N_mech=3）；负 pAp 悖论破译（Fredholm 择一性崩溃：非线性残差 r_null≠0 → PCG 零空间死循环 → 浮点相消）——**预言双验证全中**（‖p‖=9.6e13>1e10 ✓/归一化 Rayleigh=−3.8e-19 机器零 ✓）；崩溃应变四点非单调 V 形（R6→40%/R12→1.25%/R16→5.0%/R24→4-5%）；修复①探针级见效（6-连通主干+递归 k-core：R12 从 1.25%→7.5%，SPD-break 清零，‖p‖² 从 1e34→1.5e2）；**R6 重定性=伪块体解**（欠采样+自锁+33% 边界夹持，仅作冒烟基线）。
> 3. **Q3 口径统计 ✅闭环+上线**——双族实测口径+幂律映射（γ 链式法则：diamond 1.0624 复现差 0.1%）；统计规范（无信息先验 CI95=±0.081）+network Maxwell 机制段入 fea-calibration.md。
> **副产品**：CI billing 事件解决（转公开，Actions 永久免费+Pages 重启用）；parity 坑第二次→drift 硬门上线；PG v2 脚本增量吸收（输出分辨率/能量全家桶/Restart/塑性表披露——datacheck 实证修正 HISTORY 语法/DMASS 兼容）；R12 诊断探针+预言验证探针入库（probe_dt_q2_diag.mjs 含 --prune v2）。
>
> ### 新会话第一优先：Q2 平台级落地轮（纯工程，方案六轮定稿无开放问题）
> 改动五项（终版清单+护栏在 `collab/gemini/2026-11-04-q2-consistent-tangent-reenable.md`）：
> a) **6-连通主干滤波+递归 k-core 剥离入体素化生产入口**（探针 prune v2 移植——`tpms/.verify/probe_dt_q2_diag.mjs` 的 --prune 分支即参考实现）；
> b) **LM 对角阻尼+零空间优雅终止**：阻尼锚定**弹性对角线** diag(K_e)（非当前塑性对角——完全屈服体素局部刚度≈0 须弹性托底），η=5e-4；PCG 内 pᵀq≤1e-14·‖p‖²‖K‖ 即优雅终止返回值域步；
> c) **consistent 切线重启用替代 elastic+maxIter 硬扛**（算力陷阱：谱半径 0.98→570 外环步 vs consistent 5-12 步）——**第一刀=解绑 K_geo**：matVecFree 的 geo 项条件现为 `tangentMode !== 'elastic'`（consistent 误绑 K_geo，历史"失 SPD"真因），改为仅 'geo' 模式保留；护栏 C=第 8 步切线冻结/阻尼×5（防活动集乒乓）+maxIter 25 后子步折半；
> d) **DT/FEA 参照比 R6→R16/R24 迁移**+R6 更名 "R6 (1-Voxel Locking Regime / Fast Preview)" 披露；
> e) audit 门禁锚（digital_twin_compression_audit 等对 R6 语义的断言）+本地 48 门+**重建 docs/platform**（drift 硬门会拦）+CI+回贴 Gemini 验收。
> **验收基线四项**（Gemini 终审定）：V 形拉平（R12/R16/R24 到 40% 收敛）/外环 5-12 步/单档耗时 -60%/参照比上移。
> 探针入口：`node tpms/.verify/probe_dt_q2_diag.mjs 12 0.6 [--prune]`（R12 快速台，50s 级）。
>
> ### 老挂账（按价值排序）
> 1. **p0 双修**（管线轮）：STL 写前顶点预合并+eps_snap 场钳位（Gemini 核准——根除 p50 类病灶再发生）；
> 2. **LLM 回归 43 条**：需 TPMS_LLM_KEY 三 env（用户手动 export）；
> 3. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板。
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git fetch origin && git reset --hard origin/main`（未推送提交先 bundle 离线备份——**禁止 push backup-\* 分支**）；hub=导师部署仅工位接入；大文件走文件中心。
>
> ### 铁律速查
> - **平台 src 变更必须同提交重建 docs/platform**（**run_ci_suite drift 硬门**在本地拦截，ca61a80 起——已两次踩坑 eb56456/b8a526f）
> - 构建规范 cwd（license-headers 按 cwd 解析）；发版链=本地 48 门→推→CI+Pages 同 HEAD 双绿
> - **python 写文件防截断**：`open('w')` 先截断后抛错=清空（11-04 progress 事故）——长内容用 Write 工具
> - **Gemini 通道**（唯一外部评审，Codex 已停用）：无仓库上下文，出题自包含；collab/gemini/ 归档；分歧 ZCode 交叉实证
> - abaqus 命令在 `D:/SIMULIA/Commands/abaqus.bat`；.inp 手术=只注释 *ELEMENT 段（节点/单元编号撞号陷阱）+MPC PIN 非重合节点对（datacheck 实证）
> - git grep 正则通配误报（171.4 的 `.` 匹配任意字符）——甄别用 -F 固定串
> - bash 一律绝对路径；改源码用 Write/Edit；`| tail` 吃退出码；查 CI 匿名 API（public）；GBK 乱码≠损坏
>
> ---
>
> ## 详细历史
>
> - 2026-11-02 及更早：git log 与 agent_memory/archive/progress_2026-10.md（整理轮/二次清洗/转公开/发版链闭环）
