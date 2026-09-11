# Cover Letter（投稿时粘贴到 Editorial Manager 的 Cover Letter 栏）

> 使用说明：署名占位 `[Author Name] / [Affiliation] / [Email]` 待署名定稿后由 main.tex 同步；
> 提交时如系统对字数有限制，可只保留第一段 + Why it fits 前三条。

---

Dear Editors of SoftwareX,

We are pleased to submit our manuscript **"TPMS Explorer: an interactive, gate-verified open
ecosystem for triply periodic minimal surface design, generative implicit fields, multifunctional
physics simulation, and biophysical tissue-ingrowth dynamics"** for consideration as an Original
Software Publication.

**What the software does.** TPMS Explorer is a browser-based, zero-backend ecosystem for
parametric design, physics simulation, and additive-manufacturing preparation of triply periodic
minimal surface (TPMS) architected materials. It couples a watertight Surface Nets meshing
pipeline with an exact analytic porosity solver, multifunctional physics estimators (mechanical,
permeability, acoustic, thermal), CAE hand-off (Abaqus/OpenFOAM/G-code), and v7.0 research-grade
modules for generative implicit fields, yield envelopes, phononic bandgaps, and tissue-ingrowth
dynamics.

**Why we believe it fits SoftwareX.**

1. **Complementary to prior SoftwareX TPMS tooling.** Where the RegionTPMS software article
   (SoftwareX, 2021) addresses region-partitioned TPMS generation, TPMS Explorer covers the full
   chain from interactive design to verified mesh export and CAE automation — the two tools
   address adjacent stages of the same workflow and share the 1-period-equals-1-mm convention for
   interoperability.
2. **Verification culture as the core differentiator.** Every headline claim in the manuscript is
   re-executable: a 41-item CI suite (38 formal gates + navigation quick-check + CLI selftest + schema contract, >1,000 assertions
   under strict per-line accounting, each gate carrying a minimum-assertion guard) runs on a
   three-platform GitHub Actions matrix; a clean clone reproduces all claims via
   `npm install && npm run test:all`.
3. **Two methodological contributions.** (i) An exact porosity solver (analytic iso\* root-finding
   with cross-process caching and mesh-measured secant correction) that reaches 0.05 pp tolerance
   on families where the pre-fix bisection stalled and reported unreachable; (ii) root-cause
   identification and fix of a projection step-length unit error (missing k-factor) in the Surface
   Nets Newton projection — the dominant source of systematic solid-volume loss (up to 9–11 pp),
   documented with before/after evidence (IWP R48 solid fraction +21.5 pp).
4. **Honest-boundary engineering.** Known limitations (Voigt upper-bound shear estimates,
   LBM→FD-Darcy substitution, voxel-topology fail-closed parameter ranges) are disclosed and
   guard-railed in the repository rather than left undocumented.

**Declarations.** The manuscript is original, has not been published previously, and is not under
consideration elsewhere. All authors approved the submission and declare no competing interests.
The software is MIT-licensed and publicly available at
https://github.com/zhaoliuxin926-ux/tpms-explorer, with the submission version archived at the
tagged release.

Sincerely,

[Author Name]
[Affiliation]
[Email]
