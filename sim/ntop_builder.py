#!/usr/bin/env python3
"""
nTop 6.3.3 Native Binary Container Synthesizer & CLI Runner (sim/ntop_builder.py)

Constructs valid nTop `.ntop` containers (`MAGIC%$1` section table + `MAGIC@@9`
AST/leaves chunks) without requiring manual GUI template files, executes
`ntopcl.exe` headlessly to generate true C3D6 prism boundary-layer + C3D4
tetrahedral volume meshes via `boundary_layer_mesh[1.2.0]`, and audits the
resulting Abaqus `.inp` / Nastran `.bdf` exports.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import struct
import subprocess
import time
from typing import Any

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
SIM_DIR = pathlib.Path(__file__).resolve().parent
NTOP_DIR = SIM_DIR / "ntop"
DEFAULT_TEMPLATE_NTOP = NTOP_DIR / "tpms_bl_cfd.ntop"

TOP_MAGIC = b"MAGIC%$1"
CHUNK_MAGIC = b"MAGIC@@9"
TOP_HEADER_SIZE = 248
CHUNK_HEADER_SIZE = 128

IMPLICIT_TPMS_FUNCS: dict[str, str] = {
    "gyroid": "gyroid_implicit<real>[1.1.0]",
    "diamond": "diamond_implicit<real>[1.1.0]",
    "schwarz": "schwarz_implicit<real>[1.1.0]",
    "lidinoid": "lidinoid_implicit<real>[1.1.0]",
    "splitp": "splitp_implicit<real>[1.1.0]",
    "neovius": "neovius_implicit<real>[1.1.0]",
}


def find_ntopcl() -> str | None:
    """Locate `ntopcl.exe` on Windows/Linux."""
    env_p = os.environ.get("NTOPCL_EXE")
    if env_p and pathlib.Path(env_p).is_file():
        return env_p
    found = shutil.which("ntopcl") or shutil.which("ntopcl.exe")
    if found:
        return found
    for cand in (
        r"D:\Program Files\nTopology\nTopology\ntopcl.exe",
        r"C:\Program Files\nTopology\nTopology\ntopcl.exe",
    ):
        if pathlib.Path(cand).is_file():
            return cand
    return None


def make_chunk(kind: str, name: str, payload: bytes) -> bytes:
    """Pack a single 128-byte `MAGIC@@9` nTop chunk header + payload."""
    hdr = bytearray(CHUNK_HEADER_SIZE)
    hdr[0:8] = CHUNK_MAGIC
    kind_b = kind.encode("ascii")[:16]
    name_b = name.encode("ascii")[:16]
    hdr[8 : 8 + len(kind_b)] = kind_b
    hdr[24 : 24 + len(name_b)] = name_b
    struct.pack_into("<Q", hdr, 40, len(payload))
    return bytes(hdr) + payload


def make_obj_container(kind: str, name: str, index_json_bytes: bytes) -> bytes:
    """Pack a `cache1` object container wrapping a JSON `index` chunk."""
    idx_chunk = make_chunk("json", "index", index_json_bytes)
    payload = struct.pack("<Q", 8) + idx_chunk
    return make_chunk(kind, name, payload)


def _ast_node(
    nid: int,
    name: str,
    func: str,
    typ: str,
    inputs: list[int] | None = None,
    qual: int = 0,
) -> dict[str, Any]:
    return {
        "autoc": func == "",
        "bldst": 0,
        "func": func,
        "id": nid,
        "inputs": [
            {
                "instanceId": iid,
                "meta": {"expression": "", "is_default": iid == 0, "name": ""},
                "modelInputIdx": -1,
                "propchain": [],
            }
            for iid in (inputs or [])
        ],
        "meta": {"desc": "", "import": 0},
        "name": name,
        "optional": False,
        "paust": 0,
        "qual": qual,
        "type": typ,
        "units": {},
        "unitsKnown": True,
    }


def _pack_ntop_sections(fn_obj: dict[str, Any], leaves: list[dict[str, Any]]) -> bytes:
    c_turhe = make_chunk("JSON", "turhe", b'{"turver":[2,20,5]}')
    c_fn = make_chunk("json", "fn", json.dumps(fn_obj, separators=(",", ":")).encode("utf-8"))
    c_leaves = make_obj_container("cache1", "leaves", json.dumps(leaves, separators=(",", ":")).encode("utf-8"))
    c_main = make_chunk("ntopfn", "main", c_fn + c_leaves)
    c_cache = make_obj_container("cache1", "cache", b"[]")
    c_view = make_chunk("jsn", "view", b"[]")
    c_open = make_chunk("jsn", "open", b"[]")
    c_viewport = make_chunk("jsn", "viewport", b"{}")

    top_secs = [
        ("turhe", c_turhe),
        ("main", c_main),
        ("cache", c_cache),
        ("view", c_view),
        ("open", c_open),
        ("viewport", c_viewport),
    ]
    top_hdr = bytearray(TOP_HEADER_SIZE)
    top_hdr[0:8] = TOP_MAGIC
    struct.pack_into("<Q", top_hdr, 8, len(top_secs))
    cum = 0
    body = bytearray()
    for i, (nm, ch) in enumerate(top_secs):
        cum += len(ch)
        off = 24 + i * 24
        nm_b = nm.encode("ascii")[:16]
        top_hdr[off : off + len(nm_b)] = nm_b
        struct.pack_into("<Q", top_hdr, off + 16, cum)
        body.extend(ch)
    return bytes(top_hdr) + bytes(body)


def build_bl_mesh_ntop_bytes(
    *,
    in_stl: pathlib.Path | str,
    out_bdf: pathlib.Path | str,
    out_inp: pathlib.Path | str,
    out_surf_stl: pathlib.Path | str | None = None,
    bl_layers: int = 5,
    bl_first_height_mm: float = 0.015,
    bl_growth: float = 1.25,
    all_domains: bool = True,
    tpms_type: str = "gyroid",
    periods: int = 1,
    cell_size_mm: float = 4.0,
    porosity: float = 0.70,
) -> bytes:
    """
    Build a binary `.ntop` notebook that imports a fluid surface mesh and runs:
      import_mesh -> boundary_layer_mesh[1.2.0] -> fe_volume_mesh -> export_fe_mesh (.bdf, .inp) + export_mesh (.stl)
    Lengths inside nTop real leaves are stored in SI meters (`mm * 1e-3`).
    """
    nodes = [
        _ast_node(100, "root", "core.group<any>", "group", [103, 115, 117, 119, 121, 125], qual=2),
        _ast_node(101, "in_stl", "", "file_path"),
        _ast_node(102, "unit_mm", "", "unit_length_enum"),
        _ast_node(103, "ImportedMesh", "import_mesh<file_path,unit_length_enum>", "mesh", [101, 102]),
        _ast_node(111, "bl_layers", "", "integer"),
        _ast_node(112, "bl_h1", "", "real"),
        _ast_node(113, "bl_growth", "", "real"),
        _ast_node(114, "bl_all_dom", "", "bool"),
        _ast_node(115, "BLVolumeMesh", "boundary_layer_mesh<mesh,integer,real,real,bool>[1.2.0]", "volume_mesh", [103, 111, 112, 113, 114]),
        _ast_node(116, "geo_order", "", "geometric_order_enum"),
        _ast_node(117, "FEMesh", "fe_volume_mesh<volume_mesh,geometric_order_enum>", "fe_mesh", [115, 116]),
        _ast_node(118, "out_stl", "", "file_path"),
        _ast_node(119, "ExportSurf", "export_mesh<file_path,mesh,unit_length_enum>", "mesh_file_data_list", [118, 103, 102]),
        _ast_node(120, "out_bdf", "", "file_path"),
        _ast_node(121, "ExportFE_BDF", "export_fe_mesh<file_path,fe_mesh,unit_length_enum,list<fe_set>>", "fe_mesh_file_data", [120, 117, 102, 0]),
        _ast_node(124, "out_inp", "", "file_path"),
        _ast_node(125, "ExportFE_INP", "export_fe_mesh<file_path,fe_mesh,unit_length_enum,list<fe_set>>", "fe_mesh_file_data", [124, 117, 102, 0]),
    ]
    if not out_surf_stl:
        nodes[0]["inputs"] = [x for x in nodes[0]["inputs"] if x["instanceId"] != 119]

    leaves: list[dict[str, Any]] = [
        {"id": "101", "type": "file_path", "value": {"val": str(in_stl)}},
        {"id": "102", "type": "unit_length_enum", "value": {"id": "mm"}},
        {"id": "111", "type": "integer", "value": {"val": int(bl_layers)}},
        {"id": "112", "type": "real", "value": {"isFinite": True, "units": {"length": 1}, "val": float(bl_first_height_mm) * 1e-3}},
        {"id": "113", "type": "real", "value": {"isFinite": True, "units": {}, "val": float(bl_growth)}},
        {"id": "114", "type": "bool", "value": {"val": bool(all_domains)}},
        {"id": "116", "type": "geometric_order_enum", "value": {"enum": 0}},
        {"id": "118", "type": "file_path", "value": {"val": str(out_surf_stl or pathlib.Path(out_bdf).with_suffix(".surf.stl"))}},
        {"id": "120", "type": "file_path", "value": {"val": str(out_bdf)}},
        {"id": "124", "type": "file_path", "value": {"val": str(out_inp)}},
    ]

    desc = (
        f"TPMS CFD Boundary Layer Mesh in nTop 6.3.3 "
        f"(type={tpms_type}, periods={periods}, cell_mm={cell_size_mm}, por={porosity:.3f}, "
        f"bl={bl_layers}x{bl_first_height_mm:.4f}mm@{bl_growth:.2f})"
    )
    fn_obj = {
        "code": nodes,
        "def": {
            "description": desc,
            "displayname": "tpms_bl_cfd",
            "function": "user_func_tpms_bl_cfd",
            "inputs": [],
            "output": {"type": ""},
            "outputBaseUnits": {},
            "releasestage": 2,
            "runaspects.defaultname": "",
            "runaspects.disablelistprocessing": False,
            "runaspects.embeddable": False,
            "runaspects.implicitparam": 0,
            "runaspects.overloadpriority": 0,
            "runaspects.progstages": -1,
            "runaspects.rons": 1,
            "runaspects.sideeffects": True,
            "runaspects.startvisible": True,
            "unitsVariadicMultiplier": [0, 1],
        },
        "dependencies": [],
        "output": -1,
    }
    return _pack_ntop_sections(fn_obj, leaves)


def build_implicit_tpms_ntop_bytes(
    *,
    tpms_type: str = "gyroid",
    cell_size_mm: float = 4.0,
    periods: int = 1,
    wall_thickness_mm: float = 0.65,
    feature_size_mm: float = 0.25,
    out_stl: pathlib.Path | str = "tpms_implicit.stl",
) -> bytes:
    """
    Build an optional pure-implicit nTop notebook generating a TPMS solid directly
    inside a `[0, L]^3` cube using native `*_implicit<real>[1.1.0]` operators.
    """
    key = tpms_type.strip().lower()
    if key not in IMPLICIT_TPMS_FUNCS:
        raise ValueError(f"Unsupported TPMS implicit type: {tpms_type!r} (supported: {sorted(IMPLICIT_TPMS_FUNCS)})")
    L_mm = float(cell_size_mm) * float(periods)
    half_mm = 0.5 * L_mm
    imp_func = IMPLICIT_TPMS_FUNCS[key]
    nodes = [
        _ast_node(100, "root", "core.group<any>", "group", [112], qual=2),
        _ast_node(101, "cell_len", "", "real"),
        _ast_node(102, "TPMSField", imp_func, "implicit", [101]),
        _ast_node(103, "wall_t", "", "real"),
        _ast_node(104, "WallBody", "thicken_implicit<implicit,real>[1.0.0]", "implicit", [102, 103]),
        _ast_node(105, "center_pt", "", "point"),
        _ast_node(106, "box_len", "", "real"),
        _ast_node(107, "DomainBox", "box<point,real,real,real>", "implicit", [105, 106, 106, 106]),
        _ast_node(108, "ClippedTPMS", "boolean_intersect<implicit,implicit>", "implicit", [104, 107]),
        _ast_node(109, "feat_size", "", "real"),
        _ast_node(110, "TPMSMesh", "implicit_to_mesh<implicit,real>", "mesh", [108, 109]),
        _ast_node(111, "out_stl", "", "file_path"),
        _ast_node(113, "unit_mm", "", "unit_length_enum"),
        _ast_node(112, "ExportMesh", "export_mesh<file_path,mesh,unit_length_enum>", "mesh_file_data_list", [111, 110, 113]),
    ]
    leaves = [
        {"id": "101", "type": "real", "value": {"isFinite": True, "units": {"length": 1}, "val": float(cell_size_mm) * 1e-3}},
        {"id": "103", "type": "real", "value": {"isFinite": True, "units": {"length": 1}, "val": float(wall_thickness_mm) * 1e-3}},
        {"id": "105", "type": "point", "value": {"units": {"length": 1}, "x": half_mm * 1e-3, "y": half_mm * 1e-3, "z": half_mm * 1e-3}},
        {"id": "106", "type": "real", "value": {"isFinite": True, "units": {"length": 1}, "val": L_mm * 1e-3}},
        {"id": "109", "type": "real", "value": {"isFinite": True, "units": {"length": 1}, "val": float(feature_size_mm) * 1e-3}},
        {"id": "111", "type": "file_path", "value": {"val": str(out_stl)}},
        {"id": "113", "type": "unit_length_enum", "value": {"id": "mm"}},
    ]
    fn_obj = {
        "code": nodes,
        "def": {
            "description": f"Implicit {key} TPMS generator in nTop 6.3.3",
            "displayname": f"tpms_implicit_{key}",
            "function": f"user_func_tpms_implicit_{key}",
            "inputs": [],
            "output": {"type": ""},
            "outputBaseUnits": {},
            "releasestage": 2,
            "runaspects.defaultname": "",
            "runaspects.disablelistprocessing": False,
            "runaspects.embeddable": False,
            "runaspects.implicitparam": 0,
            "runaspects.overloadpriority": 0,
            "runaspects.progstages": -1,
            "runaspects.rons": 1,
            "runaspects.sideeffects": True,
            "runaspects.startvisible": True,
            "unitsVariadicMultiplier": [0, 1],
        },
        "dependencies": [],
        "output": -1,
    }
    return _pack_ntop_sections(fn_obj, leaves)


def verify_ntop_container(ntop_path: pathlib.Path | str) -> dict[str, Any]:
    """Parse and validate a binary `.ntop` container without invoking nTopCL."""
    p = pathlib.Path(ntop_path)
    data = p.read_bytes()
    if len(data) < TOP_HEADER_SIZE or data[:8] != TOP_MAGIC:
        raise ValueError(f"Invalid MAGIC%$1 header in {p}")
    sec_count = struct.unpack_from("<Q", data, 8)[0]
    sections: dict[str, tuple[int, int]] = {}
    prev = 0
    for i in range(sec_count):
        off = 24 + i * 24
        raw_name = data[off : off + 16].split(b"\x00", 1)[0].decode("ascii", errors="replace")
        cum = struct.unpack_from("<Q", data, off + 16)[0]
        sections[raw_name] = (TOP_HEADER_SIZE + prev, TOP_HEADER_SIZE + cum)
        prev = cum

    main_start, main_end = sections["main"]
    main_hdr = data[main_start : main_start + CHUNK_HEADER_SIZE]
    if main_hdr[:8] != CHUNK_MAGIC:
        raise ValueError(f"Invalid MAGIC@@9 main chunk in {p}")
    main_payload_sz = struct.unpack_from("<Q", main_hdr, 40)[0]
    pos = main_start + CHUNK_HEADER_SIZE
    end = pos + main_payload_sz
    fn_obj = None
    leaves_obj = None
    while pos < end and pos + CHUNK_HEADER_SIZE <= len(data):
        chdr = data[pos : pos + CHUNK_HEADER_SIZE]
        if chdr[:8] != CHUNK_MAGIC:
            break
        ckind = chdr[8:24].split(b"\x00", 1)[0].decode("ascii", errors="replace")
        cname = chdr[24:40].split(b"\x00", 1)[0].decode("ascii", errors="replace")
        csz = struct.unpack_from("<Q", chdr, 40)[0]
        cpayload = data[pos + CHUNK_HEADER_SIZE : pos + CHUNK_HEADER_SIZE + csz]
        if cname == "fn" and ckind == "json":
            fn_obj = json.loads(cpayload.decode("utf-8"))
        elif cname == "leaves" and ckind == "cache1":
            idx_pos = 8
            ihdr = cpayload[idx_pos : idx_pos + CHUNK_HEADER_SIZE]
            if ihdr[:8] == CHUNK_MAGIC:
                isz = struct.unpack_from("<Q", ihdr, 40)[0]
                leaves_obj = json.loads(cpayload[idx_pos + CHUNK_HEADER_SIZE : idx_pos + CHUNK_HEADER_SIZE + isz].decode("utf-8"))
        pos += CHUNK_HEADER_SIZE + csz

    return {
        "valid": True,
        "path": str(p),
        "bytes": len(data),
        "sections": list(sections.keys()),
        "nodeCount": len(fn_obj.get("code", [])) if fn_obj else 0,
        "leafCount": len(leaves_obj) if leaves_obj else 0,
        "funcs": [n.get("func") for n in (fn_obj or {}).get("code", []) if n.get("func")],
    }


def extract_inp_element_counts(inp_path: pathlib.Path | str) -> dict[str, int]:
    """Count node lines and C3D6 prism / C3D4 tet elements in an Abaqus `.inp` mesh."""
    counts = {"nodes": 0, "prismsC3D6": 0, "tetsC3D4": 0, "otherElems": 0}
    mode = ""
    elem_type = ""
    with open(inp_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("**"):
                continue
            if s.startswith("*"):
                up = s.upper()
                if up.startswith("*NODE"):
                    mode = "node"
                    elem_type = ""
                elif up.startswith("*ELEMENT"):
                    mode = "elem"
                    m = re.search(r"TYPE\s*=\s*([A-Z0-9_]+)", up)
                    elem_type = m.group(1) if m else ""
                else:
                    mode = ""
                    elem_type = ""
                continue
            if mode == "node":
                counts["nodes"] += 1
            elif mode == "elem":
                if elem_type == "C3D6":
                    counts["prismsC3D6"] += 1
                elif elem_type == "C3D4":
                    counts["tetsC3D4"] += 1
                else:
                    counts["otherElems"] += 1
    counts["total3d"] = counts["prismsC3D6"] + counts["tetsC3D4"] + counts["otherElems"]
    return counts


def inspect_bdf_with_gmsh(bdf_path: pathlib.Path | str) -> dict[str, Any]:
    """Audit `.bdf` mesh element counts and SICN/Gamma quality via Gmsh Python API."""
    info: dict[str, Any] = {
        "gmshAvailable": False,
        "prisms": 0,
        "tets": 0,
        "minSICNTet": None,
        "meanSICNTet": None,
        "minGammaTet": None,
        "minSICNPrism": None,
        "meanSICNPrism": None,
    }
    try:
        import gmsh  # type: ignore
    except Exception:
        return info

    info["gmshAvailable"] = True
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.open(str(bdf_path))
        tet_tags = []
        prism_tags = []
        for etype, etags, _ in zip(*gmsh.model.mesh.getElements(3)):
            if etype == 4:
                tet_tags.append(etags)
            elif etype == 6:
                prism_tags.append(etags)
        if tet_tags:
            flat_tets = [int(t) for arr in tet_tags for t in arr]
            info["tets"] = len(flat_tets)
            sicn = gmsh.model.mesh.getElementQualities(flat_tets, "minSICN")
            gamma = gmsh.model.mesh.getElementQualities(flat_tets, "gamma")
            info["minSICNTet"] = round(float(min(sicn)), 5)
            info["meanSICNTet"] = round(float(sum(sicn) / len(sicn)), 5)
            info["minGammaTet"] = round(float(min(gamma)), 5)
        if prism_tags:
            flat_prisms = [int(t) for arr in prism_tags for t in arr]
            info["prisms"] = len(flat_prisms)
            psicn = gmsh.model.mesh.getElementQualities(flat_prisms, "minSICN")
            info["minSICNPrism"] = round(float(min(psicn)), 5)
            info["meanSICNPrism"] = round(float(sum(psicn) / len(psicn)), 5)
    finally:
        gmsh.finalize()
    return info


def run_ntopcl_bl(
    *,
    in_stl: pathlib.Path | str,
    out_dir: pathlib.Path | str,
    tag: str,
    bl_layers: int = 5,
    bl_first_height_mm: float = 0.015,
    bl_growth: float = 1.25,
    tpms_type: str = "gyroid",
    periods: int = 1,
    cell_size_mm: float = 4.0,
    porosity: float = 0.70,
    template_path: pathlib.Path | str | None = None,
    timeout_sec: int = 180,
) -> dict[str, Any]:
    """
    Generate a runtime `.ntop` notebook for the target `in_stl` fluid surface,
    execute `ntopcl.exe -v 2 <run.ntop>`, and return mesh metrics & exported paths.
    """
    in_p = pathlib.Path(in_stl).resolve()
    out_p = pathlib.Path(out_dir).resolve()
    out_p.mkdir(parents=True, exist_ok=True)

    run_ntop = pathlib.Path(template_path).resolve() if template_path else (out_p / f"{tag}_ntop_bl.ntop")
    out_bdf = out_p / f"{tag}_ntop_bl.bdf"
    out_inp = out_p / f"{tag}_ntop_bl.inp"
    out_surf_stl = out_p / f"{tag}_ntop_surf.stl"

    if not template_path:
        raw = build_bl_mesh_ntop_bytes(
            in_stl=in_p,
            out_bdf=out_bdf,
            out_inp=out_inp,
            out_surf_stl=out_surf_stl,
            bl_layers=bl_layers,
            bl_first_height_mm=bl_first_height_mm,
            bl_growth=bl_growth,
            tpms_type=tpms_type,
            periods=periods,
            cell_size_mm=cell_size_mm,
            porosity=porosity,
        )
        run_ntop.write_bytes(raw)

    ntopcl = find_ntopcl()
    if not ntopcl:
        return {
            "ntopExe": None,
            "ntopExecuted": False,
            "ntopStatus": "ntopcl_not_found",
            "runNtopPath": str(run_ntop),
        }
    if not in_p.is_file():
        return {
            "ntopExe": ntopcl,
            "ntopExecuted": False,
            "ntopStatus": "input_stl_missing",
            "runNtopPath": str(run_ntop),
        }

    t0 = time.perf_counter()
    proc = subprocess.run(
        [ntopcl, "-v", "2", str(run_ntop)],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )
    elapsed = round(time.perf_counter() - t0, 3)

    inp_counts = extract_inp_element_counts(out_inp) if out_inp.is_file() else {}
    bdf_qual = inspect_bdf_with_gmsh(out_bdf) if out_bdf.is_file() else {}
    ok = proc.returncode == 0 and out_inp.is_file() and inp_counts.get("total3d", 0) > 0

    return {
        "ntopExe": ntopcl,
        "ntopExecuted": ok,
        "ntopStatus": "executed" if ok else "failed",
        "exitCode": proc.returncode,
        "elapsedSec": elapsed,
        "runNtopPath": str(run_ntop),
        "ntopBdfPath": str(out_bdf) if out_bdf.is_file() else None,
        "ntopInpPath": str(out_inp) if out_inp.is_file() else None,
        "ntopSurfStlPath": str(out_surf_stl) if out_surf_stl.is_file() else None,
        "ntopPrisms": inp_counts.get("prismsC3D6", bdf_qual.get("prisms", 0)),
        "ntopTets": inp_counts.get("tetsC3D4", bdf_qual.get("tets", 0)),
        "ntopNodes": inp_counts.get("nodes", 0),
        "ntopMinSICNTet": bdf_qual.get("minSICNTet"),
        "ntopMeanSICNTet": bdf_qual.get("meanSICNTet"),
        "ntopMinGammaTet": bdf_qual.get("minGammaTet"),
        "ntopLogTail": (proc.stdout + "\n" + proc.stderr).strip().splitlines()[-12:],
    }


def ensure_default_template(out_path: pathlib.Path = DEFAULT_TEMPLATE_NTOP) -> dict[str, Any]:
    """Create `sim/ntop/tpms_bl_cfd.ntop` reference container if missing or updating."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_dir = REPO_ROOT / "sim" / "out"
    raw = build_bl_mesh_ntop_bytes(
        in_stl=out_dir / "fluid_gyroid_p70.stl",
        out_bdf=out_dir / "fluid_gyroid_p70_ntop_bl.bdf",
        out_inp=out_dir / "fluid_gyroid_p70_ntop_bl.inp",
        out_surf_stl=out_dir / "fluid_gyroid_p70_ntop_surf.stl",
        bl_layers=5,
        bl_first_height_mm=0.015,
        bl_growth=1.25,
    )
    out_path.write_bytes(raw)
    return verify_ntop_container(out_path)


