# 上机操作卡（一页）

> 配套 `PHYSICAL_TESTING_PROTOCOL.md` 全文；本卡供打印工位使用。产品 **v1.0.3**。

## 打印

| 项 | 值 |
|---|---|
| 试样 | `specimens/S*_r{1,2,3}.stl`（`export-specimens.mjs`） |
| 端板 | **不进 STL**；切片软件加 2.0 mm 实心立方 ×2 布尔合并 |
| 材料建议 | PLA/TC4 按 protocol §二；记录实际丝材/粉末批次 |
| 层高 | 0.12–0.2 mm；记录实际值 |
| 摆放 | 竖直（加载轴 = 打印 Z） |

## 压缩（ISO 13314）

| 项 | 值 |
|---|---|
| 速率 | ε̇ = 1×10⁻³ s⁻¹ → v = ε̇ · H × 60 mm/min |
| H | 芯体 8 mm + 端板 2×2 mm = **12 mm** → **v ≈ 0.72 mm/min** |
| 采集 | 位移-载荷 CSV ≥10 Hz |
| 命名 | `{S#}_{rep}_{date}.csv` 例 `S1_r2_20260923.csv` |

## 称重孔隙

m 总质量（0.001 g）→ protocol §五 公式（端板修正）→ 记入 CSV 旁 `.note`

## 回传

1. CSV 放入 `specimens/csv/`
2. `node tpms/agent/fit-batch.mjs` → `docs/fit-report.md`
3. 与平台数字孪生/Gibson-Ashby 预测对标（protocol §六）
