# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-05 ·Q2 裁定处置轮收官 ·θ 混合+步加密双负结果 ·V形拉平=架构级边界）

> **仓库态**：main=今日提交（见下），CI 绿。昨日 8d20186=Q2 落地轮主提交（48 门+CI 三平台绿实证）。
>
> ### 11-05 增量（Gemini 第八档裁定处置，`collab/gemini/2026-11-05-gemini-blend-tangent-verdict.md`）
> - **裁定三收**：①负结果定案核准（Watchdog α≡1 空操作判读）；②c₁ 谱证明闭合（λ_ortho=2μσy/σv_tr∈[0.7,1) 恒正、λ_normal=2μH/(3μ+H) 唯一最小，LM 结论 100% 成立）；③路线图 θ 混合首选/双曲平滑次之/混合控制否决。
> - **P1 θ 混合四点扫描失败**（0.4/0.6/0.75/1.0）：单调劣化无甜点（θ=0.4 的 s2 仍差 elastic 12×）——谱半径收益<活动集过冲代价，等比缩放无法分离两者。`tangentBlend` 参数已入库（默认 1 零行为变化）。
> - **步加密假说亦排除**（steps=64）：迭代仍指数攀升且极限反而更早（崩@5% vs 32 步的 7.5%）——深段失败=elastic 谱半径随塑性单调恶化（算力陷阱预言兑现），**架构级边界**。
> - **定性**：V 形拉平在 elastic/consistent 家族全口径不可达；P2 双曲平滑（与 θ 同构预期有限）与 B_L(F) 变形构型装配列为研究级候选，本轮不扩大；生产口径维持 elastic+maxIter40+prune。
> - 门 27:57/0、门 28:27/0、docs/platform 重建 ✓。
> - **待用户**：第八档四节处置回执代贴 Gemini（P1 未兑现+双负结果+B_L 立项候选）。

> ## 🔖 前会话指引（2026-11-04 深夜 ·Q2 落地轮收官 ·已折叠）

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
