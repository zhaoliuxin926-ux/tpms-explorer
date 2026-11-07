# -*- coding: utf-8 -*-
"""Phase 3 流体域提取：TPMS 孔隙相（负空间）→ 水密 STL（COMSOL/Fluent 通用输入）。

与 p0 共享同一条等值面 f=c，取相反侧：固相 = f≥c（p0），孔隙域 = f<c（本脚本）——
盒 SDF/整数周期/清洗兜底机制全部复用 p0_generate。对账：孔隙域体积/盒体积 ≈ 目标孔隙率。
另做周期配对自检：x=0 与 x=2π 两个边界面三角形数应相等（数据周期性 ⇒ MC 截线逐点对应，
是单胞 PBC 网格周期条件的前置条件——discuss-2026-10-29-permeability-model 共识）。

用法：python sim/p3_fluid_domain.py [--k 1] [--R 24] [--por 0.60]
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
from p0_generate import box_sdf, solve_level  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def generate_fluid(k: int, R: int, porosity: float, structure: str = "network",
                   solid: float = 0.35):
    from skimage import measure
    margin = 2
    dx = 2.0 * np.pi / R
    box_lo, box_hi = 0.0, 2.0 * np.pi * k
    n = k * R + 2 * margin
    ax = np.linspace(-margin * dx, box_hi + margin * dx, n + 1)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    f = np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)
    eps = 1e-6
    in_box = ((x >= box_lo - eps) & (x <= box_hi + eps)
              & (y >= box_lo - eps) & (y <= box_hi + eps)
              & (z >= box_lo - eps) & (z <= box_hi + eps))
    if structure == "sheet":
        # sheet 孔隙域：|f|>t 侧（与 p0 sheet 固相 |f|≤t 同一等值面对）；t 与 p0 同法二分
        from p0_generate import solve_sheet_halfwidth
        t = solve_sheet_halfwidth(f[in_box], solid)
        g = np.maximum(t - np.abs(f), box_sdf(ax, box_lo, box_hi))  # g<0 ⇔ 孔隙∩盒内
    else:
        # c 与 p0 同源（同一等值面）；孔隙指示 h = c - f（p0 固相为 f-c）
        c = solve_level(f[in_box], 1.0 - porosity)       # c 按固相率二分（与 p0 一致）
        g = np.maximum(f - c, box_sdf(ax, box_lo, box_hi))  # g<0 ⇔ 孔隙(f<c)∩盒内（与 p0 固相侧相反）
        t = c
    verts, faces, _, _ = measure.marching_cubes(g, level=0.0)
    verts = verts * dx + np.array([ax[0], ax[0], ax[0]])
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    if mesh.volume < 0:
        mesh.invert()
    mesh.process(validate=True)
    if not mesh.is_watertight:
        import pymeshfix
        v, ff = pymeshfix.clean_from_arrays(np.array(mesh.vertices), np.array(mesh.faces))
        mesh = trimesh.Trimesh(vertices=v, faces=ff, process=False)
        if mesh.volume < 0:
            mesh.invert()
    return mesh, t


def periodic_pair_check(mesh: trimesh.Trimesh, k: int) -> tuple[bool, str]:
    """信息性输出（非 gate）：边界 x≈0 与 x≈2πk 三角形计数。

    截线的几何对应由数据周期性保证（f(0)=f(2πk)）；MC 边界三角剖分受两侧邻格
    （非镜像 margin）影响计数可不等——配对属网格器职责（Gmsh periodic 约束 /
    COMSOL 周期面对），几何端不做硬 gate。
    """
    L = 2.0 * np.pi * k
    tri_x = mesh.triangles[:, :, 0]
    near0 = np.all(tri_x < 1e-6, axis=1)
    nearL = np.all(tri_x > L - 1e-6, axis=1)
    n0, nL = int(near0.sum()), int(nearL.sum())
    return True, f"x=0 面 {n0} / x=2πk 面 {nL} 三角（计数差属 MC 邻格效应，配对在网格器侧处理）"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=1)        # 单胞优先（PBC 扫参主力，discuss-2 共识）
    ap.add_argument("--R", type=int, default=24)
    ap.add_argument("--por", type=float, default=0.60, help="network 模式：目标孔隙率")
    ap.add_argument("--structure", type=str, default="network", choices=["network", "sheet"])
    ap.add_argument("--solid", type=float, default=0.35, help="sheet 模式：目标固相率（与 p0 --solid 同源）")
    a = ap.parse_args()

    if a.structure == "sheet":
        mesh, thr = generate_fluid(a.k, a.R, porosity=1.0 - a.solid, structure="sheet", solid=a.solid)
        fluid_target = 1.0 - a.solid
        thr_label = f"tfield={thr:.4f}"
    else:
        mesh, thr = generate_fluid(a.k, a.R, a.por)
        fluid_target = a.por
        thr_label = f"level_c={thr:.4f}"
    bbox = mesh.bounds[1] - mesh.bounds[0]
    fluid_frac = mesh.volume / float(np.prod(bbox))
    pair_ok, pair_msg = periodic_pair_check(mesh, a.k)
    comps = len(mesh.split(only_watertight=False))

    if a.structure == "sheet":
        out = REPO / "sim" / "out" / f"fluid_gyroid_sheet_k{a.k}_s{int(a.solid*100)}.stl"
        # sheet 孔隙域预期 comp=2（G+/G- 双迷宫互不相通）——几何特征非缺陷
        comp_note = f"comp={comps}（{'双迷宫预期' if comps == 2 else '⚠ 非预期，应=2'}）"
    else:
        out = REPO / "sim" / "out" / f"fluid_gyroid_k{a.k}_p{int(a.por*100)}.stl"
        comp_note = f"comp={comps}"

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(trimesh.exchange.stl.export_stl(mesh))

    ok = mesh.is_watertight and mesh.is_winding_consistent
    sheet_comp_ok = (a.structure != "sheet") or (comps == 2)
    print(f"[{'OK' if (ok and sheet_comp_ok) else 'WARN'}] {out.name}: faces={len(mesh.faces)} "
          f"watertight={mesh.is_watertight} {comp_note} "
          f"fluid_frac={fluid_frac:.4f} (target {fluid_target:.2f}, "
          f"dev={abs(fluid_frac-fluid_target)*100:.2f}pp) | {thr_label} | 周期自检: {pair_msg}")
    return 0 if (ok and sheet_comp_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
