# BENCHMARKS — TPMS Explorer 公开基准

> 生成于 2026-10-02T17:59:04.550Z｜复跑：`node tpms/agent/benchmarks.mjs --md BENCHMARKS.md`（约 10-20 分钟，全程确定性）
> 口径：目标孔隙率 60%｜exact 孔隙率求解器（解析积分求根 + 网格实测割线校正）｜水密三硬指标（开放边/非流形边/退化面）任一非零即 fail-closed 拒产——**拒产是平台的正确行为**，代表该 (曲面, 孔隙率, 分辨率) 组合的网格表示不可靠（亚体素薄壁自触，随分辨率收敛）。

## 1. 几何基准矩阵（可产性 / 水密 / 孔隙率偏差）

| 曲面 | R48 | R96 |
|---|---|---|
| gyroid | ✓ dev 0.59pp / 6210ms | ✓ dev 0.09pp / 13467ms |
| diamond | ✓ dev 0.06pp / 5138ms | ✓ dev 0.37pp / 11273ms |
| schwarz | ✓ dev 0.02pp / 3324ms | ✓ dev 0.12pp / 6683ms |
| neovius | ✓ dev 0.18pp / 5729ms | ✓ dev 0.27pp / 8231ms |
| iwp | ✓ dev 0.22pp / 3991ms | ✓ dev 0.02pp / 12663ms |
| frd | ✓ dev 4.08pp / 5200ms | ✓ dev 0.04pp / 16749ms |
| lidinoid | ✓ dev 0.3pp / 7350ms | ✓ dev 0.09pp / 24996ms |
| splitp | ✓ dev 0.59pp / 6667ms | ✓ dev 0.3pp / 24252ms |
| octo | ✓ dev 6.95pp / 4148ms | ✓ dev 0.34pp / 12405ms |
| karcher | ✓ dev 0.49pp / 5342ms | ✓ dev 0.22pp / 17137ms |
| fks | 拒产 (nm 9504) / 5031ms | ✓ dev 0.17pp / 13531ms |
| fky | 拒产 (nm 4752) / 5044ms | ✓ dev 0.57pp / 20262ms |
| gprime | ✓ dev 1.11pp / 6106ms | 拒产 (nm 19080) / 9079ms |
| fcks | 拒产 (nm 27720) / 5936ms | 拒产 (nm 10368) / 18863ms |
| dprime | 拒产 (nm 18252) / 5768ms | ✓ dev 0.14pp / 26668ms |
| dp | ✓ dev 2.92pp / 6699ms | ✓ dev 0.22pp / 14148ms |
| dd | ✓ dev 1.26pp / 5716ms | ✓ dev 0.16pp / 11108ms |
| dg | 拒产 (nm 18354) / 7779ms | ✓ dev 0.19pp / 22226ms |
| fcky | ✓ dev 0.28pp / 7662ms | ✓ dev 0.2pp / 12282ms |
| cdd | 拒产 (nm 18252) / 5965ms | ✓ dev 0.16pp / 28158ms |
| slotp | ✓ dev 2.16pp / 5359ms | ✓ dev 0.2pp / 16720ms |
| fs | ✓ dev 9.55pp / 3317ms | ✓ dev 0.07pp / 9970ms |
| qstar | 拒产 (nm 792) / 4248ms | ✓ dev 0.18pp / 8999ms |
| ws | ✓ dev 13.26pp / 5300ms | ✓ dev 0.15pp / 18940ms |

## 2. 可用域速查（LLM/用户选择曲面时的决策表）

| 曲面 | R48 可产 | R96 可产 | 备注 |
|---|---|---|---|
| gyroid | ✅ | ✅ |  |
| diamond | ✅ | ✅ |  |
| schwarz | ✅ | ✅ |  |
| neovius | ✅ | ✅ |  |
| iwp | ✅ | ✅ |  |
| frd | ✅ | ✅ | 低分辨率薄壁自触 fail-closed，R96 可产 |
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
| dg | ⛔ | ✅ | 求根域自适应后（2026-10-02 C1）R96 精确命中 0.19pp（旧 ±1.6 钳制时代曾带 ~8pp 偏差静默交付）；R48 p0.6 薄壁自触 fail-closed（nm 18354），升分辨率可产 |
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
| 验证门禁 | 46 道 CI 门禁 / 1000+ 断言 | ❌ | ❌ | ❌ |
| 孔隙率求解 | exact 解析求根+网格实测校正（Diamond R96 0.37pp·当前快照；MC 噪声带内波动 0.1~0.4pp） | 解析 NIntegrate | level-set 近似 | 数值 |
| 渐变等值场 | ✅ isoGrad 三平台+过渡带 | ✅ 渐变 | ❌ | 部分 |
| 异族拼接 | ✅ hybrid 凸组合（CLI/UI） | ✅ 多相 | ❌ | ❌ |
| 仿真交付 | STL/INP/OBJ/GLB/3MF/VTI/G-code | STL | STL/INP | STL/mesh |

## 5. 诚实边界

- 高谐波族（iwp/frd/lidinoid/splitp/fks/fky/gprime/dprime）低分辨率下网格表示物理受限：偏差与拒产随分辨率收敛
- 孔隙率偏差为网格实测口径 vs 目标，含场离散项（exact 求解器已作割线校正）
- 力学口径为 Gibson-Ashby 解析估算，非 FEA；压缩响应以 Abaqus 实跑为准
- fcks 可产域=R120 k6 ∪ R128 k2（~9s，偏差 0.13pp）；k6 R48/R96/R128 薄壁自触拒产（旧「R128 >36 分钟」实为索引池溢出死循环，2026-09-10 已修；性能路径 2026-09-11 退役）

## 6. 访客体验快照（Lighthouse·环境相关·人工复测节——生成器不重算，数字为标注日期的实测快照）

- 2026-10-03 实测（Chrome 稳定版 · Pages 线上 · 落地页+platform × desktop+mobile 四轮）：Accessibility / Best Practices / SEO / Agentic Browsing 四类 **100/100**（落地页两轮各 40 项审计零失败；platform 两轮各 50 项零失败；分数有环境方差，以当日复测为准）
- 2026-10-04 补测教学版 docs/app.html（Pages 形态 × desktop+mobile 两轮）：四类同样 **100/100**（各 51 项审计零失败）——三页 × 双端六轮全满贯
- 关键时延（同日 Navigation Timing，未节流口径）：落地页 TTFB 194ms · FCP 1.06s · load 0.95s；platform 首开 load 4.7s · 传输 ~325KB（gzip；three.js 主包 277KB 见 GitHub 压缩产物口径）；教学版 TTFB 516ms · FCP 0.93s · load 1.8s · 传输 ~138KB
- 复测口径（访客可复现）：Chrome DevTools Lighthouse 面板 / Lighthouse CLI / PageSpeed Insights 任一，对三页各跑 desktop+mobile navigation 审计；本节数字仅在人工复测后更新（生成器重跑 §1-§5 不触碰本节内容块以外的快照值）
- 口径披露：本快照为 Accessibility/Best Practices/SEO/Agentic 四类，**不含 Performance 类**；加载时延以上行未节流 Navigation Timing 另列，**与 Lighthouse simulated 节流值口径不可互比**