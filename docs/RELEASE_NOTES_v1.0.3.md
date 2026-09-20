# Release Notes — v1.0.3（geo 切线复活批）

> 2026-09-20 · 几何刚度 matvec 修复 · 求解器默认口径定案 · 门 27 升 57 断言

## 修复

- **geo 切线 matvec 行/列倒置（v6.0 起屈曲捕获功能死亡）**：几何刚度 mat-vec 把
  (K_G·v)_a = Σ_b (G_a·∇N_b)·v_b 错写为行 b 累加——由 Q1 单位分解 Σ∇N ≡ 0 整体恒零，
  tangent='geo' 自上线起与 'elastic' 逐位同效（bugs §一.15）。修复后 geo 为正确可用的
  可选项；受压下 geo 增广算子失去 SPD 性，Jacobi-PCG 鲁棒性受限——收敛域实验
  （probe_geo_fix.mjs）实测 R=6 gyroid maxStrain≤0.012 档全步收敛。

## 定案

- **求解器默认切线 'geo'→'elastic'，数字孪生 wrapper 同步**：残差侧几何项恒在——真实
  StVK 平衡/坍塌物理不受切线选择影响（v1.0.2 的坍塌检测/DT-GA 结果本就等效 elastic
  口径）；elastic 切线是最鲁棒的修正牛顿口径。geo 保留为正确可用的可选项。

## 门禁

- **gpu_plasticity_audit 55→57**（E 组重校三重钉）：
  a) elastic/geo 双口径全步收敛（温和应变档）；
  b) 终态反力一致 ≤1%（切线影响路径不影响收敛解——matvec 正确性）；
  c) **geo 活性钉：迭代路径分叉**（死 geo 与 elastic 逐位同路径必同迭代数——防回退死代码）。

## 验证

tsc 0 错 · 门 27 57/57 · 门 28 24/24 · card_smoke 14/14 · 三套 UI 门禁 7/6/23 ·
**44/44 门全量（三平台 CI）** · 浏览器压溃 k1 完整结果复验（坍塌@ε=2.0%·DT/GA=0.87·10s）。
