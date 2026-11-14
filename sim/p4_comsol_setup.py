# -*- coding: utf-8 -*-
"""Module 3: COMSOL Multiphysics 6.2 TPMS CFD (LaminarFlow + BL + Darcy/WSS) generator & runner.

Generates a self-contained COMSOL 6.2 Model Java source (`TpmsComsolCfd_<tag>.java`),
compiles it into `.class` via `comsolcompile.exe`, and optionally runs `comsolbatch.exe`
to produce the solved `.mph` and inlet/outlet pressure + wall shear stress CSV exports.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tpms_fields import SUPPORTED_TYPES  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
DEFAULT_COMSOL_BIN = Path(r"D:\Program Files\COMSOL\COMSOL62\Multiphysics\bin\win64")


def find_comsol_tools() -> tuple[Path | None, Path | None]:
    comp_env = os.environ.get("COMSOL_COMPILE")
    batch_env = os.environ.get("COMSOL_BATCH")
    comp = Path(comp_env) if comp_env and Path(comp_env).is_file() else (DEFAULT_COMSOL_BIN / "comsolcompile.exe")
    batch = Path(batch_env) if batch_env and Path(batch_env).is_file() else (DEFAULT_COMSOL_BIN / "comsolbatch.exe")
    if not comp.is_file():
        w = shutil.which("comsolcompile")
        comp = Path(w) if w else None
    if not batch.is_file():
        w = shutil.which("comsolbatch")
        batch = Path(w) if w else None
    return (comp if comp and comp.is_file() else None, batch if batch and batch.is_file() else None)


def jstr(p: str | Path) -> str:
    return str(p).replace("\\", "\\\\").replace('"', '\\"')


def generate_comsol_java(
    class_name: str,
    mesh_or_stl: Path,
    L_mm: float,
    v_in_mm_s: float,
    rho: float,
    mu: float,
    bl_layers: int,
    bl_first_height_mm: float,
    out_mph: Path,
    out_dp_csv: Path,
    out_wss_csv: Path,
) -> str:
    tol = max(0.01, L_mm * 0.005)
    L_str = f"{L_mm:.6f}"
    tol_str = f"{tol:.6f}"
    ext = mesh_or_stl.suffix.lower()
    use_stl_geom = (ext == ".stl")

    geom_import_block = (
        f"""
        model.component("comp1").geom().create("geom1", 3);
        model.component("comp1").geom("geom1").lengthUnit("mm");
        model.component("comp1").geom("geom1").create("imp1", "Import");
        model.component("comp1").geom("geom1").feature("imp1").set("type", "stl");
        model.component("comp1").geom("geom1").feature("imp1").set("filename", "{jstr(mesh_or_stl)}");
        model.component("comp1").geom("geom1").run();

        model.component("comp1").mesh().create("mesh1", "geom1");
        model.component("comp1").mesh("mesh1").create("ftet1", "FreeTet");
        model.component("comp1").mesh("mesh1").create("bl1", "BndLayer");
        model.component("comp1").mesh("mesh1").feature("bl1").selection().named("sel_wall");
        model.component("comp1").mesh("mesh1").feature("bl1").create("blp1", "BndLayerProp");
        model.component("comp1").mesh("mesh1").feature("bl1").feature("blp1").set("blnlayers", {int(bl_layers)});
        model.component("comp1").mesh("mesh1").feature("bl1").feature("blp1").set("hauto", false);
        model.component("comp1").mesh("mesh1").feature("bl1").feature("blp1").set("hfirst", "{bl_first_height_mm:.5f}[mm]");
        model.component("comp1").mesh("mesh1").run();
"""
        if use_stl_geom
        else f"""
        model.component("comp1").mesh().create("mesh1");
        model.component("comp1").mesh("mesh1").create("imp1", "Import");
        model.component("comp1").mesh("mesh1").feature("imp1").set("source", "nastran");
        model.component("comp1").mesh("mesh1").feature("imp1").set("filename", "{jstr(mesh_or_stl)}");
        model.component("comp1").mesh("mesh1").run();
"""
    )

    phys_target = '"geom1"' if use_stl_geom else '"mesh1"'

    return f"""import com.comsol.model.*;
