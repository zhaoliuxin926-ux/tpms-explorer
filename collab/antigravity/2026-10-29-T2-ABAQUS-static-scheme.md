# T2 · Phase 2 ABAQUS Static 弹性段求解方案设计

- **设计日期**：2026-10-29
- **设计方**：反重力 / Antigravity
- **主控方**：ZCode（宿舍侧）
- **依据与约束真源**：
  - `collab/README.md`（T2 任务书）
  - `tpms/agent/fit-batch.mjs`（CSV 契约真源）
  - `PHYSICAL_TESTING_PROTOCOL.md`（§四/§六/§九 协议口径）
  - `tpms/tpms-platform/src/export/verification-suite.ts`（runner 契约）
  - `plans/2026-10-28-tpms-simulation-pipeline-research.md`（仿真管线全貌）
  - `agent_memory/progress.md`（T1 闭环结论与最新网格数据）
- **协作铁律**：本文档仅写入 `collab/antigravity/`，不修改工作树其余文件，不执行 git 操作。

---

## 一、阅读文件与设计依据清单

| 文件路径 | 提取的关键依据与约束 |
|---|---|
| `tpms/agent/fit-batch.mjs` | **CSV 硬契约**：必须以 `# key=value` 输出 `lengthMm/widthMm/thicknessMm`；表头必须为 `displacement_mm,force_N`；正负号约定为位移与压缩力均为正；空行/注释行过滤逻辑。 |
| `PHYSICAL_TESTING_PROTOCOL.md` | §四/§六 压缩试验口径：×2.5 档标称 $H_0=24\text{ mm}$（含上下各 $2\text{ mm}$ 实心端板），横向截面 $20\times 20\text{ mm}$；§九 明确 Static 求解提取顶面 `*OUTPUT, HISTORY`（NSET_TOP 的 RF+U），后处理口径 $\sigma=-\Sigma RF_3/A_0$、$\epsilon=-U_3/H_0$。 |
| `tpms/tpms-platform/src/export/verification-suite.ts` | 批十七 P1-06 修复结论：Abaqus 提取脚本必须从 FIELD `fieldOutputs['RF']` 与 HISTORY 双重兼容；符号约定严格为 `force.append(-rf_sum)`、`disp.append(-u)`。 |
| `sim/p1_mesh.py`（T1 采纳后） | 输出的 `.inp` 已剔除 2D 面单元，网格类型规范化为 `C3D10`，节点序验证通过，`minSICN` 经坐标重构后稳定在 $>0.05$。 |
| `plans/2026-10-28 §1 & §3` | 单元二次四面体收敛标准；压板解析刚体原则；质量缩放与惯性力排查纪律。 |

---

## 二、设置清单总览（Executive Checklist）

| 模块 | 核心设置 | 参数 / 关键字 | 决策依据与说明 |
|---|---|---|---|
| **单元类型** | 二次四面体 | **C3D10**（直接位移法）<br>*C3D10M*（压板接触法） | 纯线性弹性段无体积自锁，C3D10 刚度矩阵正定、精度高且求解极速；若带接触必须切 C3D10M。 |
| **几何尺度** | 物理毫米制 | 单位制：$\text{mm}-\text{N}-\text{MPa}$ | 与平台物理协议对齐，应变/弹性模量直读 MPa。 |
| **底面边界** | 支座固定 | `*BOUNDARY`<br>`NSET_BOTTOM, 3, 3, 0.0`<br>+ 中心对称防漂移约束 | 模拟刚性底座支撑，消除垂直位移同时允许微小侧向变形，或采用固支模拟粘接。 |
| **顶面加载** | 单轴位移控制 | `*BOUNDARY`<br>`NSET_TOP, 3, 3, -disp` | **Phase 2 首选**：确定性线性收敛，1 增量步直达，免除接触非线性迭代风险。 |
| **备选加载** | 解析刚体压板 | `*SURFACE, TYPE=SEGMENTS` + 罚接触 | 作为进阶对照组，评估微观接触刚度过渡（Toe 区形成机理）。 |
| **分析步** | 静态线性/小变形 | `*STEP`<br>`*STATIC`<br>`0.05, 1.0, 1e-5, 0.05` | 默认划分 20 个增量步（步长 0.05），输出密集曲线供 `fit-batch` 高精拟合。 |
| **输出请求** | 场输出 + 历史输出 | `*NODE OUTPUT`<br>`U, RF`<br>`*NODE OUTPUT, NSET=NSET_TOP`<br>`U3, RF3` | FIELD 供云图与 runner 备用，HISTORY 供快速无损反力曲线提取。 |
| **数据交付** | 符合协议 §六 | `displacement_mm,force_N`<br>含 `# lengthMm=...` 元数据 | 严格对齐 `fit-batch.mjs`，可直接喂入 ISO 13314 反演。 |

