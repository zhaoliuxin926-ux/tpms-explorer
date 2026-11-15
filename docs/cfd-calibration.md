# CFD 标定线 — TPMS gyroid K(ε) 幂律（通透池压差驱动口径）

> 与 docs/fea-calibration.md（FEA 力学线）平行的 CFD 渗透率标定权威文档。数据真源：sim/cfd/tpms_cell/K_scan_result.json（k1 单胞）+ k2_scan_result.json（k2 双胞入口效应对照）。

## 口径（先读）

- **链路**：p3_fluid_domain R48 STL → strip_caps 剔端盖 → snappyHexMesh lvl2 无棱（定案参数）→ 通透池压差驱动（x 两端 Dirichlet，y/z 壁面）→ foamRun incompressibleFluid → K = ε·Ubar/(ΔP/L)
- **梯度口径**：ΔP/L = 5.089/2π = 0.8099 mm/s²（mm 制，ν=1 mm²/s）
- **单位**：K [mm²]；Ubar 由 volFieldValue 全域平均反读

## K(ε) 四点实测表（k1 单胞口径）

| 目标孔隙率 | ε 实测 | K_cell (mm²) | KC 对照 (mm²) | CFD/KC |
|---|---|---|---|---|
| 50 | 0.4990 | 0.05212 | 0.02714 | 1.92 |
| 60 | 0.5999 | 0.08942 | 0.04095 | 2.18 |
| 70 | 0.7005 | 0.14590 | 0.05904 | 2.47 |
| 80 | 0.8019 | 0.23527 | 0.08179 | 2.88 |

幂律拟合：**K = 0.461·ε^3.17（R²=0.998）**——指数与 KC 的 ε³ 同族微陡（喉道效应）。

## 入口效应修正（k2 双胞对照，2026-11-15 四点实测定案）

- 同链同梯度唯一变量=胞数：k2 双胞 [0,4π]×[0,2π]² 对照 k1 [0,2π]³
- 四点入口效应：p50 −4.0% / p60 −3.75% / p70 −4.26% / p80 −4.22%——**窄带 −4.26~−3.75%（均值 −4.06%），端部效应与孔隙率基本无关**
- **统一修正因子 0.9594**（K_true = K_cell × 0.9594）；单胞口径高估机制=Dirichlet 端部低压降伪影在 1 周期域占比过半
- **适用边界**：同链+R48 STL 网格档内有效；升 lvl3 或换驱动口径时端部伪影不同步收敛，**0.9594 不可跨档引用**（跨档需重做 k1/k2 对照）

## 修正后交付口径（CSV 契约消费）

| ε 实测 | K_true (mm²) = K_cell×0.9594 |
|---|---|
| 0.4990 | 0.04998 |
| 0.5999 | 0.08580 |
| 0.7005 | 0.13996 |
| 0.8019 | 0.22578 |

幂律（修正后）：K_true = 0.442·ε^3.17（指数不变，幅值 ×0.9594）。

## 复现

```
# k1 单胞全族
wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_K_scan.sh
# k2 双胞对照（p60 单案 + p50/70/80 全族）
wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_k2.sh
wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_k2_scan.sh
# STL 再生（不入库，sim/.gitignore *.stl）
python sim/p3_fluid_domain.py --k 2 --R 48 --por 0.60 --out <raw.stl>
python sim/cfd/tpms_cell/strip_caps.py <raw.stl> <k2.stl>
```