def main() -> int:
    ap = argparse.ArgumentParser(description="nTop 6.3.3 Binary Container Synthesizer & CLI Runner")
    ap.add_argument("--init-template", action="store_true", help="Write sim/ntop/tpms_bl_cfd.ntop baseline container")
    ap.add_argument("--verify", type=str, default=None, help="Inspect an existing .ntop container")
    ap.add_argument("--in-stl", type=str, default=None, help="Input watertight fluid STL to mesh in nTopCL")
    ap.add_argument("--out-dir", type=str, default=str(REPO_ROOT / "sim" / "out"))
    ap.add_argument("--tag", type=str, default="fluid_ntop_rve")
    ap.add_argument("--bl-layers", type=int, default=5)
    ap.add_argument("--bl-first-height", type=float, default=0.015)
    ap.add_argument("--bl-growth", type=float, default=1.25)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    res: dict[str, Any] = {}
    if args.init_template:
        res["template"] = ensure_default_template()
    if args.verify:
        res["verified"] = verify_ntop_container(args.verify)
    if args.in_stl:
        res["run"] = run_ntopcl_bl(
            in_stl=args.in_stl,
            out_dir=args.out_dir,
            tag=args.tag,
            bl_layers=args.bl_layers,
            bl_first_height_mm=args.bl_first_height,
            bl_growth=args.bl_growth,
        )
    if not res:
        res["template"] = ensure_default_template()
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