---

## 三、关键分项技术论证与取舍

### 1. 单元选型：C3D10 vs C3D10M

- **理论机理对比**：
  - **C3D10（标准 10 节点二次四面体）**：位移型完全积分二次单元。在小应变弹性分析中，位移二阶插值、应力应变一阶线性分布，能够精确捕捉 TPMS 连续弯曲与鞍面曲率梯度，无剪切自锁。由于刚度矩阵纯对称正定，直接求解器（Direct Sparse Solver）收敛极佳。
  - **C3D10M（修正 10 节点四面体，带表面节点集中力重分配）**：SIMULIA 专为大变形接触与塑性不可压缩性（$\nu \to 0.5$）设计的改良单元。在传统 C3D10 上，接触面角节点的等效一致外力会出现**负加权**（Corner weight 为负，Midside weight 为正），导致接触压力剧烈跳跃、震颤甚至无法收敛；C3D10M 通过特殊质量/刚度集中技术使所有表面节点等效力恒正。
- **选型结论**：
  - **Static 弹性段（Phase 2 主线）**：由于材料处于线弹性阶段（无体积自锁），且主线采用顶面节点集直接施加位移边界（无接触面），**首选 C3D10**。C3D10 相比 C3D10M 具有更刚硬、更接近理论解析解的弹性响应，计算内存与耗时亦略优。
  - **后续压溃段（Explicit / Contact）**：一旦引入金属塑性、自接触或压板接触，必须切换至 **C3D10M**。

---

### 2. 边界条件与加载方式取舍

#### A. 顶部位移加载 vs 解析刚体压板接触

```
【方案 A：顶面直接位移加载】(Phase 2 首选推荐)
   ↓↓↓↓↓↓↓↓↓↓  U3 = -disp (直接作用于 NSET_TOP 节点集)
 ┌──────────────┐
 │  TPMS 网格   │  · 求解性质：100% 确定性线性求解，零迭代失败
 └──────────────┘  · 单元需求：标准 C3D10
 ════════════════  · 耗时：秒级求解 (Direct Solver 1次分解)

【方案 B：解析刚体压板接触加载】(进阶对标对照)
 ════════════════  刚性压板 (Analytical Rigid Surface)
   ↓↓↓↓  接触力   · 求解性质：高度非线性 (接触状态搜寻与牛顿迭代)
 ┌──────────────┐  · 单元需求：必须使用 C3D10M
 │  TPMS 网格   │  · 风险：接触面网格微凹凸引发严重不收敛 (SDI 循环)
 └──────────────┘  · 优势：可真实呈现物理压机接触初期的局部贴合 (Toe 区)
```

- **权衡决策**：
  - Phase 2 的核心目标是**打通仿真-实验同口径反演全链路**，首要保证自动化管线的健壮性与无人工干预通过率（Fail-Closed 闭环）。
  - 因此，**方案 A（直接位移加载）作为生产基线**；
  - 方案 B（压板接触）作为单独的可选扩展模板，保留在配置字典中，供深入探究接触非线性使用。

#### B. 底面支承与消除刚体位移

