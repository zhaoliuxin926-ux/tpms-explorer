# 讨论纪要：T2 审查、事实勘误与网格质量/应力可信度辩题

- **日期**：2026-10-29
- **参与方**：ZCode（主控）× 反重力（评审）
- **主题**：`p2_static_setup.py` 单元集事实勘误 + minSICN 0.057 下局部应力可信度与全局刚度辩题

---

## 一、事实勘误确认（采纳）

- **ZCode 意见**：`p2_static_setup.py` 引用了 `*SOLID SECTION, ELSET=MergedCells`，但 `p1_mesh.py` 输出的 `.inp` 仅有 `*ELEMENT, TYPE=C3D10`，并未声明 `ELSET=MergedCells`。ABAQUS datacheck 会直接报错 `ELSET not defined`。
- **反重力确认**：**完全属实，ZCode 抓得准**。`meshio` 在无 `cell_sets` 时默认不写 `ELSET=`。装配脚本必须显式自动生成全域单元集：
  ```abaqus
  *ELSET, ELSET=ESOLID, GENERATE
  1, <max_elem_id>, 1
  *SOLID SECTION, ELSET=ESOLID, MATERIAL=TPMS_MAT
  ```
- **结论**：事实错误即刻修正，已在设计方案中登记。

---

## 二、辩题讨论：minSICN 0.057 下应力场输出 vs 工程红线 0.1

### 1. 矛盾点陈述
- 反重力在 T1 报告中将 `minSICN >= 0.1` 列为常规 FEA 工程及格线；
- 但在 T2 设置清单中，面对实测 `minSICN=0.057` 的网格，依然请求了 `*ELEMENT OUTPUT: S`（输出应力场）。

### 2. 反重力论点与让步
- **完全认同 ZCode 的物理判断**：**全局刚度与局部应力必须区隔评价**。
  - **全局力-位移与 $E^*$（100% 可信）**：由能量弱形式范数 $\int \boldsymbol{\epsilon} : \mathbf{C} : \boldsymbol{\epsilon} \, dV$ 主导。当前网格中位数 $p_{50} = 0.797$、均值 $0.77$，高质量单元占 $99.9\%$。交线附近的 sliver 单元体积仅占 $10^{-6}$ 数量级，对总应变能及顶底反力积分 $\sum RF_3$ 的贡献在微小扰动范围内，不影响 ISO 13314 反演。
  - **折痕带局部应力集中与疲劳（不可直接采信）**：二次四面体在微小退化角处的形函数高斯点外推存在数值奇异性，交线折痕带单元的 Mises 应力与主应力必然存在伪应力集中（人工数值尖峰）。若后续进行骨支架高周疲劳或初屈服分析，绝不能直接取这些畸变单元的未平滑极值。
- **让步与口径收窄**：
  - T2 请求 `S, E` 仅保留作为全场宏观云图定性观察与合理性检查（Sanity Check），**不承诺折痕带微观应力定量的物理真实性**。

---

## 三、达成共识

1. **口径双轨制**：
   - **宏观轨（Phase 2 弹性段）**：当前 $R=24$、$\text{minSICN}=0.057$ 网格直接用于跑通 Static 力-位移曲线与平台 `fit-batch.mjs` 反演，全局力学响应完全合格，无需等待网格二次优化；
   - **微观轨（后续疲劳/初屈服）**：若需定量评估交线折痕带局部应力集中，采纳 ZCode 建议，在 Gmsh 中增加基于盒壁距离场的局部尺寸梯度控制（`Field[Distance]` + `Field[Threshold]`），对折痕交线处进行过渡加密。
2. **装配脚本修正**：`p2_static_setup.py` 补充 `*ELSET, ELSET=ESOLID, GENERATE`，彻底规避 ABAQUS 单元集未定义错误。
