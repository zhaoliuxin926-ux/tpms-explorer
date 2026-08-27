# TPMS 科研与增材制造实战指南

> 本指南面向三类工作流：**3D 打印与压缩试验**、**OpenFOAM 灌注 CFD 模拟**、**Python/MATLAB 脚本复现**。
> 所有导出链路均经过 CI 门禁审计（见文末质量基准表），数据可溯源、参数可复现。
>
> 适用版本：`v2.2.0-endplates-cfd` 及以上。

---

## 目录

1. [增材制造与力学压缩试验流](#一增材制造与力学压缩试验流)
2. [OpenFOAM CFD 灌注模拟工作流](#二openfoam-cfd-灌注模拟工作流)
3. [Python / MATLAB 脚本复现指南](#三python--matlab-脚本复现指南)
4. [质量与审计基准](#四质量与审计基准)

---

## 一、增材制造与力学压缩试验流

### 1.1 为什么需要加载端板（Endplates）

多孔 TPMS 试件在万能试验机单轴压缩中，压盘与试件的接触面是应力集中最先击穿的
位置——表层孔隙处的细支柱会在远低于整体屈服载荷时局部早溃，导致测得的
弹性模量与平台应力系统性偏低（文献中常见 10%~30% 的实验偏差即来源于此）。

TPMS Explorer 的**加载端板**功能在试件上下两端生成致密实心过渡层：

- 结构面板 → **加载端板 (Endplates)** 滑块，范围 0~3.0 mm（步长 0.2 mm）
- 推荐值：**1.0~2.0 mm**（与试验机压盘刚性匹配的常用经验区间）
- 生效厚度会被自动钳制到 `0.4 × 单元总宽`，保证两端板之间始终保留 ≥ 0.2·L
  的多孔试验段——端板不会"吃掉"试件
- 导出的 STL 已通过专项审计：**水密 open edges = 0、端面满填充、体积增量与
  理论平板偏差 ≤ 1.79%**（`tpms/.verify/endplate_audit.mjs`，26 项断言）

端板与孔隙结构的过渡由体素场直接融合（非布尔运算），过渡带无伪影、天然水密；
端面孔口的原有锯齿/开口封盖问题也随之消除——端板化后孔隙在端面上不再开口。

> **力学口径提示**：UI 统计面板中的孔隙率为**网格实测口径**（发散定理体积积分）。
> 开启端板后材料占比会随端板增厚上升、孔隙率读数下降——这是物理事实而非误差；
> 文献汇报"多孔段孔隙率"时建议关闭端板单独导出一份用于截面统计。

### 1.2 切片软件导入建议

导出 STL（工具栏下载键或导出中心）后，按工艺推荐：

**FDM / 桌面级（拓竹 Bambu Studio、PrusaSlicer、Cura）**

| 参数 | 推荐值 | 说明 |
|---|---|---|
| 层厚 | 0.12~0.16 mm | TPMS 曲面曲率连续，细层厚显著减少阶梯纹；0.2 mm 为下限 |
| 壁厚 / 墙数 | ≥ 0.8 mm（3~4 wall） | TPMS 的力学性能由曲面壳承载，壁数不足会打断应力路径 |
| 填充 | **100%**（试件本体） | TPMS 本身即结构，切勿叠加切片器内部填充图案；端板区域可依赖端板实心层 |
| 支撑 | 无需 | TPMS 为自支撑点阵（拓扑连通、悬垂角连续变化），这正是其 AM 优势 |
| 缩放 | 1:1 | 导出已按 1 period = 1 mm 换算，STL 总宽 = 单元密度 k（mm），无需缩放 |

**光固化 SLA/DLP（PreForm、Chitubox、Lychee）**

| 参数 | 推荐值 | 说明 |
|---|---|---|
| 层厚 | 0.025~0.05 mm | 高孔隙率细支柱（<0.5 mm）建议 0.025 |
| 摆放 | 试件轴向与 build plate 成 10~30° 倾角 | 避免端板大面积贴盘吸底；端板面朝上或斜置 |
| 支撑 | 仅端板底面 | 多孔段自支撑；端板作为"天然刚性基座"反而便于布置粗支撑 |
| 固化曝光 | 首层 +4~6 层过曝 | 保证端板底面平整度（后续压缩接触面） |

**试验前处理**：端板面建议以 400→800→1500 目砂纸逐级打磨后上机；两端面平行度
控制在 0.05 mm 内（游标卡尺 + 直角尺检查），即可满足准静态压缩的接触均匀性要求。

---

## 二、OpenFOAM CFD 灌注模拟工作流

### 2.1 导出 Multi-solid ASCII STL

工程版导出中心 → **CFD Multi-Patch STL (OpenFOAM)**。产物为标准 ASCII STL，
按三角形质心与定向法线自动分为四个 boundary patch：

| Patch | 判定规则 | OpenFOAM 语义建议 |
|---|---|---|
| `inlet` | 质心 z ≤ z_min+ε 且 n_z < −0.7 | 速度入口（fixedValue / pressureInletOutletVelocity） |
| `outlet` | 质心 z ≥ z_max−ε 且 n_z > 0.7 | 压力出口（totalPressure / inletOutlet） |
| `sides` | 贴 x/y 边界裁剪面 | 周期（cyclic）或对称（symmetryPlane）边界 |
| `wall` | 其余全部内部多孔曲面 | 无滑移固壁（noSlip） |

> 开启加载端板时，端板外表面自然归入 `inlet`/`outlet`（强 z 法线 + 贴边界），
> 与灌注入口语义一致，无需人工重分组。
> **注意**：本 STL 为**固相**几何；灌注模拟以补集为流动域时，`inlet`/`outlet`
> 的物理进出口朝向请按具体试件复核（固壁外法线方向已统一为"指向空气侧"）。

### 2.2 snappyHexMesh 配置范例

将 STL 与下列配置放入 `constant/polyMesh`（或 `system/`）同级目录，
在 `snappyHexMeshDict` 中按 patch 名直接引用：

```cpp
// system/snappyHexMeshDict（关键节选）
geometry
{
    tpms-gyroid-p70-solid_network-cfd.stl   // 导出的 Multi-solid 文件
    {
        type triSurfaceMesh;
        name tpms;                          // 所有 patch 统一前缀 tpms<Name>
    }
};

castellatedMesh true;
snap            true;
addLayers       true;

geometry → refinementSurfaces
{
    tpmsinlet   // <name><patch> 命名由 snappy 自动拼接（tpms + inlet）
    {
        level (2 2);            // 入口区域不需要过度加密
        patchInfo { type patch; }
    }
    tpmswall    // 内部多孔曲面：贴体六面体的加密主战场
    {
        level (3 4);            // (min max)：多孔通道建议 3~4 级
        patchInfo { type wall; }
        refinementRegions { ... }   // 可选：按曲率局部加密需配合 refinementRegions
    }
    tpmsoutlet
    {
        level (2 2);
        patchInfo { type patch; }
    }
    tpmssides
    {
        level (1 2);
        patchInfo { type cyclic; }  // 或 symmetryPlane（单半模 + 对称面场景）
    }
}

// 层参数：多孔壁面 y+ 控制建议
addLayersControls
{
    relativeSizes true;
    layers
    {
        tpmswall { nSurfaceLayers 3; }
    }
    expansionRatio     1.2;
    finalLayerThickness 0.5;
    minThickness       0.1;
    nSmoothPatchNormals 3;
}
```

**特征边提取**（`surfaceFeatures`，供 `snappyHexMesh` 的 `features` 节引用，
锐利处保护 + 入出口边缘对齐）：

```bash
# 用 surfaceFeatures 生成 eMesh（OpenFOAM 自带工具，无需第三方）
surfaceFeatures -dict system/surfaceFeaturesDict
```

```cpp
// system/surfaceFeaturesDict
surfaces ("tpms-gyroid-p70-solid_network-cfd.stl");

// 入口/出口与侧壁的交线（端板开启时为端板外缘矩形框）
includedAngle   150;        // 二面角小于该值识别为特征边
writeObj        yes;        // 同步输出可视 eMesh/obj 便于检查

// 多孔壁自身无锐边（曲率连续），无需提取内部特征
```

随后在 `snappyHexMeshDict` 中：

```cpp
features
(
    { file "tpms-gyroid-p70-solid_network-cfd.eMesh"; level 2; }
);
```

**典型工作流**：`blockMesh`（粗背景网格）→ `surfaceFeatures` → `snappyHexMesh`
→ `checkMesh`（确认 boundary 文件中 inlet/outlet/sides/wall 四组 patch 俱全）
→ `simpleFoam` / `porousSimpleFoam` 灌注压降计算。

### 2.3 分辨率与几何保真提示

CFD 面片来自网格化提取，端面与容器壁存在**半格内缩**（k3/R61 ≈ 25 µm），
远小于工程网格尺度；若需更高几何保真，在工程版中调高**单元密度**后再导出——
分辨率分配公式（`units.ts:hdResolution`）会在 96³ 上限内自动按每周期密度
最大化分配（倍频曲面密度加倍补偿已内置）。

---

## 三、Python / MATLAB 脚本复现指南

### 3.1 导出与运行

工程版导出中心 → **Python 脚本**（或 MATLAB）。产物为自包含重建脚本：
参数、隐函数公式、容器裁剪、孔隙率二分、端板覆写全部内联，仅依赖
`numpy + pyvista`（`pip install numpy pyvista`）：

```bash
python tpms-gyroid-p70-solid_network.py
# 输出 tpms_reconstructed.vtk + 顶点/面片统计 + iso_bias/t_eff 打印
```

### 3.2 PyVista 等值面提取与二次后处理

脚本核心是 `tpms_field(X, Y, Z, weights)` 隐函数 + `pyvista.ImageData.contour`。
二次开发示例——在重建体上追加自己的分析：

```python
import pyvista as pv
import numpy as np

# —— 脚本已产出 grid（UniformGrid/ImageData，point_data['values']=F）——
mesh = grid.contour([0.0])                      # 与导出 STL 同源的等值面
mesh.save('tpms_surface.stl')                   # 可直接回写 STL

# 比表面积与体积（与平台 physics/ 模块同口径的实测计算）
print('surface area  =', mesh.area)             # mm²（1 period = 1 mm）
print('volume        =', mesh.volume)          # mm³（固相）
print('porosity      =', 1 - mesh.volume / (cell_size**3))

# 多孔通道抽提（流动模拟的流体域 = 重建体包络 − 固相）
solid = mesh.delaunay_3d().extract_surface()
solid_vol = solid.volume
fluid = grid.threshold(value=0.0, scalars='values', invert=False)  # F<0 = 固相（与平台一致）
fluid.save('fluid_domain.vtk')                  # 直接导入 OpenFOAM 的 foamyHexMesh 或 ParaView 检查

# 截面扫描（对应平台"截面扫描"滑块的离线版）
slices = mesh.slice_orthogonal(x=0, y=0, z=0)
slices.save('tpms_sections.vtp')
```

MATLAB 脚本同构：`isosurface(X, Y, Z, F, 0)` + `patch` 渲染，`stlwrite` 导出。
两语言与平台源码的数值一致性由 CI 门禁 `parity_math.mjs`（74 断言，
含 iso_bias 逐位一致、STL 字节包围盒、脚本语义对齐）强制保证。

### 3.3 同源契约速查

| 量 | 平台 | Python 脚本 | MATLAB 脚本 |
|---|---|---|---|
| 坐标域 | wc ∈ [−π, π]，频率 k 编码周期 | 同左 | 同左 |
| 物理单位 | 1 period = 1 mm | `X * kk / (2π)` 换算 | 同左 |
| 固相判据 | `F_final > 0` | 同左 | 同左 |
| 容器 | 无条件空气覆写（非 max 裁剪） | 同左 | 同左 |
| 端板 | z 带覆写 ±1.0（对称幅值） | 同左 | 同左 |
| 分辨率 | `hdResolution`（A2 密度保优） | 同式内联 | 同式内联 |

---

## 四、质量与审计基准

以下数字由 `tpms/tpms-platform && npm run test:all` 一键复现
（5 道门禁、全部数字为 2026-08-28 版本实测记录）：

| 门禁 | 内容 | 基准 |
|---|---|---|
| `mesh_audit` | 29 案例几何质量（8 曲面 × 拓扑/容器/梯度/预览/权重 + 红队回归） | **Watertight 100%**（开放边 = 0）；固相体积偏差 ≤6%（预设精确案例 +0.52%）；定向 100% 外向 |
| `parity_math` | 数学同源（8 曲面三实现互证 / iso 指纹 / 法线 / STL 字节包围盒 / 脚本对齐） | **74 / 74** |
| `sim_export_check` | CFD 四区块完整性 + 曲率解析健壮性（混叠/混合工况） | 13 断言全过 |
| `endplate_audit` | 端板专项（水密 / 端面满填充 / 体积增量 / CFD 兼容 / 幂等） | 26 断言全过；**体积增量实测 ≤1.79%**；水密 100% |
| `run_all` | UI 回归（求值器安全 / 接线 / 红队复验 / 遗留修复 / tip / 单文件版） | 6 套件 108 项全过 |

**对抗验证履历**（数字来源见 `agent_memory/`）：
红队 53 用例攻击矩阵（静默失败清零：EMPTY 6→0）、"代码 vs 文献"逐条审计
（Lysenko / Taubin 1995 / Gibson 1998 / iso2mesh / MaSMaker）、
浏览器双入口端到端 + pyvista 实跑交叉验证、内存泄漏探针
（80 循环堆增量 < 1 MB、WebGL context 恒定）。

**已知量化边界**（均有实测与机理文档，非缺陷）：
倍频曲面（I-WP/F-RD/Neovius）弦切离散 −5~−10%；梯度壳非 z 向 −8~−10%；
鞍点掐捏非流形边 0.008~0.4%（切片器无感）；端板外表面半格内缩
（k3/R61 ≈ 25 µm，打印首层补偿即可对齐）。

---

*本文档由 TPMS Explorer 项目维护，遵循仓库开源许可。发现文档与实现不符，
欢迎提 issue——文档错误与代码 bug 同等重要。*
