# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-09-11T05:34:47.716Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 10-20 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 3198ms | ✓ dev 0.09pp / 9212ms |
| diamond | ✓ dev 0.09pp / 3219ms | ✓ dev 0.13pp / 10524ms |
| schwarz | ✓ dev 0.05pp / 2588ms | ✓ dev 0.05pp / 4462ms |
| neovius | ✓ dev 0.18pp / 2914ms | ✓ dev 0.22pp / 5140ms |
| iwp | ✓ dev 0.16pp / 3319ms | ✓ dev 0.02pp / 10134ms |
| frd | 拒产 (nm 20736) / 3157ms | ✓ dev 0.04pp / 11629ms |
| lidinoid | ✓ dev 0.28pp / 5525ms | ✓ dev 0.08pp / 17399ms |
| splitp | ✓ dev 0.55pp / 4418ms | ✓ dev 0.33pp / 16056ms |
| octo | ✓ dev 7.06pp / 2827ms | ✓ dev 0.32pp / 8785ms |
| karcher | ✓ dev 0.51pp / 3574ms | ✓ dev 0.23pp / 12429ms |
| fks | 拒产 (nm 9504) / 3350ms | ✓ dev 0.19pp / 8856ms |
| fky | 拒产 (nm 4752) / 3225ms | ✓ dev 0.58pp / 14123ms |
| gprime | ✓ dev 1.12pp / 4239ms | 拒产 (nm 19080) / 7408ms |
| fcks | 拒产 (nm 27720) / 3914ms | 拒产 (nm 10368) / 15104ms |
| dprime | 拒产 (nm 18252) / 3947ms | ✓ dev 0.13pp / 17045ms |
| dp | ✓ dev 2.94pp / 3791ms | ✓ dev 0.27pp / 8710ms |
| dd | ✓ dev 1.31pp / 3508ms | ✓ dev 0.22pp / 6888ms |
| dg | ✓ dev 8.52pp / 5566ms | ✓ dev 7.92pp / 19463ms |
| fcky | ✓ dev 0.26pp / 4014ms | ✓ dev 0.29pp / 8169ms |
| cdd | 拒产 (nm 18252) / 4110ms | ✓ dev 0.16pp / 20341ms |

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
| fcks | ⛔ | ⛔ | 谐波 3×：可产域=R120 k6（p0.5-0.7 nm=0）∪ R128 k2（nm=0，偏差 0.13pp，~9s）；k6 R48/R96/R128 薄壁自触 fail-closed——降周期数可避 |
| dprime | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产（C2 第三批实测 nm 18252@R48） |
| dp | ✅ | ✅ |  |
| dd | ✅ | ✅ |  |
| dg | ✅ | ✅ | p0.6 iso 触求解域下界 −1.6：偏差 ~8pp 为可用域事实（nm=0 可产，如实报告） |
| fcky | ✅ | ✅ |  |
| cdd | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产（nm 18252@R48） |

## 3. 力学解析口径（Gibson-Ashby，非 FEA）

- E*/Es = C1·ρ̄²（C1 文献带 0.35~0.44，per-曲面标定值见 `list` 命令）
- σ*/σs = 0.3·ρ̄^1.5（网格泡沫折中上界；经典开孔泡沫 0.23 为带下界）
- 文献对比带已内建于 `scenario` 命令验证报告（每曲面带内/带外自动判定）

## 4. 对标（开源生态）

| 能力 | 本项目 | RegionTPMS | MiniSurf | microgen |
|---|---|---|---|---|
| 浏览器零安装交互 | ✅ WebGPU/TS 单页 | ❌ Mathematica | ❌ MATLAB | ❌ Python 库 |
| 曲面族 | 20 | 4 | 19 | 8+ |
| 验证门禁 | 39 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）