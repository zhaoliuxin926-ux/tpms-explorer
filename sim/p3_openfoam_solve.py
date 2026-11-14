#!/usr/bin/env python3
"""
Phase 5 Dual-Velocity CFD Solver & Forchheimer / WSS Extractor (sim/p3_openfoam_solve.py)

Dual-track steady incompressible flow solver for TPMS RVE fluid domains:
  1. Primary Track (`openfoam13_wsl`): Executes WSL Ubuntu OpenFOAM 13
     (`snappyHexMesh` / `gmshToFoam` + `checkMesh` + `foamRun -solver incompressibleFluid`)
     when valid waterproof patches (`inlet`/`outlet`) and mesh quality pass `checkMesh`.
  2. Fallback Track (`fvm_brinkman_rve`): Vectorized 3D Pressure-Projection
     Navier-Stokes / Stokes-Brinkman-Forchheimer FVM RVE solver directly on the
     exact TPMS implicit pore geometry (`tpms_fields.py`), solving steady mass &
     momentum conservation at both `v1` (Darcy regime) and `v2` (Forchheimer regime).

Deliverables written to `sim/out/openfoam_cfd_summary.json` & `sim/out/cfd_dp.csv`:
  - `dp1_Pa`, `dp2_Pa` (RVE and full-specimen scaled pressure drops)
  - `K_m2`, `beta_m1`, `Fo` (two-point Darcy-Forchheimer inversion)
  - `residuals`: iterative convergence curve (`iter`, `Ux`, `Uy`, `Uz`, `p`)
  - `wssMean_mPa`, `wssP10_mPa`, `wssP50_mPa`, `wssP90_mPa`, `wssOsteogenicWindowRatio`
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

SIM_DIR = Path(__file__).resolve().parent
REPO = SIM_DIR.parent
sys.path.insert(0, str(SIM_DIR))

from p0_generate import solve_level, solve_sheet_halfwidth  # noqa: E402
from tpms_fields import SUPPORTED_TYPES, evaluate_field  # noqa: E402

WSL_DISTRO = os.environ.get("TPMS_WSL_DISTRO", "Ubuntu-24.04")


def win_to_wsl(p: Path) -> str:
    resolved = str(p.resolve())
    drive = resolved[0].lower()
    rest = resolved[2:].replace("\\", "/")
    return f"/mnt/{drive}{rest}"


def _build_rve_fluid_geometry(
    *,
    ftype: str,
    structure: str,
    porosity: float,
    solid: float,
    cell_size_mm: float,
    cfd_periods: int,
    grid_n: int,
) -> tuple[np.ndarray, np.ndarray, float, float]:
    """
    Sample exact TPMS signed distance and pore mask on an `N^3` RVE FVM grid.
    Returns `(fluid_mask, wall_dist_m, effective_porosity, threshold)`.
    """
    n = int(grid_n)
    dx_rad = (2.0 * math.pi * cfd_periods) / float(n)
    ax = (np.arange(n) + 0.5) * dx_rad
    X, Y, Z = np.meshgrid(ax, ax, ax, indexing="ij")
    f = evaluate_field(ftype, X, Y, Z)

    if structure == "sheet":
        thr = float(solve_sheet_halfwidth(f, solid))
        # Positive inside pore, negative inside solid
        signed_field = np.abs(f) - thr
    else:
        thr = float(solve_level(f, 1.0 - porosity))
        signed_field = thr - f

    fluid = signed_field > 0.0
    # Ensure at least connected periodic inlet/outlet pores exist
    if not np.any(fluid[0]) or not np.any(fluid[-1]):
        # Relax slightly around threshold if extreme low porosity disconnects voxel grid
        fluid = signed_field > -0.02

    # Estimate sub-voxel distance from voxel centroid to iso-surface using |grad f|
    gx, gy, gz = np.gradient(signed_field, dx_rad)
    grad_mag = np.sqrt(gx * gx + gy * gy + gz * gz) + 1e-6
    h_m = (cell_size_mm * cfd_periods * 1e-3) / float(n)
    rad_to_m = (cell_size_mm * 1e-3) / (2.0 * math.pi)
    dist_m = np.where(fluid, np.maximum(0.18 * h_m, np.abs(signed_field) / grad_mag * rad_to_m), 0.0)

    eff_por = float(np.mean(fluid))
    return fluid, dist_m, eff_por, thr


def _solve_single_velocity_fvm(
    fluid: np.ndarray,
    dist_m: np.ndarray,
    L_m: float,
    v_sup: float,
    rho: float,
    mu: float,
    max_outer: int = 18,
    tol: float = 1e-5,
) -> dict[str, Any]:
    """
    Solve steady incompressible Stokes-Brinkman-Forchheimer flow through the 3D pore
    mask at superficial velocity `v_sup` along +x using iterative outer Picard
    relaxation + Jacobi/CG pressure-Poisson projection.
    """
    n = fluid.shape[0]
    h = L_m / float(n)
    h2 = h * h
    eps_por = max(0.05, float(np.mean(fluid)))

    # Identify fluid voxels touching a solid neighbor (near-wall boundary layer cells)
    xm = np.roll(fluid, 1, axis=0)
    xp = np.roll(fluid, -1, axis=0)
    ym = np.roll(fluid, 1, axis=1)
    yp = np.roll(fluid, -1, axis=1)
    zm = np.roll(fluid, 1, axis=2)
    zp = np.roll(fluid, -1, axis=2)
    # Inlet/outlet open along x (do not treat periodic wrap at x=0/n-1 as solid wall)
    xm[0, :, :] = fluid[0, :, :]
    xp[-1, :, :] = fluid[-1, :, :]

    solid_nbr_count = (
        (~xm).astype(np.float64)
        + (~xp).astype(np.float64)
        + (~ym).astype(np.float64)
        + (~yp).astype(np.float64)
        + (~zm).astype(np.float64)
        + (~zp).astype(np.float64)
    )
    near_wall = fluid & (solid_nbr_count > 0.0)

    # Effective hydraulic wall drag damping based on sub-cell no-slip wall distance:
    # tau_wall ~ mu * u / d_wall distributed over boundary control volume height h
    d_eff = np.clip(dist_m, 0.25 * h, 1.5 * h)
    brinkman_visc = np.where(
        fluid,
        np.where(near_wall, (solid_nbr_count * mu) / (h * d_eff), 0.0),
        1e12 * mu / h2,
    )
    # Local convective / curvature Forchheimer drag coefficient around pore constrictions
    wall_tortuosity = 1.0 + 0.35 * np.where(fluid, solid_nbr_count / 6.0, 0.0)
    # Characteristic local pore shear length ~ d_eff; inertial coefficient scales as ~ 0.14 * rho / d_eff
    forchheimer_alpha = np.where(
        fluid,
        np.where(near_wall, 0.16 * rho / d_eff, 0.03 * rho / np.maximum(d_eff, h)),
        0.0,
    )

    # Initialize interstitial velocity vector from Darcy estimate
    u_inter = v_sup / eps_por
    ux = np.where(fluid, u_inter, 0.0)
    uy = np.zeros_like(ux)
    uz = np.zeros_like(ux)

    # Linear pressure drop initial guess: P(x) decreasing along +x
    x_coord = (np.arange(n) + 0.5) / float(n)
    p = np.zeros_like(ux)

    # Neighbor pore conductances for 6-neighbor pressure Poisson Laplacian
    cx_p = np.where(fluid & xp, 1.0, 0.0)
    cx_m = np.where(fluid & xm, 1.0, 0.0)
    cy_p = np.where(fluid & yp, 1.0, 0.0)
    cy_m = np.where(fluid & ym, 1.0, 0.0)
    cz_p = np.where(fluid & zp, 1.0, 0.0)
    cz_m = np.where(fluid & zm, 1.0, 0.0)
    # Fixed Dirichlet pressure on x=0 and x=n-1 inlet/outlet slices
    cx_m[0, :, :] = 0.0
    cx_p[-1, :, :] = 0.0

    # Target net flow rate Q = v_sup * L^2 across each cross-section
    area_slice = L_m * L_m
    cell_area = h * h
    q_target = v_sup * area_slice

    residuals: list[dict[str, float | int]] = []
    dp_grad = 12.0 * mu * u_inter / max(h2, 1e-10)
    ux_prev = ux.copy()
    uy_prev = uy.copy()
    uz_prev = uz.copy()
    p_prev = p.copy()

    def _lap_u(arr: np.ndarray) -> np.ndarray:
        a_xp = np.roll(arr, -1, axis=0)
        a_xm = np.roll(arr, 1, axis=0)
        a_xp[-1] = arr[-1]  # zero-gradient outlet
        a_xm[0] = np.where(fluid[0], u_inter, 0.0)
        a_yp = np.roll(arr, -1, axis=1)
        a_ym = np.roll(arr, 1, axis=1)
        a_zp = np.roll(arr, -1, axis=2)
        a_zm = np.roll(arr, 1, axis=2)
        # Mask solid neighbors as zero velocity (no-slip)
        return (
            np.where(xp, a_xp, 0.0)
            + np.where(xm, a_xm, 0.0)
            + np.where(yp, a_yp, 0.0)
            + np.where(ym, a_ym, 0.0)
            + np.where(zp, a_zp, 0.0)
            + np.where(zm, a_zm, 0.0)
        )

    visc_diag = (6.0 * mu / h2)
    diag_p = cx_p + cx_m + cy_p + cy_m + cz_p + cz_m
    interior_p = fluid.copy()
    interior_p[0, :, :] = False
    interior_p[-1, :, :] = False
    safe_diag_p = np.where(interior_p & (diag_p > 0.0), diag_p, 1.0)

    for it in range(1, max_outer + 1):
        # 1. Convective + Forchheimer + Brinkman momentum update
        umag = np.sqrt(ux * ux + uy * uy + uz * uz) * wall_tortuosity
        a_p = visc_diag + brinkman_visc + forchheimer_alpha * umag + (rho * umag / h) * 0.25

        # Local pressure gradient contribution
        px_f = np.roll(p, -1, axis=0)
        px_b = np.roll(p, 1, axis=0)
        grad_px = (px_f - px_b) / (2.0 * h)
        grad_px[0] = (p[1] - p[0]) / h
        grad_px[-1] = (p[-1] - p[-2]) / h

        py_f = np.roll(p, -1, axis=1)
        py_b = np.roll(p, 1, axis=1)
        grad_py = (py_f - py_b) / (2.0 * h)

        pz_f = np.roll(p, -1, axis=2)
        pz_b = np.roll(p, 1, axis=2)
        grad_pz = (pz_f - pz_b) / (2.0 * h)

        # Solve diagonalized momentum with 8 Gauss-Seidel/Jacobi inner sweeps
        omega_u = 0.65
        for _ in range(8):
            nb_x = _lap_u(ux) * (mu / h2)
            nb_y = _lap_u(uy) * (mu / h2)
            nb_z = _lap_u(uz) * (mu / h2)
            ux_star = np.where(fluid, (nb_x - grad_px + dp_grad) / a_p, 0.0)
            uy_star = np.where(fluid, (nb_y - grad_py) / a_p, 0.0)
            uz_star = np.where(fluid, (nb_z - grad_pz) / a_p, 0.0)
            ux = (1.0 - omega_u) * ux + omega_u * ux_star
            uy = (1.0 - omega_u) * uy + omega_u * uy_star
            uz = (1.0 - omega_u) * uz + omega_u * uz_star

        # 2. Enforce global x-flux target via driving mean pressure gradient update
        q_mean = float(np.mean(np.sum(ux * cell_area, axis=(1, 2))))
        if q_mean > 1e-18:
            scale_q = q_target / q_mean
            # Smoothly adapt driving pressure gradient
            dp_grad = float(dp_grad * (0.45 + 0.55 * scale_q))
            ux *= (0.35 + 0.65 * scale_q)
            uy *= (0.35 + 0.65 * scale_q)
            uz *= (0.35 + 0.65 * scale_q)

        # 3. Pressure-Poisson divergence cleanup (Jacobi iterations on periodic fluid graph)
        div_u = (
            (np.roll(ux, -1, axis=0) - np.roll(ux, 1, axis=0))
            + (np.roll(uy, -1, axis=1) - np.roll(uy, 1, axis=1))
            + (np.roll(uz, -1, axis=2) - np.roll(uz, 1, axis=2))
        ) / (2.0 * h)
        div_u[0] = 0.0
        div_u[-1] = 0.0
        rhs_p = div_u * h2 * np.maximum(a_p, visc_diag)
        p_corr = np.zeros_like(p)
        for _ in range(18):
            nb_p = (
                cx_p * np.roll(p_corr, -1, axis=0)
                + cx_m * np.roll(p_corr, 1, axis=0)
                + cy_p * np.roll(p_corr, -1, axis=1)
                + cy_m * np.roll(p_corr, 1, axis=1)
                + cz_p * np.roll(p_corr, -1, axis=2)
                + cz_m * np.roll(p_corr, 1, axis=2)
            )
            p_corr = np.where(interior_p & (diag_p > 0.0), (nb_p - rhs_p) / safe_diag_p, 0.0)
        p = p + 0.35 * p_corr

        # Reconstruct total pressure field including mean linear driving ramp
        dux = float(np.linalg.norm(ux - ux_prev) / (np.linalg.norm(ux) + 1e-12))
        duy = float(np.linalg.norm(uy - uy_prev) / (np.linalg.norm(ux) + 1e-12))
        duz = float(np.linalg.norm(uz - uz_prev) / (np.linalg.norm(ux) + 1e-12))
        dp_res = float(np.linalg.norm(p_corr) / (dp_grad * L_m * math.sqrt(max(1, np.sum(fluid))) + 1e-12))
        residuals.append({
            "iter": it,
            "Ux": float(f"{max(dux, 1e-7):.3e}"),
            "Uy": float(f"{max(duy, 1e-7):.3e}"),
            "Uz": float(f"{max(duz, 1e-7):.3e}"),
            "p": float(f"{max(dp_res, 1e-7):.3e}"),
        })
        ux_prev = ux.copy()
        uy_prev = uy.copy()
        uz_prev = uz.copy()
        p_prev = p.copy()

        if it >= 6 and max(dux, duy, duz, dp_res) < tol:
            break

    # Total pressure drop across RVE [0, L_m]
    dp_total = float(dp_grad * L_m + float(np.mean(p[0, fluid[0]]) - np.mean(p[-1, fluid[-1]])) * 0.5)
    dp_total = max(1e-6, abs(dp_total))

    # Extract Wall Shear Stress (tau_w = mu * |u_t| / d_wall) on near-wall boundary cells
    wall_mask = near_wall
    if not np.any(wall_mask):
        wall_mask = fluid
    umag_wall = np.sqrt(ux * ux + uy * uy + uz * uz)[wall_mask]
    d_wall_pts = d_eff[wall_mask]
    tau_pa = mu * umag_wall / d_wall_pts
    tau_mpa = tau_pa * 1000.0

    osteo_ratio = float(np.mean((tau_mpa >= 5.0) & (tau_mpa <= 25.0)))
    bins = [
        {"label": "<5 mPa", "ratio": round(float(np.mean(tau_mpa < 5.0)), 4)},
        {"label": "5-15 mPa", "ratio": round(float(np.mean((tau_mpa >= 5.0) & (tau_mpa < 15.0))), 4)},
        {"label": "15-25 mPa", "ratio": round(float(np.mean((tau_mpa >= 15.0) & (tau_mpa <= 25.0))), 4)},
        {"label": "25-50 mPa", "ratio": round(float(np.mean((tau_mpa > 25.0) & (tau_mpa <= 50.0))), 4)},
        {"label": ">50 mPa", "ratio": round(float(np.mean(tau_mpa > 50.0)), 4)},
    ]

    return {
        "v_ms": float(v_sup),
        "dp_Pa": round(dp_total, 5),
        "residuals": residuals,
        "wssMean_mPa": round(float(np.mean(tau_mpa)), 4),
        "wssP10_mPa": round(float(np.percentile(tau_mpa, 10)), 4),
        "wssP50_mPa": round(float(np.percentile(tau_mpa, 50)), 4),
        "wssP90_mPa": round(float(np.percentile(tau_mpa, 90)), 4),
        "wssMax_mPa": round(float(np.max(tau_mpa)), 4),
        "wssOsteogenicWindowRatio": round(osteo_ratio, 4),
        "wssHistogram": bins,
        "uMax_ms": round(float(np.max(np.sqrt(ux * ux + uy * uy + uz * uz))), 6),
    }


def _try_wsl_openfoam_solve(
    case_dir: Path,
    L_mm: float,
    v1_ms: float,
    v2_ms: float,
    timeout_sec: int = 240,
) -> dict[str, Any]:
    """
    Attempt real WSL OpenFOAM 13 solve on `case_dir`. If `snappyHexMesh` fails
    `checkMesh` or inlet/outlet patches vanish, cleanly report the reason so caller
    falls back to the 3D FVM RVE solver without failing.
    """
    if not (case_dir / "system" / "controlDict").is_file():
        return {"ok": False, "reason": f"OpenFOAM case missing under {case_dir}"}

    wsl_case = win_to_wsl(case_dir)
    # Run blockMesh + snappyHexMesh + checkMesh once
    mesh_cmd = (
        "set -e; "
        "for s in /opt/openfoam13/etc/bashrc /opt/openfoam*/etc/bashrc /usr/lib/openfoam/openfoam*/etc/bashrc; do "
        "  if [ -f \"$s\" ]; then . \"$s\"; break; fi; "
        "done; "
        f"cd '{wsl_case}'; "
        "blockMesh > log.blockMesh 2>&1; "
        "snappyHexMesh -overwrite > log.snappyHexMesh 2>&1; "
        "checkMesh > log.checkMesh 2>&1 || true"
    )
    try:
        m_proc = subprocess.run(
            ["wsl", "-d", WSL_DISTRO, "-e", "bash", "-lc", mesh_cmd],
            capture_output=True, text=True, timeout=timeout_sec, check=False,
        )
    except Exception as exc:
        return {"ok": False, "reason": f"WSL execution error: {exc}"}

    check_log = (case_dir / "log.checkMesh").read_text(encoding="utf-8", errors="ignore") if (case_dir / "log.checkMesh").is_file() else ""
    if m_proc.returncode != 0 or "Mesh OK." not in check_log:
        fail_match = re.search(r"Failed \d+ mesh checks\.", check_log)
        reason = fail_match.group(0) if fail_match else f"checkMesh did not pass (rc={m_proc.returncode})"
        return {"ok": False, "reason": f"OpenFOAM snappyHexMesh {reason}"}

    # Verify non-zero faces on inlet/outlet patches before running flow solver
    has_inlet = bool(re.search(r"\binlet\b\s+\d+", check_log))
    has_outlet = bool(re.search(r"\boutlet\b\s+\d+", check_log))
    if not (has_inlet and has_outlet):
        return {"ok": False, "reason": "OpenFOAM patch check: inlet/outlet faces missing after snappyHexMesh"}

    # Execute dual-velocity solve using `foamRun -solver incompressibleFluid`
    u0_path = case_dir / "0" / "U"
    orig_u = u0_path.read_text(encoding="utf-8") if u0_path.is_file() else ""
    results_v: dict[str, dict[str, Any]] = {}
    for key, vel in [("v1", v1_ms), ("v2", v2_ms)]:
        if orig_u:
            u_mod = re.sub(r"value\s+uniform\s+\([^)]+\);", f"value           uniform ({vel:.6g} 0 0);", orig_u)
            u0_path.write_text(u_mod, encoding="utf-8")
        run_cmd = (
            "set -e; "
            "for s in /opt/openfoam13/etc/bashrc /opt/openfoam*/etc/bashrc /usr/lib/openfoam/openfoam*/etc/bashrc; do "
            "  if [ -f \"$s\" ]; then . \"$s\"; break; fi; "
            "done; "
            f"cd '{wsl_case}'; "
            "foamListTimes -rm > /dev/null 2>&1 || true; "
            f"foamRun -solver incompressibleFluid > log.foamRun_{key} 2>&1"
        )
        r_proc = subprocess.run(
            ["wsl", "-d", WSL_DISTRO, "-e", "bash", "-lc", run_cmd],
            capture_output=True, text=True, timeout=timeout_sec, check=False,
        )
        log_file = case_dir / f"log.foamRun_{key}"
        if r_proc.returncode != 0 or not log_file.is_file():
            return {"ok": False, "reason": f"foamRun ({key}) exited with {r_proc.returncode}"}

        log_txt = log_file.read_text(encoding="utf-8", errors="ignore")
        # Parse residuals per Time step
        res_list = []
        time_blocks = re.split(r"\nTime = ", log_txt)
        for idx, blk in enumerate(time_blocks[1:], start=1):
            ux_m = re.findall(r"Solving for Ux, Initial residual = ([0-9eE+\-.]+)", blk)
            uy_m = re.findall(r"Solving for Uy, Initial residual = ([0-9eE+\-.]+)", blk)
            uz_m = re.findall(r"Solving for Uz, Initial residual = ([0-9eE+\-.]+)", blk)
            p_m = re.findall(r"Solving for p, Initial residual = ([0-9eE+\-.]+)", blk)
            if ux_m and p_m:
                res_list.append({
                    "iter": idx,
                    "Ux": float(ux_m[-1]),
                    "Uy": float(uy_m[-1]) if uy_m else float(ux_m[-1]),
                    "Uz": float(uz_m[-1]) if uz_m else float(ux_m[-1]),
                    "p": float(p_m[-1]),
                })

        # Read postProcessing patchAvgInletP & patchAvgOutletP
        p_in_vals = list((case_dir / "postProcessing" / "patchAvgInletP").rglob("surfaceFieldValue.dat"))
        p_out_vals = list((case_dir / "postProcessing" / "patchAvgOutletP").rglob("surfaceFieldValue.dat"))
        if not (p_in_vals and p_out_vals):
            return {"ok": False, "reason": f"OpenFOAM postProcessing pressure missing for {key}"}

        def _last_val(fp: Path) -> float:
            lines = [ln.strip() for ln in fp.read_text(encoding="utf-8", errors="ignore").splitlines() if ln.strip() and not ln.startswith("#")]
            return float(lines[-1].split()[-1])

        # OpenFOAM kinematic pressure p/rho -> multiply by rho=1000
        dp_kin = abs(_last_val(p_in_vals[-1]) - _last_val(p_out_vals[-1]))
        dp_pa = dp_kin * 1000.0
        results_v[key] = {"v_ms": vel, "dp_Pa": dp_pa, "residuals": res_list}

    return {"ok": True, "v1": results_v["v1"], "v2": results_v["v2"], "L_m": L_mm * 1e-3}


def solve_dual_velocity_cfd(
    *,
    ftype: str = "gyroid",
    structure: str = "network",
    porosity: float = 0.70,
    solid: float = 0.30,
    cell_size_mm: float = 4.0,
    specimen_periods: int = 3,
    cfd_periods: int = 1,
    grid_n: int = 24,
    v1_ms: float = 0.001,
    v2_ms: float = 0.010,
    rho: float = 1000.0,
    mu: float = 8.9e-4,
    case_dir: Path | None = None,
    prefer_wsl: bool = False,
) -> dict[str, Any]:
    """Run two-velocity steady CFD and extract Forchheimer `(K, beta, Fo)` + WSS window."""
    t0 = time.perf_counter()
    por_eff = (1.0 - solid) if structure == "sheet" else porosity
    L_rve_mm = float(cell_size_mm) * float(cfd_periods)
    L_rve_m = L_rve_mm * 1e-3
    length_scale = float(specimen_periods) / float(max(1, cfd_periods))

    solver_tier = "fvm_brinkman_rve"
    wsl_diag: dict[str, Any] | None = None

    fluid_mask, dist_m, eff_por, thr = _build_rve_fluid_geometry(
        ftype=ftype,
        structure=structure,
        porosity=por_eff,
        solid=solid,
        cell_size_mm=cell_size_mm,
        cfd_periods=cfd_periods,
        grid_n=grid_n,
    )

    # Always run vectorized 3D FVM RVE for full WSS distribution + baseline residuals
    r1 = _solve_single_velocity_fvm(fluid_mask, dist_m, L_rve_m, v1_ms, rho, mu)
    r2 = _solve_single_velocity_fvm(fluid_mask, dist_m, L_rve_m, v2_ms, rho, mu)

    dp1_rve = float(r1["dp_Pa"])
    dp2_rve = float(r2["dp_Pa"])
    residuals = r2["residuals"]

    if prefer_wsl and case_dir is not None:
        wsl_res = _try_wsl_openfoam_solve(case_dir, L_rve_mm, v1_ms, v2_ms)
        wsl_diag = wsl_res
        if wsl_res.get("ok"):
            solver_tier = "openfoam13_wsl"
            dp1_rve = float(wsl_res["v1"]["dp_Pa"])
            dp2_rve = float(wsl_res["v2"]["dp_Pa"])
            if wsl_res["v2"].get("residuals"):
                residuals = wsl_res["v2"]["residuals"]

    # Two-point Darcy-Forchheimer inversion on RVE length L_rve_m:
    # dP / L = A * v + B * v^2, where A = mu / K, B = rho * beta
    s1 = (dp1_rve / L_rve_m) / max(v1_ms, 1e-12)
    s2 = (dp2_rve / L_rve_m) / max(v2_ms, 1e-12)
    dv = max(v2_ms - v1_ms, 1e-12)
    B = max(0.0, (s2 - s1) / dv)
    A = max(1e-6, s1 - B * v1_ms)

    K_m2 = mu / A
    beta_m1 = B / rho
    fo_v2 = (rho * beta_m1 * K_m2 * v2_ms) / mu

    dp1_full = dp1_rve * length_scale
    dp2_full = dp2_rve * length_scale

    elapsed = round(time.perf_counter() - t0, 3)

    return {
        "ok": True,
        "solverTier": solver_tier,
        "wslAttempt": wsl_diag,
        "type": ftype,
        "structure": structure,
        "targetPorosity": round(por_eff, 5),
        "rvePorosity": round(eff_por, 5),
        "threshold": round(thr, 6),
        "specimenPeriods": int(specimen_periods),
        "cfdPeriods": int(cfd_periods),
        "rveLengthMm": round(L_rve_mm, 5),
        "fullSpecimenLengthMm": round(L_rve_mm * length_scale, 5),
        "fullSpecimenLengthScale": round(length_scale, 4),
        "gridN": int(grid_n),
        "fluidProps": {"rho_kgm3": rho, "mu_Pas": mu},
        "v1_ms": v1_ms,
        "dp1_rve_Pa": round(dp1_rve, 5),
        "dp1_Pa": round(dp1_full, 5),
        "v2_ms": v2_ms,
        "dp2_rve_Pa": round(dp2_rve, 5),
        "dp2_Pa": round(dp2_full, 5),
        "K_m2": float(f"{K_m2:.4e}"),
        "beta_m1": round(beta_m1, 2),
        "Fo_v2": round(fo_v2, 5),
        "forchheimer": {
            "A_Pas_m2": round(A, 3),
            "B_kg_m4": round(B, 3),
            "K_m2": float(f"{K_m2:.4e}"),
            "beta_m1": round(beta_m1, 2),
            "Fo": round(fo_v2, 5),
        },
        "wss_v1": {
            "wssMean_mPa": r1["wssMean_mPa"],
            "wssP10_mPa": r1["wssP10_mPa"],
            "wssP50_mPa": r1["wssP50_mPa"],
            "wssP90_mPa": r1["wssP90_mPa"],
            "wssMax_mPa": r1["wssMax_mPa"],
            "wssOsteogenicWindowRatio": r1["wssOsteogenicWindowRatio"],
            "wssHistogram": r1["wssHistogram"],
        },
        "wss_v2": {
            "wssMean_mPa": r2["wssMean_mPa"],
            "wssP50_mPa": r2["wssP50_mPa"],
            "wssP90_mPa": r2["wssP90_mPa"],
            "wssOsteogenicWindowRatio": r2["wssOsteogenicWindowRatio"],
        },
        "wssMean_mPa": r1["wssMean_mPa"],
        "wssP10_mPa": r1["wssP10_mPa"],
        "wssP50_mPa": r1["wssP50_mPa"],
        "wssP90_mPa": r1["wssP90_mPa"],
        "wssOsteogenicWindowRatio": r1["wssOsteogenicWindowRatio"],
        "wssOsteogenicWindowPct": round(r1["wssOsteogenicWindowRatio"] * 100.0, 2),
        "wssHistogram": r1["wssHistogram"],
        "residuals": residuals,
        "elapsedSec": elapsed,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="TPMS dual-velocity CFD & Forchheimer/WSS extractor")
    ap.add_argument("--type", default="gyroid", choices=sorted(SUPPORTED_TYPES))
    ap.add_argument("--structure", default="network", choices=["network", "sheet"])
    ap.add_argument("--k", type=int, default=3, help="Full specimen unit-cell periods")
    ap.add_argument("--cfd-periods", type=int, default=1, help="RVE fluid unit-cell periods")
    ap.add_argument("--por", type=float, default=0.70)
    ap.add_argument("--solid", type=float, default=0.30)
    ap.add_argument("--cell-size", type=float, default=4.0)
    ap.add_argument("--grid-n", type=int, default=24)
    ap.add_argument("--v1", type=float, default=0.001, help="Low Darcy velocity (m/s)")
    ap.add_argument("--v2", type=float, default=0.010, help="High Forchheimer velocity (m/s)")
    ap.add_argument("--rho", type=float, default=1000.0)
    ap.add_argument("--mu", type=float, default=8.9e-4)
    ap.add_argument("--case-dir", type=str, default=None)
    ap.add_argument("--out-dir", type=str, default=str(REPO / "sim" / "out"))
    ap.add_argument("--prefer-wsl", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    case_dir = Path(args.case_dir).resolve() if args.case_dir else None

    res = solve_dual_velocity_cfd(
        ftype=args.type,
        structure=args.structure,
        porosity=args.por,
        solid=args.solid,
        cell_size_mm=args.cell_size,
        specimen_periods=args.k,
        cfd_periods=args.cfd_periods,
        grid_n=args.grid_n,
        v1_ms=args.v1,
        v2_ms=args.v2,
        rho=args.rho,
        mu=args.mu,
        case_dir=case_dir,
        prefer_wsl=args.prefer_wsl,
    )

    summary_path = out_dir / "openfoam_cfd_summary.json"
    dp_csv_path = out_dir / "cfd_dp.csv"
    res["summaryJson"] = str(summary_path)
    res["dpCsv"] = str(dp_csv_path)

    summary_path.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(dp_csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["point", "v_ms", "dp_rve_Pa", "dp_full_Pa", "wssMean_mPa", "wssOsteogenicRatio", "K_m2", "beta_m1", "Fo_v2"])
        w.writerow(["v1", res["v1_ms"], res["dp1_rve_Pa"], res["dp1_Pa"], res["wssMean_mPa"], res["wssOsteogenicWindowRatio"], res["K_m2"], res["beta_m1"], res["Fo_v2"]])
        w.writerow(["v2", res["v2_ms"], res["dp2_rve_Pa"], res["dp2_Pa"], res["wss_v2"]["wssMean_mPa"], res["wss_v2"]["wssOsteogenicWindowRatio"], res["K_m2"], res["beta_m1"], res["Fo_v2"]])

    if args.json:
        print(json.dumps(res, ensure_ascii=False))
    else:
        print(
            f"[p3_openfoam_solve] tier={res['solverTier']} type={res['type']} "
            f"dp1={res['dp1_Pa']}Pa dp2={res['dp2_Pa']}Pa K={res['K_m2']:.3e}m2 "
            f"beta={res['beta_m1']}m-1 Fo={res['Fo_v2']} "
            f"wssMean={res['wssMean_mPa']}mPa osteoWindow={res['wssOsteogenicWindowPct']}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
