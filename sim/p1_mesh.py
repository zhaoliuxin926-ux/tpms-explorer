# -*- coding: utf-8 -*-
"""Phase 1 网格端：水密 STL → Gmsh HXT 四面体（二阶）→ meshio 出 ABAQUS .inp。

坑位对策（plan 八坑表 #4）：tet10 在 Gmsh msh 与 ABAQUS inp 之间的节点排列差异
由 meshio 的 permute 处理；inp 中材料/截面/ELSET 属 Phase 2 模板拼接，此处只出几何网格。

用法：python sim/p1_mesh.py <stl路径> [--lmax 0.5] [--dim mm]
验证 gate：单元体积符号全正（tet10 前 4 角点行列式>0 ⇒ 节点序正确）。
"""
import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import meshio
import numpy as np

REPO = Path(__file__).resolve().parents[1]


def make_mesh(stl: Path, lmax: float) -> Path:
    import gmsh

    out_msh = stl.with_suffix(".msh")
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.merge(str(stl))
        # discrete 路线：不参数化（classifySurfaces+forceParametrizable 对数万面片
        # 的 marching-cubes 网格是 O(面数) 的几何实体爆炸，实测 >4min 未返回）。
        # createTopology 把离散三角组成实体表面，STL 面网格直接作为体网格边界。
        gmsh.model.mesh.createTopology()
        surfaces = [s[1] for s in gmsh.model.getEntities(2)]
        sl = gmsh.model.geo.addSurfaceLoop(surfaces)
        gmsh.model.geo.addVolume([sl])
        gmsh.model.geo.synchronize()
        gmsh.option.setNumber("Mesh.Algorithm3D", 10)      # HXT
        gmsh.option.setNumber("Mesh.Optimize", 1)
        t0 = time.time()
        gmsh.model.mesh.generate(3)
        gmsh.model.mesh.setOrder(2)                         # 二阶 → C3D10
        gmsh.write(str(out_msh))
        n3d = len(gmsh.model.mesh.getElements(3, -1)[1][0])
        print(f"[gmsh] tet4={n3d} order2 t={time.time()-t0:.1f}s -> {out_msh.name}")
    finally:
        gmsh.finalize()
    return out_msh


def to_inp(msh_path: Path) -> Path:
    mesh = meshio.read(msh_path)
    tet10 = [c for c in mesh.cells if c.type == "tetra10"]
    if not tet10:
        types = {c.type: len(c.data) for c in mesh.cells}
        raise SystemExit(f"[FAIL] 无 tetra10 单元，实际单元类型：{types}")
    out_inp = msh_path.with_suffix(".inp")
    meshio.write(out_inp, mesh, file_format="abaqus")
    n_cells = sum(len(c.data) for c in tet10)
    n_nodes = len(mesh.points)
    print(f"[meshio] tet10={n_cells} nodes={n_nodes} -> {out_inp.name}")
    return out_inp, mesh


def verify_tet10(mesh) -> None:
    """角点行列式全正 ⇒ 节点序正确（ABAQUS 约定）。"""
    for c in mesh.cells:
        if c.type != "tetra10":
            continue
        p = mesh.points[c.data[:, :4].astype(int)]          # (n,4,3) 前 4 角点
        v0, v1, v2, v3 = p[:, 0], p[:, 1], p[:, 2], p[:, 3]
        vol6 = np.einsum("ij,ij->i", np.cross(v1 - v0, v2 - v0), v3 - v0)
        neg = int(np.sum(vol6 <= 0))
        print(f"[verify] tet10 六倍体积：min={vol6.min():.3e} 非正={neg}/{len(vol6)} "
              f"-> {'PASS' if neg == 0 else 'FAIL'}")
        if neg:
            raise SystemExit("[FAIL] 存在负体积单元，节点序或网格质量有问题")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("stl", type=str)
    ap.add_argument("--lmax", type=float, default=0.5)
    args = ap.parse_args()
    stl = Path(args.stl)
    msh = make_mesh(stl, args.lmax)
    inp, mesh = to_inp(msh)
    verify_tet10(mesh)
    print(f"[DONE] {inp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
