# 上机操作卡（一页）

> 配套 `PHYSICAL_TESTING_PROTOCOL.md` 全文；本卡供打印工位使用。产品 **v1.2.0**。

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
| 速率 | ε̇ = 1×10⁻³ s⁻¹ → v = ε̇ · H × 60 mm/min（**H 按实际打印档取值**） |
| H₀ 档 | 12 mm（1:1 芯体 8+端板 4）→ **0.72 mm/min** ｜ **24 mm（×2.5 芯体 20+端板 4，S1_G60 推荐档）→ 1.44 mm/min** ｜ 34 mm（×3.75 芯体 30+端板 4）→ **2.04 mm/min** |
| 采集 | 位移-载荷 CSV ≥10 Hz |
| 命名 | `{S#}_{result}_{repeat}.csv` 例 `S1_G60_r1.csv`（与 protocol §六 一致） |

## 称重孔隙

m 总质量（0.001 g）→ protocol §五 公式（端板修正）→ 记入 CSV 旁 `.note`

## 回传

1. CSV 放入 `specimens/csv/`；**首部加三行卡尺实测元数据（fit-batch 缺失即拒算）**——
   照 protocol §六 模板：`# lengthMm=24` / `# widthMm=20` / `# thicknessMm=20`
   （数值按本件实测填，lengthMm=含端板总高 H₀）
2. `node tpms/agent/fit-batch.mjs` → `docs/fit-report.md`（experimental-fit 真实内核，2026-10-20 起；H₀ 档位 {12,24,34}±1 越档照算+告警；εd 有效性/W 积分终点/样本 CV 口径见报告头，2026-10-24）
3. **必须**在工程版「试验曲线反演」复核后再写报告（勾「位移-载荷」上传 CSV——带元数据行时 **L₀/A₀ 自动预填**，无需手填；越档有 ⚠ 兜底）
4. 与平台数字孪生/Gibson-Ashby 预测对标（protocol §六）
