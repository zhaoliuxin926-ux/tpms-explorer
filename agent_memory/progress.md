# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-04 深夜 ·口径换代落地+Q2 三层证据+Gemini 通道成熟）

> **仓库态**：main=**ea41e2f 已推送**（9a518a5 口径换代落地 → b8a526f Q2 诊断基建 → ca61a80 parity 修复+drift 硬门 → ea41e2f 交接[含 progress 清空事故，本文件为重写版]）。**事故披露**：ea41e2f 提交时 python heredoc `open('w')` 先截断后抛错（尾逗号 tuple）——progress.md 被清空推送；本文件按终态重写，历史细节见 git（ca61a80 版本可查旧文）与 collab/gemini/ 三档归档。
>
> ### 今日三线（2026-11-04，Gemini 通道首日全链）
> 1. **口径换代落地（9a518a5）**——Gemini 裁定 1 全量执行：C1/指数双族换 STL 实测口径（gyroid 0.9914/2.2028、diamond 0.7871/2.0709）+ `NOMINAL_TO_MEASURED` 入口幂律映射（ρ̂=κ·ρ̄^γ：1.01461/1.02161 与 1.04157/1.06235——MC 弦截断畸变从物理指数分离，γ 链式法则实证）；selftest 双锚 64/0；本地 48 门 exit 0；**依据链**：p50 修复对照 |ΔE*|=0.0006%（判据 17 倍余量）+基线复现 0.03%→Gemini 结项签发（实验③豁免/Clapeyron 等价/float32 ULP 台阶锁定）。
> 2. **Q2 排障三层证据（b8a526f）**——①崩溃应变**非单调**：R6→40%（不崩）/R12→1.25%/R24→4-5%（物理失稳应单调收敛=数值伪影主导）；②onPcgDiag 诊断基建（pApMin/SPD break/detF 对角近似——twin 接口透传）：崩溃时 **detF=0.97 健康 + pAp 负到 −1e16**（CG 发散热，非单元翻转）；③悬臂剔除对照：R12 有 6 个共享面=1 体素（**三轴循环对称组——与 p50 病灶同款模式**），剔除后 1.25→2.5% **不治根**。**新假说=棱/角邻接体素对机构铰**（共享 2 节点无转动约束→近奇异→Jacobi-PCG 条件数爆炸）；**判读包已交用户代贴 Gemini**（四问：机构铰刻画/修复排序/纯 Ke 悖论/R6 语义重定性）。p50 病灶机制定案：float32 STL 量化（ULP=2^-20≈9.5e-7>Gmsh Tolerance 1e-8 拒合并）+循环置换对称双节点对（单元 36886/71236）。
> 3. **parity 同款坑第二次→结构性防线（ca61a80）**——b8a526f 改平台源码漏重建 docs/platform（CI parity 三平台齐红，eb56456 首次同款）；**run_ci_suite drift 守卫升级硬门**：dist 存在且 hash 不一致直接 exit 1（原只 warn——bugs.md 已知缺口，两次踩坑实证补上）。
>
> ### 新会话第一优先
> 1. **Gemini Q2 判读回复落地**（判读包四问文本在会话/git b8a526f 前后）：机构铰假说判读→修复轮（连通性重标注/LM 阻尼/最小转动刚度三选）；R6 固定算例语义重定性（自锁伪刚度假平台？）影响 DT/FEA 参照比口径；
> 2. **CI 终态确认**（ca61a80/ea41e2f 链；9a518a5 的 run 被 b8a526f concurrency 取消属正常接棒）；
> 3. **R16 判别点**（后台跑中，崩溃点若落 2.5-4% 区间则非单调曲线形状确认）；
> 4. **p0 双修**：STL 写前顶点预合并（float64 域合并→写 float32 必然同坐标，Gmsh 100% 合并）+ eps_snap 场钳位（Gemini 核准方案）。
>
> ### 多设备纪律（machine-facts.md=新设备第一读）
> 开工 `git fetch origin && git reset --hard origin/main`（未推送提交先 bundle 离线备份——**禁止 push backup-\* 分支**，旧历史会成远端可达引用）；hub=导师部署仅工位接入；大文件走文件中心。
>
> ### 铁律速查
> - **平台 src 变更必须同提交重建 docs/platform**（构建→rm docs/platform→cp dist→删 *.map→diff 零差异；**run_ci_suite 已有硬门**，本地跑门禁即拦截——ca61a80 起）
> - 构建必须规范 cwd（`cd <abs>/tpms/tpms-platform && node node_modules/vite/bin/vite.js build`；license-headers 按 cwd 解析）
> - 发版链：本地 48 门→推→CI+Pages 同 HEAD 双绿才算成；中间环境性红由最后 push 的 SUCCESS 超越，绝不 rerun 中间 run
> - **python heredoc 写文件防截断事故**：`open(p,'w')` 先截断、后继计算抛错=文件清空且随提交推送（2026-11-04 progress 事故实录）——长内容用 Write 工具或先构造完整字符串再 open
> - docs_consistency 正向钉=README 双语+gate 三行+PROJECT_INVENTORY 全链同步；计数以实测为准（schema=113）
> - bash 一律绝对路径；改源码用 Write/Edit；`| tail` 吃退出码；查 CI 用匿名 API（public 已恢复）或 git credential token
> - git 显示层 GBK 乱码≠存储损坏（python utf-8 解码判定）
> - **Gemini 通道**（唯一外部评审）：无仓库上下文，出题必须自包含；collab/gemini/ 归档；分歧 ZCode 交叉实证后用户拍板
>
> ---
>
> ## 详细历史
>
> - 2026-11-02 及更早：见 git log 与 agent_memory/archive/progress_2026-10.md（整理轮/二次清洗/转公开/发版链闭环全记录）
