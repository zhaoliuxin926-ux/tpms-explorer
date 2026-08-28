# TPMS Explorer: A Browser-Based Parametric Design and Multi-Physics Simulation Platform for Triply Periodic Minimal Surface Lattices

## Abstract

TPMS Explorer is an open-source, browser-based platform for parametric design, analysis, and fabrication preparation of triply periodic minimal surface (TPMS) lattices. The platform integrates eight canonical TPMS topologies with a constructively watertight meshing pipeline, native in-browser finite element homogenization (J-PCG), lattice Boltzmann/finite-difference permeability solving, stress-driven anisotropy (Wolff's law), hierarchical multi-scale architecture, inverse multi-objective design (Nelder-Mead + LM), Micro-CT deviation analysis, and direct G-code generation. All computations run client-side with zero server dependencies.

## Key Features

1. **Watertight meshing**: Edge-crossing key extraction + tangential Taubin smoothing + analytic Newton projection; STL watertight 100% (29-case audit).
2. **Native CAE solvers**: Browser-based voxel FEA homogenization (J-PCG) and FD-Darcy permeability; solid-block patch test analytic-exact.
3. **Inverse design**: Multi-objective (E*, κ, P) inverse solving with Nelder-Mead + Levenberg-Marquardt; κ lower-bound constraint semantics; 10 inverse-crime cases converge ≤3%.
4. **Additive manufacturing**: Endplates, CFD multi-patch STL, 3MF (mm native), G-code direct export (Marlin/Klipper/Bambu).
5. **Multi-scale**: Hierarchical TPMS (F = F_macro + λ·F_micro(Nx)); coarea dual specific surface; Micro-CT deviation heatmap.

## Architecture

- Single-page Vite + TypeScript platform (tpms-platform/)
- Self-contained single-file teaching edition (docs/app.html)
- 26 CI gates / 1000+ assertions / 3-platform matrix (Ubuntu/Windows/macOS)
- Four-way parity: TS source ↔ docs/app.html ↔ Python ↔ MATLAB

## Statements

**Availability**: MIT license, https://github.com/xxx/tpms
**Requirements**: Modern browser (Chrome/Firefox/Safari); WebGPU optional
**Dependencies**: Three.js r0.185 (bundled); zero other runtime dependencies

