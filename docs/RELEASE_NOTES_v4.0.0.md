# TPMS Explorer v4.0.0-multiphysics-inverse-design Release Notes（双语）

> 发布日期：2026-08-28 ｜ 上一版本：v3.0.0-nextgen-cae ｜ **21 道 CI 门禁 · 780+ 断言全绿**

---

## 中文

v4.0 完成「**多物理场仿真验证 → 逆向多目标设计 → 科研成果闭环**」三大跃迁。五大特性：

### 🎯 阶段 I：逆向多目标设计引擎（Inverse Design Engine）
- 零依赖双优化器：Nelder-Mead 自适应单纯形（多起点全局探索）+ Levenberg-Marquardt 阻尼最小二乘（数值 Jacobian）
- 目标泛函：E*（等值）/ κ（**下限约束**——松质骨/散热沉语义）/ P（等值）加权残差；8 类曲面外层枚举输出 Top-3
- 解剖预设库：股骨皮质骨（E*≈15 GPa）/ 股骨近端松质骨（E*+κ+P）/ 高通量散热沉（κ+P）
- UI：目标滑块 + 一键反演 + 应用最优解（自动迁移曲面类型/孔隙率/单元密度）
- 门禁 17 `inverse_design_audit`（23 断言）：10 组逆向犯罪测试 **100% 收敛、前向误差 ≤3%**
- 红测抓获两处真 bug：LM 初值 cost=0 早退（从未运行）；κ 等式语义导致 239% 伪残差（改下限约束）

### 🌀 阶段 II：庞加莱非欧双曲度规映射
- r' = 2R₀²r/(R₀²−r²)，0.95R₀ 截断处以截点斜率线性延拓——全域单射、无发散
- 门禁 18 `poincare_metric_audit`（12 断言）：det(J)>0 全域 9000 采样、径向单射、水密拓扑继承、有向边配对
- **存量 bug 修复**：非 custom 类型的 py/m 脚本导出崩溃（模板无条件插值空公式编译）——16 门从未以非 custom 导出故漏网

### 🔬 阶段 III：CAE 自动化求解与验证链
- `abaqus_auto_runner.py`（noGUI 准静态压缩 → E_FEM/σ_peak/σ_pl）+ `openfoam_auto_runner.py`（simpleFoam 达西渗流 → κ/WSS）
- 导出中心【CAE 验证脚本包】ZIP（含壳脚本 + 理论-仿真对比矩阵模板，rel_error ≤15% PASS 口径）
- 门禁 19 `cae_verification_audit`（25 断言）：脚本 ast 语法 + 内容完备 + **runner↔导出器节点集/patch 交叉核对** + FoamFile 规范

### 💥 阶段 IV：动态冲击吸能（SEA）与振动模态
- `impact-energy.ts`：σ_pl = C2·σ_ys·ρ̄^1.5 平台理想化、ε_d = 1−1.4ρ̄、SEA(J/g)、效率 η(ε)、峰值 σ_peak
- 等效梁 6 阶模态（4 弯曲+轴向+扭转），方形截面正交简并对（频率重根）由审计断言
- 门禁 20 `impact_modal_audit`（11 断言）：SEA ∈ [5,60] J/g 物理带（8 型×3 密度）、√ρ̄ 标度精确 √3

### 🩻 阶段 V：Micro-CT 体素重构与制造偏差热力图
- `ct-reconstruction.ts`：Otsu 自动阈值 + 精确 3D EDT（Felzenszwalb 可分离三趟）+ SDF 符号场
- 演示 CT（注入过充偏置 0.25mm + 表面粗糙噪声 + 层间漂移）→ 逐顶点偏差 Blue-White-Red 热力图 + 过充/欠肉/RMS 统计
- 门禁 21 `ct_reconstruction_audit`（11 断言）：EDT 暴力逐体素一致、bias 注入恢复 ≤0.1mm、偏差色值域
- 红测教训：合成 CT 灰度必须双峰（固相亮/孔隙暗）——单峰连续分布让 Otsu 偏离等值面 0.5mm

### 工程纪律
- **21 道 CI 门禁 · 780+ 断言全绿**；每阶段 commit→push→双部署；WORKFLOW_GUIDE 扩至二十章；progress.md 全程记录红测抓获的 5 处实现/断言缺陷

---

## English

v4.0 delivers **multiphysics verification, inverse multi-objective design, and a research closed loop**.

- **Stage I — Inverse Design Engine**: dependency-free Nelder-Mead + Levenberg-Marquardt over analytic Gibson-Ashby/Kozeny-Carman surrogates; κ is a LOWER-BOUND constraint (medical semantics). Gate 17: 10 inverse-crime cases, 100% convergence, forward error ≤3%.
- **Stage II — Poincaré hyperbolic mapping**: r' = 2R₀²r/(R₀²−r²) with 0.95R₀ cutoff slope-continuation (globally injective). Gate 18: det(J)>0 over 9000 samples, watertight topology inheritance. Also fixes a shipped bug: py/m script export crashed for all non-custom types.
- **Stage III — CAE verification chain**: automated Abaqus quasi-static compression and OpenFOAM Darcy-permeability runners, exported as a ZIP suite with a theory-vs-simulation comparison matrix. Gate 19: node-set/patch cross-checks against the exporters.
- **Stage IV — Impact SEA & modal estimation**: plateau-stress idealization with ε_d = 1−1.4ρ̄, specific energy absorption (J/g), and a 6-mode equivalent-beam modal set with orthogonal-pair degeneracy. Gate 20: SEA within the physical [5, 60] J/g band.
- **Stage V — Micro-CT deviation analysis**: Otsu + exact 3D EDT + signed distance field; per-vertex Blue-White-Red deviation heatmap with over-fill/under-fill/RMS statistics. Gate 21: injected 0.25 mm bias recovered within 0.1 mm.

**Quality**: 21 CI gates, 780+ assertions, 3-platform matrix. See `WORKFLOW_GUIDE.md` chapters 17–20.