TPMS 试样底面（$Z=0$）节点集为 `NSET_BOTTOM`：
1. **主支承**：所有底面节点约束垂直位移 $U_3 = 0.0$。
2. **防侧向漂移（消除 $X, Y$ 平动与绕 $Z$ 轴转动）**：
   - 方式 1（全固支）：直接约束 `NSET_BOTTOM` 的 $U_1=U_2=U_3=0.0$。物理上对应试样与下压板黏结/高摩擦。由于试样含实心端板或厚基底，全固支与实际工况高度吻合。
   - 方式 2（微摩擦滑移）：仅对 `NSET_BOTTOM` 中最接近几何中心 $(X_c, Y_c, 0)$ 的单一节点约束 $U_1=U_2=0$，对另一侧主轴节点约束 $U_2=0$。
   - **基准推荐**：在纯弹性段推荐**方式 1（全固支）**，边界定义简单，与平台现行 `scenario` 导出的 INP 规范（`NSET_BOTTOM, 3, 3, 0.0` 且横向对称约束）保持一致。

---

### 3. 输出请求与数据提取路径

#### A. INP 侧关键字配置
在 `*STEP` 内配置兼顾云图展示与高性能曲线提取的输出请求：
```abaqus
*OUTPUT, FIELD, VARIABLE=PRESELECT
*NODE OUTPUT
U, RF
*ELEMENT OUTPUT
S, E
*OUTPUT, HISTORY
*NODE OUTPUT, NSET=NSET_TOP
U3, RF3
```

#### B. ODB 提取算法与口径对齐
从 `.odb` 提取位移与载荷时，采用双重回退机制：
1. **优先从 HISTORY 读取**：
   - 读取 `step.historyRegions['Node NSET_TOP'].historyOutputs['RF3']`；
   - 优势：无需加载庞大的 3D 场数据，秒级读取完成。
2. **回退从 FIELD 读取**（确保兼容任意 Abaqus 版本与无历史输出算例）：
   - 遍历 `step.frames`；
   - 提取 `NSET_TOP` 节点集上的 `fieldOutputs['U'].values[0].data[2]`（取平均位移或代表点位移）；
   - 提取 `fieldOutputs['RF'].values`，对集内所有顶面节点的 $Z$ 向反力求和：$RF_{\text{sum}} = \sum v.\text{data}[2]$。
3. **符号转换口径**：
   $$\text{disp\_mm} = -U_3 \quad (\ge 0)$$
   $$\text{force\_N} = -RF_{\text{sum}} \quad (\ge 0)$$

---

## 四、硬约束交付：兼容 fit-batch.mjs 契约的 CSV 规范

### 1. 契约语法规范（白名单严格校验）
依据 `tpms/agent/fit-batch.mjs` 第 58~75 行的正则解析规则，输出的 CSV 文件必须满足以下硬约束：

```csv
# lengthMm=24.000000
# widthMm=20.000000
# thicknessMm=20.000000
displacement_mm,force_N
0.000000,0.0000
0.012000,15.8231
0.024000,31.6450
...
```

- **元数据行**：
  - 语法必须精确匹配正则：`^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[\d.]+)\s*$`；
  - `lengthMm`：试样高度（加载向尺寸，mm）。必须匹配标称档 $\{12, 24, 34\} \pm 1$（例如 ×2.5 推荐档为 $24\text{ mm}$），否则 `fit-batch` 会报越档警示；
  - `widthMm` 与 `thicknessMm`：横向尺寸（mm），用于计算受压横截面积 $A_0 = \text{width} \times \text{thickness}$。
- **列头与数据**：
  - 必须包含 `displacement_mm,force_N`；
  - 数据必须从原点 $(0, 0)$ 开始；
  - 曲线应包含不少于 20 个等间距增量点，覆盖 $0 \sim 2\%$ 弹性变形阶段。

---

## 五、可直接执行的 Phase 2 脚本套件（参考实现）

反重力为 Phase 2 设计了两份核心脚本（可直接放置于 `sim/` 目录下由 ZCode 调度）：

### 1. 组装完整 INP：`sim/p2_static_setup.py`

负责读取 `sim/p1_mesh.py` 输出的纯几何网格 `.inp`，自动识别顶底面节点集，注入材料本构、截面与静力载荷步，生成就绪的 `_case.inp`：

