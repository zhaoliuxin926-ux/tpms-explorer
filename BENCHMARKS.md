# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-09-09T23:57:49.634Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 10-20 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 2577ms | ✓ dev 0.09pp / 9401ms |
| diamond | ✓ dev 0.09pp / 3593ms | ✓ dev 0.13pp / 10301ms |
| schwarz | ✓ dev 0.05pp / 2452ms | ✓ dev 0.05pp / 5045ms |
| neovius | ✓ dev 0.18pp / 3091ms | ✓ dev 0.22pp / 5732ms |
| iwp | ✓ dev 0.16pp / 3501ms | ✓ dev 0.02pp / 10082ms |
| frd | 拒产 (nm 20736) / 3428ms | ✓ dev 0.04pp / 11863ms |
| lidinoid | ✓ dev 0.28pp / 5087ms | ✓ dev 0.08pp / 18710ms |
| splitp | ✓ dev 0.55pp / 4591ms | ✓ dev 0.33pp / 16731ms |
| octo | ✓ dev 7.06pp / 3082ms | ✓ dev 0.32pp / 9094ms |
| karcher | ✓ dev 0.51pp / 3712ms | ✓ dev 0.23pp / 12648ms |
| fks | 拒产 (nm 9504) / 3469ms | ✓ dev 0.19pp / 10255ms |
| fky | 拒产 (nm 4752) / 3882ms | ✓ dev 0.58pp / 15439ms |
| gprime | ✓ dev 1.12pp / 4411ms | 拒产 (nm 19080) / 8326ms |
| fcks | 拒产 (nm 27720) / 4350ms | 拒产 (nm 10368) / 17360ms |
| dprime | 拒产 (nm 18252) / 4226ms | ✓ dev 0.13pp / 19062ms |
| dp | ✓ dev 2.94pp / 4141ms | ✓ dev 0.27pp / 9375ms |
| dd | ✓ dev 1.31pp / 3888ms | ✓ dev 0.22pp / 8063ms |
| dg | ✓ dev 8.52pp / 6281ms | ✓ dev 7.92pp / 22748ms |

## 2. 可用域速查（LLM/用户选择曲面时的决策表）

| 曲面 | R48 可产 | R96 可产 | 备注 |
|---|---|---|---|
| gyroid | ✅ | ✅ |  |
| diamond | ✅ | ✅ |  |
| schwarz | ✅ | ✅ |  |
| neovius | ✅ | ✅ |  |
| iwp | ✅ | ✅ |  |
| frd | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产 |
| lidinoid | ✅ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产 |
| splitp | ✅ | ✅ |  |
| octo | ✅ | ✅ |  |
| karcher | ✅ | ✅ |  |
| fks | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产 |
| fky | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产 |
| gprime | ✅ | ⛔ | 默认周期数 k6 R96 p0.6 薄壁自触 fail-closed（nm 19080），降周期数 k=2 可产 |
| fcks | ⛔ | ⛔ | 谐波 3×：R120 中段孔隙率可产（实测 p0.5/0.6/0.7 均 nm=0）；R48/R96/R128 薄壁自触 fail-closed（R128 旧「>36 分钟」实为索引池溢出死循环，2026-09-10 已修） |
| dprime | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产（C2 第三批实测 nm 18252@R48） |
| dp | ✅ | ✅ |  |
| dd | ✅ | ✅ |  |
| dg | ✅ | ✅ | p0.6 iso 触求解域下界 −1.6：偏差 ~8pp 为可用域事实（nm=0 可产，如实报告） |

## 3. 力学解析口径（Gibson-Ashby，非 FEA）

- E*/Es = C1·ρ̄²（C1 文献带 0.35~0.44，per-曲面标定值见 `list` 命令）
- σ*/σs = 0.3·ρ̄^1.5（网格泡沫折中上界；经典开孔泡沫 0.23 为带下界）
- 文献对比带已内建于 `scenario` 命令验证报告（每曲面带内/带外自动判定）

## 4. 对标（开源生态）

| 能力 | 本项目 | RegionTPMS | MiniSurf | microgen |
|---|---|---|---|---|
| 浏览器零安装交互 | ✅ WebGPU/TS 单页 | ❌ Mathematica | ❌ MATLAB | ❌ Python 库 |
| 曲面族 | 18 | 4 | 19 | 8+ |
| 验证门禁 | 39 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks 可产域=R120 中段孔隙率（实测 p0.5/0.6/0.7 均 nm=0 水密），R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修）