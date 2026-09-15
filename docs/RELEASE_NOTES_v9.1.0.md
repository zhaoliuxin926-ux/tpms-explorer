# Release Notes — v9.1.0 · dual-extractor-manufacturing-loop

> 2026-09-15 ｜ 中文版在前，[English below](#english)。前版：[v9.0.0](RELEASE_NOTES_v9.0.0.md)（fullstack-cae-ecosystem）。
> CI 44 门三平台全绿（1,000+ 断言）。本版为 v9.0 封板后的功能演进合集（2026-09-13~15）。

---

## 中文

v9.1 的主线是把 v9.0 打通的全链推向「制造物理可交付」：切片有了工业格式，打印前有了可打印性审计，CFD 有了可运行 case 与渗透率后处理，几何家族新增了径向梯度构型——为此平台长出了第二套网格提取器。

### 一、直接隐式层切三部曲 + 前端预览

- **扫描线区间法**：每层每行对 V−iso 线性求根取固相区间，跳过三角网格直出矢量层切；与 mesh 发散体积双口径对拍 0.4–1.2%（体素 0 阶分类为离群源，对拍锚=mesh）。
- **容器裁剪**：cylinder 解析区间（±π√(1−y²)）与 C5 外部 STL 的 SDF 区间线性求根，三维布尔降维成一维区间交。
- **CLI 工业格式**：Common Layer Interface（`$$HEADER/UNITS/LAYER/HATCHES/ENDOFFILE`），hatch 重算体积保真 ≤0.1%。诚实边界：按公开规范摘要写出，未经真实机床实测。
- **前端预览画布**：120 层一次预计算 + Z 滑块仅渲染（`run_all` 第 7 UI 套件）。

### 二、可打印性审计（悬垂角 + 最优摆盘）

- `overhang` 命令：悬垂角 α = arccos(−N·b) 工业口径（0°=水平悬挑最危险）面积统计 + 九桶直方图 + Fibonacci 球确定性摆盘寻优（512 方向，无 RNG）。
- 解析锚：单位球面积极分 14.645%±1%、立方体 1/6 精确、critical=89° 方向语义钉（口径反掉必炸）。
- **物理结论**：六试样实测最优摆盘收益仅 ±1pp——TPMS 晶格法向近各向同性，换方向几乎不减支撑需求；支撑控制应走切片器参数侧。摆盘寻优对各向异性构件保留价值。

### 三、CFD 交付链（可运行 case + Forchheimer 渗透率）

- `--cfd-polyMesh` 的交付从「网格就绪」升级为**解压即 foamRun 可解**：SIMPLE 稳态字典、flowRateInletVelocity 入口、运动压强口径、dP 面积平均预埋输出、WSS functionObject、氧传质 Robin 壁面、README 跑法与坑清单（mm 单位制自洽）。
- `cfd-post` 命令：两流量点 Forchheimer 分离 ΔP=A·Q+B·Q²，固有渗透率取 Stokes 截距 K_int=μL/(A_box·A)；WSS 对照 10–30 mPa 促矿化窗口（文献核验锚）；`--kinematic` 直接吃 mm 单位制 case 的运动压差自动换算。
- **WSL OpenFOAM v13 真跑闭环**：双流量点 600 步收敛，K_int=2.337×10⁻⁹ m²（落骨支架文献带 10⁻⁹~5×10⁻⁸），K_app 随流量降、惯性占比 2.6→21.1%、WSS 随流量 ×10.07（Stokes 线性自洽）。真跑五迭代定案全部固化进模板（GAMG 六面体死锁→PCG/DIC、v13 patchAverage 键值语法、surfaceFieldValue writeFields 必填、mm 单位制）。

### 四、radial-grad 径向梯度构型 + 双提取器格局

- **radial-grad 家族**：中心膨胀 K、边缘 1 的度规逆映射构型（arctanh 径向 + 有理轴向双通道 + 壁厚补偿阈值场，K∈[1,3]，K=1 退化均匀基准）；K=1.5 实测设计密度 ≈50.6%。
- **Marching Tetrahedra 提取器**：surface-nets 的顶点插值对场不光滑点（|P| 折痕 / max 尖点）结构性非流形（原生壳×圆柱容器组合实测同样拒产——平台既有盲区），MT 的 cell 角点二值化对此免疫。三个关键定案：4-cut 穿越边按共享角点链接成环（固定枚举序会产生蝴蝶序自交）、corner 值 η 正则化（让贴角退化配置不出现，而非在退化配置上硬拽）、退化判据走尺度无关口径（相切带等边微楔片是真实离散几何——针形仍拦）。
- **五 K 档（1/1.25/1.5/1.75/2.0）全部水密 STL 产出**（开放边/非流形/退化/定向全零；MT 球锚 4π/3 偏差 0.13%@R48）。平台进入**双提取器格局**：surface-nets（光滑场主力）+ MT（不光滑场/梯度构型）。

### 五、Agent 模型线四档验收

- 37 条真实模型回归四档画像：glm-5.3-flash **37/37 一次全绿（推荐档）**、5.3 满血 36/37×2（推理深思 30–150s，失败项轮换=服务端方差）、4.6 35/37、4-flash 33/37。对抗指令四档零透传（fail-closed 三形态：平台拒绝/模型层拒绝/模型自觉改发合法值）。
- Provider 超时三处对称 170s + `TPMS_LLM_TIMEOUT_MS` 环境覆盖（推理模型对对抗陷阱深思可达 150s+）。

### 透明边界（Transparent Boundaries）

- CFD 字典口径经 WSL 真跑验证，但平台几何为结构化六面体网格；绝对值（ΔP/K_int/WSS）须带网格敏感性披露（未做网格收敛研究前不报 GCI）。
- CLI 工业格式按公开规范摘要写出，未经真实机床实测。
- MT 管线退化判据为尺度无关口径（等边微楔片=相切带真实离散几何）；radial-grad 的 clip 边界半格内移（几何尺寸损 1/R）。
- MT 管线 R128/12 周期产出约 443 万三角（STL ≈221MB）——按需降分辨率/周期数减小。
- 浏览器侧 FEM/CFD 仍为工程解析估算口径（非 Abaqus 级），与导出实跑的两层口径在 UI 与文档中保持分离。

---

## English

v9.1 pushes the v9.0 end-to-end chain toward *manufacturing-grade deliverables*: industrial slicing formats, pre-print printability audit, runnable CFD cases with permeability post-processing, and a radial-gradient geometry family — which required the platform to grow a second mesh extractor.

1. **Direct implicit slicing trilogy + live preview** — scan-line interval extraction (vs mesh divergence volume 0.4–1.2%), analytic/SDF container clipping, and the **Common Layer Interface** industrial format (hatch volume fidelity ≤0.1%, honest boundary: written from public spec, not yet machine-tested). Canvas preview card joins the UI regression suite.
2. **Printability audit** — `overhang` command: industrial-convention overhang statistics (α = arccos(−N·b)) with nine-bin histogram and deterministic Fibonacci-sphere orientation search. Key finding from six specimens: TPMS lattices are near-isotropic — orientation gain ≈ ±1 pp, so support control belongs to the slicer. Analytic anchors: spherical-cap integral 14.645%±1%, cube 1/6 exact, critical=89° semantics pin.
3. **CFD delivery chain** — `--cfd-polyMesh` now emits a **runnable OpenFOAM case** (SIMPLE steady dicts, flow-rate inlet, kinematic-pressure convention, embedded dP area-averages, WSS function objects, Robin oxygen walls). `cfd-post` performs the two-point Forchheimer separation: K_int = 2.337×10⁻⁹ m² measured on WSL foamRun (bone-scaffold literature band), inertial fraction 2.6→21.1%, WSS linear ×10.07. Five real-run iterations are baked into the template (GAMG hex deadlock → PCG/DIC; v13 function syntax; writeFields mandatory; mm-consistent units).
4. **radial-grad family + dual-extractor architecture** — a center-dilated metric remap family (K∈[1,3]) whose fields are non-smooth at |P| creases and max ridges defeats Surface Nets (measured: native shell × cylinder also fails — a pre-existing blind spot). Enter **Marching Tetrahedra**: cell-corner binarization is immune; three decisions (shared-corner ring ordering for 4-cut cases, corner-value η regularization, shape-invariant degeneracy criterion) deliver **watertight STL for all K = 1…2** (sphere anchor 4π/3 within 0.13% @R48). The platform now runs Surface Nets (smooth fields) and MT (non-smooth fields) side by side.
5. **Agent model-tier acceptance** — 37-case real-model regression across four tiers: glm-5.3-flash 37/37 in one run (recommended); adversarial prompts fail closed across all tiers; provider timeouts symmetric at 170s with env override.

**Transparent boundaries**: structured-hex CFD absolutes require mesh-sensitivity disclosure; CLI format not machine-tested; MT degeneracy criterion is shape-invariant by design; R128/12-period MT output ≈4.4M triangles (221MB); browser FEM/CFD remain analytic engineering estimates.

---

*验证底座：44 道 CI 门禁（1,000+ 断言）三平台矩阵全绿；本版全部功能宣称与实测命令一一对应，明细见 [BENCHMARKS.md](../BENCHMARKS.md) v9.1 节与 [ROADMAP](../tpms/agent/ROADMAP.md)。*
