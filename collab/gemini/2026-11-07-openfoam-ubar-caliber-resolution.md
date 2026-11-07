# Gemini 补充裁决 · Ubar 口径裂缝闭环 + Anchor 批次授权（2026-11-07）

> **承接**：`2026-11-07-personal-project-cfd-route-and-governance-reply.md` 处置表"口径注记"登记项
> **回执**：用户代贴 Gemini 原文归档（节选核心，全文见会话记录）｜**ZCode 接受裁决如下**

## 裁决核心（原文要点）

1. **Ubar 物理身份**：`gmshToFoam` 仅剖分孔隙流体域（固相不在 polyMesh 中），
   `meanVelocityForce`（selectionMode all）的体积平均分母=ΣV_cell=V_fluid=ε·L³——
   **Ubar=孔隙本征流速 U₀**，非达西表观流速 v_D=ε·U₀。
   → **K = ν·ε_eff·Ubar/G 保留 ε 因子**。若删 ε，Anchor-1（ε=π/4）会偏大 1/ε≈27.3%。
2. **"登记待验"优于"当场改写"的三条件**：①分歧涉及外部黑盒归一化口径；②下游紧邻
   高信噪比解析锚（Anchor-1 ε=0.7854≠1，几分钟零歧义判决）；③后处理末端不阻塞前置基建。
3. **fvModels 标准写法**（补 KB 盲区，Anchor-1 直接用）：
   ```cpp
   // constant/fvModels
   momentumSource
   {
       type            meanVelocityForce;
       selectionMode   all;
       fields          (U);
       Ubar            (1e-3 0 0);
       relaxation      1.0;
   }
   ```
   日志验证点：`momentumSource: pressure gradient = <G>` → K=ν·ε_eff·|Ubar|/G 对账 εR²/8。
4. **授权**：OpenFOAM v13 安装+Anchor-1~3 阶梯自主开工，Anchor-1 误差 <0.5% 放行。

## ZCode 接受与勘误登记（2026-11-07）

- **接受**：Ubar=U₀ 裁决物理成立——关键事实=CFD 域只含流体网格，"全域平均"的"域"是
  流体域本身。ZCode 前轮"Ubar=表面流速 v_D"的猜测在此域定义下**作废**（表面流速
  v_D=ε·U₀ 是对含固相的包络体积平均，OpenFOAM 网格里没有那个体积）。
- **勘误记录**：本机核查发现 WSL Ubuntu-24.04 已装 /opt/openfoam13（Foundation v13）+
  ~/OpenFOAM/qi-13 用户目录——"待安装"条目为未查先假设（同日 check-before-assume 第三犯），
  即改。Anchor-1 直接开工。
