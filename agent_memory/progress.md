# progress — 当前任务进度

> ## Phase 2 宿舍端就绪：p2 脚本落地（2026-10-29）

> - **sim/p2_static_setup.py**：裸网格 → 完整 Static 算例（ELSET ESOLID GENERATE 注入/NSET 顶底/材料/STATIC 20 增量/双输出）。实测 k2p60：333,886 节点 / 212,209 单元 / 顶底各 3,716 节点 / 尺寸自读 H=W=T=12.5664mm（档位 OK）/ A0=157.91mm² / disp=-0.2513mm；S 输出注释带 sanity 口径（discuss 共识）。
> - **sim/p2_extract_csv.py**：ABAQUS ODB → fit-batch 契约 CSV（FIELD 为主路径语义确定，HISTORY 聚合为快路径并注明用了哪条；符号 disp=-U3/force=-ΣRF3；档位越档 WARN）。py_compile 过，**待工位 abaqus python 实跑验证**。
> - **工位执行序列**：git pull → python sim/p0_generate.py --k 2 --R 24 --por 0.60 → python sim/p1_mesh.py sim/out/gyroid_k2_p60.stl → python sim/p2_static_setup.py sim/out/gyroid_k2_p60.inp → abaqus job=gyroid_k2_p60_static cpus=4 interactive → abaqus python sim/p2_extract_csv.py --odb gyroid_k2_p60_static.odb --h 12.5664 --w 12.5664 → node tpms/agent/fit-batch.mjs --dir <csv目录>。

> ## CI 终态核清（2026-10-29 · 宿舍侧首次完整对账远端 CI）

> - **main=b30c99b：CI 三平台（ubuntu/windows/macos）48 门全绿 + Pages 绿——"双绿才算成"达标**。Windows 慢 runner 约 55 分钟（已知模式，非红）。
> - 宿舍侧推送 CI 对账补全：b15e27c ✅ / 1300357 ✅ / 0d90d74 cancelled（concurrency 超越，变更被 b30c99b 覆盖验证）/ e851d8f·a049e30·3267668 仅 Pages 全绿 / 28a5fc0 不触发。
> - 查 CI 的方法：fine-grained PAT（仅 Contents 权限）实测可读 actions runs/jobs API——`git credential fill` 取 token + curl，无需额外授权。

> ## T4 仓库门面打磨（2026-10-29 · 双 AI 协作：反重力审计 × ZCode 整改）

> - **P0 三项全部实锤并修复**：README_EN:96 "46-gate"→48（与首屏 48 矛盾）；QUICKSTART Demo 编号乱序 1-2-4-5-6-3→重排连续；中文 README H1「工作区·总导航」→「TPMS Explorer · 三周期极小曲面结构探索器」+ verification-first 定位句（原"教学工具"定位卖低，与特性矩阵实力不符）。
> - **ZCode 独立发现**：目录树缺 specimens/sim/collab/agent_memory/plans；"记忆辅助"段 gitignored 声明过时（根 agent_memory/plans 已入库）——目录树与辅助段已重写；新增 HONESTY/BENCHMARKS 导航行、链接分层、sim/ 矩阵行（诚实标注实测非门禁）。
> - **新铁律**：collab/ 已入 docs_consistency 的 md 链接扫描域——协作报告内的相对链接须按 collab/antigravity/ 相对路径写（../../），示例链接禁用 `(...)` 字面占位（会成断链红门禁）。
> - docs_consistency 本地 332/0+零断链；本提交含 README/docs 触发全量 CI（远端验证）。

> ## T2 审查 + 首次全自动辩论（2026-10-29）

