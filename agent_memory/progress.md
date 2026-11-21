# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-21 深夜 XVI 规整版 · T4 COMSOL 弧+UX 打磨弧收官）
>
> - **仓库态**：v1.3.0 正式发布（tag v9.5.0），本日两弧（T4 COMSOL MPh 实跑批+平台 UX 打磨弧）全绿收官，工作树净，**50 门 CI 三平台与 Pages 全绿**（每次提交后均经权威复取 `gh run view --json conclusion`，不信守望退出码单源）。**宿舍机开工：fetch + reset --hard origin/main**。
>
> ### 各线终态（五线全绿或自持）
>
> | 线 | 终态 |
> |---|---|
> | **CFD 标定线** | 完全自持（三层交付+口径三层+机制证据链，详 11-15 摘要）；**11-21 增 T4 COMSOL 弧**：MPh 全链配方（working/scratch/mph_t4_fluid.py）、K 双口径双解 0.4% 互证（K=0.11517 mm²）、真 Forchheimer β≈500-583 m⁻¹（β√K=0.19 落 Ergun 带）、WSS 窗口终判 **29.4% 可引**（口径披露 docs/cfd-wss-window-caliber.md） |
> | **四级对标** | T1/T2/T3/T4 全量真数据齐（E_eff 包络与 T2 降阶披露详 archive/progress_2026-11-late.md）；**T3 rve1 报告层 ×1000 单位坑机制实锤（求解正确/报告层双层错），权威数据修正等拍板**；T4 流体侧真数据=COMSOL/OF 双解互证 |
> | **平台线** | Phase 2-5 全链 50 门三平台绿；**11-21 UX 打磨弧**：拦截三段式卡片（blockCard.ts+行动钮竞态修复 awaitNextRebuild）+B6 行为断言钉 fix_check（守卫 30）+NL 气泡重建指示（elapsed 诚实版）+NL 抽屉 45↔85vh+推荐文案程序化派生；fix_check 30/harness 38 PASS |
> | **架构沉淀** | agent-architecture.md + DeepSeek 调研归档 + 37 曲线谱系索引 + 流程铁律（本周期新增五条见下） |
> | **外评通道+工具链** | Gemini 咨询在案；三轨网格器全实证（nTop 棱柱/COMSOL MPh 全链/OF snappy 定案）；OF13+COMSOL 6.2 双求解器动量审计范式落地 |
>
> ### 下一步队列（按价值排序，全部标注依赖）
>
> 1. **T3 ×1000 权威数据修正**（等拍板）：multifidelity 报告 T3 行 K_m2/ΔP/β/WSS 修正+SI 面核对——定案依据 bugs.md 深夜 VII+docs/cfd-wss-window-caliber.md 附带定案段
> 2. **EXPL 链塑性段实跑**（卡机时：小时~天级）→ Rp0.2 代理升档 → Gemini 触发点（理论前置=Abaqus 讲义第十讲，working/study_pack/）
> 3. **S1 上机解冻**（卡用户）/ **LLM key 跨源实测**（卡用户）
> 4. **k6_tolerance_table 入包**（推荐文案完全程序化派生前置）+批次三深度（NL 抽屉拖拽手势）——低优
> 5. ~~T4 COMSOL MPh 实跑批~~（**11-21 闭环**：K 双口径 0.4% 互证+真惯性数据点+窗口终判）~~仓根规整~~（11-18+11-21 两批完成）~~批次二/三 UX~~（全清）~~diamond k4 矛盾~~（竞态定案修复）
>
> ### 铁律速查（本周期沉淀，合并版）
>
> - **动量守恒=跨求解器局部量争议的终审法庭**：控制体必须与力作用面一致（RHS 用流体入口面 A=Q/v_in，非整箱截面）；比面均值对拍强一个层级
> - **预注册判读表**：归属判决先写表后提取（防事后合理化；WSS 归属判决全流程实效）
> - **playwright JS `waitForFunction` 第二位是 arg 非 options**：时序预算走 waitForSelector 或三参形式（CI CPU 慢机超时教训）
> - **解析锚 BC 等价性必须与被测方同构**：体力+周期≠压差短管（入口发展段损失 ~30%）
> - **动手前先 grep 现状**：队列项可能已被并行会话落地（批次三主体在役教训）
> - **提交暂存核对**：commit 前 `git status --short`+`git diff --cached --stat` 双核对（1477845 事故）
> - **试错时间盒 15 分钟**：超盒必须产出中间证据或停（守望型豁免）
> - **钉串穷举验证**：从被钉源码正则提取验证，不凭记忆手抄
> - **E2E 预算三件套**：耗时自观测+预算 6-16× 快机基线+80% 预警线；fail-soft safeClick
> - **MSYS 路径转换**：wsl 参数 `MSYS_NO_PATHCONV=1`；CRLF 一律 LF 归一交付 WSL；重要脚本一律绝对路径
> - **MPh API 链**（COMSOL 6.2）：mph.start→j.component().create("comp1",True)→geom("geom1").create("imp1","Import")→**imp1.set("type","file")**（"stl" 是 6.2 前旧值）；每轮失败读 FlException 消息（=文档）；JInt 二义/空选集静默 0/边界梯度 mean(d()) 详 archive/progress_2026-11-late.md
> - **v13 语法断代**：外部声称必实测 ETC（meanVelocityForce/acceleration/surfaceFieldValue regionType 三例在案）
> - **构建/历史重写/物理量纲**：见 archive/progress_2026-11-early.md 铁律段（仍有效）
>
> ### 近期摘要（压缩版，明细见 archive/progress_2026-11-late.md）
>
> - **11-14~16（37 提交）**：孤儿批次接手归档（Phase 2-5 全链 3b951cb）+CI 三红三修+WSL OF13 真解打通+k2 修正 0.9594+T4 ABAQUS E_eff=138.29（−1.07%）+Gemini 四问+k∞=0.1342+仓库瘦身 32G→2.4G+T2 探针解锁+诚实勘误批（11-19：csv 18/35 有效+Forchheimer NOT_INDEPENDENT+KUBC 上界化）
> - **11-18**：课题组资料包吸收（Abaqus 讲义=EXPL 理论前置）+nTop 实跑闭环（10,620 真棱柱）+MPh 路线打通（T4 复活）+OF 边界层三层格局盘点+仓根规整（zip 删+原型归位）
> - **11-21**：**T4 COMSOL MPh 实跑批闭环**（K 双口径 0.4% 互证+T3 ×1000 坑机制实锤+真 Forchheimer β≈500-583+窗口 29.4% 终判+披露文档 docs/cfd-wss-window-caliber.md）+**平台 UX 打磨弧**（拦截三段式卡片+B6 门钉 30+NL 重建指示+NL 抽屉+派生文案+卡片行动钮竞态修复 awaitNextRebuild）+**残余整理**（保守删除 ~30M 可再生件，双判决现场保留）
>
> ## 详细历史
>
> - **2026-11-17~21 明细**：`agent_memory/archive/progress_2026-11-late.md`（T4 COMSOL 弧+UX 弧逐批明细：提交号/数值/坑账/九机制矩阵全保留）
> - **2026-11-13 及更早**：`agent_memory/archive/progress_2026-11-early.md`（11-13 R48 曲线/11-12 anchor 终判/11-11 平台化咨询/11-07-08 Anchor 病灶与 sheet 管线/11-04~06 Gemini FEA 线）
> - **2026-10 及更早**：`agent_memory/archive/progress_2026-10.md`
