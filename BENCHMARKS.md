# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-09-15T17:27:38.432Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 10-20 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 2789ms | ✓ dev 0.09pp / 7758ms |
| diamond | ✓ dev 0.09pp / 2678ms | ✓ dev 0.13pp / 8914ms |
| schwarz | ✓ dev 0.05pp / 2001ms | ✓ dev 0.05pp / 4061ms |
| neovius | ✓ dev 0.18pp / 2423ms | ✓ dev 0.22pp / 4793ms |
| iwp | ✓ dev 0.16pp / 2656ms | ✓ dev 0.02pp / 8494ms |
| frd | 拒产 (nm 20736) / 2631ms | ✓ dev 0.04pp / 10134ms |
| lidinoid | ✓ dev 0.28pp / 4092ms | ✓ dev 0.08pp / 15818ms |
| splitp | ✓ dev 0.55pp / 3903ms | ✓ dev 0.33pp / 14559ms |
| octo | ✓ dev 7.06pp / 2615ms | ✓ dev 0.32pp / 8050ms |
| karcher | ✓ dev 0.51pp / 3312ms | ✓ dev 0.23pp / 10834ms |
| fks | 拒产 (nm 9504) / 3041ms | ✓ dev 0.19pp / 8361ms |
| fky | 拒产 (nm 4752) / 2930ms | ✓ dev 0.58pp / 12814ms |
| gprime | ✓ dev 1.12pp / 3815ms | 拒产 (nm 19080) / 6839ms |
| fcks | 拒产 (nm 27720) / 3589ms | 拒产 (nm 10368) / 14054ms |
| dprime | 拒产 (nm 18252) / 3659ms | ✓ dev 0.13pp / 14909ms |
| dp | ✓ dev 2.94pp / 3539ms | ✓ dev 0.27pp / 7823ms |
| dd | ✓ dev 1.31pp / 3107ms | ✓ dev 0.22pp / 6317ms |
| dg | ✓ dev 8.52pp / 4896ms | ✓ dev 7.92pp / 17647ms |
| fcky | ✓ dev 0.26pp / 3484ms | ✓ dev 0.29pp / 7398ms |
| cdd | 拒产 (nm 18252) / 3851ms | ✓ dev 0.16pp / 18085ms |
| slotp | ✓ dev 2.05pp / 3173ms | ✓ dev 0.22pp / 10438ms |
| fs | ✓ dev 9.52pp / 2051ms | ✓ dev 0.07pp / 7133ms |
| qstar | 拒产 (nm 792) / 2643ms | ✓ dev 0.06pp / 6170ms |
| ws | ✓ dev 13.25pp / 3040ms | ✓ dev 0.16pp / 12784ms |

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
| slotp | ✅ | ✅ |  |
| fs | ✅ | ✅ |  |
| qstar | ⛔ | ✅ |  |
| ws | ✅ | ✅ |  |

## 3. 力学解析口径（Gibson-Ashby，非 FEA）

- E*/Es = C1·ρ̄²（C1 文献带 0.35~0.44，per-曲面标定值见 `list` 命令）
- σ*/σs = 0.3·ρ̄^1.5（网格泡沫折中上界；经典开孔泡沫 0.23 为带下界）
- 文献对比带已内建于 `scenario` 命令验证报告（每曲面带内/带外自动判定）

## 4. 对标（开源生态）

| 能力 | 本项目 | RegionTPMS | MiniSurf | microgen |
|---|---|---|---|---|
| 浏览器零安装交互 | ✅ WebGPU/TS 单页 | ❌ Mathematica | ❌ MATLAB | ❌ Python 库 |
| 曲面族 | 24 | 4 | 19 | 8+ |
| 验证门禁 | 44 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（R96 0.26pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 与文献实验数据的对照（诚实口径）

平台力学预测为 Gibson–Ashby 解析工程口径（`E*/Es = C1·ρ̄²`、`σ*/σs = C2·ρ̄^1.5`，C1=0.38/C2=0.3），非针对具体打印件的 FEA。下表把模型行为与文献实验共识并排——**带内一致处与模型边界如实分列**：