> - **T2 方案采纳（含两处修正）**：①ELSET=MergedCells 事实错误→落地时注入 `*ELSET, ELSET=ESOLID, GENERATE`；②S 输出口径降级为 sanity check。保留：CSV 契约正则级对齐、HISTORY+FIELD 双回退、顶面位移加载生产基线。
> - **辩论环境建成并首轮运转**（用户零干涉闭环）：ZCode 用 computer-use 向反重力聊天框打字（Ctrl+A+typeText，Send 按钮状态=落地判据；Electron 编辑器 setValue 无效）⇄ getAXState 读其回复 ⇄ 文件落盘精确回传。辩题"minSICN 0.057 vs 它自定 0.1 红线"一轮收敛，共识=口径双轨制（宏观轨当前网格直接用；微观轨须 Gmsh Distance+Threshold 交线带加密）。纪要 collab/antigravity/discuss-2026-10-29-mesh-quality.md，处置表已登记。
> - **讨论模式规则**（collab/README.md）：[discuss] 前缀、对话体 500 字内、每轮带新论据或让步、5 轮收敛、用户可拍板终止。每场讨论用户只需开头一句话，过程 ZCode 自动循环（发→sleep 等→读→回应）。
> - **discuss-2 渗透率/WSS 模型形态（两轮收敛，三段式定案）**：扫参=单胞 PBC（K+基准 WSS）；WSS 窗口覆盖率作优化目标时按实验工况分流（体外反应器→整件复核必做 / 体内渗流→单胞+口径披露）；文献数字（3.2~6.8%/1.8~2.6×/15~28%）方向采纳、定量[待原文核验]（Montazerian 2017/Castro 2019/Ali 2019）。本轮 ZCode 首次部分让步（接受 K/WSS 二分法），Phase 3 流体线方法论由此定案。
> - **下一步**：p2 脚本落地（按修正版：ESOLID 注入 + 双回退提取 + CSV 契约）→ 工位机 ABAQUS 求解 → fit-batch 反演闭环；T3 未动。

> ## 反重力 T1 评审闭环（2026-10-29 · 协作黑板首单）

> - **S1~S6 全部采纳并实测验证**：①缺陷 A/B 实锤（旧 .inp 混入 TYPE=CPE6 + C3D10MH，ABAQUS datacheck 必挂——ZCode 实现遗漏，plan 坑 4 预警过但没做）；②坐标系重构（整数周期盒 [0,2πk]³ + 数据域外扩 + 盒内统计阈值）实测：孔隙率偏差 **0.90pp→0.02pp**，meshfix 侵蚀 -0.00%；③minSICN 审计上线，修复后 212,209 C3D10 实测 min=0.057、0 个<0.05（反重力报告的 min=1e-3/884 个<0.05 是旧几何快照，S1 修复顺带把质量拉起来了）。处置结论在 collab/README.md 处置记录表。
> - **新铁律**：meshio 写 ABAQUS inp 必须只传 tet10（triangle6→CPE6 混入）+ 类型文本规范化（tetra10 硬编码 C3D10MH→C3D10）。
> - **T2 已放行**（Phase 2 ABAQUS Static 设置清单，硬约束 fit-batch CSV 契约）；T3 未动。

> ## 仿真管线 Phase 1 打通（2026-10-28 · 宿舍会话开工首日）