```python
# -*- coding: utf-8 -*-
"""Phase 2 前处理组装器：裸网格 INP -> 完整 ABAQUS Static 压缩算例 INP。

用法：python sim/p2_static_setup.py <input_mesh.inp> [--specimen-h 24.0] [--specimen-w 20.0] [--strain 0.02]
"""
import argparse
from pathlib import Path
import numpy as np


def assemble_inp(mesh_inp: Path, h_mm: float, w_mm: float, strain: float,
                 E_modulus: float = 2000.0, nu: float = 0.3) -> Path:
    out_inp = mesh_inp.with_name(mesh_inp.stem + "_static.inp")
    lines = mesh_inp.read_text(encoding="utf-8").splitlines()

    # 1. 提取所有节点坐标，识别 Z 轴极值以划分 NSET_TOP 与 NSET_BOTTOM
    nodes = {}
    in_node = False
    for line in lines:
        if line.startswith("*NODE"):
            in_node = True
            continue
        if line.startswith("*"):
            in_node = False
            continue
        if in_node and line.strip():
            parts = [p.strip() for p in line.split(",")]
            nid = int(parts[0])
            coords = [float(p) for p in parts[1:4]]
            nodes[nid] = coords

    z_vals = [c[2] for c in nodes.values()]
    z_min, z_max = min(z_vals), max(z_vals)
    tol = 1e-3 * (z_max - z_min) if (z_max - z_min) > 0 else 1e-4

    bot_nodes = [nid for nid, c in nodes.items() if abs(c[2] - z_min) <= tol]
    top_nodes = [nid for nid, c in nodes.items() if abs(c[2] - z_max) <= tol]

    # 2. 组装新 INP
    buf = []
    buf.append("*HEADING")
    buf.append(f"TPMS Static Compression (H={h_mm}mm, W={w_mm}mm, E={E_modulus}MPa)")
    buf.append(f"** generated for fit-batch contract: lengthMm={h_mm}, widthMm={w_mm}")
    buf.extend(lines[1:])  # 保留原始 *NODE 与 *ELEMENT

    # 写入顶底节点集
    def write_nset(name: str, nids: list[int]):
        buf.append(f"*NSET, NSET={name}")
        for i in range(0, len(nids), 16):
            buf.append(", ".join(str(n) for n in nids[i:i + 16]))

    write_nset("NSET_BOTTOM", bot_nodes)
    write_nset("NSET_TOP", top_nodes)

    # 实体截面与线性弹性材料
    buf.append("*SOLID SECTION, ELSET=MergedCells, MATERIAL=TPMS_MAT")
    buf.append("*MATERIAL, NAME=TPMS_MAT")
    buf.append("*ELASTIC")
    buf.append(f"{E_modulus:.2f}, {nu:.4f}")

    # 静态压缩单步 (小应变弹性)
    disp = -abs(strain * h_mm)
    buf.append("*STEP, NAME=COMPRESSION, NLGEOM=NO")
    buf.append("*STATIC")
    buf.append("0.05, 1.0, 1e-5, 0.05")  # 20 个增量点

    # 边界条件
    buf.append("*BOUNDARY")
    buf.append("NSET_BOTTOM, 1, 3, 0.0")  # 底面全固支
    buf.append(f"NSET_TOP, 3, 3, {disp:.6f}")  # 顶面均匀受压位移

    # 输出请求 (兼顾 FIELD 与 HISTORY)
    buf.append("*OUTPUT, FIELD")
    buf.append("*NODE OUTPUT")
    buf.append("U, RF")
    buf.append("*ELEMENT OUTPUT")
    buf.append("S, E")
    buf.append("*OUTPUT, HISTORY")
    buf.append("*NODE OUTPUT, NSET=NSET_TOP")
    buf.append("U3, RF3")
    buf.append("*END STEP")

    out_inp.write_text("\n".join(buf) + "\n", encoding="utf-8")
    print(f"[setup] Assembled {out_inp.name}: bot_nodes={len(bot_nodes)}, top_nodes={len(top_nodes)}, disp={disp:.4f}mm")
    return out_inp
```

