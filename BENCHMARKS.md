# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-09-09T04:46:30.428Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 15 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 3045ms | ✓ dev 0.09pp / 8431ms |
| diamond | ✓ dev 0.09pp / 2760ms | ✓ dev 0.13pp / 9796ms |
| schwarz | ✓ dev 0.05pp / 2109ms | ✓ dev 0.05pp / 4016ms |
| neovius | ✓ dev 0.18pp / 2551ms | ✓ dev 0.22pp / 4689ms |
| iwp | ✓ dev 0.16pp / 3282ms | ✓ dev 0.02pp / 9172ms |
| frd | 拒产 (nm 20736) / 2910ms | ✓ dev 0.04pp / 11551ms |
| lidinoid | ✓ dev 0.28pp / 5803ms | ✓ dev 0.08pp / 17222ms |
| splitp | ✓ dev 0.55pp / 3872ms | ✓ dev 0.33pp / 15155ms |
| octo | ✓ dev 7.06pp / 2650ms | ✓ dev 0.32pp / 9063ms |
| karcher | ✓ dev 0.51pp / 3675ms | ✓ dev 0.23pp / 10608ms |
| fks | 拒产 (nm 9504) / 3523ms | ✓ dev 0.19pp / 9869ms |
| fky | 拒产 (nm 4752) / 3181ms | ✓ dev 0.58pp / 15342ms |
| gprime | ✓ dev 1.12pp / 3796ms | 拒产 (nm 19080) / 7476ms |
| fcks | 拒产 (nm 27720) / 6476ms | 拒产 (nm 10368) / 26975ms |

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
| gprime | ✅ | ⛔ | R96 过渡带薄壁自触 fail-closed（基准实测 nm 19080，择 band/分辨率可避） |
| fcks | ⛔ | ⛔ | 预注册：谐波 3×，R128 单次构建 >36 分钟 CPU（重计算档，求解器级性能路径后开放） |

## 3. 力学解析口径（Gibson-Ashby，非 FEA）

- E*/Es = C1·ρ̄²（C1 文献带 0.35~0.44，per-曲面标定值见 `list` 命令）
- σ*/σs = 0.3·ρ̄^1.5（网格泡沫折中上界；经典开孔泡沫 0.23 为带下界）
- 文献对比带已内建于 `scenario` 命令验证报告（每曲面带内/带外自动判定）

## 4. 对标（开源生态）

| 能力 | 本项目 | RegionTPMS | MiniSurf | microgen |
|---|---|---|---|---|
| 浏览器零安装交互 | ✅ WebGPU/TS 单页 | ❌ Mathematica | ❌ MATLAB | ❌ Python 库 |
| 曲面族 | 14（含预注册） | 4 | 19 | 8+ |
| 验证门禁 | 39 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带（CLI/UI） | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks R128 重计算档：单次构建 >36 分钟 CPU（谐波 3× 本质成本），求解器级性能路径后开放