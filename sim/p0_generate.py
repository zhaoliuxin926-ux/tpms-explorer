# -*- coding: utf-8 -*-
"""Phase 1 生成端：TPMS 隐式场 → marching cubes → 水密 STL。

network 模式（缺省）：固相 = f >= c，c 由目标孔隙率二分确定（规则采样点计数）。
sheet 模式（2026-11-07 宿舍批）：固相 = |f| <= t（绕中面 f=0 对称区间提取，八坑 #1 正解——
  禁止中面 offset 加厚，从几何根源杜绝鞍点自交）；壁厚由 --solid 目标固相率二分 t 确定
  （八坑 #2 纪律：参数标定用相对密度而非名义壁厚——|∇f| 空间变化，固定 t 的几何壁厚
  ≈2t/|∇f| 天然不均，实测固相率披露为准）。

与平台口径对齐：k=周期数（无量纲域 [0, 2πk]³），R=每周期采样格数，
network: targetPorosity=目标孔隙率（0.60=60% 孔隙）；sheet: --solid=目标固相率。
用法：python sim/p0_generate.py [--type gyroid] [--structure network|sheet]
      [--k 2] [--R 24] [--por 0.60 | --solid 0.35] [--out sim/out/xxx.stl]
"""
import argparse
import sys
import time
from pathlib import Path

import numpy as np
import trimesh
from skimage import measure

REPO = Path(__file__).resolve().parents[1]


def gyroid_field(k: int, R: int) -> tuple[np.ndarray, np.ndarray]:
    """无量纲 gyroid 场 f 与采样坐标。域 [0, 2πk]³，每周期 R 格。"""
    n = k * R
    ax = np.linspace(0.0, 2.0 * np.pi * k, n + 1)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    f = np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)
    return f, ax


def diamond_field(k: int, R: int) -> tuple[np.ndarray, np.ndarray]:
    """无量纲 diamond 场（与平台 tpms-functions.ts 同源四项式）。域 [0, 2πk]³。"""
    n = k * R
    ax = np.linspace(0.0, 2.0 * np.pi * k, n + 1)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    f = (np.sin(x) * np.sin(y) * np.sin(z)
         + np.sin(x) * np.cos(y) * np.cos(z)
         + np.cos(x) * np.sin(y) * np.cos(z)
         + np.cos(x) * np.cos(y) * np.sin(z))
    return f, ax


FIELDS = {"gyroid": gyroid_field, "diamond": diamond_field}


def solve_level(f: np.ndarray, solid_fraction: float) -> float:
    """二分等值面 level c 使采样固相占比 mean(f>=c) → solid_fraction。"""
    lo, hi = float(f.min()), float(f.max())
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        frac = float(np.mean(f >= mid))
        if frac > solid_fraction:      # 固相偏多 → 提高 c
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def solve_sheet_halfwidth(f: np.ndarray, solid_fraction: float) -> float:
    """sheet 模式：二分区间半宽 t 使 mean(|f|<=t) → solid_fraction（单调递增，二分安全）。"""
    lo, hi = 0.0, float(np.abs(f).max())
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        frac = float(np.mean(np.abs(f) <= mid))
        if frac < solid_fraction:      # 固相偏少 → 加宽区间
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def box_sdf(ax: np.ndarray, box_lo: float, box_hi: float) -> np.ndarray:
    """采样域上的盒子 SDF（盒内为负）。盒=[box_lo, box_hi]，须严格落在数据域内部。"""
    half = 0.5 * (box_hi - box_lo)
    mid = 0.5 * (box_lo + box_hi)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    qx = np.abs(x - mid) - half
    qy = np.abs(y - mid) - half
    qz = np.abs(z - mid) - half
    outside = np.sqrt(
        np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2
    )
    inside = np.minimum(np.maximum(np.maximum(qx, qy), qz), 0.0)
    return outside + inside


