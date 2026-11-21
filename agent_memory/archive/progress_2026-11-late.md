# progress 归档：2026-11-17 ~ 11-21（T4 COMSOL 弧 + UX 打磨弧明细）

> 本档收纳 11-17~11-21 两弧的逐批明细。摘要与终态见 progress.md 主档；本档为证据级细节（提交号/数值/坑账全保留）。

## 一、仓根规整批（11-18，用户三项拍板）

- 课题组学习资料.zip（179MB，已吸收 study_pack）删除；原型/harness-驾驶舱.html git mv → tpms/prototypes/（注释级引用两处同步=改源+重建+重灌 docs/platform，parity+349 PASS 零漂移）；不动清单=sim/cfd 定案现场（tpms_cell 148M+anchor1 41M）/docs 根散 .md（门禁扫描面）/specimens 1.3G。**CI（169cd2a）三平台全绿**（macos 首跑 cancelled=GH 侧瞬态，`--failed` fresh runner 绿定案）；推送注意：裸 `git push` 无 upstream 被拒，`-u origin main` 一次设定。
- OF 边界层能力盘点核实（咨询批）：仓内三处在案实跑——anchor-1 带棱柱（+0.319% vs .nolayer +0.579%，层贡献≈0.26pp 主责=表面加密，8f960a5）、tpms_cell 单胞通透池 K=0.0811 带层定案、p1_bl_mesh.py 模板出厂 addLayers true（3b951cb；lmax<0.2 反噬告警 aae367a）；生产 K 案（WSL feaBoneReanalysis 树）false 实锤。**勘误试点案名**：K_1.5_AE 未复现→改 K_1.25_AE（trial1/2+fine）；live 树 fea_bone_reanalysis_20260922 为空=生产案唯一副本在 _bak 树（单副本风险）。

## 二、T4 COMSOL MPh 实跑批（11-21，P20261121010022）

- **MPh 全链 12 轮错误消息驱动打通**（working/scratch/mph_t4_fluid.py）：labeled 流体 STL 一步成域（domains=1/80 面，无需布尔差集）→6 Box+Union/Complement(entitydim=2)→BndLayer(2 层)+FreeTet(fine hmax0.3)→LaminarFlow 双点求解→六数值特征。**API 断代坑 6 例**：JInt 二义重载/Union-Complement 默认域级/BndLayerProp 无 hfirst/Size 子操作首字母大写/数值特征须求解后建（dataset）+空选集=静默 0/spf 速度=标量 u,v,w 非 u.x/边界梯度须 mean(d())。产出 sim/out/comsol_t4/。
- **T4 vs T3 对拍（口径全同 μ=0.00089/L=4mm）**：ΔP(v1) 0.40% 吻合；K_bc 0.11472 vs 0.11519 mm² **0.40%**；K_flux 0.0694 vs 0.0698 **0.4%**；Ubar 1.017✓；WSS max −6.8%。
- **【重大发现·机制实锤】T3 rve1 报告层 ×1000 单位坑**：OF 求解本身正确（case BC 实际 0.01 mm/s、ν=0.89 mm²/s 正确 mm 世界、raw ΔP_kin=0.30917 mm²/s²）；错在报告层双层（①U 口径 ×100（case 0.01 vs 声称 1.0）②运动压 ×100 标度后漏乘 ρ×1e-6→"30.907 Pa"=真值×1000）。K_true=0.11517 mm²（BC 口径）/0.0698（flux）与 COMSOL 双口径 0.4% 吻合；multifidelity T3 K_m2=1.1519e-10 → 真 1.1519e-7 m²。pitfall I213。**权威数据修正等拍板**。
- **v2"异常"定案=真 Forchheimer 惯性**：std2 新鲜求解 15 位复现+三点二次律（ΔP=0.0288U+0.00225U²）3% 自洽（v5 判决点 −2.5%）+OF13 真 10mm/s 独立判决 0.519067 vs 0.512896=**1.20% 吻合**（of_rve1_U10）→ β≈500-583 m⁻¹（项目首个真惯性数据点）；OF 原两点均深 Stokes（BC 0.01/0.1 vs 声称 1.0/10.0）。β√K=0.19 落 Ergun 带 0.29±（60× 差距=我方 √K 误用 bug-K 的算术 bug，已修正）。**BC 等价性方法论**：解析锚对照的 BC 必须与被测方同构（压差驱动短管有入口发展段损失 ~30%；体力+周期才是 OF 锚等价物）。

## 三、WSS/窗口归因弧（11-21 深夜 II~VII）

