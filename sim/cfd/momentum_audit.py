import re, math, json
case = r"D:\GITHUB\tpms\sim\out\rve_real_fix\of_fluid_gyroid_network_k1_R20_p70_cs4_rve1"
poly = case + r"\constant\polyMesh"
b = open(poly + r"\boundary", encoding="utf-8", errors="ignore").read()
m = re.search(r"scaffoldWall\s*\{[^}]*nFaces\s+(\d+);[^}]*startFace\s+(\d+);", b)
nw_, sw_ = int(m.group(1)), int(m.group(2))
pts_t = open(poly + r"\points", encoding="utf-8", errors="ignore").read()
pts = [tuple(map(float, v)) for v in re.findall(r"\(([-\d.e+]+) ([-\d.e+]+) ([-\d.e+]+)\)", pts_t)]
f_t = open(poly + r"\faces", encoding="utf-8", errors="ignore").read()
i0 = f_t.index("(\n")
ftoks = f_t[i0+2:].replace("(", " ( ").replace(")", " ) ").split()
NF = 136891
faces = []
w = 0
while w < len(ftoks) and len(faces) < NF:
    nv = int(ftoks[w]); w += 1
    if ftoks[w] == "(": w += 1
    idx = [int(ftoks[w+q]) for q in range(nv)]
    w += nv
    if w < len(ftoks) and ftoks[w] == ")": w += 1
    faces.append(idx)
o_t = open(poly + r"\owner", encoding="utf-8", errors="ignore").read()
i0 = o_t.index("(\n")
owners = [int(x) for x in o_t[i0+2:].split()[:NF]]
pt_t = open(case + r"\147\p", encoding="utf-8", errors="ignore").read()
i0 = pt_t.index("internalField")
ncell = 40914
ptoks = pt_t[i0:].replace("(", " ").replace(")", " ").split()
pvals = []
for tok in ptoks:
    try:
        pvals.append(float(tok))
    except ValueError:
        continue
if abs(pvals[0] - ncell) < 1:
    pvals = pvals[1:]
pvals = pvals[:ncell]
print("p values=%d first=%.5g" % (len(pvals), pvals[0]))
t = open(case + r"\147\wallShearStress", encoding="utf-8", errors="ignore").read()
i = t.index("scaffoldWall")
wall_vecs = re.findall(r"\(([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)\)", t[i:i+1500000])[:nw_]
dp_kin = 0.3091711
# KEY FIX: pressure acts on the FLUID inlet face (A=Q/v_in=9.679 mm^2), not the full box (16)
A_fluid_inlet = 9.679
RHS = dp_kin * A_fluid_inlet
tot_p = 0.0; tot_w = 0.0; A_w = 0.0
for k in range(nw_):
    fi = sw_ + k
    idx = faces[fi]
    P = [pts[i2] for i2 in idx]
    sx=sy=sz=0.0
    for j in range(len(P)):
        x1,y1,z1 = P[j]; x2,y2,z2 = P[(j+1)%len(P)]
        sx += 0.5*(y1-y2)*(z1+z2); sy += 0.5*(z1-z2)*(x1+x2); sz += 0.5*(x1-x2)*(y1+y2)
    Sm = math.sqrt(sx*sx+sy*sy+sz*sz)
    nx_, ny_, nz_ = sx/Sm, sy/Sm, sz/Sm
    pw_ = pvals[owners[fi]]
    tot_p += pw_*nx_*Sm
    wx, wy, wz = (float(v) for v in wall_vecs[k])
    wdn = wx*nx_ + wy*ny_ + wz*nz_
    tx_ = wx - wdn*nx_
    tot_w += tx_*Sm
    A_w += Sm
print("A_wall=%.3f mm^2 (STL ref 47.57)" % A_w)
print("wall(p*nx)=%.5g wall(tau_x)=%.5g RHS=%.5g" % (tot_p, tot_w, RHS))
net = tot_p - tot_w
print("balance: int(p.nx) - int(w_x) = dP*A_fluid")
print("int(p.nx)=%.5g  int(w_x)=%.5g  ->  LHS=%.5g  RHS=%.5g" % (tot_p, tot_w, net, RHS))
print("closure = %.1f%%" % (100*net/RHS))
S = json.load(open(r"D:\GITHUB\tpms\sim\out\comsol_t4\t4_summary.json", encoding="utf-8"))
S["of_gyroid_momentum_audit"] = {"A_wall_mm2": round(A_w, 3),
 "wall_p_nx": round(tot_p, 4), "wall_tau_x": round(tot_w, 4),
 "RHS_dp_A_fluid": round(RHS, 4), "closure_pct": round(100*net/RHS, 2),
 "balance": "int(p.nx) - int(w_x) = dP*A_fluid_inlet (w stored = traction on fluid)",
 "note": "p_wall=internalField[owner] zeroGradient approx; Newell 0.5 fixed; count-token bug fixed"}
fh = open(r"D:\GITHUB\tpms\sim\out\comsol_t4\t4_summary.json", "w", encoding="utf-8")
json.dump(S, fh, ensure_ascii=False, indent=1); fh.close()
