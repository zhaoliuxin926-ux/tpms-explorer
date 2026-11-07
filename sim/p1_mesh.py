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


def split_domains(stl: Path) -> list[Path]:
    """连通域分解（STL 顶点先 merge——STL 格式每三角形独立顶点，不 merge 全碎成
    逐三角"域"，实测 56240 域）。多域写 {stem}__dom{i}.stl 逐域处理；
    单域返回原文件（零改动路径）。"""
    import trimesh
    src = trimesh.load_mesh(stl, process=False)
    src.merge_vertices()
    comps = src.split(only_watertight=False)
    if len(comps) <= 1:
        return [stl]
    paths = []
    total_v = sum(abs(c.volume) for c in comps)
    for i, comp in enumerate(comps):
        p = stl.with_name(f"{stl.stem}__dom{i + 1}.stl")
        p.write_bytes(trimesh.exchange.stl.export_stl(comp))
        paths.append(p)
        if abs(comp.volume) / total_v < 0.01:
            print(f"[WARN] 域 {i + 1} 体积占比 {abs(comp.volume)/total_v*100:.4f}% "
                  f"（{len(comp.faces)} 面）——疑似 pymeshfix 孤立碎片，CFD 前建议人工确认后剔除")
    return paths


def concat_inps(inp_paths: list, out_inp: Path) -> None:
    """多域 .inp 拼接：节点/单元重编号合并。COMSOL/Fluent 按连通性自动识别域
    （两迷宫不接触），无需 physical 标签（Gmsh 端多 volume 路线证伪：STL 顶点
    合并行为不可控，实测聚出 4 片碎片+两迷宫混杂）。"""
    import numpy as np
    points_all, cells_all = [], []
    offset = 0
    for p in inp_paths:
        m = meshio.read(p)
        tet10 = [c for c in m.cells if c.type == "tetra10"]
        if not tet10:
            raise SystemExit(f"[FAIL] {p.name} 无 tetra10")
        cells_all.append(np.vstack([c.data for c in tet10]) + offset)
        points_all.append(m.points)
        offset += len(m.points)
    merged = meshio.Mesh(points=np.vstack(points_all),
                         cells=[("tetra10", np.vstack(cells_all))])
    meshio.write(out_inp, merged, file_format="abaqus")
    txt = out_inp.read_text(encoding="utf-8")
    n_mh = txt.count("TYPE=C3D10MH")
    if n_mh:
        out_inp.write_text(txt.replace("TYPE=C3D10MH", "TYPE=C3D10"), encoding="utf-8")
    print(f"[concat] {len(inp_paths)} 域合并 -> {out_inp.name} "
          f"(C3D10MH->C3D10 x{n_mh})")


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
        gmsh.option.setNumber("Mesh.MeshSizeMax", lmax)      # 仅作上限：勿设 ExtendFromBoundary=0 促粗化——
        gmsh.option.setNumber("Mesh.MeshSizeMin", lmax * 0.05)
        # 【2026-11-07 对抗审查实验定案】lmax"死参数"机制根因 = Gmsh 缺省
        # MeshSizeExtendFromBoundary=1：MC 密集边界网格的局部尺寸场向内延伸，
        # MeshSizeMax 只是上限管不住（0.5/0.8 逐位同实证）。置 0 可令 lmax 生效
        # （121,461 tets，-39%），**但实测有害**：薄壁壁厚方向解析被粗化破坏
        # （p50 0.738→0.418、<0.05 从 8 个暴涨 480× 至 3877 个）——边界驱动细
        # 网格是薄壁质量的保障机制，非缺陷。故保留缺省 1，lmax 仅防超大单元。
        gmsh.option.setNumber("Mesh.Algorithm3D", 10)      # HXT
        gmsh.option.setNumber("Mesh.Optimize", 1)
        t0 = time.time()
        gmsh.model.mesh.generate(3)
        # S6 质量审计：minSICN（signed inverse condition number，正四面体=1，工程红线~0.1）
        _, tets, _ = gmsh.model.mesh.getElements(3)
        quals = np.array(gmsh.model.mesh.getElementQualities(tets[0], "minSICN"))
        print(f"[quality] minSICN: min={quals.min():.4f} p50={np.median(quals):.3f} "
              f"<0.01={int((quals < 0.01).sum())} <0.05={int((quals < 0.05).sum())} "
              f"/ {len(quals)} tets")
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
    # 只写 tet10：混入的 2D 面单元（triangle6）会被 meshio 映射为 CPE6，
    # ABAQUS 三维模型直接 fatal（反重力 T1 实测定位——原实现把整个 mesh 传入 write）
    clean_mesh = meshio.Mesh(points=mesh.points, cells=tet10)
    out_inp = msh_path.with_suffix(".inp")
    meshio.write(out_inp, clean_mesh, file_format="abaqus")
    # meshio 将 tetra10 硬编码为 C3D10MH（杂交），Static 弹性段规范为 C3D10
    inp_text = out_inp.read_text(encoding="utf-8")
    n_mh = inp_text.count("TYPE=C3D10MH")
    inp_text = inp_text.replace("TYPE=C3D10MH", "TYPE=C3D10")
    out_inp.write_text(inp_text, encoding="utf-8")
    print(f"[meshio] tet10={sum(len(c.data) for c in tet10)} nodes={len(mesh.points)} "
          f"C3D10MH->C3D10 x{n_mh} -> {out_inp.name}")
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
    domains = split_domains(stl)
    if len(domains) == 1:
        msh = make_mesh(stl, args.lmax)
        inp, mesh = to_inp(msh)
        verify_tet10(mesh)
    else:
        print(f"[multidomain] {len(domains)} 域 → 逐域划网 + INP 拼接")
        inps = []
        total = 0
        for i, d in enumerate(domains):
            print(f"[multidomain] 域 {i + 1}/{len(domains)}: {d.name}")
            msh = make_mesh(d, args.lmax)
            inp_d, mesh_d = to_inp(msh)
            verify_tet10(mesh_d)
            inps.append(inp_d)
            total += len(mesh_d.cells[0].data) if len(mesh_d.cells) == 1 else 0
        inp = stl.with_suffix(".inp")
        concat_inps(inps, inp)
    print(f"[DONE] {inp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