def generate(k: int, R: int, porosity: float, ftype: str = "gyroid",
             structure: str = "network", solid: float = 0.35
             ) -> tuple[trimesh.Trimesh, float]:
    """生成水密 TPMS 实体。

    structure="network"：固相 = f≥c（c 二分自目标孔隙率），返回 level c；
    structure="sheet"：固相 = |f|≤t（t 二分自目标固相率 solid），返回 t。
    体积分数守恒盒 [0,2πk]³ + 数据域外扩 margin 格（T1 评审定案）。
    """
    # 盒=严格整数周期 [0, 2πk]³（体积分数守恒域），数据域向外扩 margin 格
    # （旧实现域锁 [0,2πk] 盒内缩 → 盒内仅 1.846 周期 + solve_level 全域统计与盒内
    #  几何不一致，结构性孔隙率偏差 ~0.9pp——反重力 T1 评审定位，实测修复后 -0.02pp 级）
    margin = 2
    dx = 2.0 * np.pi / R
    box_lo, box_hi = 0.0, 2.0 * np.pi * k
    ax = np.linspace(-margin * dx, box_hi + margin * dx, k * R + 2 * margin + 1)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    # 场分族（2026-10-31）：gyroid 原式；diamond 与平台 tpms-functions.ts 同源四项式
    if ftype == "diamond":
        f = (np.sin(x) * np.sin(y) * np.sin(z)
             + np.sin(x) * np.cos(y) * np.cos(z)
             + np.cos(x) * np.sin(y) * np.cos(z)
             + np.cos(x) * np.cos(y) * np.sin(z))
    else:
        f = np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)
    # 阈值只在盒内统计（与最终几何的统计域一致）
    eps = 1e-6
    in_box = ((x >= box_lo - eps) & (x <= box_hi + eps)
              & (y >= box_lo - eps) & (y <= box_hi + eps)
              & (z >= box_lo - eps) & (z <= box_hi + eps))
    t = None
    if structure == "sheet":
        # 八坑 #1 正解：隐式场区间提取（禁中面 offset——鞍点自交根源杜绝）；
        # 八坑 #2 纪律：壁厚参数用目标固相率二分（|∇f| 空间变化→固定 t 壁厚不均）
        t = solve_sheet_halfwidth(f[in_box], solid)
        g = np.maximum(np.abs(f) - t, box_sdf(ax, box_lo, box_hi))
    else:
        c = solve_level(f[in_box], 1.0 - porosity)
        g = np.maximum(c - f, box_sdf(ax, box_lo, box_hi))
    verts, faces, _, _ = measure.marching_cubes(g, level=0.0)
    verts = verts * dx + np.array([ax[0], ax[0], ax[0]])
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    if mesh.volume < 0:
        mesh.invert()
    # 清洗段：MC 在 TPMS 等值面与盒 SDF 交线附近产生共面折叠三角对/退化面
    # （实测 HXT 报 dihedral=0 自交）——process(validate=True)=合并顶点+去无限/重复/退化面，
    # 仍不水密时 pymeshfix 兜底；三阶段审计披露侵蚀量（ΔV/V>1% 须人工介入）
    vol_raw, faces_raw = mesh.volume, len(mesh.faces)
    mesh.process(validate=True)
    faces_proc = len(mesh.faces)
    fix_delta_v = 0.0
    if not mesh.is_watertight:
        import pymeshfix
        v, f = pymeshfix.clean_from_arrays(
            np.array(mesh.vertices), np.array(mesh.faces)   # TrackedArray 会被拒收
        )
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=False)
        if mesh.volume < 0:
            mesh.invert()
        fix_delta_v = mesh.volume - vol_raw
    dv_pct = fix_delta_v / vol_raw * 100 if vol_raw else 0.0
    flag = "WARN" if abs(dv_pct) > 1.0 else "ok"
    print(f"[geom-audit] raw faces={faces_raw} vol={vol_raw:.2f} -> proc faces={faces_proc} "
          f"-> final faces={len(mesh.faces)} vol={mesh.volume:.2f} "
          f"meshfix_dV={fix_delta_v:+.3f}mm3 ({dv_pct:+.2f}%) [{flag}]")
    return mesh, (t if structure == "sheet" else c)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", type=str, default="gyroid", choices=sorted(FIELDS), help="曲面类型（gyroid/diamond）")
    ap.add_argument("--structure", type=str, default="network", choices=["network", "sheet"],
                    help="network=单侧阈值固相网络（缺省）；sheet=绕中面区间提取薄片（八坑 #1 正解）")
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--R", type=int, default=24)
    ap.add_argument("--por", type=float, default=0.60, help="network 模式：目标孔隙率（sheet 模式下忽略）")
    ap.add_argument("--solid", type=float, default=0.35,
                    help="sheet 模式：目标固相率（决定壁厚；|∇f| 非常数故不用名义壁厚标定）")
    ap.add_argument("--out", type=str, default=None)
    args = ap.parse_args()

    t0 = time.time()
    if args.structure == "sheet":
        mesh, thr = generate(args.k, args.R, porosity=1.0 - args.solid, ftype=args.type,
                             structure="sheet", solid=args.solid)
        thr_label = f"tfield={thr:.4f}"
    else:
        mesh, thr = generate(args.k, args.R, args.por, args.type)
        thr_label = f"level_c={thr:.4f}"
    bbox = mesh.bounds[1] - mesh.bounds[0]
    actual_por = 1.0 - mesh.volume / float(np.prod(bbox))
    comps = len(mesh.split(only_watertight=False))

    if args.structure == "sheet":
        out = (Path(args.out) if args.out else
               REPO / "sim" / "out" / f"{args.type}_sheet_k{args.k}_R{args.R}_s{int(args.solid*100)}.stl")
    else:
        out = (Path(args.out) if args.out else
               REPO / "sim" / "out" / f"{args.type}_k{args.k}_R{args.R}_p{int(args.por*100)}.stl")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(trimesh.exchange.stl.export_stl(mesh))

    print(f"[{'OK' if (mesh.is_watertight and mesh.is_winding_consistent and comps == 1) else 'WARN'}] "
          f"{out.name}: faces={len(mesh.faces)} watertight={mesh.is_watertight} "
          f"winding={mesh.is_winding_consistent} comp={comps} "
          f"{'solid' if args.structure == 'sheet' else 'target_por'}={args.solid if args.structure == 'sheet' else args.por:.4f} "
          f"actual_por={actual_por:.4f} "
          f"dev={(abs((1.0-actual_por)-args.solid)*100 if args.structure=='sheet' else abs(actual_por-args.por)*100):.2f}pp {thr_label} "
          f"bbox={np.round(bbox,2).tolist()} t={time.time()-t0:.1f}s")
    return 0 if (mesh.is_watertight and mesh.is_winding_consistent and comps == 1) else 1


if __name__ == "__main__":
    sys.exit(main())
