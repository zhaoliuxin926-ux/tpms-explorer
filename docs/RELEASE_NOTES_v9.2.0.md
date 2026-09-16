# Release Notes v9.2.0 — 24 Family Equations & Hardened Loops

**版本代号**：`v9.2.0-24families-hardened`（自 v9.1.0-dual-extractor-manufacturing-loop，6 commits）

本版本把曲面库扩展到 **24 族**（Slotted P / F / Q\* / W 落地，出自 jwf23 方程数据集 CC BY 4.0）、把 radial-grad 从 CLI-only 升级为 **UI 一键预览/导出**，并用一轮 4 路红队对抗审查（0 CRITICAL + 10 MAJOR + 20 MINOR 全修）加固了 UI 与 CLI 的同源承诺。

---

## ✨ 新特性

### 🧬 曲面库 20 → 24 族（C2 第六批）
- **Slotted P**（2× 混合积谐波）、**F**（余弦积）、**Q\***（差角 + √3 非对称族）、**W**（2× 积反对称对）——公式逐字转录自 [jwf23/Equation-Based-Lattice-Structure-Dataset](https://github.com/jwf23/Equation-Based-Lattice-Structure-Dataset)（CC BY 4.0，27 曲面 Fourier 拟合，配套论文 [Data in Brief, DOI 10.1016/j.dib.2023.109612](https://doi.org/10.1016/j.dib.2023.109612)）
- 四方同源：TypeScript 权威库 / Python 导出 / MATLAB 导出 / GPU WGSL IR 万点对拍位级一致（parity_math 314 断言 + webgpu_parity 119 断言）
- 可用域公开于 BENCHMARKS.md（R48/R96 全矩阵；qstar p0.5 微非流形拒产如实披露，k6 默认档四族均拒产——降周期数可避）
- lidinoid 原始文献 DOI 补录（10.1039/FT9908600769，Lidin & Larsson 1990）

### 🌀 radial-grad M(r) UI 卡（工程版「视图与工具」组）
- K/ta/tb 滑块（K=1 联动锁 tb，nTop 标定表精确落格 0.001 步长）+ **MT 一键预览**（R=48，约 1-2s）+ **HD STL 导出**（R=96，内置边配对水密审计 fail-closed——与 CLI 水密门同标准）
- 守卫七连与 CLI 同语义：须 Schwarz P / solid_network / cube，与外部 STL 容器、渐变等值场、混合场、非欧映射互斥
- 实测 K=1.5：预览 192,784 三角 / 孔隙率 54.7%，与 CLI 表值口径**逐位一致**

### 🖼 论文配图模式 HD 锁
配图 PNG 与 sidecar 从此与导出中心同 HD 口径（提取共享函数 `ensureExportGradeGeometry`，拖动滑块后 350ms 窗口期内进配图不再产出 preview 低清图）。

## 🔧 修复与加固（对抗审查轮 v3：4 红队 0C+10M+20m 全修）

- **polyMesh corner-air 口径**：legacy cylinder 容器外包络角部体素不再计入流体（cube 输出逐字节不变；圆柱侧壁正确入 wall patch、端面 patch 只覆盖柱截面）
- **fourPatch 端面语义**：flowAxis 向端口只认域端面——torus 等无贯穿端口容器的侧壁阶梯面不再误入 inlet/outlet（旧实测 71% 误归）；连带修复空 patch `startFace` 写 0 断 boundary 链的二阶缺陷
- **MATLAB 导出真机验证**：R2025a 无头三支路冒烟（identity/倍频/非欧）3/3——实测抓出并修复非欧分支 `isonormals` 在变形（非可分）网格上的必炸缺陷
- **MATLAB 重建脚本**拆出 `buildMatlabScript(state)` 可测试接口（探针独立入库）
- UI 细节：hybrid typeB 点击高亮即时同步、STL 文件名含 tb 参数、权重项展开 mojibake 修复
- k=6 非标定域披露补齐（CLI usage + schema description，含标定数据四案例数字）

## 📊 门禁增量

| 门禁 | v9.1.0 | v9.2.0 |
|---|---|---|
| parity_math（四方同源对拍+锚点） | 282 | **314** |
| webgpu_parity（GPU IR 万点对拍） | 101 | **119** |
| conformal_fill_audit（C5） | 28 | **30** |
| cae_mesh_audit（INP+polyMesh） | 66 | **67**（+容器体积锚） |
| schema_check（契约与可用域） | 98 | **106**（+qstar 反向钉） |
| run_all UI 回归套件 | 7 | **8**（+radial-grad 卡冒烟 7 断言） |
| **全量 CI 门** | 44 | **44（三平台）** |

## ⚠️ 透明边界（诚实披露）

- 本版所有修复经 4 路独立红队攻击验证（正面结论：数值同源/提取等价性/DOI 真实性/44 门账实全部成立）；审查实录见仓库 ROADMAP「究极对抗审查轮 v3」节
- C2 第六批四曲面在默认周期数 k=6 下均触发薄壁自触拒产（fail-closed）——与 lidinoid/gprime 同族，`--periods ≤5` 可避（schema 已量化披露）
- radial-grad UI 卡为一次性预览语义（改动参数后常规重建恢复；卡片状态行明示）；cellSize=5 时预览 R48 会因壁厚体素比 <2 拒绝、HD 导出 R96 正常（voxPerWall 分辨率口径，属设计行为）
- MATLAB 真机探针（`matlab_script_smoke.mjs`）与可产域探针（`probe_c2_batch6.mjs`）为独立运行探针，不进 CI 调度（CI 无 MATLAB 环境 / 探针先行定案模式，同 volume_loss 先例）
- 论文手稿已同轮对齐 24 族 + 数据集引用条目（bibitem ×2）；投稿与否为作者侧决策

## 🔄 升级与复现

```bash
git clone https://github.com/zhaoliuxin926-ux/tpms-explorer.git
cd tpms-explorer && npm install
npm run test:all   # 44 gates × 三平台（Ubuntu/Windows/macOS）
```

24 族 CLI 冒烟：`node tpms/agent/tpms.mjs list --json`（types=24）；radial-grad UI：工程版「视图与工具 → 径向梯度构型 M(r)」。

---

# v9.2.0 发布说明（中文对照）

**版本代号**：`v9.2.0-24families-hardened`

曲面库扩至 **24 族**（Slotted P / F / Q\* / W，出自 jwf23 方程数据集，CC BY 4.0）；radial-grad 升级为 **UI 一键预览/HD 导出**（内置水密 fail-closed 门）；配图模式补 HD 锁；MATLAB 重建脚本经 R2025a 真机三支路验证并修复非欧分支 isonormals 缺陷；corner-air 与 fourPatch 端面语义修复；4 路红队对抗审查 10 MAJOR + 20 MINOR 全修（含 BENCHMARKS 24 族矩阵重生、论文数据集引用条目补录、8 文件 13+ 处计数漂移修齐）。门禁 44 门三平台全绿；透明边界与审查实录全文见上（英文节）。
