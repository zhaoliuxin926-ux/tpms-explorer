# TPMS Explorer v9.0.0-fullstack-cae-ecosystem Release Notes（双语）

> 发布日期：2026-09-13 ｜ 前置版本：v8.0.0-agentic-loop
> 里程碑：**44 道 CI 门禁 · 1000+ 断言（三平台矩阵，全绿）** ｜ v9.0 三大战役端到端闭环 ｜ **一处透明登记的主线程算力边界**

---

## 中文

v9.0 的主线是「**实验数据反演 × 前端标定交互 × 任意解剖流形保形填充**」的全栈 CAE 生态补完：从万能试验机的原始 CSV 到数字孪生标定比一条链路贯通；从任意封闭流形 STL（如解剖骨缺损段）到贴壁 TPMS 骨小梁自动填充，CLI 与 Web UI 双入口闭环。

### 战役一 — experimental-fit：ISO 13314 试验曲线标定反演（门禁 43，18 断言）
- `physics/experimental-fit.ts`：CSV/TSV 健壮解析（分隔符自适应/表头列名/乱序/重复折叠/单位换算）→ Toe Region 虚拟原点补偿（**高斜率带并集回归**——消 max-slope 窗口搜索的 winner's curse 噪声正偏 +2.2%）→ ISO 13314:2011 特征抽取（准弹性模量 / Rp0.2 / 第一峰值 / 平台应力 / 密实化应变 / 比吸能 / η_max）→ DT/GA 双向标定比；
- 参考真值与被测实现**完全不同源**（细网格积分/二分求交/解析 E₀），实测恢复精度：E\* +0.4% / Rp0.2 −1.9% / 平台应力 −0.1% / 虚拟原点误差 2×10⁻⁵ / 单位换算闭环 ≤10⁻¹²；
- 配套物理试验包：`PHYSICAL_TESTING_PROTOCOL.md`（6 试样矩阵/应变速率折算/称重孔隙率端板修正）+ `specimens/` 6 组水密 STL（R96 k8 甜点域实测——k10 在 R96/R128 双双薄壁自触拒产）。

### 战役二 — 前端标定画布（仿真与评价组第 9 卡片）
- 试验机 CSV/TSV 拖拽即出全部 ISO 13314 指标 + 反演曲线画布（平台线/εd 拐点/Rp0.2 交点）+ 当前模型 Gibson-Ashby 预测**实时标定比**；
- 同模式卡片：「外部 STL 保形容器」（构型组）文件拖拽 → SDF 注入 → 贴壁重建（见战役三）。

### 战役三 — C5 任意解剖流形 STL 保形填充（门禁 44，10 断言）
- `geometry/mesh-container.ts`：STL 解析（binary/ASCII + **顶点焊接**修复面汤假开放）→ 水密/流形 fail-closed 自检 → 归一化 5% margin → **加权穿越计数扫描线**（det=0 刀片三角形对奇偶判定致命、对法线 x 分量代数和零贡献——符号 100%）→ 均匀网格桶最近点 SDF；
- 修复 `closestPtTriangle` B 顶点区条件反转（Ericson 原版 d4 ≤ d3）——该 bug 曾致远壁距离系统性低估 0.72→0.34，9 场景单元测试锁定；
- **融合语义三轮实证定案**：全域 smooth-max 两版（log1p/二次型）均破坏「容器外硬覆写」（孔隙率 0.2%/5.7% 断崖暴露，+109%→+27% 历史教训重演）→ 定案**壁面邻域高斯 bump 倒角**（容器外与深处保留硬 max，贴壁顶点 1.35× 成形倒角壳）；
- 门禁 44 十断言：torus SDF 解析对照（med 0.0006 = 3% 半格）/ 斜切管（股骨段）med 0.0003 / 符号 100% / 非水密 fail-closed / **相对水密**（mesh nm 403 ≤ cube 同参 1668——gyroid k6 p0.65 薄壁自触为既有行为，融合不引入新缺陷）/ 贴合 max 0.0289 ≤ 半格+弦差立项口径 / 倒角壳 A/B；
- 双入口：CLI `mesh --container-mesh <stl> --container-blend <h>` 与 Web UI 拖拽卡片（惰性 SDF 缓存 Map<R,sdf>，分辨率切换自动重算；端板互斥守护）。

