# 物理试样备料与压缩试验协议（ISO 13314 对齐）

> 生成：2026-09-13 ｜ 配套：v8.0.0-agentic-loop（exact 孔隙率求解器）｜ 试样 STL 已导出至本地 `specimens/`（~228MB，gitignored，不入库）
> 目的：ROADMAP C3 物理闭环第一步——数字孪生/Gibson-Ashby 预测接受真实压缩试验检验；CSV 数据将馈入 v9 experimental-fit 反演（规划中）。

## 一、试样矩阵（6 构型 × 建议 3 重复件 = 18 件）

**统一构型**：periods k=8（8×8×8 mm 点阵芯体）+ 上下实心端板各 2.0 mm（切片软件内添加，见 §3）
**统一工艺参数**：R=96（12 体素/周期——实测水密甜点：k10@R96/R128 均触发薄壁自触拒产，k8@R96 全部一次通过）

| 编号 | 曲面族 | 目标孔隙率 | 实测孔隙率* | 偏差 | 三角面数 | 特点与测试意图 |
|---|---|---|---|---|---|---|
| S1-G60 | gyroid | 60% | **60.11%** | 0.11pp | 727,776 | 弯曲主导连续骨架基准 |
| S2-G75 | gyroid | 75% | **75.08%** | 0.08pp | 612,864 | 高孔隙仿生骨小梁 |
| S3-D60 | diamond | 60% | **60.42%** | 0.42pp | 899,616 | 拉伸主导对照 |
| S4-D75 | diamond | 75% | **74.01%** | 0.99pp | 672,672 | 薄壁屈曲失效模式 |
| S5-FK60 | fcky | 60% | **60.30%** | 0.30pp | 1,010,400 | C2 扩展族低谐波健壮锚点 |
| S6-FK75 | fcky | 75% | **74.97%** | 0.03pp | 850,848 | 扩展族高孔隙压溃验证 |

\* 网格实测口径（发散定理），R96 k8 端到端构建；导出 JSON 同存 `specimens/*.json`。

## 二、导出命令（已执行；长旗标——CLI 无短旗标形式）

```bash
node tpms/agent/tpms.mjs mesh --type gyroid  --porosity 0.6  --resolution 96 --periods 8 --out specimens/S1_G60.stl
node tpms/agent/tpms.mjs mesh --type gyroid  --porosity 0.75 --resolution 96 --periods 8 --out specimens/S2_G75.stl
node tpms/agent/tpms.mjs mesh --type diamond --porosity 0.6  --resolution 96 --periods 8 --out specimens/S3_D60.stl
node tpms/agent/tpms.mjs mesh --type diamond --porosity 0.75 --resolution 96 --periods 8 --out specimens/S4_D75.stl
node tpms/agent/tpms.mjs mesh --type fcky    --porosity 0.6  --resolution 96 --periods 8 --out specimens/S5_FK60.stl
node tpms/agent/tpms.mjs mesh --type fcky    --porosity 0.75 --resolution 96 --periods 8 --out specimens/S6_FK75.stl
```

注意：CLI 输出为**二进制 STL（mm）**；3MF 导出在平台 UI 侧（工程版导出中心）。切片机（Bambu Studio 等）直接读 STL，无需转格式。

## 三、切片与端板

1. **端板不进 STL**：CLI 无 --endplate 旗标（端板融合为平台 UI/INP 路径特性）。切片软件内添加 2.0 mm 实心立方体 ×2，与点阵上下面对齐做布尔合并——打印质量优于网格融合端板，厚度可调。
2. **打印尺寸缩放**：STL 原生 8×8×8 mm 点阵。缩放不改变孔隙率与相对密度（自相似缩放，Gibson-Ashby 口径 E*/Es、σ*/σs 不变，仅胞元尺寸增大）。推荐：
   - 直接打印 12×12×12（8 胞 1.5 mm 胞元）——最小可用；
   - 缩放 ×2.5 → 20×20×20（胞元 2.5 mm）——推荐档；
   - 缩放 ×3.75 → 30×30×30（胞元 3.75 mm）——若设备成形精度允许。
3. **ISO 13314 胞元数偏离声明**：ISO 建议试样每向 ≥10 个完整单胞；k=8 为 8 胞（平台可产域与水密裕度的折中——k10 以上在目标孔隙率触发亚体素薄壁自触拒产）。作为对比性研究可接受，需在报告中如实标注。

## 四、压缩试验执行规约

1. **应变速率**：目标准静态 ε̇ = 1×10⁻³ s⁻¹（ISO 13314 通用口径）。按试样总高 H 折算压头速率 v = ε̇·H×60 mm/min：

| 试样状态 | 总高 H（含 2×2mm 端板） | v（ε̇=1e-3/s） |
|---|---|---|
| 原生 8mm 点阵 | 12 mm | 0.72 mm/min |
| 缩放 ×2.5 | 30 mm | 1.80 mm/min |
| 缩放 ×3.75 | 45 mm | 2.70 mm/min |

2. **停机条件**：工程应变 ε = 50%，或载荷骤升（密实化段，载荷-位移曲线斜率数量级跃升）。
3. **预载与对中**：≤5% 名目应变的接触对中预载；记录初始接触刚度（Toe 区，供 experimental-fit 预载松弛补偿）。
4. **采集**：位移-载荷 CSV，采样 ≥10 Hz；同时记录时间列（可选）。

## 五、实测孔隙率换算（称重法，端板修正）

```
φ_lattice = 1 − (m − ρ_s·V_plates) / (ρ_s·V_lattice)

  m          = 试样总质量（天平，0.001 g）
  ρ_s        = 打印材料实心密度（PLA 1.24 / PLA-CF 1.29 / 树脂按说明书 / TC4 4.43 g/cm³）
  V_plates   = 2 × A × t_plate （A=实测截面，t=端板厚；卡尺 0.02mm）
  V_lattice  = A × H_lattice （H_lattice = 总高 − 2·t_plate，按打印后实测）
```

对比三角面：网格实测孔隙率（§一表）↔ 称重孔隙率——两者差值即"打印增益/缺陷"（欠挤出、空洞、翘曲），是 LPBF/光固化工艺质量的直接读数。

## 六、数据交付格式（对接 v9 experimental-fit）

每试样一份 CSV，列：`displacement_mm,force_N[,time_s]`；命名 `S{n}_{result}_{repeat}.csv`（如 S1_G60_r1.csv）。
配套记录：材料牌号/批次、打印参数（层高/喷嘴/固化）、实测尺寸与质量、环境温湿度。

## 七、预期对标量（平台侧预测，试验后回填实测）

| 量 | 平台口径 | 备注 |
|---|---|---|
| 平台应力 σ_pl | Gibson-Ashby σ*/σs = 0.3·ρ̄^1.5（解析估算，非 FEA） | 与 ISO 13314 平台应力（20-40% 应变均值）对标 |
| 初始模量 E* | E*/Es = C1·ρ̄²（C1 按曲面族各向异性比） | 与 quasi-elastic gradient 对标 |
| 压溃数字孪生 | 体素 FEM，DT/GA ≈1.7-2.0 偏刚披露带 | 体素离散偏刚属离散属性——本试验用于**标定收窄**该带并量化不确定度 |
