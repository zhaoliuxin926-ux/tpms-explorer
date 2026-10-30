# -*- coding: utf-8 -*-
"""Phase 2 前处理组装器：p1_mesh.py 裸网格 .inp -> 完整 ABAQUS Static 压缩算例 _static.inp。

T2 方案落地（含讨论修正，见 collab/antigravity/2026-10-29-T2-ABAQUS-static-scheme.md）：
- ELSET 注入：meshio 产物只有 *NODE/*ELEMENT 无单元集——*ELSET, ELSET=ESOLID, GENERATE
  圈全部单元（修正 T2 原稿引用不存在的 MergedCells）；
- S 输出口径 = sanity check：折痕带 minSICN<0.1 单元的局部应力不作定量依据
  （discuss-2026-10-29-mesh-quality 共识：宏观轨用全局力-位移，微观轨须交线带加密）；
- 尺寸自读：lengthMm/widthMm/thicknessMm 默认取几何 bbox 实际值
  （fit-batch 档位校验 {12,24,34}±1，越档会告警）；单位制 mm-N-MPa。

用法（仓库根执行）：
  python sim/p2_static_setup.py sim/out/gyroid_k2_p60.inp [--strain 0.02] [--E 2000] [--nu 0.3] [--h X] [--w X] [--t X]
产物：同目录 <stem>_static.inp，配 ABAQUS：abaqus job=<stem>_static cpus=4 interactive
"""
import argparse
import sys
from pathlib import Path


def parse_mesh_inp(path: Path):
    """读 meshio 裸网格：返回 (原始行列表, nodes{id:[x,y,z]}, max_elem_id, n_elems)。"""
    lines = path.read_text(encoding="utf-8").splitlines()
    nodes, section = {}, None
    max_eid, n_elems = 0, 0
    for ln in lines:
        s = ln.strip()
        if s.startswith("*"):
            section = s.split(",")[0].upper()
            continue
        if not s:
            continue
        if section == "*NODE":
            p = [x.strip() for x in s.split(",")]
            nodes[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
        elif section == "*ELEMENT":
            eid = int(s.split(",")[0])
            max_eid = max(max_eid, eid)
            n_elems += 1
    if not nodes or not n_elems:
        raise SystemExit(f"[FAIL] {path.name} 未解析到 *NODE/*ELEMENT（确认是 p1_mesh 产物）")
    return lines, nodes, max_eid, n_elems


def assemble(mesh_inp: Path, strain: float, E: float, nu: float,
             h_override=None, w_override=None, t_override=None) -> Path:
    lines, nodes, max_eid, n_elems = parse_mesh_inp(mesh_inp)
    xs = [c[0] for c in nodes.values()]
    ys = [c[1] for c in nodes.values()]
    zs = [c[2] for c in nodes.values()]
    x_lo, x_hi = min(xs), max(xs)
    z_min, z_max = min(zs), max(zs)
    tol = 1e-3 * (z_max - z_min)
    bot = sorted(nid for nid, c in nodes.items() if abs(c[2] - z_min) <= tol)
    top = sorted(nid for nid, c in nodes.items() if abs(c[2] - z_max) <= tol)
    if not bot or not top:
        raise SystemExit("[FAIL] 顶/底面节点集为空（Z 极值容差内无节点）")

    h = h_override if h_override else z_max - z_min
    w = w_override if w_override else x_hi - x_lo
    t = t_override if t_override else max(ys) - min(ys)
    disp = -abs(strain) * h
    out = mesh_inp.with_name(mesh_inp.stem + "_static.inp")

    buf = []
    buf.append("*HEADING")
    buf.append(f"TPMS Static compression (H={h:.4f} W={w:.4f} T={t:.4f} mm, E={E:.1f} MPa, nu={nu})")
    buf.append(f"** for fit-batch contract: lengthMm={h:.6f} widthMm={w:.6f} thicknessMm={t:.6f}")
    buf.extend(lines)
    buf.append("*ELSET, ELSET=ESOLID, GENERATE")
    buf.append(f"1, {max_eid}, 1")

    def nset(name, ids):
        buf.append(f"*NSET, NSET={name}")
        for i in range(0, len(ids), 16):
            buf.append(", ".join(str(n) for n in ids[i:i + 16]))

    nset("NSET_BOTTOM", bot)
    nset("NSET_TOP", top)
    buf.append("*SOLID SECTION, ELSET=ESOLID, MATERIAL=TPMS_MAT")
    buf.append("*MATERIAL, NAME=TPMS_MAT")
    buf.append("*ELASTIC")
    buf.append(f"{E:.2f}, {nu:.4f}")
    buf.append("*STEP, NAME=COMPRESSION, NLGEOM=NO")
    buf.append("*STATIC")
    buf.append("0.05, 1.0, 1e-5, 0.05")
    buf.append("*BOUNDARY")
    buf.append("NSET_BOTTOM, 1, 3, 0.0")
    buf.append(f"NSET_TOP, 3, 3, {disp:.6f}")
    buf.append("*OUTPUT, FIELD")
    buf.append("*NODE OUTPUT")
    buf.append("U, RF")
    buf.append("** sanity check 口径：折痕带 minSICN<0.1 单元的局部应力不作定量依据（discuss-2026-10-29 共识）")
    buf.append("*ELEMENT OUTPUT")
    buf.append("S, E")
    buf.append("*OUTPUT, HISTORY")
    buf.append("*NODE OUTPUT, NSET=NSET_TOP")
    buf.append("U3, RF3")
    buf.append("*END STEP")
    out.write_text("\n".join(buf) + "\n", encoding="utf-8")

    band_ok = any(abs(h - b) <= 1.0 for b in (12.0, 24.0, 34.0))
    print(f"[setup] {out.name}: nodes={len(nodes)} elems={n_elems}(ESOLID 1..{max_eid}) "
          f"bot={len(bot)} top={len(top)} disp={disp:.4f}mm "
          f"H={h:.4f} W={w:.4f} T={t:.4f} A0={w*t:.2f}mm2 "
          f"{'[档位OK]' if band_ok else '[WARN] lengthMm 越档 {12,24,34}±1，fit-batch 将告警'}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh_inp", type=str)
    ap.add_argument("--strain", type=float, default=0.02)
    ap.add_argument("--E", type=float, default=2000.0, help="弹性模量 MPa（示例聚合物值，按实际材料改）")
    ap.add_argument("--nu", type=float, default=0.3)
    ap.add_argument("--h", type=float, default=None, help="覆盖 lengthMm（缺省=几何 bbox Z）")
    ap.add_argument("--w", type=float, default=None)
    ap.add_argument("--t", type=float, default=None)
    a = ap.parse_args()
    assemble(Path(a.mesh_inp), a.strain, a.E, a.nu, a.h, a.w, a.t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
