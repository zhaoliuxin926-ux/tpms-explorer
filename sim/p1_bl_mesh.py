# -*- coding: utf-8 -*-
"""Module 2: Triple-track TPMS boundary-layer CFD/FEA preprocessing pipeline.

Supports three preprocessing backends:
  1. ntop      - Exports structured nTopCL 6.3.3 JSON input spec, discovers/inspects
                 sim/ntop/*.ntop notebooks via ntopcl --template, and invokes ntopcl.exe
                 when a valid template exists (otherwise gracefully falls back to gmsh-bl).
  2. gmsh-bl   - Discrete fluid STL -> feature-angle surface classification -> Distance +
                 Threshold near-wall boundary-layer gradation 3D tetrahedral mesh (.msh,
                 .bdf, .inp) with minSICN quality audit.
  3. snappy-bl - Strips periodic/outer box caps from fluid STL, computes interior pore seed,
                 generates OpenFOAM v13 blockMeshDict + snappyHexMeshDict (addLayers true)
                 and complete incompressibleFluid Darcy+WSS case (optional WSL execution).

Note on terminology:
  - snappy-bl generates true topological prism boundary layers (extruded hexahedra/prisms)
    via snappyHexMesh addLayers.
  - gmsh-bl generates isotropic/graded near-wall boundary-layer refinement (tetrahedral
    Distance + Threshold field) because Gmsh Field.BoundaryLayer extrudes prisms only on
    analytical B-Rep CAD rather than discrete STL facets.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ntop_builder  # noqa: E402
from p3_fluid_domain import find_interior_pore_seed, generate_fluid  # noqa: E402
from tpms_fields import SUPPORTED_TYPES  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
DEFAULT_NTOPCL = Path(r"D:\Program Files\nTopology\nTopology\ntopcl.exe")
WSL_DISTRO = os.environ.get("TPMS_WSL_DISTRO", "Ubuntu-24.04")


def find_ntopcl() -> Path | None:
    env_p = os.environ.get("NTOPCL_EXE")
    if env_p and Path(env_p).is_file():
        return Path(env_p)
    if DEFAULT_NTOPCL.is_file():
        return DEFAULT_NTOPCL
    w = shutil.which("ntopcl")
    return Path(w) if w else None


def discover_ntop_template(explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None
    ntop_dir = REPO / "sim" / "ntop"
    if ntop_dir.is_dir():
        cands = sorted(ntop_dir.glob("*.ntop"))
        if cands:
            return cands[0]
    return None


def win_to_wsl(p: Path) -> str:
    resolved = str(p.resolve())
    drive = resolved[0].lower()
    rest = resolved[2:].replace("\\", "/")
    return f"/mnt/{drive}{rest}"


def strip_box_caps(mesh: trimesh.Trimesh, L: float) -> tuple[trimesh.Trimesh, dict[str, int]]:
    """Remove triangles lying flush on the 6 outer bounding-box planes [0, L]^3."""
    tris = mesh.triangles  # (F, 3, 3)
    tol = max(1e-4, 2e-4 * L)
    x, y, z = tris[:, :, 0], tris[:, :, 1], tris[:, :, 2]
    on_x0 = np.all(x < tol, axis=1)
    on_xL = np.all(x > L - tol, axis=1)
    on_y0 = np.all(y < tol, axis=1)
    on_yL = np.all(y > L - tol, axis=1)
    on_z0 = np.all(z < tol, axis=1)
    on_zL = np.all(z > L - tol, axis=1)
    is_cap = on_x0 | on_xL | on_y0 | on_yL | on_z0 | on_zL
    wall_faces = mesh.faces[~is_cap]
    wall = trimesh.Trimesh(vertices=mesh.vertices, faces=wall_faces, process=True)
    counts = {
        "totalFaces": int(len(mesh.faces)),
        "strippedCaps": int(is_cap.sum()),
        "wallFaces": int(len(wall.faces)),
        "x0": int(on_x0.sum()),
        "xL": int(on_xL.sum()),
    }
    return wall, counts


def build_ntop_spec(
    args: argparse.Namespace,
    L: float,
    out_dir: Path,
    tag: str,
    *,
    fluid_stl: Path | None = None,
    cfd_k: int | None = None,
) -> dict:
    ntopcl = find_ntopcl()
    eff_k = int(cfd_k if cfd_k is not None else args.k)
    por_val = round(float(args.por if args.structure == "network" else 1.0 - args.solid), 6)
    cs_val = float(args.cell_size if args.cell_size > 0 else round(2.0 * math.pi, 6))
    spec_path = out_dir / f"{tag}_ntop_input.json"
    out_json_path = out_dir / f"{tag}_ntop_output.json"
    out_mesh_path = out_dir / f"{tag}_ntop_bl.bdf"
    payload = {
        "description": "TPMS CFD boundary-layer mesh automation contract for nTopCL 6.3.3",
        "inputs": [
            {"name": "tpms_type", "type": "text", "value": args.type},
            {"name": "structure", "type": "text", "value": args.structure},
            {"name": "porosity", "type": "real", "value": por_val},
            {"name": "solid_fraction", "type": "real", "value": round(1.0 - por_val, 6)},
            {"name": "cell_size_mm", "type": "real", "value": cs_val},
            {"name": "k_cells", "type": "integer", "value": eff_k},
            {"name": "specimen_k_cells", "type": "integer", "value": int(args.k)},
            {"name": "domain_length_mm", "type": "real", "value": round(float(L), 6)},
            {"name": "bl_layers", "type": "integer", "value": int(args.bl_layers)},
            {"name": "bl_first_height_mm", "type": "real", "value": float(args.bl_first_height)},
            {"name": "bl_growth_ratio", "type": "real", "value": float(args.bl_growth)},
            {"name": "max_cell_size_mm", "type": "real", "value": float(args.lmax)},
            {"name": "export_mesh_path", "type": "text", "value": str(out_mesh_path)},
        ],
    }
    spec_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # Ensure canonical sim/ntop/tpms_bl_cfd.ntop reference container exists
    if not ntop_builder.DEFAULT_TEMPLATE_NTOP.is_file():
        try:
            ntop_builder.ensure_default_template()
        except Exception:
            pass
    tmpl = discover_ntop_template(args.ntop_file)

    result: dict = {
        "ntopclInstalled": bool(ntopcl),
        "ntopclPath": str(ntopcl) if ntopcl else None,
        "ntopTemplateFound": bool(tmpl),
        "ntopTemplatePath": str(tmpl) if tmpl else None,
        "ntopInputJson": str(spec_path),
        "ntopExecuted": False,
        "ntopTemplateSchema": None,
        "ntopStatus": "not_run",
        "ntopMessage": "",
        "ntopPrisms": 0,
        "ntopTets": 0,
    }
    if not ntopcl:
        result["ntopStatus"] = "ntopcl_missing"
        result["ntopMessage"] = f"未找到 ntopcl.exe，已生成参数契约 {spec_path.name}。"
        return result

    explicit_custom = bool(
        args.ntop_file
        and tmpl
        and tmpl.resolve() != ntop_builder.DEFAULT_TEMPLATE_NTOP.resolve()
    )
    if explicit_custom and tmpl:
        try:
            t_proc = subprocess.run(
                [str(ntopcl), "--template", str(tmpl)],
                capture_output=True, text=True, timeout=60, check=False,
            )
            if t_proc.returncode == 0 and t_proc.stdout.strip():
                result["ntopTemplateSchema"] = t_proc.stdout.strip()[:2000]
            r_proc = subprocess.run(
                [str(ntopcl), "-j", str(spec_path), "-o", str(out_json_path), str(tmpl)],
                capture_output=True, text=True, timeout=600, check=False,
            )
            result["ntopExecuted"] = (r_proc.returncode == 0)
            result["ntopStatus"] = "executed" if r_proc.returncode == 0 else f"exit_{r_proc.returncode}"
            result["ntopMessage"] = (r_proc.stdout + "\n" + r_proc.stderr).strip()[:1200]
            if out_json_path.is_file():
                result["ntopOutputJson"] = str(out_json_path)
            if out_mesh_path.is_file():
                result["ntopMeshFile"] = str(out_mesh_path)
        except Exception as exc:
            result["ntopStatus"] = "error"
            result["ntopMessage"] = str(exc)
        return result

    if args.backend not in ("auto", "ntop"):
        result["ntopStatus"] = "skipped_by_backend"
        result["ntopMessage"] = f"按指定后端 {args.backend} 运行，已写入 nTop 参数契约 {spec_path.name}。"
    elif fluid_stl and fluid_stl.is_file():
        try:
            ntop_run = ntop_builder.run_ntopcl_bl(
                in_stl=fluid_stl,
                out_dir=out_dir,
                tag=tag,
                bl_layers=int(args.bl_layers),
                bl_first_height_mm=float(args.bl_first_height),
                bl_growth=float(args.bl_growth),
                tpms_type=args.type,
                periods=eff_k,
                cell_size_mm=cs_val,
                porosity=por_val,
            )
            result.update(ntop_run)
            result["ntopMeshFile"] = ntop_run.get("ntopBdfPath")
            result["ntopMessage"] = (
                f"nTopCL 6.3.3 原生执行完成（C3D6 棱柱 {ntop_run.get('ntopPrisms', 0)} + "
                f"C3D4 四面体 {ntop_run.get('ntopTets', 0)}，耗时 {ntop_run.get('elapsedSec')}s）。"
                if ntop_run.get("ntopExecuted")
                else "\n".join(ntop_run.get("ntopLogTail", []))
            )
        except Exception as exc:
            result["ntopStatus"] = "error"
            result["ntopMessage"] = str(exc)
    else:
        result["ntopStatus"] = "input_stl_missing"
        result["ntopMessage"] = "流体表面 STL 尚未就绪，跳过 nTopCL 运行。"
    return result


def write_labeled_multisolid_stl(fluid_mesh: trimesh.Trimesh, L: float, dest: Path) -> dict[str, int]:
    """Export closed fluid shell as multi-solid ASCII STL with inlet/outlet/boxSide/scaffoldWall."""
    tris = fluid_mesh.triangles
    tol = max(1e-4, 2e-4 * L)
    x, y, z = tris[:, :, 0], tris[:, :, 1], tris[:, :, 2]
    m_in = np.all(x < tol, axis=1)
    m_out = np.all(x > L - tol, axis=1)
    m_box = (
        np.all(y < tol, axis=1)
        | np.all(y > L - tol, axis=1)
        | np.all(z < tol, axis=1)
        | np.all(z > L - tol, axis=1)
    ) & (~m_in) & (~m_out)
    m_wall = ~(m_in | m_out | m_box)
    chunks: list[str] = []
    counts: dict[str, int] = {}
    for name, mask in [("inlet", m_in), ("outlet", m_out), ("boxSide", m_box), ("scaffoldWall", m_wall)]:
        cnt = int(mask.sum())
        counts[name] = cnt
        if cnt > 0:
            sub = trimesh.Trimesh(vertices=fluid_mesh.vertices, faces=fluid_mesh.faces[mask], process=False)
            raw_txt = trimesh.exchange.stl.export_stl_ascii(sub)
            lines = raw_txt.splitlines()
            if lines and lines[0].startswith("solid"):
                lines[0] = f"solid {name}"
            if lines and lines[-1].startswith("endsolid"):
                lines[-1] = f"endsolid {name}"
            chunks.append("\n".join(lines) + "\n")
    dest.write_text("".join(chunks), encoding="utf-8")
    return counts


def classify_fluid_surfaces(L: float) -> dict[str, list[int]]:
    import gmsh
    tol = max(1e-3, 1e-3 * L)
    groups: dict[str, list[int]] = {
        "inlet": [],
        "outlet": [],
        "boxSide": [],
        "scaffoldWall": [],
    }
    for dim, tag in gmsh.model.getEntities(2):
        name = (gmsh.model.getEntityName(dim, tag) or "").strip()
        if name in groups:
            groups[name].append(tag)
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(dim, tag)
        if abs(xmin) < tol and abs(xmax) < tol:
            groups["inlet"].append(tag)
        elif abs(xmin - L) < tol and abs(xmax - L) < tol:
            groups["outlet"].append(tag)
        elif (
            (abs(ymin) < tol and abs(ymax) < tol)
            or (abs(ymin - L) < tol and abs(ymax - L) < tol)
            or (abs(zmin) < tol and abs(zmax) < tol)
            or (abs(zmin - L) < tol and abs(zmax - L) < tol)
        ):
            groups["boxSide"].append(tag)
        else:
            groups["scaffoldWall"].append(tag)
    return groups


def run_gmsh_bl(
    fluid_mesh: trimesh.Trimesh,
    L: float,
    bl_layers: int,
    h1: float,
    growth: float,
    lmax: float,
    out_dir: Path,
    tag: str,
    *,
    curvature_elements: int = 0,
    optimize_netgen: int = 1,
    mesh_algorithm_3d: int = 1,
) -> dict:
    import gmsh

    t0 = time.time()
    msh_path = out_dir / f"{tag}_bl.msh"
    bdf_path = out_dir / f"{tag}_bl.bdf"
    inp_path = out_dir / f"{tag}_bl.inp"
    labeled_stl = out_dir / f"{tag}_labeled.stl"
    stl_tri_counts = write_labeled_multisolid_stl(fluid_mesh, L, labeled_stl)

    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add(tag)
        gmsh.merge(str(labeled_stl))
        gmsh.model.mesh.removeDuplicateNodes()
        gmsh.model.mesh.createTopology()
        surfs = [s for _, s in gmsh.model.getEntities(2)]
        groups = classify_fluid_surfaces(L)
        wall_tags = groups["scaffoldWall"] if groups["scaffoldWall"] else surfs

        sl = gmsh.model.geo.addSurfaceLoop(surfs)
        vol = gmsh.model.geo.addVolume([sl])
        gmsh.model.geo.synchronize()

        # Assign physical groups for downstream COMSOL / OpenFOAM / ABAQUS workflows
        gmsh.model.addPhysicalGroup(3, [vol], 1, "fluid")
        if groups["inlet"]:
            gmsh.model.addPhysicalGroup(2, groups["inlet"], 11, "inlet")
        if groups["outlet"]:
            gmsh.model.addPhysicalGroup(2, groups["outlet"], 12, "outlet")
        if groups["boxSide"]:
            gmsh.model.addPhysicalGroup(2, groups["boxSide"], 13, "boxSide")
        if groups["scaffoldWall"]:
            gmsh.model.addPhysicalGroup(2, groups["scaffoldWall"], 14, "scaffoldWall")

        # Near-wall BL gradation via Distance + Threshold from scaffoldWall
        total_bl = sum(h1 * (growth ** i) for i in range(max(1, bl_layers)))
        dist_min = max(1e-3, h1 * 0.75)
        dist_max = max(dist_min * 2.5, total_bl * 2.2)

        f_dist = gmsh.model.mesh.field.add("Distance")
        gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", wall_tags)
        gmsh.model.mesh.field.setNumber(f_dist, "Sampling", 30)

        f_thr = gmsh.model.mesh.field.add("Threshold")
        gmsh.model.mesh.field.setNumber(f_thr, "InField", f_dist)
        gmsh.model.mesh.field.setNumber(f_thr, "SizeMin", max(0.015, h1))
        gmsh.model.mesh.field.setNumber(f_thr, "SizeMax", max(h1 * 2.0, lmax))
        gmsh.model.mesh.field.setNumber(f_thr, "DistMin", dist_min)
        gmsh.model.mesh.field.setNumber(f_thr, "DistMax", dist_max)
        gmsh.model.mesh.field.setAsBackgroundMesh(f_thr)

        gmsh.option.setNumber("Mesh.CharacteristicLengthExtendFromBoundary", 0)
        gmsh.option.setNumber("Mesh.CharacteristicLengthFromPoints", 0)
        gmsh.option.setNumber("Mesh.CharacteristicLengthFromCurvature", int(curvature_elements))
        gmsh.option.setNumber("Mesh.Algorithm3D", int(mesh_algorithm_3d))
        gmsh.option.setNumber("Mesh.Optimize", 1)
        gmsh.option.setNumber("Mesh.OptimizeNetgen", int(optimize_netgen))
        gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)

        gmsh.model.mesh.generate(3)

        node_tags, _, _ = gmsh.model.mesh.getNodes()
        tet_types, tet_tags, _ = gmsh.model.mesh.getElements(3)
        tri_types, tri_tags, _ = gmsh.model.mesh.getElements(2)
        all_tets = tet_tags[0] if tet_tags else np.array([], dtype=np.int64)
        all_tris = tri_tags[0] if tri_tags else np.array([], dtype=np.int64)

        qual_min = None
        qual_mean = None
        gamma_min = None
        gamma_mean = None
        if len(all_tets) > 0:
            q = gmsh.model.mesh.getElementQualities(all_tets.tolist(), "minSICN")
            g = gmsh.model.mesh.getElementQualities(all_tets.tolist(), "gamma")
            q_arr = np.asarray(q, dtype=float)
            g_arr = np.asarray(g, dtype=float)
            qual_min = round(float(np.min(q_arr)), 5)
            qual_mean = round(float(np.mean(q_arr)), 5)
            gamma_min = round(float(np.min(g_arr)), 5)
            gamma_mean = round(float(np.mean(g_arr)), 5)

        gmsh.write(str(msh_path))
        gmsh.write(str(bdf_path))
        gmsh.write(str(inp_path))
    finally:
        gmsh.finalize()

    return {
        "meshingMethod": "gmsh-distance-threshold-bl",
        "isTopologicalPrism": False,
        "labeledStl": str(labeled_stl),
        "stlTriangleGroups": stl_tri_counts,
        "mshPath": str(msh_path),
        "bdfPath": str(bdf_path),
        "inpPath": str(inp_path),
        "nodes": int(len(node_tags)),
        "tets": int(len(all_tets)),
        "triangles": int(len(all_tris)),
        "minSICN": qual_min,
        "meanSICN": qual_mean,
        "minGamma": gamma_min,
        "meanGamma": gamma_mean,
        "blLayersRequested": int(bl_layers),
        "blFirstHeightMm": float(h1),
        "blGrowth": float(growth),
        "blBandWidthMm": round(float(dist_max), 4),
        "surfaceGroups": {k: len(v) for k, v in groups.items()},
        "elapsedSec": round(time.time() - t0, 2),
    }


def _quality_passes(min_sicn: float | None, min_gamma: float | None, elem_count: int) -> bool:
    if elem_count <= 0 or min_sicn is None:
        return False
    if min_sicn < 0.05:
        return False
    if min_gamma is not None and min_gamma < 0.01:
        return False
    return True


def run_mesh_doctor_gmsh(
    fluid_mesh: trimesh.Trimesh,
    L: float,
    bl_layers: int,
    h1: float,
    growth: float,
    lmax: float,
    out_dir: Path,
    tag: str,
) -> tuple[dict, dict]:
    """Run Gmsh BL generation with two-stage Mesh Doctor auto-healing on SICN/Gamma."""
    g0 = run_gmsh_bl(fluid_mesh, L, bl_layers, h1, growth, lmax, out_dir, tag)
    init_q = {
        "minSICN": g0.get("minSICN"),
        "minGamma": g0.get("minGamma"),
        "tets": g0.get("tets", 0),
    }
    actions: list[str] = []
    attempts = 1
    best = g0

    if _quality_passes(g0.get("minSICN"), g0.get("minGamma"), int(g0.get("tets", 0))):
        return best, {
            "triggered": False,
            "attempts": attempts,
            "gateThresholdSICN": 0.05,
            "gateThresholdGamma": 0.01,
            "initialQuality": init_q,
            "finalQuality": init_q,
            "healed": True,
            "actions": actions,
        }

    # Stage A: relax near-wall h1/growth/layers & enforce Netgen pass
    attempts += 1
    h1_a = round(h1 * 1.15, 5)
    growth_a = min(1.30, round(growth + 0.05, 4))
    layers_a = max(3, int(bl_layers) - 1)
    actions.append(f"StageA: relax BL (h1 {h1}->{h1_a}mm, growth {growth}->{growth_a}, layers {bl_layers}->{layers_a}, Netgen)")
    g_a = run_gmsh_bl(
        fluid_mesh, L, layers_a, h1_a, growth_a, lmax, out_dir, tag,
        curvature_elements=0, optimize_netgen=1,
    )
    if (g_a.get("minSICN") or -1.0) >= (best.get("minSICN") or -1.0):
        best = g_a

    if not _quality_passes(best.get("minSICN"), best.get("minGamma"), int(best.get("tets", 0))):
        # Stage B: curvature-adaptive sizing + widened smoothing
        attempts += 1
        h1_b = round(h1_a * 1.15, 5)
        actions.append(f"StageB: curvature refinement (CharacteristicLengthFromCurvature=18, h1={h1_b}mm)")
        g_b = run_gmsh_bl(
            fluid_mesh, L, layers_a, h1_b, growth_a, lmax, out_dir, tag,
            curvature_elements=18, optimize_netgen=1,
        )
        if (g_b.get("minSICN") or -1.0) >= (best.get("minSICN") or -1.0):
            best = g_b

    final_q = {
        "minSICN": best.get("minSICN"),
        "minGamma": best.get("minGamma"),
        "tets": best.get("tets", 0),
    }
    return best, {
        "triggered": True,
        "attempts": attempts,
        "gateThresholdSICN": 0.05,
        "gateThresholdGamma": 0.01,
        "initialQuality": init_q,
        "finalQuality": final_q,
        "healed": _quality_passes(final_q["minSICN"], final_q["minGamma"], int(final_q["tets"])),
        "actions": actions,
    }


def write_openfoam_bl_case(
    wall_stl: Path,
    L: float,
    seed: list[float],
    bl_layers: int,
    h1: float,
    growth: float,
    lmax: float,
    case_dir: Path,
    v_in_mm_s: float = 1.0,
    nu_mm2_s: float = 0.89,
    run_snappy: bool = False,
) -> dict:
    """Create a complete OpenFOAM v13 snappyHexMesh (addLayers true) + incompressibleFluid case."""
    for sub in ["0", "constant/triSurface", "system"]:
        (case_dir / sub).mkdir(parents=True, exist_ok=True)

    target_stl = case_dir / "constant" / "triSurface" / "tpms_wall.stl"
    shutil.copy2(wall_stl, target_stl)

    ncells = int(max(20, min(48, round(L / max(lmax, L / 28.0)))))

    (case_dir / "system" / "blockMeshDict").write_text(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}
// Units: mm (consistent with STL coordinates and nu={nu_mm2_s} mm^2/s)
scale   1;

vertices
(
    (0   0   0)
    ({L} 0   0)
    ({L} {L} 0)
    (0   {L} 0)
    (0   0   {L})
    ({L} 0   {L})
    ({L} {L} {L})
    (0   {L} {L})
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({ncells} {ncells} {ncells}) simpleGrading (1 1 1)
);

edges ( );

boundary
(
    inlet
    {{
        type patch;
        faces ( (0 4 7 3) );
    }}
    outlet
    {{
        type patch;
        faces ( (1 2 6 5) );
    }}
    symSides
    {{
        type symmetry;
        faces
        (
            (0 1 5 4)
            (3 7 6 2)
            (0 3 2 1)
            (4 5 6 7)
        );
    }}
);
""", encoding="utf-8")

    (case_dir / "system" / "snappyHexMeshDict").write_text(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      snappyHexMeshDict;
}}
castellatedMesh true;
snap            true;
addLayers       true;

