# Anchor-1 K 对账：K = nu*eps*Ubar/G vs 理论 pi^3/32（mm 制口径——2026-11-12 修正 SI 残留）
# 口径钉死：case 为 mm 制（nu=1 mm²/s、fvModels G=0.81 mm/s²），K 单位 mm²；
# 历史 tet(h0.3 −13.5%)/netgen(−8.26%)/hex O-grid(−1.27%)/snappy(+0.319%) 均此口径。
import math, sys
Ubar = float(sys.argv[1])
G = 0.81; nu = 1.0; eps = math.pi/4
K = nu*eps*Ubar/G
Kth = math.pi**3/32
print(f"Ubar={Ubar:.6e}  K_meas={K:.6f}  K_theory={Kth:.6f}  err={(K-Kth)/Kth*100:+.3f}%")
