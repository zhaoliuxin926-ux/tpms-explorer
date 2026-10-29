# 多 Agent 协作黑板

> 参与方：**ZCode（宿舍侧，主控）** × **反重力/Antigravity（评审方）** × 用户（最终放行）。
> 机制：git 仓库即黑板——没有实时对话通道，所有协作经本目录异步交换。

## 规则（三行）

1. **反重力只写 `collab/antigravity/`**（命名 `YYYY-MM-DD-主题.md`），不改其余任何目录、不 push 主分支；其余目录由 ZCode 主控写入。
2. 每份产出注明：**读了哪些文件、建议是什么、依据是什么**；ZCode 审查后在 `agent_memory/progress.md` 登记处置结论（采纳/修正后采纳/驳回+理由）；分歧由用户拍板。
3. 反重力若产出代码，**只给 diff/patch 形式**，由 ZCode 审查后决定是否应用到工作树。

## 入口文档（新会话先读这三份）

| 文档 | 内容 |
|---|---|
| `plans/2026-10-28-tpms-simulation-pipeline-research.md` | 仿真管线全貌：调研结论、十坑表、决策记录、Phase 进度 |
| `agent_memory/progress.md` | 当前状态 + 开工指引（每次收尾更新） |
| `agent_memory/machine-facts.md` | 两台机器环境差异 + 铁律 |

## 当前任务（反重力按此领取，产出写 collab/antigravity/）

### T1 · 评审 Phase 1 脚本的数值健壮性
读 `sim/p0_generate.py` + `sim/p1_mesh.py`。关注点：①R24 分辨率下孔隙率偏差 1.14pp 的来源与收敛速度（R→∞ 时预期行为）；②pymeshfix 兜底对几何的改动量级（修复了多少面、体积变化多少——脚本目前未披露，建议加报告）；③盒 SDF 交线附近三角形质量对 C3D10 网格质量的影响。

### T2 · Phase 2 ABAQUS 求解方案设计（Static 弹性段）
产出一份可直接执行的设置清单：单元（C3D10 vs C3D10M 在 Static 下的选择）、边界/加载（底面固定方式、顶部位移 vs 压板接触的取舍）、输出请求（力-位移曲线提取路径）。**硬约束：输出口径必须兼容平台 `tpms/agent/fit-batch.mjs` 的 CSV 契约（协议 §六：`displacement_mm,force_N` + `# key=value` 元数据）**——仿真压缩曲线要能直接喂平台的 ISO 13314 反演，实现"仿真-实验同口径对比"，这是本项目两条线的交汇点。

### T3 · 开放三问意见
读 plan §8，给独立判断（尤其问题 1：现有 ANSYS 划网是实体四面体还是壳单元——这决定 Phase 2 对标口径；问题 2：打印工艺对壁厚约束的定量影响）。

## 讨论模式（2026-10-29 新增）

双方可发起技术辩论，消息以 `[discuss]` 开头。规则：
1. 回复用**对话体（500 字内）**，不写报告；每轮必须带新论据或明确让步，禁止纯客套。
2. 最多 5 轮收敛；收敛后把共识+分歧落盘 `collab/antigravity/discuss-*.md`（反重力写）或由 ZCode 在处置记录登记。
3. 用户可随时拍板终止辩论。

## 处置记录

| 日期 | 任务 | 结论 |
|---|---|---|
| 2026-10-29 | T1 | **S1~S6 全部采纳**（补丁经 ZCode 审查+实测验证后应用，commit 见 progress）。核心实证：①缺陷 A/B 属实（旧 .inp 实测混入 TYPE=CPE6 + TYPE=C3D10MH，ABAQUS datacheck 必挂）——ZCode 认领实现遗漏责任；②S1 坐标系重构实测兑现：偏差 0.90pp→**0.02pp**（整数周期盒 + 盒内统计阈值）；③附带收益超反重力预期：其报告的旧网格质量数据（minSICN min=1e-3、884 个<0.05）在 S1 修复后实测为 **min=0.057、0 个<0.05**（212,209 tets）——其"Explicit 时间步崩溃"风险论述基于旧快照，严重度大幅下降（Explicit 阶段仍按 minSICN 复查）；④其"R≥120 才能到 0.1pp"的收敛预测仅对旧实现成立。T2 放行，按 README 任务描述推进。 |
| 2026-10-29 | T2 | **方案采纳（含两处修正后生效）**：①p2_static_setup.py 的 ELSET=MergedCells 为事实错误（meshio 不写该集名）——落地时必须注入 `*ELSET, ELSET=ESOLID, GENERATE` + `*SOLID SECTION, ELSET=ESOLID`；②`*ELEMENT OUTPUT S` 口径降级为全场云图 sanity check，不承诺折痕带应力定量真实性。方案亮点予以保留：CSV 契约正则级对齐、HISTORY+FIELD 双回退提取、顶面位移加载作生产基线（压板接触留作扩展模板）。p2 脚本落地为下一步工作。 |
| 2026-10-29 | discuss-1（网格质量/应力口径） | **一轮收敛，共识=口径双轨制**：宏观轨（力-位移/E*/fit-batch 反演）当前网格直接合格，无需二次优化；微观轨（局部屈服/疲劳）须 Gmsh Distance+Threshold 交线带加密后才可信。反重力补充量化论据：sliver 体积占比 ~1e-6，对总应变能贡献在噪声内。纪要：collab/antigravity/discuss-2026-10-29-mesh-quality.md。本轮为首次全自动辩论演示（ZCode computer-use 打字 ⇄ 屏幕读取，用户零干涉）。 |
| 2026-10-29 | discuss-2（渗透率/WSS 模型形态） | **两轮收敛，三段式定案**：①扫参级（Phase 3 主力）=单胞+平移 PBC（K+基准平均 WSS，Re<0.1 水力发展段<0.01mm）；②WSS 窗口覆盖率作核心优化目标时按实验工况分流——体外反应器灌流→必做整件复核（1~2 个胜出构型），体内渗流/未定→单胞+口径披露；③文献数字（3.2~6.8%/1.8~2.6×/15~28%）方向采纳、**定量标记[待原文核验]**（Montazerian 2017/Castro 2019/Ali 2019 须核后方可作门禁阈值）。纪要：collab/antigravity/discuss-2026-10-29-permeability-model.md。本轮 ZCode 部分让步（接受 K/WSS 二分法）+两个精化（工况分流、数字纪律），为讨论模式首次双向交锋。 |
