# progress — 当前任务进度

> ## 🔖 新会话开工指引（2026-11-16 规整版 · v1.3.0 发版收官）
>
> - **仓库态**：**v1.3.0（别名 tag v9.5.0）已正式发布**（[GitHub Release](https://github.com/zhaoliuxin926-ux/tpms-explorer/releases/tag/v1.3.0)，`gh` CLI 已持久化登录，`About` 简介已更新为 `50 CI gates (v1.3.0)`），工作树净，**50 门 CI 三平台与 Pages 全绿**。已先后落地 DeepSeek × 卡兹克开源机制吸收（总览防脑腐哨兵 + 博客五 + EXPL 任务书）与 **v1.3.0 后三项闭环**（T2 浏览器与体素内核四级对标包络闭环、T4 盲测 CSV 抢救入库 + 37 曲线 `index.json`/`README.md` 谱系索引、`cae-daemon.mjs` 持久化 `jobs.jsonl` 事件溯源）。**宿舍机开工：fetch + reset --hard origin/main**。
>
> ### 各线终态（五线全绿或自持）
>
> | 线 | 终态 |
> |---|---|
> | **CFD 标定线** | **完全自持**：三层交付（数据 JSON/md/CSV）+ 口径三层（0.9594 N=2 实用修正 / K∞=0.1342 渐近参考 / KC 重算 Kozeny 9.6→13.5）+ 机制证据链（k2 窄带+k3 预言命中+k∞ 外推） |
> | **四级对标** | **T1/T2/T3/T4 全量真数据齐备**：`E_eff` 包络 `homog(82.15) < DT_R8(100.35) < ABAQUS(138.29) ≈ T1(139.79) < R20_KUBC(310.03) MPa`；Forchheimer 回代 T3 压降还原 `K_int=1.15e-4 mm²`（`docs/cfd-multifidelity-report.json`） |
> | **平台线** | Phase 2-5 全链（6 工具满配+session-core 单源+DSH 工作台+`cae-daemon` 含 `jobs.jsonl` 溯源）50 门三平台绿；E2E 预算链四层闭环 |
> | **架构沉淀** | agent-architecture.md 扩展者手册 + DeepSeek 调研归档 + 37 曲线谱系索引（`sim/csv_archive/index.json`）+ 流程铁律三项 |
> | **外评通道+工具链** | Gemini 四问闭环；**三轨网格器全实证**（nTop headless 首跑闭环：license+10,620 真棱柱+minSICN 0.11，产物 sim/out/ntop_test/）；**MPh 1.4.0 路线打通**（COMSOL STL 导入已证，绕 Java 断代——T4 COMSOL 挂起项复活） |
>
> ### 下一步队列（按价值排序，全部标注依赖）
>
> 1. **T4 COMSOL MPh 实跑批**（最近可做项）：MPh 导 STL 已证 → 补 Boundary Layers 网格特征+LaminarFlow 求解+ΔP/WSS 导出（路线图在 11-18 段；探针 working/scratch/mph_probe.py）；EXPL 七问任务书在案
> 2. **EXPL 链塑性段实跑**（小时~天级）→ Rp0.2 代理升档 → **下次 Gemini 触发点**（理论前置=Abaqus 讲义第十讲准静态分析，working/study_pack/）
> 2. **S1 上机解冻**（卡用户）→ Q3 四步正交实验（Gemini 设计在案：称重 ε/长度序列 TLM/端面车削/多流速）
> 3. **DeepSeek/LLM key**（卡用户）→ 真跨源实测 + 43 条 LLM 回归
> 4. ~~T2 人工会话取数~~（**2026-11-16 已解锁闭环**：根因系 `working/scratch/t2_browser_probe.mjs` 第 9 行服务目录误指不存在的 `../../tpms-platform` 致 404，修正为 `docs/platform` 后双壳 E2E 与 R=20 体素内核均一次实算通过）
> 5. ~~COMSOL API 专项~~（**已被 MPh 路线取代**：绕开 Java 模板，Python 客户端 API 与 COMSOL 版本同源）
> 6. 名义 vs 实测参数口径普查（可选审计；`sim/csv_archive/` 全量 37 曲线谱系与 SHA256 清单已先行落盘 `index.json`/`README.md`）
>
> ### 铁律速查（本周期沉淀，合并版）
>
> - **提交暂存核对**：commit 前 `git status --short` + `git diff --cached --stat` 双核对；Edit 失败时同消息连带提交必须中止（1477845 事故）
> - **后台/试错时间盒**：试错型 15 分钟超盒必须产出中间证据或停（CPU/墙钟比异常=停信号）；守望型豁免
> - **钉串验证**：从被钉源码正则提取穷举验证，不凭记忆手抄清单
> - **E2E 预算三件套**：耗时自观测（拼断言名）+ 预算 6-16× 快机基线 + 80% 预警线；fail-soft safeClick；瞬态重试=YAGNI
> - **MSYS 路径转换**：wsl 参数用 `MSYS_NO_PATHCONV=1`；cmd 跑 bat 用 `cmd //c`
> - **CRLF**：跨系统脚本一律 LF 归一后交付 WSL
> - **Node 25 strip-types**：零依赖 TS 内核可 `node --experimental-strip-types` 直跑（experimental-fit ✓）；DT 内核例外（隐藏阻塞，见 T2 挂起）
> - **MPh API 链**（COMSOL 6.2）：`mph.start()` → `j.component().create("comp1", True)` → `j.component("comp1").geom().create("geom1", 3)` → `geom("geom1").create("imp1", "Import")` → **`imp1.set("type", "file")`**（"stl" 是 6.2 前旧值）+filename 后缀驱动格式；每轮失败读 FlException 错误消息（=文档）
> - **v13 语法断代三例**：meanVelocityForce/acceleration/surfaceFieldValue regionType——外部声称必实测 ETC
> - **构建/历史重写/wsl/物理量纲**：见 archive/progress_2026-11-early.md 铁律段（仍然有效）
>

> ### 11-16 续 II：仓库瘦身 32G→2.4G（用户授权清理批，bf3b60e）
>
> - **清理四类**：①35 个标定 ODB（18G）→ **全量曲线提取 35/35 零失败**入 sim/csv_archive/（tracked，42K）后删；②T4 p50/p70 ODB（10.2G）删（curve CSV+LE_static INP 双留证，E_eff 已入档）；③标定期 ABAQUS 副产物（.stt/.dat/.prt 等 ~1.4G）+可再生网格 INP/MSH/labeled STL（~1G）清（p0→p1 链完备再生）；④根目录散落验证 STL 233M+D:\GITHUB	mp 150M 清。
> - **保留判定**：specimens 1.3G 全保（S1-S8×4 统计重复件=上机必需）；sim/out 293M（csv 现场+calibration_curves.png+rve_* 近期现场+comsol）；.git 77M；tpms/ 620M（源码+node_modules）。
> - **归档增益**：multifidelity 报告从 gitignored 区入 docs/cfd-multifidelity-report.json；标定曲线原始数据首次全量入库（此前 csv_expl 只有 6 份，本次 35 份补全——**ODB 原始证据降级为 CSV 证据，重跑成本从删库不可逆变为 Explicit 小时~天级**）。
> - **尺寸口径钉**：标定族提取统一 12.5664mm（k2 无量纲 4π，CSV 头部元数据实证）。
> - **D:\GITHUB 层已清（用户拍板"没用全删"，11-16 续 III）**：3 bundle+2 mirror.git（~390M 重写备份，远端稳定 8 天旧史确认抛弃）+空目录 tpms-external+tpms-scrub2-replace.txt 全删；push-tpms.cmd（推送小工具）保留。**D:\GITHUB 终态 3.1G**（tpms 2.4G+编号小游戏）。

> ## 三天工作摘要（2026-11-14 ~ 11-16，37 提交）
>
> ### 11-14：孤儿批次接手 + CI 三红三修 + 真机批开闸
>
> - **接手 11-13/14 孤儿批次**（~5000 行未归档）→ 盘点+验证（两门禁 53/38 断言+全量 50 门绿）→ **3b951cb 归档**（Phase 2-5 全链：6 工具满配/session-core 单源/DSH 工作台/cae-daemon/四级对标矩阵/sim 9 族单源）
> - **CI 三红三修**：①H4 读 gitignored 产物→fixture 内嵌（30f89b7）②J2/J3/K2 环境条件双档+K1 python3 回退（c66d05e）③J2* 钉串穷举验证修正（3538445）→ 三平台全绿
> - **真机批**：WSL OF13 真解 K=1.15e-4 mm²（177s）+ 四级对标首战抓 FVM 586× 失配→冒烟档定级（3bbcf42）；RVE snappy 加密负结果=可行域边界 20³+2 层（3f5f9ca）；T3 降级标注+H4/H5 预算链+E2E 四层闭环（aae367a→9f15a0f→1cada2d→2ce63bd→9eca213→f5b3fa9）
>
> ### 11-15：CFD 标定线主线收官 + T4 ABAQUS + Gemini 四问
>
> - **k2 双胞入口效应**：单点定案 −3.7%（6d0a5f6）→ 全族四点窄带 −4.06%±0.2 → **统一修正 0.9594 实测定案**（fcb1ab8）
> - **T4 ABAQUS 静态实算**：E_eff=138.29 MPa vs T1 −1.07%（弹性 R²=1.0）；p2 生成器 INC 缺陷修复（6059377）；**体积拆账发现**：实测 ρ̄ 口径下偏差 ≈0（−1.07%≈MC 离散体积亏损）
> - **Gemini 四问闭环**（7b18bc5）：k3 预言命中（0.9458∈0.9467±0.006）/ KC 勘误（STL 权威重算 CFD/KC=0.52→0.37，Kozeny 9.6→13.5）/ 三证据链 / fidelity_warning 护栏；CSV 契约三层交付（94bf45c）；DeepSeek 开源调研+agent-architecture.md（3948efe/7735e9a）
> - **流程铁律落地**：提交暂存核对（872b8c3 事故入档）
>
> ### 11-16：挂起双项 + k∞ 外推 + 口径层级澄清
>
> - **T2 双路径挂起**（0e21687）：node 化 50 分钟无产出+playwright 四轮主 frame 未就绪→人工会话登记
> - **COMSOL batch 挂起**（33ad807）：license 在位（compile 9.6s+batch 23.1s）但 API 断代 ClassCastException→留专项
> - **k∞ 渐近外推**（a7e70e3）：三点 R²=0.9992 → **K∞=0.1342 mm²**；**诚实更正**：实测 K(N) 递减与 Gemini 串联阻力模型方向相反，k3"命中"=两点内插巧合；口径层级=0.9594（N=2 实用）/ K∞（渐近参考）
- **T2 浏览器探针解锁 + CSV 谱系 + Daemon 事件溯源（11-16 续 IV）**：①定位 `t2_browser_probe.mjs` 挂起根因为服务路径误指不存在的 `../../tpms-platform`，切回 `docs/platform` 后一次全绿跑通，补齐 `docs/cfd-multifidelity-report.json` 四级包络；②抢救 `tpms_gyroid_k2_R20_p50/p70_LE_curve.csv` 入 `sim/csv_archive/`（共 37 条 CSV），批量生成 `index.json` 与 `README.md`（检出 16 条相同 `<10` 点空桩 `48751f6370f40383`、5 条 `ε≥0.40` ISO 全提取、p50 跨尺寸复现差 0.09%）；③`cae-daemon.mjs` 实装 `sim/out/jobs.jsonl` 追加写与 `GET /api/cae/history`、`/api/cae/status` 路由（Node 25 `--self-test` 顺带修复 `UV_HANDLE_CLOSING`）。
>

> ### 11-18：课题组资料包吸收 + nTop 实跑闭环 + MPh 路线打通（T4 COMSOL 复活）
>
> - **用户资料包**（课题组学习资料.zip 179MB）：ntop docx=官方学习入口（learn.ntop.com/support.ntop.com）；隐式建模白皮书=SDF 理论（与平台隐式场同源背书）；COMSOL CFD 简介=物理场接口指南（5.6 版营销文档，非网格手册）；**Abaqus Standard/Explicit 讲义（SIMULIA 官方培训）=EXPL 塑性段七问任务的理论前置**（第十讲准静态分析 p190：质量缩放/能量平衡判据/加载速率敏感性——fea-calibration"EXPL E* 口径差 17%"的敏感性验证官方出处）。其余（王勖成 FEM/弹性力学/MS/UG/SolidWorks）=工具书按需查；DeepSeek/Hermes 教程已解压待阅。
> - **nTop 实跑首次闭环**：ntop_builder --in-stl 实跑 ntopcl headless——license 成功加载+BLVolumeMesh 623ms+Export INP/BDF+"nTop successfully built"；**10,620 C3D6 真棱柱+11,859 C3D4**，minSICN 0.11，产物 sim/out/ntop_test/（inp 1.3M/bdf 2.4M/stl）。三轨网格器中唯一产真拓扑棱柱层；p1 --backend ntop 主轨激活（此前仅容器签名验证）。
> - **MPh 路线打通（T4 COMSOL 复活）**：pip install MPh 1.4.0（COMSOL 官方 API 的 Python 封装）——8 轮错误消息驱动迭代（server 36s 起→comp1 创建→geom1 序列→**STL type="file"+filename 后缀驱动**（p4 模板 type:"stl" 是 6.2 前旧值——正是 ClassCastException 断代根因之一！）→mph 保存 1.78MB PASS）。**绕开 Java 模板断代**：MPh 客户端 API 与 COMSOL 版本同源，无手工拼 Java 的版本漂移。
> - **COMSOL STL→BL 网格路线（用户建议）落地路径**：MPh 导 STL 为几何（已证）→ COMSOL Boundary Layers 网格特征（p4 模板已有 bl1 代码）→ LaminarFlow 求解 → ΔP/WSS 导出——T4 流体侧真数据闭环路线图齐备，下批实跑。
> - **坑账**：MPh model.java 桥层级三连错（geometry()/geom(comp1)/type:"stl"）——正确链=j.component().create→j.component().geom().create("geom1",3)→geom("geom1").create("imp1","Import")→imp1.set("type","file")+filename；bash cwd 漂移三犯（heredoc 落错目录）——重要脚本一律绝对路径 cat。

> ## 详细历史
>
> - **2026-11-13 及更早**：`agent_memory/archive/progress_2026-11-early.md`（11-13 R48 曲线/11-12 anchor 终判/11-11 平台化咨询/11-07-08 Anchor 病灶与 sheet 管线/11-04~06 Gemini FEA 线）
> - **2026-10 及更早**：`agent_memory/archive/progress_2026-10.md`