| 量 | 文献实验共识 | 平台（gyroid, Ti-6Al4V 110 GPa / σs≈880 MPa） | 判定 |
|---|---|---|---|
| E\* 标度指数 n | 1.5–2.5（综述带；手稿 bibitem `maskery2018` 同源标度拟合数据） | n=2（Gibson–Ashby 弯曲主导） | ✅ 落带中段 |
| C1 系数量级 | 打印开孔件 0.1–1（理想 1–4；手稿 bibitem `gibson1997cellular` 经典带） | C1=0.38 | ✅ 带内 |
| σ\* 标度指数 | 1.5（手稿 bibitem `gibson1997cellular` 经典） | n=1.5 | ✅ 一致 |
| 族间序（同密度） | 聚合物 AM 实测 P ≈ 2×(gyroid ≈ diamond)（[PII S0032386117311175](https://www.sciencedirect.com/science/article/pii/S0032386117311175)） | G-A 各向同性近似**不区分族序**（仅各向异性因子） | ⚠️ 模型边界，如实披露 |

平台侧实测数字（复现：`node tpms/agent/tpms.mjs estimate --type gyroid --porosity <30|50|70> --json`）：
ρ̄=0.70 → E\*=20.48 GPa / σ\*=154.6 MPa；ρ̄=0.50 → E\*=10.45 GPa / σ\*=93.3 MPa；ρ̄=0.30 → E\*=3.76 GPa / σ\*=43.4 MPa。

文献锚：Gibson & Ashby《Cellular Solids》（手稿 bibitem `gibson1997cellular`）；Maskery et al. 2018, *Polymer*（[ScienceDirect PII S0032386117311175](https://www.sciencedirect.com/science/article/pii/S0032386117311175)，手稿引用 Abueidda 2017 / Maskery 2018 同源标度数据）。打印件绝对值会随工艺缺陷（粉末边界/粗糙度）低于解析预测——上机试样的 Gibson-Ashby 标定比回填见 `PHYSICAL_TESTING_PROTOCOL.md §八`。

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）
## 6. WebGPU 场计算实测（2026-09-20 · 真机 RX 580 · Chrome 稳定版）

> 历史修复注记：v3.0 起 `evaluateFieldGPU` 的 `queue.submit([encoder])` 缺 `.finish()`，
> TypeError 被 catch 吞成静默 CPU 回退——GPU 加速自上线以来从未真正执行（状态行「可用」
> 为真、求值永假）。2026-09-20 真机走查抓出并修复（submit 前 finish + 类型垫片补全），
> 以下为本机实测（单次含 8.6MB mapAsync 回读的 wall-time 中位数）：

| 场规模 | 节点数 | GPU 实测 | 口径 |
|---|---|---|---|
| 61³（预览档） | 226,981 | 23.7 ms | 应用内状态行实测（重建管线端到端激活） |
| 64³ | 274,625 | ~53 ms | 模块级 bench（5 次中位） |
| 96³ | 912,673 | ~55 ms | 同上 |
| 128³（(R+1)³=129³） | 2,146,689 | ~56 ms → **~15 ms** | 同上；原「≤30ms」宣称在本机未达成（缓存前） |

**设备/管线跨重建缓存**（2026-09-20 第二轮）：一次性模式每次重建重复 requestAdapter/
requestDevice/createShaderModule/createComputePipeline（约 20ms 开销）——缓存复用（device.lost
自愈失效 + WGSL 键管线缓存容量 16）后实测稳态：129³ ≈15ms（3.4×）、97³ ≈7ms（8×）、
65³ ≈7ms（8×）；应用内预览档状态行 23.7ms → 7.6-8.8ms；场值逐点不变（absMax/非零计数全同）。

- CPU 参照（同场 JS 单线程）：128³ 分钟级——GPU 路径为唯一可交互档。
- 结论修正：原「128³ ≤ 30ms」为未验证宣称（bugs 边界 §一.5），本机实测 56ms；
  更新 GPU（非 Polaris 世代）应显著更快，宣称按实测口径披露。
