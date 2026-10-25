# 试样索引（ISO 13314 上机用）

**现行 32 件可打印** = 8 组设计 × 每组 4 件（基件 + `_r1..r3` 重复样）。
全部 k8 · R96 · solid_network，配套 JSON sidecar 与构建日志（`.err`）。
打印与压缩规程见 `docs/LAB_ONE_PAGER.md`。

| 组 | 曲面 | 目标孔隙率 | 状态 |
|---|---|---|---|
| S1_G60 | gyroid | 60% | ✅ `S1_G60.stl` + `_r{1,2,3}` |
| S2_G75 | gyroid | 75% | ✅ `S2_G75.stl` + `_r{1,2,3}` |
| S3_D60 | diamond | 60% | ✅ `S3_D60.stl` + `_r{1,2,3}` |
| S4_D75 | diamond | 75% | ✅ `S4_D75.stl` + `_r{1,2,3}` |
| S5_FK60 | fcky | 60% | ✅ `S5_FK60.stl` + `_r{1,2,3}` |
| S6_FK75 | fcky | 75% | ✅ `S6_FK75.stl` + `_r{1,2,3}` |
| S7_B65 | strutbcc 桁架（**真 BCC 场**） | 65% | ✅ 2026-10-11 真场重生成（0.19pp·水密·4 件逐位确定） |
| S8_O65 | strutoctet 桁架（**真 Octet 场**） | 65% | ✅ 2026-10-11 焊接解锁后重生成（0.88pp·水密·4 件逐位确定 40.3MB） |

## S7 桁架对照组（2026-10-11 真场版）

与 TPMS 组构成"桁架 vs 隐函数曲面"力学对照（BCC 弯曲主导 vs TPMS 连续曲面）；
实测 E 可直接检验平台代理标定值（strutbcc C1=0.06 文献域中值）。
现文件为 **G1-G5 修复后的真 BCC 桁架**（孔隙率实测 0.6519，偏差 0.19pp；
嵌合体时代旧件偏差 4.4pp）。生成走
`node tpms/agent/export-specimens.mjs --only S7`（基件另加 `--once`）。

## S8 焊接解锁（2026-10-11 同日）

真 Octet 的 12 杆结点处 Newton 投影把薄 feature 两侧的胞质心拉到同一表面点附近 →
亚格距短边被 4 个 sliver 三角共享 = 非流形（曾全分辨率/杆径域无水密窗）。根治 =
**非流形短边焊接**（surface-nets 9b，strut 门控：只焊使用次数≠2 的边，流形边永不动）——
k8 R96 实测 nm 190656→0，四件重生成水密（孔隙率 0.6588，偏差 0.88pp，42.2MB/件，
逐位确定）。S7 无需重生成（bcc 本就 nm=0，焊接 no-op，sha256 字节级不变已实证）。

## 嵌合体时代归档

`archive-chimera-2026-10-11/` 内为 S7/S8 全部旧件——提取场分派缺陷时代的 **schwarz
混合几何**（非桁架，不得上机或引用其数字）；原始哈希见 `docs/POLISHING_BASELINE.json`。

## 推荐顺序

先打 **S1_G60**（gyroid·60%——水密性与打印性最稳的一组）走通全流程（端板布尔合并 →
压缩 → CSV 回传 `fit-batch`），再按 60%→75%、gyroid→diamond→fcky 扩展——孔隙率升高与
fcky 族的壁更薄，后打可把前面积累的参数经验用在难的件上。桁架组 S7 排最后（对照组
不阻塞主线）。

## 回传

CSV 命名 `{S#}_{rep}_{date}.csv` 放入 `specimens/csv/`，然后（AI 侧接手）：

```bash
node tpms/agent/fit-batch.mjs   # 真实内核（experimental-fit 同源）；CSV 需 # 三尺寸元数据行
                                # （模板见 PHYSICAL_TESTING_PROTOCOL §六）；正式 ISO 以工程版
                                # 「试验曲线反演」复核为准（UI 可自动预填 L₀/A₀）
```
