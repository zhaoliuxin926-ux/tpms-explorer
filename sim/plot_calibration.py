# -*- coding: utf-8 -*-
"""FEA 标定组论文级图表：sheet gyroid 幂律 vs Gibson-Ashby 对照。

数据源：plans/2026-10-30_GA-C1扫参标定.md（Standard 线弹性四点 + Explicit 三点全特征）。
输出：sim/out/calibration_curves.png（两 panel：刚度 / 强度）。
用法（仓库根）：python sim/plot_calibration.py
"""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# ── 数据（2026-10-31 八轮实验定案）─────────────────────────────
rho = np.array([0.5, 0.4, 0.3])
# Standard 隐式 C3D10 线弹性 E*（轮 3；p70 为 R24 口径，R32 判别 +1.7% 已披露）
E_std = np.array([425.41, 265.65, 135.10])
E_std_r32 = 137.42  # p70 R32 判别点
# Explicit C3D10M 全特征（轮 7；同参 T=5ms/dt=2e-7/μ=0.3）
E_expl = np.array([351.53, 221.57, 115.18])
Rp_expl = np.array([7.286, 4.732, 2.602])
pl_expl = np.array([16.762, 10.008, 4.898])
Es, sig_s = 2000.0, 55.0
# k 维尺寸效应（轮 8，por 0.6）
E_k1, pl_k1 = 186.1, 6.9

rr = np.linspace(0.25, 0.55, 100)
GA_E = 0.38 * rr**2
GA_S = 0.30 * rr**1.5

def fit(x, y):
    c = np.polyfit(np.log(x), np.log(y), 1)
    return c[0], np.exp(c[1])

fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))

# ── 左：刚度 ────────────────────────────────────────────────
ax = axes[0]
nE, CE = fit(rho, E_std / Es)
ax.loglog(rr, GA_E, "k--", lw=1.2, label="Gibson–Ashby $0.38\\bar{\\rho}^2$")
ax.loglog(rr, np.exp(np.log(CE) + nE * np.log(rr)), color="tab:blue", lw=1.2,
          label=f"FEA (Std) fit  ${CE:.2f}\\bar{{\\rho}}^{{{nE:.2f}}}$")
ax.loglog(rho, E_std / Es, "o", color="tab:blue", ms=7, label="FEA Standard C3D10")
ax.loglog(rho, E_expl / Es, "s", color="tab:orange", ms=6, label="FEA Explicit C3D10M")
ax.loglog([0.3], [E_std_r32 / Es], "o", color="tab:blue", ms=7, mfc="none", label="R32 mesh check")
ax.loglog([0.4], [E_k1 / Es], "^", color="tab:red", ms=7, label="k=1 (size effect)")
ax.set_xlabel("Relative density $\\bar{\\rho}$")
ax.set_ylabel("$E^*/E_s$")
ax.set_title("(a) Stiffness scaling")
ax.grid(True, which="both", alpha=0.25)
ax.legend(fontsize=7.5, loc="upper left")

# ── 右：强度 ────────────────────────────────────────────────
ax = axes[1]
nRp, CRp = fit(rho, Rp_expl / sig_s)
nPl, CPl = fit(rho, pl_expl / sig_s)
ax.loglog(rr, GA_S, "k--", lw=1.2, label="Gibson–Ashby $0.3\\bar{\\rho}^{1.5}$")
ax.loglog(rr, np.exp(np.log(CRp) + nRp * np.log(rr)), color="tab:green", lw=1.2,
          label=f"Rp0.2 fit  ${CRp:.2f}\\bar{{\\rho}}^{{{nRp:.2f}}}$")
ax.loglog(rr, np.exp(np.log(CPl) + nPl * np.log(rr)), color="tab:red", lw=1.2,
          label=f"Plateau fit  ${CPl:.2f}\\bar{{\\rho}}^{{{nPl:.2f}}}$")
ax.loglog(rho, Rp_expl / sig_s, "s", color="tab:green", ms=6, label="Rp0.2 (Explicit)")
ax.loglog(rho, pl_expl / sig_s, "o", color="tab:red", ms=6, label="Plateau $\\sigma^*$ (Explicit)")
ax.loglog([0.4], [pl_k1 / sig_s], "^", color="tab:red", ms=7, mfc="none", label="k=1 (size effect)")
ax.set_xlabel("Relative density $\\bar{\\rho}$")
ax.set_ylabel("$\\sigma^*/\\sigma_{ys}$")
ax.set_title("(b) Strength scaling (decoupled exponents)")
ax.grid(True, which="both", alpha=0.25)
ax.legend(fontsize=7.5, loc="upper left")

fig.suptitle("Sheet gyroid TPMS: FEA calibration vs Gibson-Ashby "
             "(k$\\geq$2 domain, $\\sigma_{ys}$=55 MPa, $E_s$=2 GPa)", fontsize=11)
fig.tight_layout()
out = Path(__file__).parent / "out" / "calibration_curves.png"
fig.savefig(out, dpi=200)
print(f"[OK] {out}")
print(f"拟合：E*={CE:.3f}·ρ^{nE:.2f} | Rp0.2={CRp:.3f}·ρ^{nRp:.2f} | 平台={CPl:.3f}·ρ^{nPl:.2f}")
