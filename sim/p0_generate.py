# -*- coding: utf-8 -*-
"""Phase 1 生成端：TPMS 隐式场 → marching cubes → 水密 STL。

network 模式：固相 = f >= c，c 由目标孔隙率二分确定（规则采样点计数）。
sheet 模式：固相 = |f - f0| <= t/2 区间提取（后续批次）。

与平台口径对齐：k=周期数（无量纲域 [0, 2πk]³），R=每周期采样格数，
targetPorosity=目标孔隙率（体积分数，0.60=60% 孔隙）。
用法：python sim/p0_generate.py [--k 2] [--R 24] [--por 0.60] [--out sim/out/xxx.stl]
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


def generate(k: int, R: int, porosity: float) -> tuple[trimesh.Trimesh, float]:
    # 数据域比盒外扩 2 格：盒面（sdf=0）必须落在数据内部，等值面才能在盒壁闭合
    margin = 2
    n = k * R + 2 * margin
    ax = np.linspace(0.0, 2.0 * np.pi * k, n + 1)
    x, y, z = np.meshgrid(ax, ax, ax, indexing="ij")
    f = np.sin(x) * np.cos(y) + np.sin(y) * np.cos(z) + np.sin(z) * np.cos(x)
    c = solve_level(f, 1.0 - porosity)
    box_lo, box_hi = 2.0 * np.pi * k * margin / n, 2.0 * np.pi * k * (1 - margin / n)
    g = np.maximum(c - f, box_sdf(ax, box_lo, box_hi))
    verts, faces, _, _ = measure.marching_cubes(g, level=0.0)
    scale = (ax[1] - ax[0]) / 1.0
    verts = verts * scale
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    if mesh.volume < 0:
        mesh.invert()
    # 清洗段：MC 在 TPMS 等值面与盒 SDF 交线附近产生共面折叠三角对/退化面
    # （实测 HXT 报 dihedral=0 自交）——process(validate=True)=合并顶点+去无限/重复/退化面，
    # 仍不水密时 pymeshfix 兜底
    mesh.process(validate=True)
    if not mesh.is_watertight:
        import pymeshfix
        v, f = pymeshfix.clean_from_arrays(
            np.array(mesh.vertices), np.array(mesh.faces)   # TrackedArray 会被拒收
        )
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=False)
        if mesh.volume < 0:
            mesh.invert()
    return mesh, c


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--R", type=int, default=24)
    ap.add_argument("--por", type=float, default=0.60)
    ap.add_argument("--out", type=str, default=None)
    args = ap.parse_args()

    t0 = time.time()
    mesh, c = generate(args.k, args.R, args.por)
    bbox = mesh.bounds[1] - mesh.bounds[0]
    actual_por = 1.0 - mesh.volume / float(np.prod(bbox))
    comps = len(mesh.split(only_watertight=False))

    out = Path(args.out) if args.out else REPO / "sim" / "out" / f"gyroid_k{args.k}_p{int(args.por*100)}.stl"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(trimesh.exchange.stl.export_stl(mesh))

    print(f"[OK] {out.name}: faces={len(mesh.faces)} watertight={mesh.is_watertight} "
          f"winding={mesh.is_winding_consistent} comp={comps} "
          f"target_por={args.por:.4f} actual_por={actual_por:.4f} "
          f"dev={abs(actual_por-args.por)*100:.2f}pp level_c={c:.4f} "
          f"bbox={np.round(bbox,2).tolist()} t={time.time()-t0:.1f}s")
    return 0 if (mesh.is_watertight and mesh.is_winding_consistent and comps == 1) else 1


if __name__ == "__main__":
    sys.exit(main())
