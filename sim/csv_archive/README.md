# `sim/csv_archive/` 全量标定与盲测压缩曲线谱系清单

> **生成日期**：2026-11-16 ｜ **索引生成引擎**：`tpms-platform/src/physics/experimental-fit.ts`（ISO 13314:2011） ｜ **归档总数**：37 条 CSV（其中达到 $\varepsilon \ge 0.40$ 并完成 ISO 13314 全特征提取者 **5** 条；其余为 5% 线弹性静态盲测或大变形截断历史曲线）

## 一、量纲与口径分层说明（严防尺寸混算）

| 谱系分类 | 文件数 | 典型试样尺寸 | 基体材料口径 | 说明 |
|---|---:|---|---|---|
| `T4_blind_validation_8mm_Es2000MPa` | 2 | 8.0 × 8.0 × 8.0 mm ($k=2, a=4$ mm) | $E_s = 2000$ MPa, $\nu = 0.3$ | 2026-11 独立 blind FEA 曲线（`bf3b60e` 清理 10.2 GB ODB 后由此归档永存） |
| `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 10 | 12.5664 mm ($2\pi k=2$) | 标定基体 $E_s = 2000$ MPa (无量纲基准) | Explicit 塑性压溃与屈服/平台双幂律标定档案 |
| `ABAQUS_Standard_RVE_calibration` | 25 | 12.5664 mm ($2\pi k=2$) | 标定基体 $E_s = 2000$ MPa (无量纲基准) | Standard 准静态刚度与网格收敛早期标定曲线 |

## 二、全量 37 条归档曲线明细与特征指标

| 文件名 | 分类 | 试样边长 (mm) | $\varepsilon_{\max}$ | 线性 $E$ (MPa) | ISO $E^*$ (MPa) | $R_{p0.2}$ (MPa) | $\sigma_{\text{pl}}$ (MPa) | SHA256-16 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `d60_p50_base.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `d60_p50_fixv3.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 373.2 | — | — | — | `c74bd20f0d7c0f57` |
| `d60_p50_rebase.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 373.2 | — | — | — | `259a60b82298ae6b` |
| `d60ex_p50.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `d60ex_p50dense.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `d60ex_p50fine.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `d60ex_p60.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.450 | 219.7 | 219.7 | 4.8 | 8.1 | `65b4ff4f8102bd88` |
| `d60ex_p70.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.450 | 118.6 | 118.6 | 2.9 | 4.5 | `e396961d13ec81a9` |
| `d60le_p50.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 373.3 | — | — | — | `f276fcfb50f86ca8` |
| `d60le_p60.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 224.6 | — | — | — | `2ba2e7318ed52883` |
| `d60le_p70.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 121.3 | — | — | — | `f59725d5d0cd6ec7` |
| `dc_e50.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_e70.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_expl.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_k1.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p2v2.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p2v3.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p2v4.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p30.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p30s.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p45f.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `dc_p45s.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `diamond_k2_p50_fix.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `g60ex_k1.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.225 | 65.7 | — | — | — | `2ca0d7dba519b1ba` |
| `g60ex_p50.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.450 | 351.5 | 351.5 | 7.3 | 16.8 | `356aef7761d43961` |
| `g60ex_p70.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.450 | 115.2 | 115.2 | 2.6 | 4.9 | `1883cc736b0c8254` |
| `g60le_p50.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 425.4 | — | — | — | `62d03567f67c81f3` |
| `g60le_p70.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 135.1 | — | — | — | `67a05c9bf123cb65` |
| `g60le_p70R32.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 137.4 | — | — | — | `5f486857e5d3a0a5` |
| `gyroid_k2_p60_expl.csv` | `ABAQUS_Explicit_k2_12.5664mm_Es2000MPa` | 12.5664 | 0.450 | 221.6 | 221.6 | 4.7 | 10.0 | `dce2470f59df5e63` |
| `gyroid_k2_p60_p30.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.172 | 230.2 | — | — | — | `c13fe5e2e754257a` |
| `gyroid_k2_p60_p30s.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.000 | — | 守卫拦截/不适用 | — | — | `48751f6370f40383` |
| `gyroid_k2_p60_p45f.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.179 | 220.3 | — | — | — | `8cddb3d5eb5e4aa7` |
| `gyroid_k2_p60_p45s.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.208 | 220.3 | — | — | — | `b0a6bd281d998c8a` |
| `gyroid_k2_p60_static.csv` | `ABAQUS_Standard_RVE_calibration` | 12.5664 | 0.020 | 265.6 | — | — | — | `36d014bb637ccc99` |
| `tpms_gyroid_k2_R20_p50_LE_curve.csv` | `T4_blind_validation_8mm_Es2000MPa` | 8.0 | 0.050 | 425.0 | — | — | — | `910998d1cddaa7d7` |
| `tpms_gyroid_k2_R20_p70_LE_curve.csv` | `T4_blind_validation_8mm_Es2000MPa` | 8.0 | 0.050 | 138.3 | — | — | — | `3e8ecd7656f7b711` |
