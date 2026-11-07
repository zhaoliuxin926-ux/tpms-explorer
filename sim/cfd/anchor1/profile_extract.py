# Anchor-1 径向速度剖面提取+抛物线形状判别（2026-11-07 深夜）
import numpy as np, math, re

def read_field(path):
    with open(path, encoding='utf-8', errors='ignore') as f:
        txt = f.read()
    anchor = txt.find('internalField')
    i = txt.find(chr(10) + '(', anchor)
    j = txt.find(chr(10) + ')', i)
    body = txt[i:j]
    nums = np.array(re.findall(r'[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?', body), dtype=float)
    return nums.reshape(-1, 3)

C = read_field('D:/GITHUB/tpms/sim/cfd/anchor1/wsl_1500_C')
U = read_field('D:/GITHUB/tpms/sim/cfd/anchor1/wsl_1500_U')
assert len(C) == len(U), (len(C), len(U))
pi = math.pi
band = (np.abs(C[:, 0] - pi) < 0.05) & (np.abs(C[:, 2] - pi) < 0.05)
r = C[band, 1] - pi
ux = U[band, 0]
order = np.argsort(r)
r, ux = r[order], ux[order]
Ubar = 0.84520
a_fit = np.linalg.lstsq(np.column_stack([1 - (r / pi) ** 2]), ux, rcond=None)[0][0]
shape_err = np.sqrt(np.mean((ux - a_fit * (1 - (r / pi) ** 2)) ** 2)) / a_fit
print(f'cells in band: {band.sum()}  axis-vel fit a={a_fit:.4f}  Ubar-meas={Ubar:.4f}  a/(2*Ubar)={a_fit/(2*Ubar):.3f}')
print(f'profile shape RMS vs parabola: {shape_err*100:.2f}%')
for frac in (0.0, 0.25, 0.5, 0.75, 0.9):
    i = np.argmin(np.abs(r - frac * pi))
    print(f'  r/R={frac:.2f}: Ux={ux[i]:.4f}  parabola(2*Ubar*(1-(r/R)^2))={2*Ubar*(1-frac**2):.4f}')
