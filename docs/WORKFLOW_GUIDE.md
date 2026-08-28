# TPMS 科研与增材制造实战指南

> 本指南面向四类工作流：**3D 打印与压缩试验**、**OpenFOAM 灌注 CFD 模拟**、**Python/MATLAB 脚本复现**、
> **学术渲染与论文汇报**。所有导出链路均经过 CI 门禁审计（见文末质量基准表），数据可溯源、参数可复现。
>
> 适用版本：`v3.0.0-nextgen-cae` 及以上。

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
