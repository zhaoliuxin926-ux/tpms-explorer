# progress — 当前任务进度

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
> 1. **LLM 回归 43 条**：需 TPMS_LLM_KEY 三 env；
> 2. **S1_G60 上机**（卡用户）：CSV 回传即反演+幂律叠图；**CFD license**/单元形态拍板；
> 3. （已完成销账）P0 双修 ✓ 2026-11-06。

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