import com.comsol.model.util.*;

/**
 * Auto-generated COMSOL Multiphysics 6.2 TPMS CFD model.
 * Domain: [0, {L_str}]^3 mm | Mesh/Geom: {jstr(mesh_or_stl.name)}
 */
public class {class_name} {{

    public static Model run() {{
        Model model = ModelUtil.create("Model");
        model.label("{class_name}.mph");

        model.param().set("L_dom", "{L_str}[mm]", "Domain length");
        model.param().set("v_in", "{v_in_mm_s:.6g}[mm/s]", "Inlet superficial velocity");
        model.param().set("rho_f", "{rho:.6g}[kg/m^3]", "Fluid density");
        model.param().set("mu_f", "{mu:.6g}[Pa*s]", "Fluid dynamic viscosity");

        model.component().create("comp1", true);

        // Box selections for inlet (x=0), outlet (x=L), and interior TPMS wall
        model.component("comp1").selection().create("sel_inlet", "Box");
        model.component("comp1").selection("sel_inlet").set("entitydim", 2);
        model.component("comp1").selection("sel_inlet").set("condition", "allvertices");
        model.component("comp1").selection("sel_inlet").set("xmin", "-{tol_str}[mm]");
        model.component("comp1").selection("sel_inlet").set("xmax", "{tol_str}[mm]");

        model.component("comp1").selection().create("sel_outlet", "Box");
        model.component("comp1").selection("sel_outlet").set("entitydim", 2);
        model.component("comp1").selection("sel_outlet").set("condition", "allvertices");
        model.component("comp1").selection("sel_outlet").set("xmin", "({L_str}-{tol_str})[mm]");
        model.component("comp1").selection("sel_outlet").set("xmax", "({L_str}+{tol_str})[mm]");

        model.component("comp1").selection().create("sel_wall", "Box");
        model.component("comp1").selection("sel_wall").set("entitydim", 2);
        model.component("comp1").selection("sel_wall").set("condition", "somevertex");
        model.component("comp1").selection("sel_wall").set("xmin", "{tol_str}[mm]");
        model.component("comp1").selection("sel_wall").set("xmax", "({L_str}-{tol_str})[mm]");
        model.component("comp1").selection("sel_wall").set("ymin", "{tol_str}[mm]");
        model.component("comp1").selection("sel_wall").set("ymax", "({L_str}-{tol_str})[mm]");
        model.component("comp1").selection("sel_wall").set("zmin", "{tol_str}[mm]");
        model.component("comp1").selection("sel_wall").set("zmax", "({L_str}-{tol_str})[mm]");

        {geom_import_block}

        model.component("comp1").material().create("mat1", "Common");
        model.component("comp1").material("mat1").label("TPMS Fluid");
        model.component("comp1").material("mat1").propertyGroup("def").set("density", "rho_f");
        model.component("comp1").material("mat1").propertyGroup("def").set("dynamicviscosity", "mu_f");

        model.component("comp1").physics().create("spf", "LaminarFlow", {phys_target});
        model.component("comp1").physics("spf").create("inl1", "InletBoundary", 2);
        model.component("comp1").physics("spf").feature("inl1").selection().named("sel_inlet");
        model.component("comp1").physics("spf").feature("inl1").set("U0in", "v_in");

        model.component("comp1").physics("spf").create("out1", "OutletBoundary", 2);
        model.component("comp1").physics("spf").feature("out1").selection().named("sel_outlet");
        model.component("comp1").physics("spf").feature("out1").set("p0", "0[Pa]");

        model.component("comp1").physics("spf").create("sym1", "Symmetry", 2);
        // Remaining planar side faces act as free-slip symmetry / periodic surrogate when selected

        model.study().create("std1");
        model.study("std1").create("stat", "Stationary");

        // Post-processing numerical evaluations (Delta P & wall shear stress)
        model.result().numerical().create("av_pin", "AvSurface");
        model.result().numerical("av_pin").selection().named("sel_inlet");
        model.result().numerical("av_pin").set("expr", new String[]{{"p"}});
        model.result().numerical("av_pin").set("unit", new String[]{{"Pa"}});

        model.result().numerical().create("av_wss", "AvSurface");
        model.result().numerical("av_wss").selection().named("sel_wall");
        model.result().numerical("av_wss").set("expr", new String[]{{"spf.mu*spf.sr"}});
        model.result().numerical("av_wss").set("unit", new String[]{{"Pa"}});

        model.result().table().create("tbl_dp", "Table");
        model.result().numerical("av_pin").set("table", "tbl_dp");
        model.result().table().create("tbl_wss", "Table");
        model.result().numerical("av_wss").set("table", "tbl_wss");

        model.result().export().create("exp_dp", "Table");
        model.result().export("exp_dp").set("table", "tbl_dp");
        model.result().export("exp_dp").set("filename", "{jstr(out_dp_csv)}");

        model.result().export().create("exp_wss", "Table");
        model.result().export("exp_wss").set("table", "tbl_wss");
        model.result().export("exp_wss").set("filename", "{jstr(out_wss_csv)}");

        try {{
            model.save("{jstr(out_mph)}");
        }} catch (Exception ignored) {{}}
        return model;
    }}