geometry
{{
    tpms_wall.stl
    {{
        type triSurfaceMesh;
        file "tpms_wall.stl";
        name scaffoldWall;
    }}
}};

castellatedMeshControls
{{
    maxLocalCells 600000;
    maxGlobalCells 1500000;
    minRefinementCells 0;
    maxLoadUnbalance 0.10;
    nCellsBetweenLevels 2;
    features ( );
    refinementSurfaces
    {{
        scaffoldWall
        {{
            level (1 2);
            patchInfo {{ type wall; }}
        }}
    }}
    resolveFeatureAngle 35;
    refinementRegions {{ }}
    locationInMesh ({seed[0]:.6f} {seed[1]:.6f} {seed[2]:.6f});
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch 3;
    tolerance 2.0;
    nSolveIter 40;
    nRelaxIter 5;
    nFeatureSnapIter 10;
    implicitFeatureSnap true;
    explicitFeatureSnap false;
    multiRegionFeatureSnap false;
}}

addLayersControls
{{
    relativeSizes false;
    layers
    {{
        "scaffoldWall.*"
        {{
            nSurfaceLayers {int(bl_layers)};
        }}
    }}
    expansionRatio {float(growth):.3f};
    firstLayerThickness {float(h1):.5f};
    minThickness {max(1e-4, float(h1) * 0.2):.5f};
    nGrow 0;
    featureAngle 130;
    slipFeatureAngle 30;
    nRelaxIter 5;
    nSmoothSurfaceNormals 2;
    nSmoothNormals 3;
    nSmoothThickness 8;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.35;
    minMedialAxisAngle 90;
    nBufferCellsNoExtrude 0;
    nLayerIter 50;
    nRelaxedIter 20;
}}

