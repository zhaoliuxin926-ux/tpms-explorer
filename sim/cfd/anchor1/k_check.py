# Anchor-1 K 对账：K = nu*eps*Ubar/G vs 理论 pi^3/32
import math, sys
Ubar = float(sys.argv[1])
G = 1e-9; nu = 1e-6; eps = math.pi/4
K = nu*eps*Ubar/G
Kth = math.pi**3/32
print(f"Ubar={Ubar:.6e}  K_meas={K:.6f}  K_theory={Kth:.6f}  err={(K-Kth)/Kth*100:+.3f}%")