    public static void main(String[] args) {{
        ModelUtil.initStandalone(false);
        try {{
            Model m = run();
            try {{
                m.sol("sol1").runAll();
                m.result().numerical("av_pin").setResult();
                m.result().numerical("av_wss").setResult();
                m.result().export("exp_dp").run();
                m.result().export("exp_wss").run();
                m.save("{jstr(out_mph)}");
            }} catch (Exception ignored) {{}}
        }} finally {{
            ModelUtil.disconnect();
        }}
    }}
}}
"""


def parse_comsol_table_csv(csv_path: Path) -> float | None:
    if not csv_path.is_file():
        return None
    for line in csv_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        s = line.strip()
        if not s or s.startswith("%") or s.startswith("#"):
            continue
        parts = [x.strip() for x in s.replace(",", " ").split() if x.strip()]
        if parts:
            try:
                return float(parts[-1])
            except ValueError:
                continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="COMSOL 6.2 TPMS CFD setup, compiler, and batch runner")
    ap.add_argument("--type", default="gyroid", choices=sorted(SUPPORTED_TYPES))
    ap.add_argument("--structure", default="network", choices=["network", "sheet"])
    ap.add_argument("--k", type=int, default=1)
    ap.add_argument("--R", type=int, default=24)
    ap.add_argument("--por", type=float, default=0.70)
    ap.add_argument("--solid", type=float, default=0.30)
    ap.add_argument("--cell-size", type=float, default=4.0)
    ap.add_argument("--mesh", default=None, help="Explicit path to fluid .bdf or .stl")
    ap.add_argument("--v-in", type=float, default=1.0, help="Inlet velocity (mm/s)")
    ap.add_argument("--rho", type=float, default=1000.0, help="Density (kg/m^3)")
    ap.add_argument("--mu", type=float, default=0.00089, help="Viscosity (Pa*s)")
    ap.add_argument("--bl-layers", type=int, default=3)
    ap.add_argument("--bl-first-height", type=float, default=0.03)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out_dir) if args.out_dir else (REPO / "sim" / "out" / "comsol")
    out_dir.mkdir(parents=True, exist_ok=True)

    cs = args.cell_size if (args.cell_size and args.cell_size > 0) else None
    L_mm = (args.k * cs) if cs else (2.0 * math.pi * args.k)
    por_eff = (1.0 - args.solid) if args.structure == "sheet" else args.por
    cs_tag = f"_cs{cs:g}" if cs else ""
    tag = f"fluid_{args.type}_{args.structure}_k{args.k}_R{args.R}_p{int(round(por_eff * 100))}{cs_tag}"

    if args.mesh:
        mesh_path = Path(args.mesh)
    else:
        cand_bdf = REPO / "sim" / "out" / f"{tag}_bl.bdf"
        cand_stl = REPO / "sim" / "out" / f"{tag}.stl"
        mesh_path = cand_bdf if cand_bdf.is_file() else cand_stl
        if not mesh_path.is_file():
            # Auto-generate fluid BL mesh via p1_bl_mesh
            p1 = REPO / "sim" / "p1_bl_mesh.py"
            subprocess.run(
                [
                    sys.executable, str(p1),
                    "--backend", "gmsh-bl",
                    "--type", args.type, "--structure", args.structure,
                    "--k", str(args.k), "--R", str(args.R),
                    "--por", str(args.por), "--solid", str(args.solid),
                    "--cell-size", str(args.cell_size),
                    "--bl-layers", str(args.bl_layers),
                    "--bl-first-height", str(args.bl_first_height),
                ],
                check=True,
                stdout=sys.stderr if args.json else None,
            )
            mesh_path = cand_bdf if cand_bdf.is_file() else cand_stl

    safe_tag = "".join(ch if ch.isalnum() else "_" for ch in tag)
    class_name = f"TpmsComsol_{safe_tag}"
    java_path = out_dir / f"{class_name}.java"
    class_path = out_dir / f"{class_name}.class"
    out_mph = out_dir / f"{class_name}_solved.mph"
    out_dp_csv = out_dir / f"{class_name}_dp.csv"
    out_wss_csv = out_dir / f"{class_name}_wss.csv"
    batch_log = out_dir / f"{class_name}_batch.log"

    java_src = generate_comsol_java(
        class_name, mesh_path, L_mm, args.v_in, args.rho, args.mu,
        args.bl_layers, args.bl_first_height, out_mph, out_dp_csv, out_wss_csv,
    )
    java_path.write_text(java_src, encoding="utf-8")

    comp_exe, batch_exe = find_comsol_tools()
    summary: dict = {
        "ok": True,
        "tag": tag,
        "className": class_name,
        "meshInput": str(mesh_path),
        "javaPath": str(java_path),
        "classPath": str(class_path),
        "mphPath": str(out_mph),
        "dpCsv": str(out_dp_csv),
        "wssCsv": str(out_wss_csv),
        "domainLengthMm": round(L_mm, 5),
        "vInMmS": args.v_in,
        "rhoKgM3": args.rho,
        "muPaS": args.mu,
        "comsolCompileExe": str(comp_exe) if comp_exe else None,
        "comsolBatchExe": str(batch_exe) if batch_exe else None,
        "compiled": False,
        "executed": False,
        "dpPa": None,
        "wssPa": None,
        "permeabilityM2": None,
        "message": "",
    }

    if args.compile or args.run:
        if not comp_exe:
            summary["ok"] = False
            summary["message"] = "comsolcompile.exe not found"
        else:
            t0 = time.time()
            cp = subprocess.run([str(comp_exe), str(java_path)], capture_output=True, text=True, timeout=180, check=False)
            summary["compiled"] = (cp.returncode == 0 and class_path.is_file())
            summary["compileSec"] = round(time.time() - t0, 2)
            summary["message"] = (cp.stdout + "\n" + cp.stderr).strip()[:1000]
            if not summary["compiled"]:
                summary["ok"] = False

    if args.run and summary["compiled"]:
        if not batch_exe:
            summary["ok"] = False
            summary["message"] = "comsolbatch.exe not found"
        else:
            t0 = time.time()
            bp = subprocess.run(
                [
                    str(batch_exe),
                    "-inputfile", str(class_path),
                    "-outputfile", str(out_mph),
                    "-study", "std1",
                    "-batchlog", str(batch_log),
                    "-batchlogout",
                ],
                capture_output=True, text=True, timeout=900, check=False,
            )
            summary["executed"] = (bp.returncode == 0)
            summary["solveSec"] = round(time.time() - t0, 2)
            summary["message"] = (bp.stdout + "\n" + bp.stderr).strip()[:1200]
            dp = parse_comsol_table_csv(out_dp_csv)
            wss = parse_comsol_table_csv(out_wss_csv)
            summary["dpPa"] = dp
            summary["wssPa"] = wss
            if dp and dp > 0:
                v_ms = args.v_in * 1e-3
                L_m = L_mm * 1e-3
                summary["permeabilityM2"] = (v_ms * args.mu * L_m) / dp
            if not summary["executed"]:
                summary["ok"] = False

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(f"[p4_comsol_setup] java={java_path.name} compiled={summary['compiled']} executed={summary['executed']}")
        if summary["message"]:
            print(summary["message"])
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