meshQualityControls
{{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minVol 1e-13;
    minTetQuality 1e-15;
    minArea -1;
    minTwist 0.02;
    minDeterminant 0.001;
    minFaceWeight 0.05;
    minVolRatio 0.01;
    minTriangleTwist -1;
    nSmoothScale 4;
    errorReduction 0.75;
    relaxed
    {{
        maxNonOrtho 75;
    }}
}}

writeFlags ( scalarLevels layerSets layerFields );
mergeTolerance 1e-6;
""", encoding="utf-8")

    (case_dir / "system" / "controlDict").write_text(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      controlDict;
}}
application     foamRun;
solver          incompressibleFluid;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         600;
deltaT          1;
writeControl    timeStep;
writeInterval   200;
purgeWrite      2;
writeFormat     ascii;
writePrecision  7;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;

functions
{{
    wallShearStress1
    {{
        type            wallShearStress;
        libs            ("libfieldFunctionObjects.so");
        executeControl  writeTime;
        writeControl    writeTime;
        patches         (scaffoldWall);
    }}
    patchAvgInletP
    {{
        type            surfaceFieldValue;
        libs            ("libfieldFunctionObjects.so");
        executeControl  writeTime;
        writeControl    writeTime;
        log             true;
        writeFields     false;
        patch           inlet;
        operation       areaAverage;
        fields          (p);
    }}
    patchAvgOutletP
    {{
        type            surfaceFieldValue;
        libs            ("libfieldFunctionObjects.so");
        executeControl  writeTime;
        writeControl    writeTime;
        log             true;
        writeFields     false;
        patch           outlet;
        operation       areaAverage;
        fields          (p);
    }}
}}
""", encoding="utf-8")

    (case_dir / "system" / "fvSchemes").write_text("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSchemes;
}
ddtSchemes { default steadyState; }
gradSchemes
{
    default         cellLimited Gauss linear 1;
    grad(p)         Gauss linear;
    grad(U)         cellLimited Gauss linear 1;
}
divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwindV grad(U);
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear limited corrected 0.5; }
interpolationSchemes { default linear; }
snGradSchemes { default limited corrected 0.5; }
""", encoding="utf-8")

    (case_dir / "system" / "fvSolution").write_text("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      fvSolution;
}
solvers
{
    p
    {
        solver          GAMG;
        tolerance       1e-7;
        relTol          0.02;
        smoother        GaussSeidel;
    }
    "(U|k|epsilon|omega).*"
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.1;
    }
}
SIMPLE
{
    nNonOrthogonalCorrectors 1;
    consistent      yes;
    residualControl
    {
        p               1e-5;
        U               1e-5;
    }
}
relaxationFactors
{
    fields { p 0.3; }
    equations { U 0.7; }
}
""", encoding="utf-8")

    (case_dir / "constant" / "physicalProperties").write_text(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      physicalProperties;
}}
viscosityModel  constant;
nu              [0 2 -1 0 0 0 0] {float(nu_mm2_s):.6g};
""", encoding="utf-8")

    (case_dir / "constant" / "momentumTransport").write_text("""FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      momentumTransport;
}
simulationType  laminar;
""", encoding="utf-8")

    (case_dir / "0" / "U").write_text(f"""FoamFile
{{
    version     2.0;
    format      ascii;
    class       volVectorField;
    object      U;
}}
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{{
    inlet
    {{
        type            fixedValue;
        value           uniform ({float(v_in_mm_s):.6g} 0 0);
    }}
    outlet
    {{
        type            zeroGradient;
    }}
    symSides
    {{
        type            symmetry;
    }}
    scaffoldWall
    {{
        type            noSlip;
    }}
}}
""", encoding="utf-8")

    (case_dir / "0" / "p").write_text("""FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    inlet
    {
        type            zeroGradient;
    }
    outlet
    {
        type            fixedValue;
        value           uniform 0;
    }
    symSides
    {
        type            symmetry;
    }
    scaffoldWall
    {
        type            zeroGradient;
    }
}
""", encoding="utf-8")

    wsl_case = win_to_wsl(case_dir)
    run_sh = case_dir / "run_snappy_bl.sh"
    run_sh.write_text(f"""#!/usr/bin/env bash
