# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-09-12T17:00:24.553Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 10-20 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 2976ms | ✓ dev 0.09pp / 8923ms |
| diamond | ✓ dev 0.09pp / 3316ms | ✓ dev 0.13pp / 10355ms |
| schwarz | ✓ dev 0.05pp / 2221ms | ✓ dev 0.05pp / 4267ms |
| neovius | ✓ dev 0.18pp / 2858ms | ✓ dev 0.22pp / 5291ms |
| iwp | ✓ dev 0.16pp / 3194ms | ✓ dev 0.02pp / 8766ms |
| frd | 拒产 (nm 20736) / 3186ms | ✓ dev 0.04pp / 10929ms |
| lidinoid | ✓ dev 0.28pp / 5792ms | ✓ dev 0.08pp / 16835ms |
| splitp | ✓ dev 0.55pp / 4523ms | ✓ dev 0.33pp / 15471ms |
| octo | ✓ dev 7.06pp / 2890ms | ✓ dev 0.32pp / 8780ms |
| karcher | ✓ dev 0.51pp / 3546ms | ✓ dev 0.23pp / 11524ms |
| fks | 拒产 (nm 9504) / 3488ms | ✓ dev 0.19pp / 8939ms |
| fky | 拒产 (nm 4752) / 3339ms | ✓ dev 0.58pp / 13771ms |
| gprime | ✓ dev 1.12pp / 4391ms | 拒产 (nm 19080) / 7468ms |
| fcks | 拒产 (nm 27720) / 4270ms | 拒产 (nm 10368) / 14121ms |
| dprime | 拒产 (nm 18252) / 4059ms | ✓ dev 0.13pp / 16215ms |
| dp | ✓ dev 2.94pp / 3961ms | ✓ dev 0.27pp / 9232ms |
| dd | ✓ dev 1.31pp / 3617ms | ✓ dev 0.22pp / 7027ms |
| dg | ✓ dev 8.52pp / 5845ms | ✓ dev 7.92pp / 19529ms |
| fcky | ✓ dev 0.26pp / 3914ms | ✓ dev 0.29pp / 8065ms |
| cdd | 拒产 (nm 18252) / 4706ms | ✓ dev 0.16pp / 19955ms |

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
| dprime | ⛔ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产（nm 18252@R48） |
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
| 验证门禁 | 41 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）
## v9.1 增量基准（2026-09-15 · 平台自测口径）

### Marching Tetrahedra 提取器（球锚，收敛阶）

| R | tris | open/nm/degen | 体积偏差 vs 4π/3 |
|---|---|---|---|
| 32 | 28,560 | 0/0/36* | 0.29% |
| 48（门禁 F6 在守） | — | 0/0/0 | 0.13% |
| 64 | 115,296 | 0/0/36* | 0.07% |

*对称位置恰等值微三角（绝对判据口径）；审计走尺度无关判据后为 0。

### radial-grad 构型（五 K 档水密产出，R128 / periods=12 / MT 管线）

| K | porosity（圆柱口径） | open/nm/degen/miso | STL 三角数 |
|---|---|---|---|
| 1（均匀基准） | 56.9%* | 全零 | ≈443 万（221MB） |
| 1.25 | 55.7% | 全零 | ≈443 万 |
| 1.5 | 55.4% | 全零 | ≈443 万 |
| 1.75 | 56.4% | 全零 | ≈443 万 |
| 2.0 | 57.8% | 全零 | ≈443 万 |

*孔隙率为 MT 发散体积/圆柱包络实测口径（R128 含离散项；K=1.5 换算 surface-nets 口径 ≈50.6%）。
复现：`node tpms/agent/tpms.mjs mesh --type schwarz --porosity 0.5 --periods 12 --resolution 128 --container cube --radial-grad <K> --out out.stl --json`

### CFD 渗透率（Forchheimer 两点分离，icosphere 容器 + gyroid k2，WSL foamRun 真跑）

| 量 | 实测 | 口径 |
|---|---|---|
| K_int | 2.337×10⁻⁹ m² | Stokes 截距 μL/(A_box·A)，落骨支架文献带 10⁻⁹~5×10⁻⁸ |
| K_app(Q₁→Q₂) | 2.28→1.84×10⁻⁹ m² | 随流量降（Forchheimer 教科书行为） |
| 惯性占比 | 2.6% → 21.1% | 0.5→5 mL/min 双流量点 |
| WSS 线性 | Q₂/Q₁ ≈ 10.07× | Stokes 线性 + 0.7% 惯性 |

复现：`mesh --cfd-polyMesh --flow-axis z` → WSL `foamRun` → `cfd-post --q1 ... --dp1 ... --q2 ... --dp2 ... --kinematic`

### 可打印性（六试样悬垂审计，512 方向 Fibonacci 摆盘寻优）

critical 面积比 11.4~13.6% @ b=[0,0,1]；最优摆盘收益仅 ±1pp（TPMS 晶格法向近各向同性的定量结论——支撑控制应走切片器参数侧）。
复现：`node tpms/agent/tpms.mjs overhang --input model.stl --search`