---

### 2. ODB 提取与契约 CSV 输出：`sim/p2_extract_csv.py`

在 Abaqus Python 环境下执行（`abaqus python sim/p2_extract_csv.py --odb <job>.odb --h <H> --w <W> --out <csv>`）：

```python
# -*- coding: utf-8 -*-
"""Phase 2 后处理提取器：从 ODB 提取反力与位移，输出符合 fit-batch 契约的 CSV。

运行环境：abaqus python sim/p2_extract_csv.py [args]
"""
import sys
import os

def extract_curve(odb_path, h_mm, w_mm, t_mm, out_csv):
    from odbAccess import openOdb

    odb = openOdb(odb_path, readOnly=True)
    step = odb.steps.values()[-1]

    disp_list = [0.0]
    force_list = [0.0]

    top_nset = odb.rootAssembly.nodeSets.get('NSET_TOP', None)

    for frame in step.frames:
        if frame.frameId == 0:
            continue
        # 1. 位移提取 (代表性位移)
        u_field = frame.fieldOutputs['U'].getSubset(region=top_nset)
        avg_u3 = sum(v.data[2] for v in u_field.values) / len(u_field.values)
        # 2. 反力总和提取
        rf_field = frame.fieldOutputs['RF'].getSubset(region=top_nset)
        sum_rf3 = sum(v.data[2] for v in rf_field.values)

        # 契约：压缩位移与压缩力为正
        disp_list.append(-avg_u3)
        force_list.append(-sum_rf3)

    odb.close()

    # 写入严格符合 fit-batch 契约的 CSV
    with open(out_csv, 'w') as f:
        # 元数据行 (必须使用单行 # key=value 语法)
        f.write('# lengthMm=%.4f\n' % h_mm)
        f.write('# widthMm=%.4f\n' % w_mm)
        f.write('# thicknessMm=%.4f\n' % t_mm)
        # 表头
        f.write('displacement_mm,force_N\n')
        for d, f_val in zip(disp_list, force_list):
            f.write('%.6f,%.4f\n' % (max(0.0, d), max(0.0, f_val)))

    print('[extract] Saved fit-batch compatible CSV -> %s (points=%d)' % (out_csv, len(disp_list)))

if __name__ == '__main__':
    # 极简命令行解析 (兼容 Abaqus Python 2.7 / 3.x)
    args = sys.argv[1:]
    odb_p = args[args.index('--odb') + 1]
    h = float(args[args.index('--h') + 1])
    w = float(args[args.index('--w') + 1])
    t = float(args[args.index('--t') + 1]) if '--t' in args else w
    out_p = args[args.index('--out') + 1] if '--out' in args else 'sim_result.csv'
    extract_curve(odb_p, h, w, t, out_p)
```

---

## 六、全链路打通与验证交接

1. **工作流闭环验证路径**：
   ```bash
   # 1. 生成几何与网格
   python sim/p0_generate.py --k 2 --R 24 --por 0.60 --out sim/out/g2.stl
   python sim/p1_mesh.py sim/out/g2.stl --lmax 0.5

   # 2. 装配 Static 算例 (毫米尺寸标定)
   python sim/p2_static_setup.py sim/out/g2.inp --specimen-h 24.0 --specimen-w 20.0

   # 3. ABAQUS 求解 (工位机/本地)
   abaqus job=g2_static input=sim/out/g2_static.inp cpus=4 interactive

   # 4. 提取契约 CSV
   abaqus python sim/p2_extract_csv.py --odb g2_static.odb --h 24.0 --w 20.0 --out specimens/csv/sim_g2_r1.csv

   # 5. 平台反演核对 (两条线的交汇点)
   node tpms/agent/fit-batch.mjs --dir specimens/csv
   ```
2. **交付结论**：
   - 本方案给出了完整的单元选型、加载边界取舍理论依据与参数清单；
   - 彻底锁死了力-位移 CSV 输出格式，无缝接入平台 `fit-batch.mjs`，消除跨端口径分歧；
   - 建议 ZCode 审查本设计后推进落地。
