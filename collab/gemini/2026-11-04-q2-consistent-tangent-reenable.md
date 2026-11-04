# Gemini 第五轮裁定归档：consistent 切线重启用核准+三护栏+平台落地终版（2026-11-04）

> 线程：Q2 判读→ZCode 处置回执（预言双验证+修复①见效+consistent 重启用之问）→ 本裁定。

## 要点（ZCode 摘编+实现核对）

1. **elastic+maxIter 硬扛=算力陷阱**：塑性平台段 E_tan/E∈[0.005,0.03]→修正 Newton 谱半径 ρ≈0.97-0.995→压 5 个量级需 ~570 外环步×350 PCG——consistent 重启用是唯一降维路径（外环 5-10 步二次收敛）。
2. **拓扑滤波已实质救活 consistent**：历史"失 SPD"本质=铰接零空间被塑性软化放大 100×（γ_ep=H/(3μ+H)~1e-2 时条件数恶化；H→0 塑性铰准零空间）；Simo-Taylor 秩一 C^ep 在 H≥0 时恒 SPD；滤波根除几何零空间+LM 阻尼锁谱下界=consistent 安全。
3. **三护栏**：A=consistent 仅装配材料切线 K_mat^ep（**禁绑 K_geo**——大压缩 S<0 叠加塑性会产真实负特征值；几何非线性由残差侧精确承载不损平衡态）；B=LM 阻尼锚定**弹性对角线** diag(K_e)（非当前塑性对角——完全屈服体素局部主向刚度≈0，弹性锚托底 λ_min≥ηE，κ≤1e4 全段锁死），η=5e-4；C=第 8 步切线冻结/阻尼×5（防活动集乒乓振荡：屈服面临界体素加载/卸载切线突变→残差周期 2 极限环）+maxIter=25 后子步折半。
4. **落地终版**：a) 滤波入生产 ✓ b) LM+优雅终止 ✓ c) **consistent+弹性锚 LM+冻结机制替代拉 maxIter**（预期外环 40+→5-12 步、总耗时 -60%）d) 参照比 R16/R24+R6 更名 ✓。

## ZCode 实现核对（落地前差异披露）

- **护栏 A 冲突实锤**：我方 `gpu-plasticity-solver.ts` 的 matVecFree 中 geo 项条件为 `tangentMode !== 'elastic'`——即 **consistent 分支当前绑定了 K_geo**（与 'geo' 模式共链）。落地时须解绑：consistent=纯材料修正，K_geo 仅 'geo' 模式保留。
- 护栏 B/C 均为新增强点（当前代码无 LM/无冻结）。
- 预期落地轮改动面：matVecFree 条件拆分+LM 阻尼参数+冻结逻辑+maxIter 语义+体素化入口滤波（探针 prune v2 移植）+audit 锚+48 门+CI。

## 验证先验（落地轮判据）

R12/R16/R24 全分辨率到 40% 平台段收敛（V 形彻底拉平）；单步外环 Newton 5-12 步；R12 PCG 单峰；总耗时较 elastic 硬扛 -60%。