### 基建与文档
- CI 42→44 门（experimental_fit + conformal_fill 注册，全链六文档计数原子同步，ci.yml 陈旧 "41" 标签顺手修正）；
- 投稿包对齐：双矢量图（TikZ agentic 闭环状态机 + 定向传播三态对比 15,552/16,104/0）、v7.0 稿两处预存 LaTeX 缺陷修复（psmallmatrix 缺 mathtools、\doi 未定义——"编译通过"实为 nonstopmode 带错出 PDF）、BENCHMARKS 双跑逐字节一致性实证（20 族 × R{48,96} 全部结论位级一致——确定性宣称获双重运行证据）；
- 文档收敛：README 双语徽章、PROJECT_SUMMARY v9 战役登记、ROADMAP A1/A3/B2/C5 勾选账实对齐。

### 透明边界（如实登记，非缺陷粉饰）
- **SDF 主线程同步执行**：STL 容器上传时 `computeMeshSDF` 在主线程同步运行（冒烟锚点 12 三角）——大体量解剖网格（>10⁴ 三角）将阻塞 UI 数秒；Worker 化管线已立项归档 `bugs.md`，待真实临床需求触发。

### 教训（v9.0 新增）
- **坐标域口径先于数学对质**：surface-nets positions 在 wc∈±π 域（phys = wc/π，k 仅在公式求值瞬间乘入）——审计误用 wc/(kπ) 因子差 k 倍，把管壁环带误判为"中心洞穿出"（穿出 17969→128 的全部差额来自口径）；
- **全域平滑算子与硬覆写语义不兼容**：任何全域 smax 都会把容器外空气挤压成实体——边界局域 bump 是唯一保语义的倒角路径；
- **绝对零缺陷断言在离散极限下是虚妄**：相对审计（融合不劣于基准）守红线同时尊重体素物理下限；
- **winner's curse 在工程数据反演中真实存在**：max-slope 搜索 +2.2% 正偏，带并集回代消除。

---

## English (condensed)

v9.0 completes the full-stack CAE loop: **experimental-fit** (ISO 13314 inversion of universal-testing-machine CSV with Toe-region virtual-origin compensation via high-slope-band regression, gate 43 at 18 assertions, independent reference values; E\* +0.4%, Rp0.2 −1.9%, unit-conversion closure at 1e-12), the **drag-and-drop calibration canvas** (live Gibson-Ashby ratio against the current model), and **C5 conformal filling of arbitrary closed manifold STL** (gate 44 at 10 assertions: torus/tube SDF analytic parity med 0.0003-0.0006, weighted-crossing parity 100%, relative watertightness mesh ≤ cube control, wall-conformance within half-voxel, gaussian-bump fillet shell 1.35×). Notable root-causes: an inverted B-vertex region in the point-triangle closest-point routine (Ericson d4 ≤ d3); two global smooth-max formulations rejected empirically for violating the hard outside-air overwrite (porosity collapse 0.2%/5.7%); audit-side coordinate-caliber error (wc/π vs wc/kπ) misreporting the entire wall band as "hole penetration". One transparent boundary registered in bugs.md: computeMeshSDF runs synchronously on the main thread; worker-ization is filed for the first real clinical-scale mesh. CI grows 42→44 gates; the paper package gains two vector figures, two pre-existing LaTeX defect fixes, and a byte-identical double-run determinism proof of the public benchmark matrix.

**Verification**: 44-gate CI suite, three-platform matrix, 1000+ assertions; offline browser smoke 4/4 for the STL-container card; local full suite 44/44.