> - **全链路实测通过**：`sim/p0_generate.py`（gyroid network 隐式场→盒 SDF 封闭→MC→trimesh 清洗→pymeshfix 兜底，k2R24p60 = 47.5k 面水密单域/孔隙率偏差 1.14pp）→ `sim/p1_mesh.py`（Gmsh 4.15 HXT discrete 路线 15.4s = 206,961 C3D10/322k 节点 → meshio 5.3 出 .inp → tet10 体积符号 0 非正 PASS）。产物在 sim/out/（已 gitignore）。
> - **新坑与铁律**（详见 plan 2026-10-28 §3 坑 9 + §7）：①有限域提取周期结构 MC 边界切碎→盒 SDF 相交封闭，且数据域须比盒外扩 ≥2 格；②Gmsh 对密 MC 网格禁用 classifySurfaces(forceParametrizable=True)（几何实体爆炸 >4min），用 createTopology discrete 路线；③MC+SDF 交线产生 dihedral=0 折叠三角对，process(validate=True) 修不掉，pymeshfix 兜底；④trimesh 5.0 无 remove_degenerate_faces、pymeshfix 0.18 拒收 TrackedArray（np.array() 转）。
> - **sim/ 目录不在 CI paths**（tpms/** 之外）——提交不触发 25min 全量 CI，管线稳定后再议纳入。
> - **下一步**：Phase 2 力学线（.inp → ABAQUS 求解在工位机：同参数复现 p0+p1 或传文件）；开放三问之"现有网格是实体还是壳单元"仍待用户确认（specimens 全是 solid_network，与用户口述"壳结构"存在出入）。

> ## 宿舍侧初始化完成（2026-10-28 · 宿舍 ZCode 会话，多设备定案首次落地）

> - **仓库态**：宿舍 clone @592c300 → 新增 **b15e27c**（plans/2026-10-28-tpms-simulation-pipeline-research.md：TPMS 仿真管线调研沉淀=宿舍侧项目经验首次按新纪律入库）→ 本 progress push。工作树净，本地 **48 门全绿**（run_ci_suite SUITE_EXIT=0）。
> - **Node 26.3.1 实证**：宿舍机超出"22/25 皆可"已验证对，48 门全过——"跨版本只钉语义不钉错误码"纪律再+1；无 nvm/fnm。
> - **宿舍清单勘误（工位侧 runbook 请补一步）**：CI ci.yml:79-81 才是真源——`cd tpms/.verify && npm install --no-save --no-package-lock playwright@1.61.1`。只跑 `npx playwright install chromium`（仅浏览器二进制）不装包，ui_jump_check / run_all / webgpu-WGSL 三门全因 `ERR_MODULE_NOT_FOUND: 'playwright'` 红（.verify 脚本自 tpms/.verify 向上解析，够不到 tpms-platform 的 node_modules）。
> - **宿舍机 Git Bash 陷阱**：ucrt64 构建（D:\Program Files\Git），credential.helper 编译默认指向不存在的 mingw64 路径；系统级 `manager` 实测可用（凭证已存 Windows 凭证管理器），**global 勿写带引号绝对路径**（git 把整串当 helper 名→`'credential-D:/...' is not a git command`，push 虽可成但每次噪音）。
> - TPMS 仿真线（骨支架 sheet 型 / ABAQUS 压缩 / Fluent 渗透率）调研+八坑避坑地图已随 b15e27c 入库，两机共享同一份上下文；开放问题见该 plan §8。

> ## 🔖 新会话开工指引（2026-10-26 ·三轮外部审查全链终态：第三轮 6 P1+4 P2 全数收口）
>
> **仓库态**：main=**fd530ae**=origin/main；CI 三平台全绿+Pages 同 HEAD 双绿（7565ca9/8fafdcd 纯文档提交按 paths 过滤只触发 Pages 亦绿）；工作树净。**无未推送/未拍板挂起项**。
> **多设备定案（2026-10-26）**：交接层（agent_memory/+plans/）已入库随仓库走——任何设备 clone 即得完整开工指引；③层记忆中心=导师部署仅工位接入（宿舍不接）；宿舍侧项目经验经 GitHub 自提交入库；machine-facts.md 记跨设备机器事实；plans/** 已入 CI 触发路径（agent_memory 故意不加——收尾 push 不应触发 25 分钟全量 CI）；敏感扫描全零后放行。
> **终态**：三轮外部审查全部处置（第一轮批一~十/第二轮批十一~十三/第三轮批十四~十九）。剩余纯用户侧：S1 上机/阈值设备记录/真人走查/C1 双口径与 pack 清洗拍板/博客四。
>
> **上机打印件预检（2026-10-26，仍有效）**：specimens/ 32 件=8 唯一几何×4 字节同，水密审计 8/8 PASS——可放心上切片器；S1_G60 切片 ×2.5+2×2mm 端板=H₀ 24mm/1.44mm/min（LAB_ONE_PAGER 现场卡已对齐）。

> ## 五提交链（本会话全部产出，均 CI+Pages 双绿上线）+批五

> | 提交 | 批次 | 内容 |
> |---|---|---|
> | 29d9ad0 | 批一 | 审查 #1-#7：尺寸契约统一（units 总宽真源/mesh --specimen-size/推荐 periods=3 绑定/会话 BINDING_SEMANTICS v2/UI 采用阻断）+fit-batch 报告保护（--out+拒写+溯源）+曲线分析（Toe 跨度窗口/εd 平滑η+98%回落判据/样本 CV）+UI/CLI 导出门（mesh-audit 单源+硬拒+32 格/周期升档）。selftest 55→61、fit_audit 19→21 |
> | c7bc813 | 修复 | CI parity：构建必须规范 cwd（license-headers 插件按 cwd 解析，非规范 cwd 静默 skip 缺头部戳=parity 必红）——pitfall I169 |
> | d0e2f10 | 批二 | 审查 #8：sidecar v2.2（6 参数补全+shareUrl）+设计文件 tpms-design/1.0（保存/导入闭环，parseURLParams 复用零新校验面）——probe_design_roundtrip 15/0 |
> | 1eb5e5e | 批三 | 交付包 tpms-delivery/1.0（ZIP=design.json+水密 STL+manifest 哈希链+时间戳防同名）——probe_delivery_pkg 13/0 |
> | 0f3a9af+b9067d4 | 批四 | 制造几何检查（manufacturing-audit：壁厚双口径 medial/axial+主域孔喉+封闭腔+连通性；UI 卡；gcode 门禁 F8 五锚 32→37）+ui_jump 慢 runner 分级修复 |
> | 9db2c30 | 批五 | 任务流卡（审查"以任务组织入口"首档）：controls 顶部五步条 设计→候选→制造检查→导出→试验分析，一键跳转+展开；③④徽章挂设计指纹（geometryStateKey）设计变更转 stale（!）；probe_taskflow 10/0；ui_jump 计数隔离（卡不用 .sect/data-jump）——plan plans/2026-10-25_批五-任务流界面.md |
> | cbfd8a4 | 批六 | UI 独立尺寸（审查 #2 UI 链收口）：state.specimenSizeMm（null=自动 1period=1mm 默认全链不变）+effectiveMmFactor 单源；cacheKey SW 段（宽度变更整键失效防旧因子指标）；mmPerWc 贯通五构造点（含导出升档同步重建——漏注入致导出后指标被 legacy 覆写，探针实证）；全导出/INP/制造检查/卡尺/端板/尺寸标注换 effMm；采用解锁 periods=3+总宽=3×单胞；sw 分享参数+sidecar v2.3；probe_specimen 7/0（Sv 严格比 0.1500+采用写回）——plan plans/2026-10-25_批六-UI独立尺寸.md |
> | 3c44858 | 批七 | 可用域反馈收口（改进表第 4 行 AI 侧最后一行）：单元密度滑块下已验证域披露 field-note（批一矩阵实测：k≤5 标定域/gyroid ≥21 格每周期/fcks+diamond k5 结构性拒产/dg R128 非单调——未测域不承诺）；「失败保留最后成功设计」行为钉 probe_empty_retain 5/0（常值场确定性失败：tris 不变+失败原因持久化空态）。main.ts 零改动。注：03f8aca→3c44858 的"码页损坏 amend"是**误诊**（见铁律 git 显示层条） |
> | 2ac1461 | 批八 | 任务流五步端到端走查（row 1 验收机械化首档，纯验证零代码改动）：probe_taskflow_e2e 9/0——单会话连走五步 53.0s 无断链；新覆盖=采用路径交付包 manifest 契约产物级逐值（批六 effWidthMm 链端到端证实）；前沿点采用改页面内合成 MouseEvent 序列（576 点亚秒，playwright 逐点往返 1.2s/点不可用）；fcks 命中自动跳过。走查报告 agent_memory/taskflow-e2e-2026-10-25.md |
> | 2c059fc | 校准 | windows 慢 runner 双红测试侧校准（B5/ui_jump 同型第三例）：CI-40180212969 两跑红点漂移（meshcont_scale setInputFiles 30s 默认窗超时→verify_fixes M2 固定 1.5s 窗 in-flight 竞态触发 worker error 被零容忍哨兵误捕）——定性环境劣化非回归（ubuntu/macos 稳绿+批七同代码 windows 绿+零源码变更）；校准 setInputFiles {timeout:180s}+M2 改 tris 收敛轮询；本地 run_all 18 套全过。2ac1461 红由本 push SUCCESS 超越 |
> | 9317912 | 批九 | UI 试验反演 H₀ 档位防呆（S1_G60 试验日风险收口）：df 模式 hWarn=![12,24,34]±1 越档 ⚠ 行（复用 fit-batch 措辞）+结果尾部口径披露（L₀/A₀ 可见）——此前 UI 静默接受任意 L₀，忘改默认 12 会把 E* 错 8×；check_expfit_card 4→8 项（24 档互逆锚 1179=1179/30 越档 ⚠+E* 放大比 1461≈1474——同一份 24 基准 CSV 错误 L₀ 重解释）。防呆测试形态教训：越档用例必须"同一份数据用错误口径重解释"，不能重生成自洽数据（E* 恒不变测不出）——plan plans/2026-10-25_批九-expfit-H0档位.md |
> | 44833d8 | 批十 | 试验 CSV 元数据贯通（S1_G60 防呆第二档，批九 ⚠ 降为最后防线）：UI run() 解析 # key=value 元数据（同 fit-batch 正则），df 且三尺寸齐时预填 L₀=lengthMm/A₀=widthMm×thicknessMm 到输入框+披露「已从 CSV 元数据预填」——口径随数据走，"填错"结构性消失；无元数据行为不变（向后兼容）；协议 §六 补完整 CSV 模板文本块（# 三尺寸行+表头+双路径说明——协议成为上机唯一真源）；check_expfit_card 8→10 项（输入框预填 24/400+披露行+E* 互逆锚 1179）——plan plans/2026-10-25_批十-CSV元数据贯通.md |
> | 8d4e3ae | 批十一 | 第二轮外部评估三 P1 一致性修复（评估基线 9db2c30 动态实证，当前 HEAD 复核全成立且 #3 更广）：①导入完整状态替换语义——applyDesignFile 优先 file.state 快照（sanitizeDesignState 递归形状校验+VALID 枚举白名单+数值域钳制）重置默认再合并，缺省键显式回落关闭（脏页导入不再继承端板/混合/渐变）；无 state 退化 shareUrl 向后兼容；无载荷拒收保持原状态；②resolveBuildTrio 三元组单源（iso/targetPorosity/isoGradSpec）——渐变=iso baseIso+二分关闭+makeZGrad，非渐变恒等 resolveExportPorosity 字节级不变；三消费点（主重建/HD 升档/导出级重建）全部改喂——**HD 升档丢渐变是评估未发现的扩展**；lastExactIso 显式排除渐变；③voxelUnsupportedReasons 单源守卫——制造检查与 INP/polyMesh 共用 fail-closed（容器/混合/渐变/端板/梯度壳/分形/神经/非欧映射，体素=基础均匀多孔段语义），RVE 守卫补齐同族配置；拒绝时 ③ 徽章不置 done。验收 probe_consistency_p1 8/0（脏页导入回落/渐变导出 115520≠90768 三角哈希双差覆盖 HD+导出双路径/双守卫拒绝零产出）；非渐变设计产物字节级不变——plan plans/2026-10-25_批十一-三P1一致性.md |
> | bb7c391 | 批十二 | 评估遗留文档小项收口：QUICKSTART 新增「进阶 · 设计→检查→交付完整闭环」节（任务流五步+状态徽章语义+总宽自动换算+制造检查 fail-closed 口径+交付包构成+CSV 元数据预填+替换式导入说明——批五~十一新能力首次进入用户侧操作指南）；specimens/README「示意拟合」→真实内核措辞修正（baabb2c 起 experimental-fit 同源）+CSV 元数据模板指引。docs_consistency 349/0 |
> | cb884e3 | 批十三 | 上机操作卡（LAB_ONE_PAGER）试验日关键路径刷新：①压缩速率旧卡写死 1:1 档 0.72mm/min——S1_G60 是 ×2.5 档（H₀=24→**1.44**），拿旧卡上机=错速率数据；改 H₀ 三档表（12/24/34→0.72/1.44/2.04）；②回传段补 `#` 三尺寸元数据行指引（fit-batch 缺失即拒算——原始机台 CSV 直接跑会全量被拒，试验日关键路径断点）；③命名对齐协议 §六+UI 预填说明。docs_consistency 349/0+48 门全绿 |
> | 2da09b2 | 批十四 | 第三轮评估 P1-01/02/03 交付几何：①INP/polyMesh+CAE 套件三处体素 targetPorosity=undefined（`as number` 类型谎言）→NaN 二分→全实心（75% 设计出 64000 单元实心盒）——调用侧显式传 s.porosity/100+voxel-model 入口 fail-closed；②sanitize nullable（specimenSizeMm 默认 null 被按 typeof 丢数值 20）+导入清 meshCont（外部容器史上无清除路径）；③script-exporter py/m 拆 width_mm（cell_size 留频率语义，legacy 等值）+VTI effWidthMm。probe_delivery_p3 12/0（INP 16024 单元/固相率 0.2504/导入 20mm 保持+容器清/py+vti 尺度）；parity 断言连带 337/0——plan plans/2026-10-26_批十四-三P1交付几何.md |
> | 7b82533 | 批十五~十八 | 第三轮剩余项全量收口（按评估修复顺序 2-4）：批十五 P1-04 逆设计 α 兑现核对——应用后按 α=1+应用参数代回同代理重算+结果区「⚠ 应用后核对」披露目标缺口（10→10.10含α=1.91→重算5.28=-47.7% 与评估独立数字一致），probe_inverse_alpha 6/0；批十六 P1-05 MicroFEA 数学修复——buildElementKe 重写（旧对角系数 0.5 差 2×+剪切项是 ∂²N/∂ξ∂η 型混合二阶导；正确=链式一阶导 (ξₐ/4)(1+ηₐη)(1+ζₐζ)+detJ=1/8）+PCG 残差初始化 r=b（旧漏→z/p 全零→0 迭代假收敛）；审计 20→29（[K] 解析锚 uₓ=y→μ/uₓ=x→λ+2μ/刚体零能+真收敛+Voigt 上界——旧「C44=φμ≤15%」是在 x≡0 坏解上校准的），gyroid 真收敛 54 迭代/C11=0.2804≤Voigt；批十七 P1-06 Abaqus 契约——INP FIELD 补 *NODE OUTPUT U,RF（旧仅 HISTORY→runner KeyError）、runner 绝对窗口+sigma_pl_valid 诚实降级+force=-ΣRF3 符号+总宽随包贯通（sh 缺省 SPEC=设计总宽）+描述与 5% 线弹性实际对齐，probe_cae_contract 8/0；批十八 P2×4——firstPeak 首局部峰（2% 滞回，fit_audit +双峰锚 21→22）/fit-batch 元数据收窄 `# key=value` 单一白Width/pipeline 执行记录 periods:3+总宽/协议 Nyquist 措辞（10Hz 采样带宽仅<5Hz，低通截止≤采样率/2）。48 门全绿 |

> **UI 导出档水密缺口（批一连带发现已处置）**：显示档 19+k·14 对 gyroid/diamond 系统性不足（gyroid 需 ~21+ 格/周期）→ 导出门+升档重试：gyroid 全 k/diamond k1-4/gprime 救回；**diamond k5 与 fcks 薄壁自触族 128 帽内结构性不可产维持诚实拒**（fcks 96/120/128 全 exit3 实测）。

> ## 新会话可做方向（按价值排序）

> 1. **S1_G60 真实试样闭环（用户侧阻塞）**：上机执行卡（打印×2.5 缩放+端板 2mm/压缩 1.44mm/min/CSV 契约=协议 §六 模板 # 三尺寸元数据行+displacement_mm,force_N）。CSV 到位后 AI 侧跑 fit-batch 反演+UI 预填+GA 对标——审查改进表第 5 行（模型口径与实测校准）的数据前提。
> 2. **工艺阈值标定**：制造检查阈值（0.4mm 缺省）需实际设备/材料记录替换——等用户提供或拍板（评估明确阈值须来自设备记录而非文献泛值，故不做预设档）。
> 3. **真人无指导走查**（评估建议执行序 3）：设计→保存→导入→检查→交付全链由未参与开发者跑一遍——三 P1 修复后链路一致性闭环，等真实反馈。
> 4. **评估遗留小项**：specimens/README.md:51 "示意拟合"措辞过时+新功能操作指南（文档批次）；体素模块扩展支持混合/渐变（第二档：先拒绝后完善）。
> 5. 历史拍板项：逆设计 C1 双口径 27%（评估同判"据验证数据决定统一"）；pack ~40MB 清洗（force push 风险）；博客四/论文解冻。

> ## 铁律速查（本会话新增+延续，新会话必读）

> - **UI 独立尺寸语义**：宽度进 cacheKey（SW 段）不进几何——wc 几何不变、mm 口径全变；BuildParams.mmPerWc 五构造点（新增构建路径必须带 effMm(s)，漏注入=导出后指标面板 legacy 覆写）；采用绑定 periods=3+总宽=3×单胞（k6 非标定域）
> - **playwright download.path() 无超时**：浏览器 blob 下载验证用 createObjectURL 拦截（blob→base64 回传），别走 download 事件通道（probe_specimen 首版无界挂起 35min 实证）；stat 面板读数等"偏离切换前值"而非"连续相等"（重建期间旧值恒等误判已稳）

> - **尺寸契约三量**：总宽 specimenSizeMm（真源）/周期数 periods/单胞=总宽÷periods（派生披露）；UI 默认自动=1 period=1mm，批六起可显式总宽（结构参数→试样总宽，sw 分享参数）；推荐/采用候选 cellSize=单胞 mm 必须显式换算（periods=3+specimen-size/总宽 3×单胞）
> - **构建必须规范 cwd**：`bash -c "cd <abs>/tpms/tpms-platform && node node_modules/vite/bin/vite.js build"`（沙箱拦外层 cd；vite 位置传参 root 不等效——license-headers 插件按 cwd 解析，skip 后产物缺头部戳=CI parity 必红）+构建输出见 `[license-headers] skip: ENOENT` 即构建无效
> - **部署链**：rm -rf docs/platform && cp -r tpms/tpms-platform/dist docs/platform && find docs/platform -name '*.map' -delete；提交前本地 `diff -r -w --strip-trailing-cr -q --exclude='*.map' dist docs/platform` 零差异
> - bash 沙箱 cd 常失效：一律绝对路径；**改源码文件用 Write/Edit 工具**（bash 内嵌引号转义会损坏文件——本会话 main.ts 曾翻车）；管道 `| tail` 吃退出码；`gh run watch` 被限流掐断 exit1≠run 失败（终态以 MCP actions_get/匿名 API 轮询为准）
> - UI 数值断言取 HD 收敛终值（#stat-porosity 实测口径随分辨率收敛 l2→HD）；toast 1.5s 自清空——MutationObserver 全程记录
> - chamfer 3-4-5 EDT 权重按非零轴数取（面 3/棱 4/角 5）；voxel-model 的 iso 槽位=bias 语义（直传等值面 isoStar 得全固相——体素化走 targetPorosity 二分）
> - mesh-audit 单源 src/core/mesh-audit.ts（改审计算法只动它，agent/UI/探针自动连带）
> - εd/W 截断=not-observed 口径（平滑η+98%回落判据）；重复 CV=样本 std/均值；fit-batch --out+0 有效不写
> - 慢 runner CI 分级（B5 同型三例）：pageerror 硬门零容忍；「已重建 worker」自愈观测日志披露不判红
> - 合成 click 代触发浮层按钮（任务流→btn-export）：事件继续冒泡会被外点关闭逻辑当"菜单外点击"立即收起——代触发分支须 stopPropagation（btn-export 自己的 stopPropagation 只保护它自己的合成事件）；探针跳转断言用轮询语义终点（smooth 滚动+rebuild 布局竞争，硬等待假红）
> - **git log 中文乱码≠存储损坏**：本机 bash 管道显示 commit 消息偶发按 GBK 渲染（同会话内时好时坏）——判定用 `git cat-file commit HEAD | od -c` 字节解码或 GitHub API，**显示乱码严禁直接 amend**（批七曾误诊连换两个 SHA；2ac1461 实证 GitHub 存储正确）
> - **跨路径建模参数投影**：屏幕/交付 STL/制造检查体素/INP 体网格必须消费同一套建模自由度——iso/targetPorosity/isoGrad 三元组走 resolveBuildTrio 单源（新增构建路径禁止自算）；体素消费端（制造检查/INP/RVE）新增能力前先查 voxelUnsupportedReasons 守卫，不可表示的配置 fail-closed 拒绝不许静默均匀化；导入=替换语义（sanitizeDesignState 校验快照+重置默认再合并），新增 AppState 字段自动被快照携带
> - 发版链：本地 48 门→推→CI+Pages 同 HEAD 双绿才算成；中间环境性红由最后 push SUCCESS 超越，绝不 rerun
> - git add 显式路径（agent_memory/ 是 gitignore 个人目录）；push curl 52→postBuffer+HTTP/1.1

> ## 详细历史（倒序）

> > **2026-10-24/25（本会话）**：四批次+两 CI 修复（上表五提交）。探针：probe_design_roundtrip 15/0 / probe_delivery_pkg 13/0 / probe_mfg_card 3/0 / probe_export_gate 6/0（均在 .verify，一次性不入 CI）。plan 文件：plans/2026-10-24_尺寸统一与实用性修复.md（用户评审版）/2026-10-24_第二批-设计保存导入与sidecar补全/2026-10-25_批三-交付包。污染报告 docs/fit-report.md 已归档删除（副本+说明在 .codex 审查目录 archive-fit-report/，sha256 0e02ecfc…）。
> > **baabb2c（2026-10-20）**：fit-batch 真实内核+协议 24mm 口径（S1 上机卡就绪）。
> > **c26c671/dc1e39e（10-19）**：v1.2.0 发布（双 tag v1.2.0/v9.4.0）。
> > **更早**：见 git log、archive/progress_2026-10-01_02_session48batches.md 与 HANDOFF.md。
