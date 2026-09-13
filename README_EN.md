# TPMS Explorer — Interactive Triply Periodic Minimal Surfaces

> **English** · [中文](README.md)

An interactive, browser-based explorer for **Triply Periodic Minimal Surfaces (TPMS)** — the lattice geometries behind bone scaffolds, lightweight parts, heat exchangers and catalyst supports.
Personal, independently maintained open-source project.

**What makes it different: a verification-first culture.** Every formula, mesh and export path is guarded by **44 CI gates with 1,000+ assertions** (deterministic, pure-Node, cross-platform), anchored to analytic solutions — Poiseuille profile error 0.002 %, phononic Γ-point zero modes to machine precision, watertight STL by construction (open edges = 0 across 30 audit cases).

---

## Two editions

| | Single-file (`docs/`) | Engineering workstation (`tpms/tpms-platform/`) |
|---|---|---|
| Install | None — open `index.html`, works offline | `npm install && npm run dev` (Vite 8 + TS + Three.js + WebGPU) |
| Audience | Teaching, demos, quick exploration | Research, batch generation, CAE export, CLI automation |
| Surface families | 8 canonical | **20** (canonical + C2: Fischer-Koch / Double / Complementary D …) |
| Export | STL / PNG / glTF / OBJ / WebM | STL / VTK / VTI / 3MF / GLB / Abaqus INP / OpenFOAM polyMesh / Python (PyVista) / MATLAB scripts |

## Highlights

- **20 TPMS families** (engineering): 8 canonical + C2 extensions (O,C-TO, Karcher, Fischer-Koch S/Y/C(S)/C(Y), G′, D′, Double P/D/G, Complementary D) with four-way formula parity and a public [BENCHMARKS](BENCHMARKS.md) usable-domain matrix. Teaching edition keeps the 8 canonical families for focus.
- **Exact porosity solver** (CLI): analytic-integration root finding + mesh-measured secant validation. Measured deviation **0.26 pp @ R96** (diamond, 65 % target).
- **Watertight meshing pipeline**: edge-crossing Surface Nets with global orientation propagation — open edges, non-manifold and degenerate triangles are hard-failed before any STL is written.
- **Physics suite**: Gibson-Ashby stiffness/yield, permeability, tortuosity, homogenization (Voigt–Reuss bounds), phononic band gaps (Bloch–Floquet), tissue ingrowth (reaction–diffusion), LPBF thermo-mechanical, topology optimization, ML surrogate Pareto.
- **CAE direct-pass**: Abaqus INP (C3D8 + load steps) and OpenFOAM polyMesh straight from the browser — no snappyHexMesh.
- **AI-friendly**: a deterministic CLI (`tpms/agent/`) with machine-readable JSON output and an agentic roadmap ([ROADMAP](tpms/agent/ROADMAP.md)) — the LLM never writes numbers, the gates decide.

## Quick start

**Online (zero install):** open the GitHub Pages site → *Start Exploring*.

**Local single-file:** double-click `docs/index.html` (Chrome/Edge).

**Engineering workstation:**

```bash
cd tpms/tpms-platform
npm install
npm run dev        # http://localhost:5173
```

**CLI (porosity → watertight STL, no browser):**

```bash
cd tpms/tpms-platform && npm install
node ../agent/tpms.mjs mesh --type gyroid --porosity 0.65 --out scaffold.stl
node ../agent/tpms.mjs estimate --type gyroid --porosity 0.65 --material tc4
```

## Verification

```bash
cd tpms/tpms-platform && npm run test:all   # 44/44 gates, ~6–10 min
```

Every gate prints a `RESULT` line and carries a minimum-assertion guard, so silently skipping assertions fails the build. See [docs/LEARNING_PATH.md](docs/LEARNING_PATH.md) for the guided path from "what is a minimal surface?" to research-grade workflows, and [docs/WORKFLOW_GUIDE.md](docs/WORKFLOW_GUIDE.md) (36 chapters) for AM/CFD/CAE practice.

## Status & scope honesty

Browser-side FEM/CFD modules are **engineering-grade analytic estimates** (literature-calibrated, instant), not Abaqus-grade solvers — the UI and docs keep the two registers separate, and one-command export to real solvers is built in.

---

*Independent open-source work, continuously maintained. Issues and PRs welcome.*