- **九机制排除矩阵**（逐实验处决）：单位✗（双口径 0.4% 互证）/COMSOL BL 层数✗（BL4 mean −0.7%/max −3.6%=壁面收敛）/表面粗糙度✗（47.741 vs 47.568 mm² 恒等）/粗面污染✗（层覆盖分面均匀 4-5 mPa）/OF 层参数✗（BL4 敏感性 +2.9% 鲁棒，coverage 反降 41.4%=几何帽）/FO 语义✗（anchor-1 直管 0.999 vs 解析 G·R/2=1.2723，预注册判读表分支 1 命中）/曲率相关✗（解析 gyroid 曲率分箱 Spearman ρ=0.062<0.15 预注册阈）/非正交相关✗（ρ=0.020）/COMSOL 体网格加密→降级可选鲁棒性检验。
- **COMSOL 直管锚反转**：压差版=体力版逐位一致 τ=0.892 vs 解析 1.2723 → **ratio 0.701，动量法庭=30% 力赤字无处可去（p0 双零+惯性 3%）→ mean(d()) WSS 光滑管上也 −28% 低估**（我方首版 BC 有入口发展段损失——BC 等价性教训实证）。
- **OF gyroid 动量审计 103.6% 闭合（终审）**：∫wall p·n_x(1.685)−∫w_x(−1.415)=3.100 vs ΔP·A_fluid_inlet(0.30917×9.679=2.992)——**37% 缺口真凶=审计者控制体错误（整箱 16 vs 流体面 9.679）**；符号约定 w=作用于流体牵引。**OF gyroid WSS=4.44 mPa 自洽实锤**。
- **窗口指标终判**：可引单值=**29.4%**（OF 面元口径：动量闭合 103.6%+直管锚 0.999 双证）；COMSOL 7.03%=低偏口径仅披露；体素 34.76%=DO-NOT-CITE（冒烟档出处——p3 wss_v1 恒取体素 FVM，tier 门控漏 WSS 块，pitfall I214 已修 wssProvenance 字段 d7cd2e4）。披露文案落地 **docs/cfd-wss-window-caliber.md**（349 PASS 零漂移）。
- **K 并轨**：law 口径≡flux 口径（恒等式：ν·ε·Ubar/G 代入 Ubar=U_D/ε 即约化为 μ·U_D·L/ΔP）；2.06× 差=R20 楼梯缩喉因子 ~0.5×0.143≈0.079 自洽，精钉需 R48 重解。

## 四、平台 UX 打磨弧（11-21 深夜 IX~XII，P20261121025801）

- 外调研五模式（OpenSCAD Customizer 谱系/NNGroup 渐进披露/Configurator UX 2025/jupyter-cadquery/Salsita）→定位短板=约束反馈语义化+等待体验。
- **拦截三段式卡片**（3863ffb）：新模块 src/ui/blockCard.ts（原因绯红/推荐琥珀/行动段，零依赖 CSS 变量明暗自适应）+导出门硬拦截站接线+降密度重试钮；diamond k5 恢复闭环实拍（拦截→降密度 4→"已导出 STL"）。
- **B6 行为断言钉 fix_check**（904602e+三修链）：diamond k5→btn-stl→断卡片三段→点行动钮→断 cell-size=4；守卫 28→30。**三修链**：①playwright JS waitForFunction 第二位是 arg 非 options（240s 预算被丢成页面参数，45s 默认接管，CI CPU R128 超时）→改 waitForSelector；②测试重试环×应用递减重导=级联放大（5→4→3→2 计数链，诊断 {"cell":"2","card":true} 实锤）→单步确定性；③300ms 快照窗卡片重显=k4 重导快速失败的正确应用行为→断言收敛至不变量（cell<5）。
- **diamond k4 矛盾定案（深夜 XV）**：净室复现导出成功=**10-24 矩阵"diamond k1-4 救回"验证通过，矩阵无辜**；级联假拒产=行动钮 400ms 盲等竞态（审计跑在未重建完成的旧 k5 网格上）→修复=awaitNextRebuild(90s) 等重建完成再重导。CI 三平台全绿（a38df7f/d491a71/b691a67 后续全绿）。
- **NL 气泡重建指示**（elapsed 诚实版）：主管线 worker 单发无 progress 流——不造伪百分比；elapsed 计时+完成原地替换耗时徽章（runPendingNLExport 钩子）；restore 路径对称化（b691a67）。
- **批次三盘点+收官**（60ef5a6）：批次三主体 11-08 已落地（v-tools overflow-x=规范备选方案/controls 抽屉/NL 48vh/560px 断点——队列项陈旧，**动手前先 grep 现状**）；真实剩余两项落地：NL 抽屉 45↔85vh 展开切换（nl-head+⇕，实测 420→690px）+卡片推荐文案程序化派生（周期上界=128 帽÷32 常数运行时计算+家族宣称日期戳）；375px 像素帧全链验证（轨迹卡+1.7s 徽章+水密披露同框）。

## 五、残余整理（11-21 深夜 XVI，本批）

- 保守删除批：comsol_t4 阶段 mph×3+t4_bl4.mph+mph_probe_base.mph（~30M 可再生）+scratch 垃圾（乱码残目录/commit_msg 草稿/日志/pkl）——**双判决现场保留**（of_rve1_U10 16M=首真惯性点/of_rve1_BL4 13M=几何帽结论现场）；comsol_t4 终态 5 项 42M；scratch 22 件方法论脚本全留。
