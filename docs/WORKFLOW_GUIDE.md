# TPMS 科研与增材制造实战指南

> 本指南面向四类工作流：**3D 打印与压缩试验**、**OpenFOAM 灌注 CFD 模拟**、**Python/MATLAB 脚本复现**、
> **学术渲染与论文汇报**。所有导出链路均经过 CI 门禁审计（见文末质量基准表），数据可溯源、参数可复现。
>
> 适用版本：`v7.0.0-generative-biophysics` 及以上。

---

## 目录

1. [增材制造与力学压缩试验流](#一增材制造与力学压缩试验流)
2. [OpenFOAM CFD 灌注模拟工作流](#二openfoam-cfd-灌注模拟工作流)
3. [Python / MATLAB 脚本复现指南](#三python--matlab-脚本复现指南)
4. [3MF 现代 3D 打印工业切片流](#四3mf-现代-3d-打印工业切片流) 🆕
5. [Blender / KeyShot 学术级高精渲染流](#五blender--keyshot-学术级高精渲染流) 🆕
6. [异质多相多孔结构（Hybrid TPMS）设计指南](#六异质多相多孔结构hybrid-tpms设计指南) 🆕
7. [微物理参数学术汇报规范（迂曲度 τ 与刚度张量）](#七微物理参数学术汇报规范) 🆕
8. [质量与审计基准](#八质量与审计基准)
9. [自定义公式沙箱（AST 语法规范）](#九自定义公式沙箱ast-语法规范) 🆕
10. [非欧度规空间映射](#十非欧度规空间映射) 🆕
11. [RVE 均质化与方向模量](#十一rve-均质化与方向模量) 🆕
12. [红队极端工况矩阵](#十二红队极端工况矩阵) 🆕
13. [Abaqus 有限元单胞均质化与 PBC 施加教程](#十三abaqus-有限元单胞均质化与-pbc-施加教程-v30) 🆕 v3.0
14. [OpenFOAM polyMesh 流体秒级灌注仿真实战](#十四openfoam-polymesh-流体秒级灌注仿真实战-v30) 🆕 v3.0
15. [主应力迹线仿生多孔骨支架参数设计原则](#十五主应力迹线仿生多孔骨支架参数设计原则-v30) 🆕 v3.0
16. [多级分形 TPMS 换热器与生物支架多尺度应用](#十六多级分形-tpms-换热器与生物支架多尺度应用-v30) 🆕 v3.0
17. [逆向力学与传质多目标优化设计实战](#十七逆向力学与传质多目标优化设计实战-v40) 🆕 v4.0
18. [庞加莱非欧双曲多孔骨套筒建模范式](#十八庞加莱非欧双曲多孔骨套筒建模范式-v40) 🆕 v4.0
19. [Abaqus / OpenFOAM 自动化求解与验证后处理](#十九abaqus--openfoam-自动化求解与验证后处理-v40) 🆕 v4.0
20. [工业 Micro-CT 制造偏差表征与精度补偿](#二十工业-micro-ct-制造偏差表征与精度补偿-v40) 🆕 v4.0
21. [原生 Web Worker 有限元均质化与 LBM 流体求解实战](#二十一原生-web-worker-有限元均质化与-lbm-流体求解实战-v50) 🆕 v5.0
22. [三维交互式 CAE 边界条件拾取与载荷工况定义](#二十二三维交互式-cae-边界条件拾取与载荷工况定义-v50) 🆕 v5.0
23. [临床 Micro-CT DICOM/TIFF 导入与骨形态计量学参数解读](#二十三临床-micro-ct-dicomtiff-导入与骨形态计量学参数解读-v50) 🆕 v5.0
24. [网页端直接生成 3D 打印 G-code 与拓竹/Klipper 上机指南](#二十四网页端直接生成-3d-打印-g-code-与拓竹klipper-上机指南-v50) 🆕 v5.0
25. [神经网络多物理场代理模型与 Pareto 逆向设计前沿](#二十五神经网络多物理场代理模型与-pareto-逆向设计前沿-v50) 🆕 v5.0
26. [隐式神经场（SIREN）潜在拓扑流形探索](#三十一隐式神经场siren潜在拓扑流形探索-v70) 🆕 v7.0
27. [三维多轴各向异性屈服面与多孔破坏裕度分析](#三十二三维多轴各向异性屈服面与多孔破坏裕度分析-v70) 🆕 v7.0
28. [声子晶体能带色散与超材料宽频振动隔离设计](#三十三声子晶体能带色散与超材料宽频振动隔离设计-v70) 🆕 v7.0
29. [组织工程成骨长入与微流体氧气输运反应-扩散仿真](#三十四组织工程成骨长入与微流体氧气输运反应-扩散仿真-v70) 🆕 v7.0
30. [水平集拓扑导数自适应多目标优化重构](#三十五水平集拓扑导数自适应多目标优化重构-v70) 🆕 v7.0

---

9. [自定义公式沙箱（AST 语法规范）🆕](#九自定义公式沙箱ast-语法规范)
10. [非欧度规空间映射（圆柱 / 环面 / 双曲）🆕](#十非欧度规空间映射)
11. [RVE 均质化与方向模量 🆕](#十一rve-均质化与方向模量)
12. [红队极端工况矩阵 🆕](#十二红队极端工况矩阵)

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

## 四、3MF 现代 3D 打印工业切片流 🆕

### 4.1 为什么 3MF 优于 STL

| 维度 | STL | 3MF |
|---|---|---|
| 单位 | 无（约定俗成） | **显式 `unit="millimeter"`**，跨软件零歧义 |
| 元数据 | 无 | Title/Designer/Description + 自定义字段（TPMS:EndplateMm 等） |
| 面片定向 | 靠约定 | 规范强制一致定向 |
| 生态 | 通用但老旧 | 微软/拓竹/Ultimaker 联盟推动的现代标准 |

TPMS Explorer 导出的 3MF 已内嵌：构型标识（`TPMS:Config`）、目标孔隙率
（`TPMS:PorosityPct`）、端板厚度（`TPMS:EndplateMm`，仅开启端板时写入）——
全部为 mm 原生尺度，导入后**无需任何缩放**。

### 4.2 Bambu Studio（拓竹）导入流

1. **文件 → 导入 → 3MF**（或直接拖入）。导入后检查右下角尺寸：总宽应等于
   `单元密度 k`（mm）——若不符请检查是否误拿了 STL 旧文件。
2. **端板实心层识别**：对象 → 体数据/高度表（或"切割"工具）在
   `z = ±L/2 − EndplateMm` 高度做一次平切并"保留上半"，即可把端板区
   单独设为**实心填充**（端板元数据 `TPMS:EndplateMm` 给出了精确高度，
   免去手工测量）。
3. **变密度切片**（可选）：多孔段保持 100% 实体填充（TPMS 即结构），
   端板段可按层高直接实心；拓竹的"按对象/按区域设置"可将端板切割体
   单独指派填充参数。

### 4.3 PrusaSlicer 导入流

- 导入 3MF 后 PrusaSlicer 保留单位与坐标；**打印设置 → 填充**中同样
  将主体设 100% ` rects`（TPMS 勿叠内部图案）。
- 端板高度同上：以 `TPMS:EndplateMm` 元数据（文本编辑器打开 3MF 包内
  `3D/3dmodel.model` 即可读到）为切割基准。
- 导出 G-code 前**预览切片**确认端板层为实心、多孔段壁面连续——
  这是发现端面破洞最直观的一道人工检查。

### 4.4 端板与切片的工艺注记

端板外表面存在半格内缩（k3/R61 ≈ 25 µm），远小于首层高度；对接触
平整度有极限要求时，切片前可在切片器中给底面加 0.1 mm「raft/垫层」
补偿。端板一圈与侧壁交界的转接三角为合法几何（已审计量化），切片器
自动处理，无需修复。

---

## 五、Blender / KeyShot 学术级高精渲染流 🆕

### 5.1 带顶点色的 GLB 直读

导出中心 → **彩色 3D 模型 (.glb)**。当着色模式为
「场权重 / 平均曲率 / 高斯曲率 / 高度」任一开启时，GLB 会携带
`COLOR_0` 顶点色缓冲（Float32 vec3，值域 [0,1]，蓝→白→红 Cool-Warm），
并声明 `vertexColors` 材质——Blender 2.93+/4.x 与 KeyShot 11+ 原生支持。

**Blender**：
1. `文件 → 导入 → glTF 2.0 (.glb/.gltf)` 选 GLB。顶点色自动落地为
   Mesh 的 `Color Attribute`（名称 `COLOR_0`）。
2. Shading 工作区：`Attribute Node`（Name 填 `COLOR_0`）→ 接入
   `Base Color`。.Attribute 输出即 Cool-Warm 三通道，无需再调色。
3. 学术质感材质链参考：
   `Attribute → Mix(Roughness Map) → Principled BSDF`；
   `Roughness 0.35~0.5`、`Specular 0.4`——避免全镜面造成曲率带过曝。
4. 三向迂曲度对比图：分别导出 X/Y/Z 剖切 + 同色标 GLB，在合成器
   依次叠加并共享同一 ColorRamp 参照条（论文图例一致性关键）。

**KeyShot**：导入 GLB 后在材质编辑器把 `Color Map` 指向顶点色通道
（KeyShot 自动识别 `COLOR_0`），配合 `Product` 灯光预设 + `Region` 渲染
局部放大（过渡带/梯度带特写），可直接输出 4K Cover 级成图。

### 5.2 期刊插图规范建议

- **色标条必须随图**：Cool-Warm 的中点白 = 中性权重/零曲率，图注中
  声明"红正蓝负，饱和于 98% 分位"（与平台实现口径一致）。
- 同一论文内的所有 TPMS 图使用**同一色标范围**——平台按各结构自适应
  归一化，跨结构对比时请在图注标注各自范围。
- 端板试件的渲染建议保留端板（展示真实打印件形貌）；孔隙率统计图
  则建议另出无端板版本（见 §1.1 力学口径提示）。

---

## 六、异质多相多孔结构（Hybrid TPMS）设计指南 🆕

### 6.1 数学模型

混合场 `F = w(x)·F_A + (1−w(x))·F_B`，其中权重 `w` 沿所选**过渡方向**
由 Sigmoid（陡度 k=6/δ）或线性函数给出。过渡方向支持 X/Y/Z 轴向与
**Radial 球面波前**（r=√(x²+y²+z²)，从中心向外过渡）。

### 6.2 仿生人工骨：皮质骨-松质骨过渡

天然长骨外层为致密皮质骨（porosity 5~30%）、内层为松质骨
（porosity 50~90%），中间存在功能梯度过渡。Hybrid 配置建议：

- **主曲面 Type A**（内侧致密端）：Diamond 或 Gyroid（低孔隙、高强度）
- **次曲面 Type B**（外侧疏松端）：Gyroid（高孔隙、利于骨长入）
- **过渡方向**：Z 轴（模拟长骨轴向皮质→松质）或 **Radial**（模拟
  横截面环形皮质包裹松质——Radial 波前从中心 r₀ 向外过渡，
  与皮质骨-松质骨的解剖学径向关系一致）
- **中心 r₀/z₀**：0 ~ +0.3（过渡带偏外侧，内侧保留更长致密段）
- **宽度 δ**：0.8~1.2（避免突变界面造成应力集中；Sigmoid 的平滑
  导数正是避开「双模量界面剥离」的关键）
- **着色联动**：开启混合后自动推荐「场权重」着色——红蓝过渡带宽度
  即视觉化的过渡区厚度，可直接用于论文示意图

### 6.3 抗冲击吸能盒（Energy Absorption）

吸能结构要求"渐进屈曲 + 平台应力最大化"，常见设计是**密度沿加载
方向梯度化**，使压溃从低密度端开始、逐层致密化：

- **轴向（加载方向）过渡**：Type A 选高刚度曲面（Diamond）、Type B 选
  柔性曲面（Gyroid），`z₀` 置于冲击进入端，`δ` 适中（0.5~0.8）
  使平台应力沿轴向递增
- **迂曲度参考**：压溃行程中的吸能量与孔壁塑性变形路径长度正相关，
  可参考物理面板的三向几何 τ 评估各向吸能差异

### 6.4 与梯度双壳的区别

内置「梯度双壳」（gradient_shell）调制的是**单一曲面的壁厚**；
Hybrid 调制的是**两种曲面的空间占比**。前者适合"同一拓扑的密度
梯度"，后者适合"不同力学职能区的组合"（如吸能段+承载段）。两者
可叠加（gradient_shell 模式下再开 Hybrid，壁厚与拓扑同时梯度化），
但请以切片预览确认打印可行性。

---

## 七、微物理参数学术汇报规范 🆕

### 7.1 几何迂曲度 vs 水力迂曲度（必须区分的两种口径）

| | 几何迂曲度 τ_geo | 水力迂曲度 τ_hyd |
|---|---|---|
| 定义 | 流体域内**最短连通路径**长度 / 沿轴向直线距离 | 由 Navier-Stokes（或 Stokes）流场解得到的流线积分平均 |
| 计算 | 图论最短路（本平台实现，26 连通 Dijkstra） | CFD 求解（OpenFOAM/Simpleware 等） |
| 数值特征 | 偏小（只计几何最短路，不计粘性） | 偏大且随 Re 变化 |
| 适用 | 结构对比、快速的各向异性评估 | 渗透率预测（Kozeny-Carman 中的 τ） |

**汇报规范**：论文中使用平台数值时请注明 *"geometric tortuosity
computed via shortest fluid path on a 64³ voxelization"*；引用文献
数值对比时务必确认对方口径。高孔隙率（P ≥ 60%）下几何 τ 趋近 1
（存在近直线贯通通道）是几何定义的固有性质，不代表传质性能无差异。

### 7.2 平台输出口径速查

- **迂曲度 τx/τy/τz**：64³ 体素、26 连通 Dijkstra、容器外表面壳层
  已排除（否则边界棱空气壳会污染为 τ=1——实现细节见
  `physics/tortuosity.ts` 注释）。端板开启时 z 向被致密板封堵，
  τ_z = ∞（未贯通）。
- **各向异性刚度张量**：**一阶几何调制近似**（Gibson-Ashby 各向同性基
  × 迂曲比调制 + ν*=0.30），非渐近均质化数值解。论文表述建议：
  *"orthotropic stiffness estimated via tortuosity-modulated
  Gibson–Ashby scaling"*——勿写"渐近均质化计算"。
- **Zener 各向异性比** A = 2C44/(C11−C12)：立方对称曲面
  （Gyroid/Diamond/P/Neovius/I-WP）在迂曲各向同性时 A≈1；
  审计门禁要求离散化偏差 ≤1%。
- **孔隙率**：平台 UI 展示为**网格实测**（发散定理体积分），优于
  目标值口径；端板开启时为含端板的全件实测。

### 7.3 汇报检查清单

- [ ] 迂曲度口径声明（geometric / hydraulic）与算法/分辨率（64³ 体素）
- [ ] 刚度张量注明估算模型（tortuosity-modulated Gibson–Ashby）与
      基体材料参数
- [ ] 端板是否计入孔隙率统计
- [ ] 立方对称结构的 Zener A 报告（预期 ≈1，偏离 >5% 需检查剖切方向）

---

## 八、质量与审计基准

以下数字由 `tpms/tpms-platform && npm run test:all` 一键复现
（5 道门禁、全部数字为 2026-08-28 版本实测记录）：

| 门禁 | 内容 | 基准 |
|---|---|---|
| `mesh_audit` | 29 案例几何质量（8 曲面 × 拓扑/容器/梯度/预览/权重 + 红队回归） | **Watertight 100%**（开放边 = 0）；固相体积偏差 ≤6%（预设精确案例 +0.52%）；定向 100% 外向 |
| `parity_math` | 数学同源（8 曲面三实现互证 / iso 指纹 / 法线 / STL 字节包围盒 / 脚本对齐） | **74 / 74** |
| `sim_export_check` | CFD 四区块完整性 + 曲率解析健壮性（混叠/混合工况） | 13 断言全过 |
| `endplate_audit` | 端板专项（水密 / 端面满填充 / 体积增量 / CFD 兼容 / 幂等） | 26 断言全过；**体积增量实测 ≤1.79%**；水密 100% |
| `micro_physics_audit` | 三向迂曲度（8 曲面贯通/带宽）+ 立方对称模量/Zener + 未贯通分支 | 17 断言全过；对称模量偏差 ≤1% |
| `hybrid_audit` | 多相混合（水密 / 极限逼近 / py-TS 双语言残差 1000 点） | 5 断言全过；双语言残差 ≤1e-12 |
| `industrial_export_audit` | GLB（magic/COLOR_0/守恒）+ 3MF（ZIP/XML/端板元数据） | 12 断言全过 |
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

## 九、自定义公式沙箱（AST 语法规范）🆕

工程版「自定义隐函数」面板支持任意 f(x,y,z)，零依赖递归下降 AST 解析（无 eval），实时校验并定位错误字符。

**语法白名单**：坐标 `x y z` + 球坐标 `r theta phi`；参数 `k`（周期）、`t`（壁厚系数）、`iso`（基准等值）；函数 `sin cos tan asin acos atan sinh cosh tanh exp log log2 log10 sqrt cbrt abs sign floor ceil round trunc pow min max atan2`；常量 `PI E`。隐式乘法与任何属性访问（`constructor` 等）一律拒绝。

**自动微分**：梯度 ∇F 与 Hessian 由 Dual Number AD 精确求出（非差分），供曲率着色与 3MF/脚本导出共用。

**脚本翻译**：自定义公式自动翻译为 NumPy（`np.*`）/ MATLAB（点运算）向量化表达式，坐标自动映射 `x → kk·X`，含 KK 频率与 iso_base 前置定义。

## 十、非欧度规空间映射 🆕

对生成的封闭网格做顶点级连续弯曲（映射单射 ⇒ 水密/流形由构造继承，open edges 恒 0）：

| 映射 | 要点 | 有效性约束 |
|---|---|---|
| 圆柱弯曲 | x 绕 z 轴整圈包裹 θ∈[0,2π]，径向 R+y | R > 域 y 半宽 |
| 环面闭合 | x 绕主圆 + y 绕管圆，z 沿管径向 | R2 > 域 z 半宽 且 R > R2 + z 半宽 |
| 双曲径向 | r → R·tan(r/R·π/4)，中心致密 | 无 |
| 应力线各向异性 | p' = p + (s−1)(p·n)n | s > 0 |

门禁（manifold_audit）：det(J)>0 全域采样、open edges=0、体积>0、域两端周期对齐（Δ<1e-6）、最小三角角>0.3°。URL 键 `mfd`（类型）/`mfr`（半径）。

## 十一、RVE 均质化与方向模量 🆕

「各向异性模量曲面」面板：迂曲度调制方向刚度张量 + E(n) = 1/(nᵢnⱼnₖnℓSᵢⱼₖₗ) 球面热力图（Cool-Warm，横轴方位角 φ、纵轴极角 θ）。

- Voigt–Reuss 精确界：C_V = φ·C0（并联上界）；真孔隙 Reuss = 0。
- 迂曲度调制：E_i ∝ ρ̄²(τ̄/τ_i)²，τ 来自 26 连通 Dijkstra 三向几何迂曲度。
- 各向同性极限自检：E1=E2=E3 时 E(n) 恒定（剪切柔度 (1+ν)(1/Ei+1/Ej) 精确退化 2(1+ν)/E）。
- 工程声明：解析路线给出量级与方向趋势；逐点 FE 精度需外部求解器。

## 十二、红队极端工况矩阵 🆕

redteam_matrix_audit（100+ 案例）：孔隙率极端 {1%, 99%} × 8 曲面 × 3 模式 × 双容器、长宽比/周期极端、极高频（periods=10）、零厚度鞍点、极端权重（全零/负值/大幅值）。三硬指标：零未捕获异常（非法输入优雅报错）、零开放边、零退化三角。p=0.99 钳制后 98% 孔隙壁厚亚体素 → 空网格属合法优雅降级。性能哨兵：80³ 全量重建 621ms（Node 直跑）≤3s 回归带。

**v3.0 新增四门**：webgpu_parity_audit（34 断言：指令 IR 双后端完备性 + 8 内置/4 custom/2 hybrid 万点对拍 0.00e+0 + 模板逐字同步 + 端到端水密 + 无 GPU 优雅降级）；periodic_rve_audit（88 断言：16 门内拓扑最重——3×3×3 拼接内部缝合 100% 水密、PBC 面配对 100% 覆盖、v_right−v_left=(L,0,0) ≤1e-5、五重守卫抛错）；cae_mesh_audit（46 断言：INP 面闭合/Jacobian=h³/PBC 集不交 + polyMesh owner<neighbour/法线定向/patch 连续/cell-face 关联精确守恒 + ZIP CRC32 逐条目）；hierarchical_audit（18 断言：分级水密/λ=0 退化/微孔连通率 ≥95%/双重比表面积 coarea 分离/应力-相对密度 vm 五分桶单调递增）。合计 **16 门 · 658+ 断言**。

**v4.0 新增四门**：inverse_design_audit（23 断言：10 组逆向犯罪测试 100% 收敛且前向误差 ≤3%、κ 下限约束语义、确定性、LM 不劣性）；poincare_metric_audit（12 断言：det(J)>0 全域 9000 采样、径向单射含延拓段、水密拓扑继承、有向边配对、py 静态同源）；cae_verification_audit（25 断言：runner 语法 ast/内容完备、脚本↔导出器节点集/patch 交叉核对、FoamFile 规范、ZIP 完整性）；impact_modal_audit（11 断言：SEA∈[5,60] J/g 物理带、ε_d 解析、正交简并对、√ρ̄ 标度）+ ct_reconstruction_audit（11 断言：Otsu 谷区、EDT 暴力逐体素一致、bias 注入恢复 ≤0.1mm）。合计 **21 门 · 780+ 断言**。


## 十三、Abaqus 有限元单胞均质化与 PBC 施加教程 🆕 v3.0

导出中心 →【Abaqus 体网格 (C3D8 INP)】：体素级六面体网格（默认 40³/轴），含 `*NODE`、`*ELEMENT, TYPE=C3D8, ELSET=ESOLID`、节点集 `NSET_BOTTOM/TOP` 与三对面集 `NSET_PBC_X0/X1, Y0/Y1, Z0/Z1`（仅含固相引用节点）、材料（mm-N-MPa 单位制，E 取材质基体模量）与单轴压缩载荷步模板（底部 U3=0，顶部 U3=−0.05L）。

**周期性边界条件（PBC）施加要点**：
1. 相对面节点一一对应（`NSET_PBC_X0` ↔ `NSET_PBC_X1` 等量且按 (y,z) 排序后逐点配对）；
2. 用 `*EQUATION` 绑定三向位移：`u(X1) − u(X0) = Δ·L`（Δ 为宏观应变张量分量）；棱/角节点需按主从层次单独建方程（先角、后棱、再面，避免过约束）；
3. 均质化：取反力合力 ΣF 除以对面面积得到宏观应力，六组独立加载工况填满 6 个宏观应变分量 → 6×6 刚度矩阵；
4. 或直接用【周期性 RVE 网格 + PBC 配对表】导出：STL 为开放缝合网格（缝合边精确 lying on ±L/2 面），JSON 携带 `pairsX/Y/Z`（索引对）+ `edgeClasses/cornerClasses`（12 棱/8 角等价类），3×3×3 拼接内部 100% 水密（periodic_rve_audit 门禁守护）。

**Jacobian 与质量**：体素六面体为轴对齐正立方体，Jacobian = h³ > 0（ratio 1.0，cae_mesh_audit 门禁守护）。诚实边界：表面呈阶梯状（非贴体），适用于均质化预研与筛选；发表级贴体网格建议以 PBC 表面网格为界重建六面体/四面体混合网格。

## 十四、OpenFOAM polyMesh 流体秒级灌注仿真实战 🆕 v3.0

导出中心 →【OpenFOAM polyMesh (CFD)】：ZIP 内含 `constant/polyMesh/` 五件套（points/faces/owner/neighbour/boundary），解压到 case 目录即成完整网格——**跳过 snappyHexMesh**，无布尔剖分失败面。

```bash
unzip tpms-gyroid-polymesh.zip -d myCase/
cd myCase/system
blockMesh          # 可跳过：网格已就绪
simpleFoam         # 直接求解（或 interFoam 两相灌注）
```

- patch 分区：`inlet`(z−)、`outlet`(z+)、`wall`(固相界面+侧壁)；内部面 owner<neighbour、面法线 owner→neighbour 指向（cae_mesh_audit 抽样断言）；
- cell-face 关联守恒 Σ(2·内部+边界) = 6·cells 精确成立；体素级阶梯界面建议配合 `snappyHexMeshDict` 的 layer 添加或直接以体素尺度解释结果（粘性损失偏高，属保守估计）；
- 网格尺度：模型总宽 = cellSize mm，体素 h ≈ cellSize/40；Run 目录需自备 `0/` 场与 `system/controlDict`（本包只承载几何）。

## 十五、主应力迹线仿生多孔骨支架参数设计原则 🆕 v3.0

「应力场引导 (Stress-Driven)」面板：Wolff 定律的几何化——骨小梁沿主应力迹线排列、高应力区致密化。

- **工况**：三点弯曲（σxx = pz，纯弯线性分布）、悬臂梁（弯矩随距离衰减 + 剪切）、扭转（τxz/τyz 环向剪应力）；
- **各向异性 α**：晶胞沿最大主应力 v1 方向伸长（坐标变换 q' = Rᵀ·S·R·q，S = diag(1/α,1,1)，3×3 Jacobi 特征分解逐点求主轴）；α=1.4~1.8 为骨小梁典型各向异性带；
- **孔隙板收窄 β**：壳模式高应力侧孔隙板收窄（t = tEff·(1−β·vm)，下限 0.1）→ 相对密度与 vm 正相关。hierarchical_audit E 段以 vm 五分桶 MC 断言单调递增（β=0.5 实测 [0.335→0.628]）；
- **可视化**：着色模式 →「应力云图 (von Mises)」；β 过大（≈1）时高应力区趋于全实心属物理极限（无等值面）；
- **汇报表述**：这是「力学启发的几何自适应」而非力学求解——σ(x) 为解析预设场，非 FEA 结果。

## 十六、多级分形 TPMS 换热器与生物支架多尺度应用 🆕 v3.0

「多级分形 TPMS (Hierarchical)」面板：F = F_macro + λ·F_micro(N·x)。

- **骨组织工程**：宏观大孔 300~600 µm 促骨细胞长入（宏观周期取 1，cellSize 1 mm），微孔 20~50 µm 供营养输运——微孔尺度 = 宏观孔径/N，N=4~8 时微特征 125~250 µm，配合 SLM 最小壁厚约束选 λ=0.1~0.3；
- **换热器**：微织构强化对流换热（破坏热边界层），面积密度增益由面板实时给出——N=4 时总面积密度约 1.4×宏观（coarea MC，N=8 约 2.2×）；
- **统计口径**：S_total/S_macro 由 coarea 公式 MC 积分（|∇F| 均值），微孔附加 = S_total − S_macro；微孔连通率 = 微场空隙最大 6 连通簇占比（≥95% 视为贯通，hierarchical_audit 实测 100%）；
- **组合**：可与应力场引导叠加（先主轴拉伸再分级调制）；与 Hybrid 互斥（同为场级组合层）；
- **打印校验**：λ 过小（<0.1）微织构低于打印分辨率（SLM ~80 µm）将被熔池抹平；导出 STL 前先核对切片预览。

## 十七、逆向力学与传质多目标优化设计实战 🆕 v4.0

「逆向性能求解器 (Inverse Designer)」面板：从「参数调结构」到「性能定结构」。

- **目标语义**：E* 与孔隙率 P 为等值约束（相对残差平方）；κ 为**下限约束**（κ ≥ κ_target，只罚不足）——松质骨/散热沉的渗透率指标天然是下界，等式语义会因前向 κ 高于下界两个量级而伪不可行（门禁 17 红测抓获后修正）。
- **求解器**：Nelder-Mead 自适应单纯形（双起点全局探索）→ Levenberg-Marquardt 阻尼最小二乘精化（数值 Jacobian + 手写 3×3 高斯消元，零第三方依赖）。8 类曲面外层枚举，按目标泛函 J 升序输出 Top-3。
- **前向代理**：E* = C1·ρ̄²·E0·α（Gibson-Ashby）+ κ = ε³/(C_k·Sv²·(1−ε)²)（Kozeny-Carman，Sv = cArea(type)/cellSize）。解析代理口径（非 FEA），几何级精确验证走 CAE 验证包（§19）。
- **可行域**：P ∈ [2%, 98%]、cellSize ∈ [1, 5] mm、α ∈ [0.5, 2.5]（<1 为方向软化——三处 clamp 必须同域，NM 自由演化/LM 钳制/解报告的域不一致会让 LM 从 NM 终点跳变边界，成本 4e-13→1.2e-1，门禁 17 红测抓获）。
- **审计口径**：门禁 17 的 10 组「逆向犯罪测试」由已知参数生成目标再反解，断言 100% 收敛且前向误差 ≤3%；解剖预设（皮质骨/松质骨/散热沉）断言可解子集命中。

## 十八、庞加莱非欧双曲多孔骨套筒建模范式 🆕 v4.0

「空间映射 → 庞加莱双曲度规」：r' = 2R₀²·r/(R₀²−r²)，自中心向外围非线性拉伸加密——骨套筒外密内疏的解剖学梯度。

- **径向截断正则化**：r_c = 0.95·R₀ 处以截点斜率线性延拓（f(r_c) + f'(r_c)·(r−r_c)），斜率恒正 ⇒ 全域单射、无坐标发散、det(J) > 0（poincare_metric_audit 9000 采样 + 边界带覆盖）。硬截断（半径钳制）会折叠外围壳层——必须用斜率延拓。
- **映射正确性不变量**：拓扑继承（三角数不变）、水密继承（open=0）、有向边配对完整（det>0 的单射映射保定向）。注意「面法线径向朝外」是**错误**不变量——gyroid 曲面法线指向四面八方，与射线方向无关。
- **URL/脚本**：`?mfd=poincare&mfr=12`；Python 导出脚本含逐式向量翻译（rad = mm·2π/cellSize 换算后 warp），MATLAB 含径向族（poincare/hyperbolic）。
- **参数选择**：R₀ 取 10~20（弧度域）；R₀ 过小时域角（r_max = π√3·k ≈ 5.44k）远超截断点，外围全为线性延拓段（双曲特征弱化）。

## 十九、Abaqus / OpenFOAM 自动化求解与验证后处理 🆕 v4.0

导出中心 →【CAE 验证脚本包】：`abaqus_auto_runner.py` + `openfoam_auto_runner.py` + 壳脚本 + 对比矩阵模板。

**Abaqus 准静态压缩**（abq python 2.7 方言，无 f-string）：
```
abaqus cae noGUI=abaqus_auto_runner.py -- --inp tpms-gyroid-voxel.inp --specimen 1.0
```
JobFromInputFile 提交 → NSET_TOP 反力/位移提取 → `E_FEM`（0~5% 线性拟合）、`σ_peak`、`σ_pl`（5~25% 平台均值）→ CSV。

**OpenFOAM 达西渗流**（python3）：
```
python3 openfoam_auto_runner.py --case tpms-polymesh-case --dp 1.0
```
自动构建 system/ + 0/（simpleFoam、inlet/outlet 定压、wall noSlip）→ 求解 → `κ = Q·μL/(A·Δp)` + WSS 均值。

**对比矩阵**：`comparison_template.csv` 七项指标（E_FEM/σ_peak/σ_pl/κ/WSS/SEA/f1），理论列来自平台物理面板（Gibson-Ashby/Kozeny-Carman/impact-energy 模块），`rel_error ≤ 15%` 为解析代理口径 PASS。cae_verification_audit 断言 runner 期望的节点集/patch 名与导出器输出 100% 交叉匹配 + FoamFile class/object 声明规范 + ZIP 完整性。

## 二十、工业 Micro-CT 制造偏差表征与精度补偿 🆕 v4.0

「CT 重构与制造偏差」面板：设计 → 打印 → CT 扫描 → 精度对比的科研闭环。

- **管线**：灰度体素栈 → **Otsu 自动阈值**（要求双峰直方图：固相亮/孔隙暗——单峰连续灰度会让 Otsu 阈值系统性偏离等值面，实测 0.5mm 假偏差红测的根因）→ **精确 3D EDT**（Felzenszwalb 抛物线包络可分离三趟，5³ 暴力逐体素一致性断言）→ 有符号距离场 SDF（固相内为正）。
- **偏差语义**：Δd = SDF_scan(名义顶点)。Δd > 0 = 过充（红）；Δd < 0 = 欠肉（蓝）；RMS 为制造误差总量。门禁 21 注入 bias=0.25mm 的演示 CT，恢复偏差 |均值 − bias| ≤ 0.1mm。
- **分辨率纪律**：偏差表征的可分辨下限 = CT 体素尺寸（宽/R）；亚体素偏置（如 0.08mm @ 0.21mm 体素）不可恢复——先核对体素尺寸再设计补偿量。
- **补偿回路**：正偏差（过充）区域 → 下调平台壁厚/孔隙率参数重新导出 → 二次打印 → 二次 CT 比对，收敛到 ±1 体素精度。

## 二十一、原生 Web Worker 有限元均质化与 LBM 流体求解实战 🆕 v5.0

「原生 CAE 快速求解」面板：无需外部求解器，浏览器内直接解算等效刚度与渗透率。

- **微观 FEA（J-PCG）**：体素网格 → 6 组单位应变 KUBC 工况 → Jacobi 预条件共轭梯度 → 6×6 Voigt C 矩阵。全实心体素 ν=0.2 patch test 解析精确（C11=λ+2μ, C44=μ, Zener=1）。
- **FD-Darcy**：z 向压差（p=1/0）SOR 求解变系数扩散方程 → κ=QL/(A·Δp)。单管解析锚点精确命中 1/R²。
- **口径声明**：微观 FEA 剪切波动场 b=0 为结构性未解（bugs.md v5.0 条目），C44–C66 行为 Voigt 上界口径；FD-Darcy 为标量压力近似（未解析 Stokes 速度场）。
- **分辨率**：FEA 建议 20³（秒级），LBM/Darcy 建议 12~16³（亚秒）。

## 二十二、三维交互式 CAE 边界条件拾取与载荷工况定义 🆕 v5.0

「CAE 边界拾取」模式：Raycaster 点击 → 法向角区域生长（≤25°）→ 面集高亮。

- **BC 类型**：FIXED（全约束）/ PRESSURE（法向压强）/ INLET / OUTLET；
- **导出注入**：INP 追加 `*NSET, NSET=BC_xxx` + `*BOUNDARY` 或 `*DSLOAD`；FOAM boundary 字典追加 patch 条目；
- **映射守恒**：面集→节点集由构造保证（facesToNodes 去重排序），boundary_picker_audit 门禁校验。

## 二十三、临床 Micro-CT DICOM/TIFF 导入与骨形态计量学参数解读 🆕 v5.0

「CT 重构」面板扩展：支持拖入 .dcm 序列或 .tif 堆栈。

- **DICOM**：显式 VR LE 子集解析（Rows/Cols/BitsAllocated/Rescale/PixelSpacing/SliceThickness），16bit signed + Rescale → 8bit 归一化；仅支持未压缩传输语法。
- **骨形态计量**：BV/TV（体积分数）、Tb.Th（2×EDT 均值，mm）、Tb.Sp（2×孔隙 EDT 均值）、Tb.N（BV/TV/Tb.Th, mm⁻¹）、SMI（网格法面积加权法向偏差）。gyroid 壳 SMI < 1.5（板状），HA/β-TCP 烧结支架 SMI ~ 0–1。
- **临床口径**：BV/TV 与 µCT/QCT 一致；Tb.Th 为 EDT 近似（非距离脊），≥64³ 采样时误差 ~5%。

## 二十四、网页端直接生成 3D 打印 G-code 与拓竹/Klipper 上机指南 🆕 v5.0

「打印路径预览」模式 + 导出中心【G-code】按钮。

- **切片**：三角网格 z 等距切片 → 2D 轮廓链合 → 扫描线填充（80% 线距保证粘结）。
- **G-code**：Marlin/Klipper/Bambu 三预设头部；回抽（长 travel 自动 retract/unretract）；E = 路径长 × 线宽 × 层高 / 耗材截面。
- **上机**：Bambu 拷入 SD 卡 → P1S 局域网工作室导入；Klipper Mainsail/Fluidd 上传。
- **诚实边界**：单壁轮廓无壁厚偏移环路；桥接/悬垂未处理；体积偏差 ~10–20%（量化+重叠），精确校准需打印标定塔。

## 二十五、神经网络多物理场代理模型与 Pareto 逆向设计前沿 🆕 v5.0

「ML 代理」模块：自研前馈 MLP（ReLU 隐层 + 线性输出，零依赖 Float64 矩阵运算），SGD 在线训练。

- **教师信号**：解析代理（Gibson-Ashby E*/Kozeny-Carman κ/SEA 平台理想化）；
- **Pareto 前沿**：非支配排序（E 最大化 + κ 最大化 + SEA 最大化）→ 前沿点过滤；
- **演示口径**：MLP 训练 MSE 收敛 ≥10×；Pareto 非支配性由 ml_pareto_audit 校验。生产精度需外部数据蒸馏（论文 future work）。
GUIDE_EOF
echo "chapters appended"
__zcode_status=$?
if [ "$__zcode_status" -eq 0 ]; then pwd -P > '/c/Users/ADMINI~1/AppData/Local/Temp/zcode-51cf3aea-8620-4b49-b0df-1a3523cb2951-cwd'; fi
exit "$__zcode_status"

## 二十一、原生 Web Worker 有限元均质化与 LBM 流体求解实战 🆕 v5.0

「原生 CAE 快速求解」面板：无需外部求解器，浏览器内直接解算等效刚度与渗透率。

- **微观 FEA（J-PCG）**：体素网格 → 6 组单位应变 KUBC 工况 → Jacobi 预条件共轭梯度 → 6×6 Voigt C 矩阵。全实心体素 ν=0.2 patch test 解析精确（C11=λ+2μ, C44=μ, Zener=1）。
- **FD-Darcy**：z 向压差（p=1/0）SOR 求解变系数扩散方程 → κ=QL/(A·Δp)。单管解析锚点精确命中 1/R²。
- **口径声明**：微观 FEA 剪切波动场 b=0 为结构性未解（bugs.md v5.0 条目），C44–C66 行为 Voigt 上界口径；FD-Darcy 为标量压力近似（未解析 Stokes 速度场）。
- **分辨率**：FEA 建议 20³（秒级），FD-Darcy 建议 12~16³（亚秒）。

## 二十二、三维交互式 CAE 边界条件拾取与载荷工况定义 🆕 v5.0

「CAE 边界拾取」模式：Raycaster 点击 → 法向角区域生长（≤25°）→ 面集高亮。

- **BC 类型**：FIXED（全约束）/ PRESSURE（法向压强）/ INLET / OUTLET；
- **导出注入**：INP 追加 `*NSET, NSET=BC_xxx` + `*BOUNDARY` 或 `*DSLOAD`；FOAM boundary 字典追加 patch 条目；
- **映射守恒**：面集→节点集由构造保证（facesToNodes 去重排序），boundary_picker_audit 门禁校验。

## 二十三、临床 Micro-CT DICOM/TIFF 导入与骨形态计量学参数解读 🆕 v5.0

「CT 重构」面板扩展：支持拖入 .dcm 序列或 .tif 堆栈。

- **DICOM**：显式 VR LE 子集解析（Rows/Cols/BitsAllocated/Rescale/PixelSpacing/SliceThickness），16bit signed + Rescale → 8bit 归一化；仅支持未压缩传输语法。
- **骨形态计量**：BV/TV（体积分数）、Tb.Th（2×EDT 均值，mm）、Tb.Sp（2×孔隙 EDT 均值）、Tb.N（BV/TV/Tb.Th, mm⁻¹）、SMI（网格法面积加权法向偏差）。gyroid 壳 SMI < 1.5（板状）。
- **临床口径**：BV/TV 与 µCT/QCT 一致；Tb.Th 为 EDT 近似（非距离脊），≥64³ 采样时误差 ~5%。

## 二十四、网页端直接生成 3D 打印 G-code 与拓竹/Klipper 上机指南 🆕 v5.0

「打印路径预览」模式 + 导出中心【G-code】按钮。

- **切片**：三角网格 z 等距切片 → 2D 轮廓链合 → 扫描线填充（80% 线距保证粘结）。
- **G-code**：Marlin/Klipper/Bambu 三预设头部；回抽（长 travel 自动 retract/unretract）；E = 路径长 × 线宽 × 层高 / 耗材截面。
- **上机**：Bambu 拷入 SD 卡 → P1S 局域网工作室导入；Klipper Mainsail/Fluidd 上传。
- **诚实边界**：单壁轮廓无壁厚偏移环路；桥接/悬垂未处理；体积偏差 ~10–20%（量化+重叠）。

## 二十五、神经网络多物理场代理模型与 Pareto 逆向设计前沿 🆕 v5.0

「ML 代理」模块：自研前馈 MLP（ReLU 隐层 + 线性输出，零依赖 Float64 矩阵运算），SGD 在线训练。

- **教师信号**：解析代理（Gibson-Ashby E*/Kozeny-Carman κ/SEA 平台理想化）；
- **Pareto 前沿**：非支配排序（E 最大化 + κ 最大化 + SEA 最大化）→ 前沿点过滤；
- **演示口径**：MLP 训练 MSE 收敛 ≥10×；Pareto 非支配性由 ml_pareto_audit 校验。生产精度需外部数据蒸馏。

## 二十六、WebGPU 非线性超弹性与弹塑性大变形力学求解 🆕 v6.0

「弹塑性压溃仿真」面板（侧栏）+ 门禁 27 `gpu_plasticity_audit`（42 断言）。

- **几何非线性**：全拉格朗日（Total Lagrangian）体素 FEM，8 节点六面体 C3D8、2×2×2 Gauss；Green-Lagrange 应变 E = ½(FᵀF − I)，F = I + Σu_a⊗∇N_a；
- **材料非线性**：Saint-Venant-Kirchhoff（PK2 = C:(E−Ep)）+ J2 各向同性线性硬化塑性，径向返回映射在【张量空间】执行（流向 m = (3/2)·dev/σv，Prandtl-Reuss；单轴校验 εp11 = ε̄p）；
- **平衡**：位移加载 + 修正牛顿（弹性切线 SPD 保证 → Jacobi-PCG 无矩阵求解）+ 最优 α 回溯线搜索 + 手风琴子步回退（失败即回滚 UprevSub，杜绝半路污染）+ 位移增量限幅（0.2R，防近机制 CG 崩坏）；
- **几何内力项**：f_int 含 ∫(∇u·S)·∇N dV（B_NL 部分）——缺失则平衡方程非真实 StVK 平衡（能量台账恒等式破坏，2026-08-28 定案）；
- **能量台账（守恒恒等式）**：ΔW_ext = Σ_presc f_int·Δu（实测位移口径，对回退/往返子步恒成立）；ΔW_int = Σ S_i:dE(u_i;Δu)dV（GL 方向导数）；门禁断言漂移 ≤0.5%（实测 gyroid R=8 全程 0.32%）；
- **解析锚点**：静水 KUBC 模式（全边界仿射 u = −ε(x−R/2)）——漂移 1.9e-9 机器精确、反力 vs 3K·ε 一致；
- **GPU 分工（诚实口径）**：CPU 为权威路径（UI 主流程全流程执行）；WebGPU 本构内核（plasticity.wgsl，张量空间径向返回）逐字同步锚定 + 算法转译对拍（1211 屈服态 Δ≤1e-14），作为可选并行路径交付、尚未接入 UI 主流程；
- **单元生死**：onStep 回调改写 active 掩码（Stage II 失效判据挂点）；死亡后 Jacobi 重算 + 限幅保护；
- **诚实边界**：J2 取在 PK2 空间（中等应变工程近似）；一致弹塑性切线（秩一修正）与几何刚度切线已实现（`tangent: 'consistent'`）但默认关闭——压缩软化段失去 SPD 性会导致 CG 崩坏；底面横向全固支带来的边界约束使单轴反力高于理想单轴（单单元实测 1.098·Eε，物理正确）。

## 二十七、单轴准静态压溃数字孪生与断裂失效预测 🆕 v6.0

「数字孪生压溃」= Stage I 求解器 + 失效判据 + 坍塌检测（`digital-twin-compression.ts`）+ 门禁 28（21 断言）。

- **宏观曲线**：位移步进 Δu，工程应变 ε = Δu/L0，反力 F_total = 顶面节点内力合力，σ = F/A0；
- **失效判据**：单元平均 Green-Lagrange 应变主值（Cardano 解析特征值）超限时「单元生死」；仅拉断判据（最大主应变，Ti6Al4V 延伸率口径）；每步杀死上限 15% + 活性下限 40% 双守卫（防全灭→K 奇异）；
- **坍塌检测**：死亡/失稳导致子步回退耗尽 → `stopOnDiverge` 截断曲线，上报坍塌应变（实测 gyroid R=6 failureStrain=0.012 时坍塌 @ε=0.018）——这就是失效预测输出；
- **Gibson-Ashby 对比**：σ_pl/σ_sy = C2·ρ̄^1.5（C2=0.3 与 gibson-ashby.ts 同源）；
- **诚实边界（标定比披露）**：全积分六面体体素 FEM 对平台应力系统性偏刚，DT/GA 实测 ≈1.68（R=6）/2.04（R=8）——门禁守标定比的跨工况稳定性（≤10%）与披露带 [1.2, 3.0]，而非假装裸 ±10% 一致；GA 数字是文献口径估计，不是本模型输出；
- **韧性代理**：塑性耗散 W_pl = Σσ̄y·Δε̄p（单位参考体积）。

## 二十八、微流体 Navier-Stokes 流固耦合高精度仿真 🆕 v6.0

`navier-stokes-solver.ts` + 门禁 29 `wasm_navier_stokes_audit`（15 断言）。

- **方法**：融合显式松弛到稳态（低雷诺数 Stokes 占优）——u' = u + dt(f − ∇p + ν∇²u)（流体格；固体格 u=0 = Brinkman 无滑移口径），p' = p − β∇·u（Uzawa 压力修正）；中心差分六邻居；
- **两种模式**：`channel`（x/z 周期 + y 墙 + 体力 → Poiseuille 解析锚点）与 `periodic`（全周期 + 体力 → TPMS 多孔渗流 κ 测量的标准口径）；
- **验证**：Poiseuille 速度剖面解析误差 **0.002%**（门 29 守 ≤1.5%）；κ vs H²/12 偏差 7.7%（守 ≤10%，有限域壁面效应）；gyroid 多孔 κ 与门 22 的 FD-Darcy 交叉验证（比值带 [0.2, 5]，实测 3.1——Brinkman 惩罚与压力 SOR 口径差异）；
- **关键教训（2026-08-28 定案）**：∇² 各分量各向同性——所有方向的邻居都贡献对应速度分量的差；曾误将「邻居方向」当「速度分量」（y 邻居贡献 u_y 差），剪切层永不发育、速度线性飞升；
- **WASM 加速档（诚实降级披露）**：手写 WAT 内核 + 手工二进制汇编器（`gen_ns_wasm.mjs`，零 wabt 依赖）已实现并保留为实验件，但 wabt.js 与 V8 对同一 WAT 的编码/校验分歧（往返复现、逐字对拍无法收敛）导致暂停接入——运行时与门禁均走 TS 热循环（同功能同数值），与 v5.0 LBM→FD-Darcy 降级同口径；
- **API**：`solveNavierStokes({nx,ny,nz,fluid,mode,nu,bodyForce,dt,beta,maxIter,tol})` → {u, p, umean, permeability, converged}。

## 二十九、激光粉末床熔融（LPBF）热-力残余应力与翘曲预测 🆕 v6.0

`lpbf-thermo-mechanical.ts` + 侧栏「LPBF 打印工艺与残余应力」卡片 + 门禁 30（18 断言）。

- **热模型**：体素网格显式瞬态傅里叶热传导（Jacobi 双缓冲——**守恒口径**；曾就地更新泄漏 23.7% 能量）+ 高斯体热源蛇形扫描（q''=2AP/(πr0²d)·exp(−2r²/r0²)）；镜像边界 = 绝热；
- **沸点封顶**：T ≤ 3600K，超出部分计入蒸发耗能（台账口径）——物理动机：蒸发吸热未建模；
- **输出**：峰值温度、熔池体素数、冷却速率 R、扫描向梯度 G、凝固参量 G×R（实测 3.65e15 K²/s，文献带 1e14-1e17 ✓）；
- **力估算（固有应力法口径）**：σ_res = min(α·E·ΔT_eff·C, σ_y)（屈服封顶，实测 880 MPa 封顶）；翘曲 w ≈ C·α·ΔT·L²/(2t)（实测 2.2µm @ 1.2mm 视场）；
- **工艺窗口**：E_d = P/(v·h·t)，Ti64 键合良好带 40-120 J/mm³——三态评估（未熔合/键合/球化）；
- **门禁守恒**：能量台账平衡 0.0000%（≤0.5% 断言），跨网格（N=20/32）稳定；
- **诚实边界**：热-力解耦估算（固有应变法），非增量热-弹塑性 FEM；熔池对流/辐射/蒸发未建模（以沸点封顶代理）；单层代表口径。

## 三十、自然语言驱动的智能 CAD/CAM 增材制造代理 🆕 v6.0

`core/nl-agent.ts` + 视口右下角 💬 AI 设计助手 + 门禁 31 `nl_agent_audit`（25 断言）。

- **零依赖规则/关键词意图解析**（中英双语）：曲面类型（Gyroid/Diamond/…）、孔隙率、材料（Ti64/PLA/散热）、端板、单元尺寸、壁厚、容器形状、结构模式；
- **动作意图**：导出 STL/3MF、运行压溃仿真、重置默认、骨支架预设（Ti64+实体网络）；
- **安全钳制**：孔隙率 [5,95]%、端板 [0,10]mm、cellSize [1,8]、壁厚 [0.2,5]——不臆造、越界即钳；
- **结构化日志**：每次解析返回逐项调整日志（字段→值）+ 置信度，对话面板逐条展示；
- **确定性原则**：只做确定性映射，未识别输入显式返回 unknown 并引导帮助，绝不静默失败或瞎猜参数；
- **示例**：「给我设计一个孔隙率 75%、采用 Gyroid 结构、上下带 2mm 实心端板、用于股骨修复的人工骨支架，并导出 3MF。」→ 一次到位：参数全应用 + 模型下载。

---

## 三十一、隐式神经场（SIREN）潜在拓扑流形探索 🆕 v7.0

`core/neural-implicit-field.ts` + `core/neural-implicit-weights.ts`（生成器 `.verify/gen_neural_weights.mjs`）+ 门禁 32 `neural_implicit_audit`（43 断言）。

- **架构**：4 层正弦激活 MLP（SIREN）——输入为 Fourier 特征 `[sin x, cos x, sin y, cos y, sin z, cos z]`，3 隐层 sin 激活（宽度 16）+ 线性输出；
- **关键定案——精确周期性**：Fourier 特征输入使网络对每轴**严格 2π 周期**（500 随机点周期偏差 2.16e-15），跨周期网格水密由构造保证（原始 SIREN 直吃坐标在周期边界存在拟合误差缝，会破坏 Surface Nets 水密性）；
- **蒸馏权重**：5 位拓扑专家（Gyroid/Diamond/Lidinoid/Schwarz P/分形骨小梁）由离线 Adam 蒸馏（教师场 = 平台渲染单一语义源 TPMS_FUNCTIONS），16³ 终评 RMSE 0.69%~8.04%（分形多尺度最难，如实标注）；
- **8 维潜在空间**：专家混合解码 m = softmax(−‖z−A_i‖²/2σ²)，σ=2（实测标定：σ=1 插值斜率 9.5 → σ=2 降至 4.4）；锚点 A_i 为 ±3 Walsh 码字（8 阶 Hadamard 前 5 行，两两汉明距离 4 ⇒ 交叉权重 e^-72）；
- **UI 操作**：侧栏「隐式神经拓扑 (Generative INR)」→ 启用 → 点击 5 个专家锚点或拖动 z₀~z₇ 滑块做拓扑流形插值，状态行实时显示最近锚点与混合熵；
- **性能口径**：锚点态走单专家快路径（HD 重建成本 ≈ 单专家）；流形插值态 5 专家全前向，预览优先 + 松手 HD 的 LOD 调度保证跟手；
- **诚实边界**：神经场为教师场的蒸馏近似（非精确 TPMS）；WebGPU 指令 IR 不感知神经场，启用时自动回退 CPU 管线；Lipschitz 常数由幂迭代谱范数乘积界守护（门禁断言采样梯度上界 ≤ 乘积界）。

## 三十二、三维多轴各向异性屈服面与多孔破坏裕度分析 🆕 v7.0

`physics/yield-surface.ts` + `viewers/yield-viewer.ts` + 门禁 33 `yield_surface_audit`（35 断言）。

- **统一射线距离口径**：所有准则给出「从原点沿单位方向 n̂ 走到包络面的距离 r(n̂)」——星形凸封闭包络下安全系数 SF = r(n̂)/|σ₀| 精确；
- **四准则**：Hill-48 各向异性二次准则（+静水压力帽封闭）、Tsai-Wu 拉-压不对称（射线距离有解析二次根式，+Xt/−Xc 双强度精确复现）、Gurson 多孔压溃（q=孔隙率，f 沿射线严格单调 ⇒ 二分可靠；静水极点解析式 (2σ₀/3)·arccosh((1+q²)/2q) 精确命中）、Drucker-Prager 圆锥（σyt/σyc 反演 α,k + 压缩平台帽）；
- **凸性守卫**：所有约束域均为凸集且含原点于内部 ⇒ 交包络星形凸；门禁以 200 对表面点中点凸性检验押注（**教训：审查工具 σv 换算 Σ 漏乘 ½ 会使 σv 抬高 √2、凸性虚增 ~0.35，两度假红——审查工具必须先被校准**）；
- **工程推导**：`deriveScaffoldYieldConfigs` 从当前结构自动推导四准则参数——σ_pl = C2·σys·ρ̄^1.5（与冲击吸能同源）、方向强度 = σ_pl·√(E_i/Ē)（一阶映射）、拉压比 0.7、Gurson q = 孔隙率；
- **UI 操作**：侧栏「多轴屈服包络面」→ 选准则 + 输入工作主应力 σ₀ → 3D 交互视口（拖拽旋转）+ 安全系数/临界失效模式读数；
- **诚实边界**：Hill 静水帽与 DP 压帽为工程估算；方向强度一阶映射的文献带 ±30%。

## 三十三、声子晶体能带色散与超材料宽频振动隔离设计 🆕 v7.0

`physics/phononic-bandgap.ts` + 门禁 34 `phononic_bandgap_audit`（18 断言）。

- **模型口径**：Born–von Kármán 点阵动力学——单胞离散为 N³ 体素质点（仅固相携带质量），26 邻域轴向弹簧；Bloch 周期条件 u(x+a)=u(x)e^{ik·a} 组装波矢相关 Hermitian 复刚度 K(k)；
- **实化技巧**：Hermitian H = A + iB ↔ 实对称 [[A,−B],[B,A]]（特征值成对复制），全程实数运算无需复特征求解器；实化谱**隔二取一**展开物理支（简并多重度保留）；
- **标定定案**：κ 由长波动力矩阵精确反演（ω²_LA = κh²k²·S_x/(mN³)，S_x = Σdx⁴/d2）——**仿射均质化 C1111 不等于长波声速**（非仿射弛豫，实测比 0.53 与 26 键立方解析 0.54 吻合）；首版推导误带因子 2，实测斜率恰 √2×目标反推修正；
- **Γ 点物理**：3 平动零模态（声学支）——**PBC 下转动场 u=ω×r 非周期不容许**（自由漂浮 6 刚体模态口径不适用于能带问题，‖K·u_rot‖≠0 探针反证）；
- **求解器演进教训**（五轮，全部有探针/稠密对拍证据）：子空间迭代收敛到最大特征值 → 移位倒置对密集低频无加速 → CheFSI 窗口塌缩 → 稠密移位反演受谱间距比限制 → **终案 = 两轮 deflate-Lanczos**（run1 Ritz 向量锁定 + run2 正交补第二副本，简并度完整捕获）；
- **UI 操作**：侧栏「声子能带与振动禁带」→ 计算能带色散 → Γ-X-M-R-Γ 图谱 + 禁带底纹 + 声速比/零模态/BG% 读数；
- **诚实边界**：禁带为**路径口径**（全向禁带需全 BZ 采样）；弹簧网络为集总参数近似（光学支定量精度受模型限制）；材料阻尼未计。

## 三十四、组织工程成骨长入与微流体氧气输运反应-扩散仿真 🆕 v7.0

`physics/tissue-growth.ts` + 门禁 35 `tissue_growth_audit`（11 断言）。

- **控制方程**：氧准稳态扩散-Michaelis-Menten 消耗（∇²C = Vmax·ρ·C/((Km+C)·D)）+ 成骨细胞 Logistic 增殖（低氧 Heaviside 门控 H(C−C_hyp)）+ 骨矿化累积 ∂m/∂t = r_bone·ρ·H(C−C_min)；
- **算子分裂定案**：真实氧扩散时间 τ = L²/D ≈ 0.05 day ≪ 28 天增殖——氧气场处于准静态流形，每日先解准稳态（7 点 Jacobi）再显式更新细胞/矿化；
- **参数定标**：Vmax 按氧穿透深度 L_pen = √(2·D·C₀/Vmax) ≈ 0.4mm 定标（文献带 200~500µm）——首版 Vmax=12 时穿透深度 2.6mm > 2mm 域，全域无低氧（假 100% 存活）；
- **质量守恒**：边界层→内部面通量 = 内部域消耗（残差 0.000%）——**口径教训**：Dirichlet 值在边界流体层上，穿入通量在层与内部之间（对域外面积分得零通量 → 2e15% 假残差）；边界层自身消耗由外界面直接供养；
- **指标口径**：绝对存活细胞质量（组织工程总成骨容量）——质量加权存活率在「边界源模型」下受流体几何分布支配（密实支架流体贴边反而加权存活率高），不具可比性；
- **UI 操作**：侧栏「组织长入 0~28 天」→ 运行模拟 → 时间轴播放 O₂ 云图（视口顶点着色）+ 平均氧/存活率统计曲线；
- **诚实边界**：连续介质单尺度（无细胞个体/血管生成动力学）；氧参数为文献带工程估算（mm-day 单位制）；对流项保留接口默认 v=0。

## 三十五、水平集拓扑导数自适应多目标优化重构 🆕 v7.0

`core/levelset-optimizer.ts` + 门禁 36 `levelset_optimizer_audit`（8 断言）。

- **控制方程**：Hamilton-Jacobi 界面演化 ∂Φ/∂t + V_n·|∇Φ| = 0（Godunov 迎风开关），Φ = TPMS 符号场；
- **速度场**：V_n = wStiff·(σvm − σ̄)/σ̄（弹性 VM fully-stressed，来自 `solvePlasticityCompression` 弹性口径单步）− wFlow·(|∇p| − p̄)/p̄（FD-Darcy 压力梯度）；
- **体积约束定案**：零均值必须在**界面体素**（|Φ|≤1.5h）上取 + 体积 Lagrange 偏置（2·(sf₀−sf) 钳 ±0.2）——首版在 2×band 带上取均值，位移控制下软化假象使固相 0.50→0（刚驱死亡螺旋）或 0.76（流驱失控 κ 反降 ×0.19）；
- **柔度口径定案**：求解器为位移控制——经典柔度（固定服务载荷 F₀）= F₀²/(2k) ∝ 1/reaction；½Fδ 口径在位移控制下随软化**下降**（首版 69%「优化」实为结构软化假信号）；
- **工程配套**：岛清理（最大 6 连通分量保留——H-J 局部演化天然产生孤岛，弹性 K 连通性守卫拒绝奇异）+ 精确 EDT 再初始化（exactEDT，终态界面 |∇Φ| = 1.15）+ `phiToVField` 节点网格上采样经 gpuVField 注入 Surface Nets 水密提取；
- **UI 操作**：侧栏「水平集主动拓扑优化」→ 设流阻权重 → 演化 10 步（可多次累积）→ 应用演化结果到视口；
- **诚实边界**：体素级界面敏感度（非连续伴随法拓扑导数）；柔度为线弹性口径；流阻敏感度为标量压力梯度代理（非完整 N-S）。

---

### v7.0 变更总览（36 门 · 1000+ 断言）

| 阶段 | 模块 | 门禁 | 断言 |
|---|---|---|---|
| I | 隐式神经场 SIREN 生成式拓扑 | 32 neural_implicit_audit | 43 |
| II | 三维多轴屈服包络面 | 33 yield_surface_audit | 35 |
| III | Bloch-Floquet 声子能带与禁带 | 34 phononic_bandgap_audit | 18 |
| IV | 组织长入反应-扩散动力学 | 35 tissue_growth_audit | 11 |
| V | 水平集主动拓扑优化 | 36 levelset_optimizer_audit | 8 |

---

### v6.0 变更总览（30+ 门 · 1200+ 断言）

| 阶段 | 模块 | 门禁 | 断言 |
|---|---|---|---|
| I | WebGPU 弹塑性大变形求解器 | 27 gpu_plasticity_audit | 42 |
| II | 数字孪生压溃与断裂失效 | 28 digital_twin_compression_audit | 21 |
| III | Navier-Stokes 微流体求解器 | 29 wasm_navier_stokes_audit | 15 |
| IV | LPBF 热-力耦合预测 | 30 lpbf_thermo_mechanical_audit | 18 |
| V | 自然语言 CAD 代理 | 31 nl_agent_audit | 25 |
