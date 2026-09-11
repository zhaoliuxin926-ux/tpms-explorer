# TPMS Explorer: A Browser-Based Parametric Design and Multi-Physics Simulation Platform for Triply Periodic Minimal Surface Lattices

> 投稿主稿：`latex/main.tex`（Elsevier SoftwareX 格式，pdflatex 三连编译通过）。
> 本文件为摘要导览，与 main.tex 同步更新（2026-09-11 对齐至 v7.0 + C2 五批 20 族 + 41 门）。

## Abstract

TPMS Explorer is an open-source, browser-based platform for parametric design, analysis, and fabrication preparation of triply periodic minimal surface (TPMS) lattices. The platform integrates **20 level-set surface families** (8 canonical + C2 extensions from the MiniSurf reference: O,C-TO / Karcher / Fischer-Koch S·Y·C(S)·C(Y) / G′ / D′ / Double P·D·G / Complementary D) with a constructively watertight meshing pipeline, native in-browser finite element homogenization (J-PCG), lattice Boltzmann/finite-difference permeability solving, stress-driven anisotropy (Wolff's law), hierarchical multi-scale architecture, inverse multi-objective design (Nelder-Mead + LM), Micro-CT deviation analysis, and direct G-code generation. Version 7.0 adds generative-biophysics modules (SIREN implicit fields, multiaxial yield envelopes, Bloch–Floquet phononic bands, tissue-ingrowth reaction–diffusion, level-set topology optimization). All computations run client-side with zero server dependencies.

## Key Features

1. **Watertight meshing**: Edge-crossing key extraction + tangential Taubin smoothing + analytic Newton projection; STL watertight 100% (30-case audit); **global orientation propagation** — misoriented edges = 0 by construction (byte-level verified, 823,500 edges @R96).
2. **Exact porosity solver** (agent CLI): analytic-integration root finding (deterministic LCG Monte-Carlo) + mesh-measured secant validation; measured deviation **0.26 pp @ R96** (Diamond, 65% target). Methodology对标 RegionTPMS (SoftwareX 2021).
3. **20 surface families**: four-way formula parity (TS / Python / MATLAB / GPU IR) + public BENCHMARKS matrix with fail-closed usable-domain table.
4. **Native CAE solvers**: Browser-based voxel FEA homogenization (J-PCG) and FD-Darcy permeability; solid-block patch test analytic-exact.
5. **Inverse design**: Multi-objective (E*, κ, P) inverse solving with Nelder-Mead + Levenberg-Marquardt; κ lower-bound constraint semantics; 10 inverse-crime cases converge ≤3%.
6. **Additive manufacturing**: Endplates, CFD multi-patch STL, 3MF (mm native), G-code direct export (Marlin/Klipper/Bambu).
7. **Multi-scale**: Hierarchical TPMS (F = F_macro + λ·F_micro(Nx)); coarea dual specific surface; Micro-CT deviation heatmap.
8. **Generative biophysics (v7.0)**: SIREN implicit fields with exact 2π-periodicity; multiaxial yield envelopes; Bloch–Floquet phononic bands; tissue-ingrowth reaction–diffusion; level-set topology optimization.

## Architecture

- Single-page Vite + TypeScript platform (tpms-platform/)
- Self-contained single-file teaching edition (docs/app.html, 8 canonical families)
- Deterministic agent CLI with JSON output (tpms/agent/)
- **41 CI gates / 1000+ assertions / 3-platform matrix (Ubuntu/Windows/macOS)**; every gate carries a minimum-assertion guard
- Four-way parity: TS source ↔ docs/app.html ↔ Python ↔ MATLAB (+ GPU IR for all 20 families)

## Statements

**Availability**: MIT license（仓库根 LICENSE）, https://github.com/zhaoliuxin926-ux/tpms-explorer
**Requirements**: Modern browser (Chrome/Firefox/Safari); WebGPU optional; Node.js ≥ 20 for CI
**Dependencies**: Three.js r0.185 (bundled); zero other runtime dependencies
