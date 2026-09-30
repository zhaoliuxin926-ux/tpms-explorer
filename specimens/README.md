# 试样索引（ISO 13314 上机用）

24 件 = 6 组设计 × 每组 4 件（基件 + `_r1..r3` 重复样）。全部 k8 · R96 · solid_network，
配套 JSON sidecar 与构建日志（`.err`）。打印与压缩规程见 `docs/LAB_ONE_PAGER.md`。

| 组 | 曲面 | 目标孔隙率 | 文件 |
|---|---|---|---|
| S1_G60 | gyroid | 60% | `S1_G60.stl` + `S1_G60_r{1,2,3}.stl` |
| S2_G75 | gyroid | 75% | `S2_G75.stl` + `_r{1,2,3}` |
| S3_D60 | diamond | 60% | `S3_D60.stl` + `_r{1,2,3}` |
| S4_D75 | diamond | 75% | `S4_D75.stl` + `_r{1,2,3}` |
| S5_FK60 | fcky | 60% | `S5_FK60.stl` + `_r{1,2,3}` |
| S6_FK75 | fcky | 75% | `S6_FK75.stl` + `_r{1,2,3}` |

## 推荐顺序

先打 **S1_G60**（gyroid·60%——水密性与打印性最稳的一组）走通全流程（端板布尔合并 →
压缩 → CSV 回传 `fit-batch`），再按 60%→75%、gyroid→diamond→fcky 扩展——孔隙率升高与
fcky 族的壁更薄，后打可把前面积累的参数经验用在难的件上。

## 回传

CSV 命名 `{S#}_{rep}_{date}.csv` 放入 `specimens/csv/`，然后（AI 侧接手）：

```bash
node tpms/agent/fit-batch.mjs   # 示意拟合；正式 ISO 以工程版「试验曲线反演」复核为准
```