set -e
source /opt/openfoam13/etc/bashrc
cd "{wsl_case}"
blockMesh > log.blockMesh 2>&1
snappyHexMesh -overwrite > log.snappyHexMesh 2>&1
checkMesh > log.checkMesh 2>&1
""", encoding="utf-8", newline="\n")

    info = {
        "meshingMethod": "openfoam-snappyHexMesh-addLayers",
        "isTopologicalPrism": True,
        "caseDir": str(case_dir),
        "wallStl": str(target_stl),
        "runScript": str(run_sh),
        "locationInMesh": [round(float(x), 5) for x in seed],
        "blockMeshN": [ncells, ncells, ncells],
        "blLayersRequested": int(bl_layers),
        "blFirstHeightMm": float(h1),
        "blGrowth": float(growth),
        "snappyExecuted": False,
        "snappyOk": None,
        "cells": None,
        "layerCoveragePct": None,
        "checkMeshSummary": None,
    }

    if run_snappy:
        cmd = ["wsl", "-d", WSL_DISTRO, "bash", "-lc", f'bash "{wsl_case}/run_snappy_bl.sh"']
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
        info["snappyExecuted"] = True
        info["snappyOk"] = (proc.returncode == 0)
        snappy_log = (case_dir / "log.snappyHexMesh").read_text(encoding="utf-8", errors="ignore") if (case_dir / "log.snappyHexMesh").is_file() else ""
        check_log = (case_dir / "log.checkMesh").read_text(encoding="utf-8", errors="ignore") if (case_dir / "log.checkMesh").is_file() else ""
        m_cells = re.search(r"cells:\s+(\d+)", check_log)
        if m_cells:
            info["cells"] = int(m_cells.group(1))
        m_ext = re.findall(r"Extruding \d+ out of \d+ faces \(([\d.]+)%\)", snappy_log)
        if m_ext:
            info["extrudedFacesPct"] = round(float(m_ext[-1]), 2)
        m_cov = re.findall(r"scaffoldWall\s+\d+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", snappy_log)
        if m_cov:
            layers_avg, thk_val, thk_pct = m_cov[-1]
            info["layerAvgCount"] = float(layers_avg)
            info["layerThicknessMm"] = float(thk_val)
            info["layerCoveragePct"] = float(thk_pct)
        m_ok = re.search(r"Mesh OK\.|Failed \d+ mesh checks\.", check_log)
        info["checkMeshSummary"] = m_ok.group(0) if m_ok else (proc.stderr or proc.stdout).strip()[:240]
        if proc.returncode != 0:
            err_tails = []
            for lf in ("log.blockMesh", "log.snappyHexMesh", "log.checkMesh"):
                lp = case_dir / lf
                if lp.is_file():
                    err_tails.append(f"[{lf}] " + lp.read_text(encoding="utf-8", errors="ignore")[-400:])
            info["snappyError"] = ("\n".join(err_tails) or proc.stderr or proc.stdout).strip()[:800]

    return info


def _run_ntop_with_doctor(
    args: argparse.Namespace,
    L: float,
    out_dir: Path,
    tag: str,
    fluid_stl: Path,
    cfd_k: int,
) -> tuple[dict, dict]:
    """Run `build_ntop_spec` with automatic Stage A BL relaxation if Tet minSICN < 0.05."""
    n0 = build_ntop_spec(args, L, out_dir, tag, fluid_stl=fluid_stl, cfd_k=cfd_k)
    init_q = {
        "minSICN": n0.get("ntopMinSICNTet"),
        "minGamma": n0.get("ntopMinGammaTet"),
        "tets": n0.get("ntopTets", 0),
        "prisms": n0.get("ntopPrisms", 0),
    }
    doctor = {
        "triggered": False,
        "attempts": 1 if n0.get("ntopExecuted") else 0,
        "gateThresholdSICN": 0.05,
        "gateThresholdGamma": 0.01,
        "initialQuality": init_q,
        "finalQuality": init_q,
        "healed": _quality_passes(init_q["minSICN"], init_q["minGamma"], int(init_q["tets"])),
        "actions": [],
    }
    if not n0.get("ntopExecuted") or doctor["healed"]:
        return n0, doctor

    # Stage A: relax BL first layer height/growth slightly to remove skewed corner tets
    doctor["triggered"] = True
    doctor["attempts"] += 1
    orig_h1 = float(args.bl_first_height)
    orig_growth = float(args.bl_growth)
    orig_layers = int(args.bl_layers)
    h1_a = round(max(orig_h1 * 1.35, 0.024), 5)
    growth_a = min(1.30, round(orig_growth + 0.05, 4))
    layers_a = max(3, orig_layers - 1)
    doctor["actions"].append(
        f"StageA-nTop: relax BL (h1 {orig_h1}->{h1_a}mm, growth {orig_growth}->{growth_a}, layers {orig_layers}->{layers_a})"
    )

    adj_args = argparse.Namespace(**vars(args))
    adj_args.bl_first_height = h1_a
    adj_args.bl_growth = growth_a
    adj_args.bl_layers = layers_a
    n_a = build_ntop_spec(adj_args, L, out_dir, tag, fluid_stl=fluid_stl, cfd_k=cfd_k)
    best = n_a if (n_a.get("ntopExecuted") and (n_a.get("ntopMinSICNTet") or -1) >= (n0.get("ntopMinSICNTet") or -1)) else n0
    final_q = {
        "minSICN": best.get("ntopMinSICNTet"),
        "minGamma": best.get("ntopMinGammaTet"),
        "tets": best.get("ntopTets", 0),
        "prisms": best.get("ntopPrisms", 0),
    }
    doctor["finalQuality"] = final_q
    doctor["healed"] = _quality_passes(final_q["minSICN"], final_q["minGamma"], int(final_q["tets"]))
    return best, doctor


def main() -> int:
    ap = argparse.ArgumentParser(description="TPMS triple-track boundary-layer CFD/FEA preprocessor")
    ap.add_argument("--backend", default="auto", choices=["auto", "ntop", "gmsh-bl", "snappy-bl"])
    ap.add_argument("--type", default="gyroid", choices=sorted(SUPPORTED_TYPES))
    ap.add_argument("--structure", default="network", choices=["network", "sheet"])
    ap.add_argument("--k", type=int, default=1)
    ap.add_argument("--cfd-periods", type=int, default=None, help="Fluid RVE unit-cell periods per axis (e.g. 1 for 27x speedup vs k=3)")
    ap.add_argument("--R", type=int, default=24)
    ap.add_argument("--por", type=float, default=0.70)
    ap.add_argument("--solid", type=float, default=0.30)
    ap.add_argument("--cell-size", type=float, default=4.0, help="Physical cell size (mm); <=0 keeps 2*pi")
    ap.add_argument("--bl-layers", type=int, default=3)
    ap.add_argument("--bl-first-height", type=float, default=0.03)
    ap.add_argument("--bl-growth", type=float, default=1.25)
    ap.add_argument("--lmax", type=float, default=None)
    ap.add_argument("--maze", default=None, choices=["gplus", "gminus"])
    ap.add_argument("--ntop-file", default=None)
    ap.add_argument("--no-fallback", action="store_true")
    ap.add_argument("--run-snappy", action="store_true")
    ap.add_argument("--v-in", type=float, default=1.0, help="OpenFOAM case inlet velocity (mm/s)")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out_dir) if args.out_dir else (REPO / "sim" / "out")
    out_dir.mkdir(parents=True, exist_ok=True)

    specimen_k = max(1, int(args.k))
    cfd_k = max(1, int(args.cfd_periods)) if args.cfd_periods is not None else specimen_k
    rve_speedup = round((specimen_k / float(cfd_k)) ** 3, 2)
    length_scale = round(specimen_k / float(cfd_k), 4)

    cs = args.cell_size if (args.cell_size and args.cell_size > 0) else None
    L = (cfd_k * cs) if cs else (2.0 * math.pi * cfd_k)
    if args.lmax is None:
        args.lmax = round(max(0.08, L / 14.0), 4)
    if args.backend == 'snappy-bl' and args.lmax < 0.2:
        print(f"[warn] lmax={args.lmax}mm < 0.2mm：snappy 加密触发层添加质量反噬风险"
              f"（2026-11-14 RVE 实测 skew 5.05~5.14 超阈、加密反而恶化）——建议先跑 skew 判别或回退缺省口径")


    por_eff = (1.0 - args.solid) if args.structure == "sheet" else args.por
    cs_tag = f"_cs{cs:g}" if cs else ""
    rve_tag = f"_rve{cfd_k}" if cfd_k != specimen_k else ""
    tag = f"fluid_{args.type}_{args.structure}_k{cfd_k}_R{args.R}_p{int(round(por_eff * 100))}{cs_tag}{rve_tag}"

    with contextlib.redirect_stdout(sys.stderr if args.json else sys.stdout):
        fluid_mesh, thr = generate_fluid(
            cfd_k, args.R, por_eff,
            structure=args.structure, solid=args.solid,
            ftype=args.type, cell_size_mm=cs,
        )
    if args.structure == "sheet" and args.maze:
        from tpms_fields import evaluate_field
        parts = fluid_mesh.split(only_watertight=False)
        if len(parts) == 2:
            inv_s = ((2.0 * np.pi) / cs) if cs else 1.0
            def fmed(c):
                v = c.vertices * inv_s
                return float(np.median(evaluate_field(args.type, v[:, 0], v[:, 1], v[:, 2])))
            s_parts = sorted(parts, key=fmed)
            fluid_mesh = s_parts[0] if args.maze == "gminus" else s_parts[1]
            tag += f"_{args.maze}"

    fluid_stl = out_dir / f"{tag}.stl"
    fluid_stl.write_bytes(trimesh.exchange.stl.export_stl(fluid_mesh))
    seed = find_interior_pore_seed(cfd_k, args.R, args.type, thr, args.structure, cs)

    wall_mesh, cap_counts = strip_box_caps(fluid_mesh, L)
    wall_stl = out_dir / f"{tag}_wall_nocap.stl"
    wall_stl.write_bytes(trimesh.exchange.stl.export_stl(wall_mesh))

    labeled_stl = out_dir / f"{tag}_labeled.stl"
    stl_tri_groups = write_labeled_multisolid_stl(fluid_mesh, L, labeled_stl)

    summary: dict = {
        "ok": True,
        "tag": tag,
        "type": args.type,
        "structure": args.structure,
        "k": cfd_k,
        "specimenPeriods": specimen_k,
        "cfdPeriods": cfd_k,
        "rveSpeedupFactor": rve_speedup,
        "fullSpecimenLengthScale": length_scale,
        "R": args.R,
        "porosity": round(float(fluid_mesh.volume / (L ** 3)), 5),
        "targetPorosity": round(float(por_eff), 5),
        "domainLengthMm": round(float(L), 5),
        "fluidStl": str(fluid_stl),
        "labeledStl": str(labeled_stl),
        "stlTriangleGroups": stl_tri_groups,
        "wallNoCapStl": str(wall_stl),
        "capAudit": cap_counts,
        "locationInMesh": [round(float(x), 5) for x in seed],
        "backendRequested": args.backend,
        "backendExecuted": None,
        "fallbackReason": None,
        "meshDoctor": None,
    }

    ntop_info, ntop_doctor = _run_ntop_with_doctor(args, L, out_dir, tag, fluid_stl, cfd_k)
    summary["ntop"] = ntop_info

    if args.backend == "ntop":
        if ntop_info["ntopExecuted"]:
            summary["backendExecuted"] = "ntop"
            summary["meshDoctor"] = ntop_doctor
        elif args.no_fallback:
            summary["ok"] = False
            summary["backendExecuted"] = "none"
            summary["fallbackReason"] = ntop_info["ntopMessage"]
            summary["meshDoctor"] = ntop_doctor
            print(json.dumps(summary, ensure_ascii=False))
            return 2
        else:
            summary["backendExecuted"] = "gmsh-bl"
            summary["fallbackReason"] = ntop_info["ntopMessage"] + " 已自动回退至 Gmsh 边界层加密。"
            gmsh_res, doctor = run_mesh_doctor_gmsh(
                fluid_mesh, L, args.bl_layers, args.bl_first_height,
                args.bl_growth, args.lmax, out_dir, tag,
            )
            summary["gmsh"] = gmsh_res
            summary["meshDoctor"] = doctor
    elif args.backend == "snappy-bl":
        summary["backendExecuted"] = "snappy-bl"
        summary["snappy"] = write_openfoam_bl_case(
            wall_stl, L, seed, args.bl_layers, args.bl_first_height,
            args.bl_growth, args.lmax, out_dir / f"of_{tag}",
            v_in_mm_s=args.v_in, run_snappy=args.run_snappy,
        )
        summary["meshDoctor"] = {
            "triggered": False,
            "attempts": 1,
            "gateThresholdSICN": 0.05,
            "healed": bool(summary["snappy"].get("snappyOk", True)) if args.run_snappy else True,
            "actions": [],
        }
        if args.run_snappy and not summary["snappy"].get("snappyOk"):
            summary["ok"] = False
    elif args.backend == "gmsh-bl":
        summary["backendExecuted"] = "gmsh-bl"
        gmsh_res, doctor = run_mesh_doctor_gmsh(
            fluid_mesh, L, args.bl_layers, args.bl_first_height,
            args.bl_growth, args.lmax, out_dir, tag,
        )
        summary["gmsh"] = gmsh_res
        summary["meshDoctor"] = doctor
    else:  # auto
        if ntop_info["ntopExecuted"]:
            summary["backendExecuted"] = "ntop"
            summary["meshDoctor"] = ntop_doctor
            # Also prepare OpenFOAM case directory & labeled Gmsh MSH for COMSOL/OpenFOAM parity
            summary["snappy"] = write_openfoam_bl_case(
                wall_stl, L, seed, args.bl_layers, args.bl_first_height,
                args.bl_growth, args.lmax, out_dir / f"of_{tag}",
                v_in_mm_s=args.v_in, run_snappy=False,
            )
            if not ntop_doctor["healed"]:
                gmsh_res, gmsh_doc = run_mesh_doctor_gmsh(
                    fluid_mesh, L, args.bl_layers, args.bl_first_height,
                    args.bl_growth, args.lmax, out_dir, tag,
                )
                summary["gmsh"] = gmsh_res
                if gmsh_doc["healed"]:
                    gmsh_doc["initialQuality"] = ntop_doctor["initialQuality"]
                    gmsh_doc["actions"] = ntop_doctor["actions"] + gmsh_doc["actions"] + [
                        "StageC-Hybrid: adopted Mesh-Doctor healed Gmsh BL mesh alongside nTop C3D6 prism export"
                    ]
                    gmsh_doc["triggered"] = True
                    gmsh_doc["attempts"] = ntop_doctor["attempts"] + gmsh_doc["attempts"]
                    summary["meshDoctor"] = gmsh_doc
        else:
            summary["backendExecuted"] = "gmsh-bl"
            summary["fallbackReason"] = ntop_info["ntopMessage"]
            gmsh_res, doctor = run_mesh_doctor_gmsh(
                fluid_mesh, L, args.bl_layers, args.bl_first_height,
                args.bl_growth, args.lmax, out_dir, tag,
            )
            summary["gmsh"] = gmsh_res
            summary["meshDoctor"] = doctor
            summary["snappy"] = write_openfoam_bl_case(
                wall_stl, L, seed, args.bl_layers, args.bl_first_height,
                args.bl_growth, args.lmax, out_dir / f"of_{tag}",
                v_in_mm_s=args.v_in, run_snappy=False,
            )

    (out_dir / "bl_mesh_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / f"{tag}_bl_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        g = summary.get("gmsh")
        s = summary.get("snappy")
        md = summary.get("meshDoctor") or {}
        print(
            f"[p1_bl_mesh] tag={tag} backend={summary['backendExecuted']} "
            f"k_struct={specimen_k} k_cfd={cfd_k} speedup={rve_speedup}x L={L:.3f}mm "
            f"healed={md.get('healed')} attempts={md.get('attempts')}"
        )
        if ntop_info.get("ntopExecuted"):
            print(
                f"[ntopcl] C3D6={ntop_info.get('ntopPrisms')} C3D4={ntop_info.get('ntopTets')} "
                f"minSICN_tet={ntop_info.get('ntopMinSICNTet')} elapsed={ntop_info.get('elapsedSec')}s"
            )
        if summary.get("fallbackReason"):
            print(f"[ntop-fallback] {summary['fallbackReason']}")
        if g:
            print(f"[gmsh-bl] nodes={g['nodes']} tets={g['tets']} minSICN={g['minSICN']} meanSICN={g['meanSICN']} bdf={Path(g['bdfPath']).name}")
        if s:
            print(f"[snappy-bl] case={s['caseDir']} layers={s['blLayersRequested']} h1={s['blFirstHeightMm']}mm executed={s['snappyExecuted']}")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
