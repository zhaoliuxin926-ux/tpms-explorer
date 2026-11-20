# WSS 成骨窗口口径并轨披露（2026-11-21 定案）

> 状态：**定案**。本文档是多保真 CFD 链 WSS/成骨窗口指标的口径权威披露；推翻需新证据（动量守恒审计级别）。

## 终判：可引单值 = **29.4%**（OF 面元口径）

成骨窗口比（壁面 WSS ∈ [5, 25] mPa 的面积占比 @1 mm/s 名义流速，gyroid k1 R20 p70 cs4 rve1）：

| 口径 | 窗口比 | 地位 |
|---|---|---|
| **OF 面元**（snappy + wallShearStress FO，7442 墙面） | **29.4%** | **可引单值**（双证见下） |
| COMSOL 面元（MPh 全链，BL 2-4 层） | 7.03% | 低偏口径，仅随附披露 |
| 体素 FVM（μ·\|u\|/d_eff 代理） | 34.76% | **DO-NOT-CITE**（冒烟档出处，见下） |

## OF 口径双证

1. **动量守恒闭合 103.6%**：∫wall p·n_x（+1.685）− ∫wall w_x（−1.415）= 3.100 vs ΔP·A_fluid_inlet = 0.30917 × 9.679 = 2.992（mm⁴/s² 原始运动学单位 @case 流速）。注意 RHS 必须用**流体入口面**（A = Q/v_in = 9.679 mm²），非整箱截面 16 mm²。残余 3.6% = A_fluid 贴面估计 + 惯性通量（~0.02%）+ 端面黏性（~0.4%）。审计脚本：`working/scratch/momentum_audit.py`。
2. **直管解析锚 0.999**：同一 snappy+FO 提取链在 anchor-1 直管（R=π mm，体力驱动）上 |WSS| mean = 1.2706 vs 解析 τ = G·R/2 = 1.2723 mm²/s² → ratio 0.999（判读表预注册于提取前）。资产：`sim/cfd/anchor1/`。

## COMSOL 7.03% 低偏披露（随附口径）

COMSOL mean(d()) 边界梯度评估在光滑圆柱直管上低估 **−28%**（动量法庭：ρG·V = 1.578e-7 N vs τ·A_w = 1.105e-7 N，30% 力赤字在 p0 双零+惯性 ~3% 下无处可去）。其 gyroid 值 1.89 mPa 带同族低偏，故窗口比 7.03% 系统性偏低。引用时若并列必须附本节披露。直管对照资产：`working/scratch/mph_anchor_pipe.py` + `sim/out/comsol_t4/anchor_pipe_comsol.mph`。

## 体素 34.76% DO-NOT-CITE

多保真报告 T3 档 REAL_SOLVED 下的 34.76% 实为冒烟档体素 FVM（μ·|u|/d_eff 近壁胞估计）产物——p3 代码流 `wss_v1` 恒取体素 FVM，WSL OF13 成功时仅替换 ΔP；tier 门控漏 WSS 块（pitfall I214，已修：`wssProvenance` 字段恒注入，commit d7cd2e4）。

## 附带定案（同批）

- **T3 rve1 报告层 ×1000 单位坑**：`dp_Pa=30.907/309.171` 为 mm 制运动压 ×100 误标 Pa（修正 0.030907/0.309171 @声称流速）；K_m2 = 1.1519e-10 → 真 1.1519e-7 m²（K = 0.11517 mm²，与 T4 COMSOL 双口径 0.4% 吻合）。**权威数据修正待拍板**。
- **真 Forchheimer 惯性**：β = 563-583 m⁻¹（COMSOL/OF 双解一致，OF@真 10 mm/s 判决 1.2%）；β√K = 0.19 落 Ergun/泡沫带 0.29±。
- **COMSOL 体网格加密（原第 9 机制候选）**：降级为**可选鲁棒性检验**（非待办）——其归因动机已被动量法庭判决（COMSOL 低偏）取代；仅当未来需要 COMSOL 侧窗口比独立值时重启。

## 论文引用脚注模板

> 壁面剪切应力经 OpenFOAM 13 snappyHexMesh（动量守恒闭合 103.6%，直管解析锚偏差 −0.1%）与 COMSOL 6.2 独立复核；成骨窗口比采用 OpenFOAM 面元口径（29.4%），COMSOL 面元（7.03%）因边界梯度节点评估系统性低估（直管动量平衡 −28%）仅作对照披露。

数据链：`sim/out/comsol_t4/t4_summary.json`（全部节）｜提交链 3bbcf42 → d7cd2e4 → a38df7f → d491a71。
