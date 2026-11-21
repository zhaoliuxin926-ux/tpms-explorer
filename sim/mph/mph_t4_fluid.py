# -*- coding: utf-8 -*-
"""T4 COMSOL MPh fluid batch: T3-caliber replication (gyroid k1 R20 p70 cs4 rve1).
Caliber from T3 openfoam_cfd_summary.json:
  L=4.0mm eps=0.70106 mu=0.00089 Pa*s rho=1000
  BC: inlet velocity | outlet p=0 | sides symmetry | wall no-slip
  T3 K caliber: K[mm2] = mu*v_in*L/dP (BC value as superficial)
Cross-check: dP2/dP1 ~= 10 (T3 = 10.0000)
"""
import mph, os, json, time, traceback, math
t0 = time.time()
def log(s): print("[%7.1fs] %s" % (time.time()-t0, s), flush=True)
STL = r"D:\GITHUB\tpms\sim\out\rve_real_fix\fluid_gyroid_network_k1_R20_p70_cs4_rve1_labeled.stl"
OUT = r"D:\GITHUB\tpms\sim\out\comsol_t4"
os.makedirs(OUT, exist_ok=True)
MPH = os.path.join(OUT, "t4_comsol_rve1.mph")
L, MU, RHO, VIN1, VIN2 = 4.0, 0.00089, 1000.0, 1.0, 10.0
TOL = 0.02
import jpype
from jpype import JArray, JString
def jsa(lst): return JArray(JString)(lst)

client = mph.start(cores=4)
log("server+client up")
model = client.create("t4_comsol_rve1")

# ---------- geometry ----------
j = model.java
j.component().create("comp1", True)
comp = j.component("comp1")
g = comp.geom().create("geom1", 3)
g.lengthUnit("mm")
imp = g.create("imp1", "Import")
imp.set("type", "file")
imp.set("filename", STL)
g.run()
log("STL imported+built")
try:
    print("domains=%s boundaries=%s" % (g.getNDomains(), g.getNBoundaries()))
except Exception as e:
    log("geom stats n/a: %s" % e)
model.save(os.path.join(OUT, "stage1_geom.mph"))

# ---------- named selections ----------
def box(tag, cond, **lim):
    s = comp.selection().create(tag, "Box")
    s.set("entitydim", jpype.JInt(2))
    s.set("condition", cond)
    for k, v in lim.items():
        s.set(k, "%s[mm]" % v)
    return s

box("sel_inlet",  "allvertices", xmin=-TOL, xmax=TOL)
box("sel_outlet", "allvertices", xmin=L-TOL, xmax=L+TOL)
box("sel_y0", "allvertices", ymin=-TOL, ymax=TOL)
box("sel_yL", "allvertices", ymin=L-TOL, ymax=L+TOL)
box("sel_z0", "allvertices", zmin=-TOL, zmax=TOL)
box("sel_zL", "allvertices", zmin=L-TOL, zmax=L+TOL)
uni = comp.selection().create("uni_sides", "Union")
uni.set("entitydim", jpype.JInt(2))
uni.set("input", jsa(["sel_y0", "sel_yL", "sel_z0", "sel_zL"]))
cpl = comp.selection().create("cpl_wall", "Complement")
cpl.set("entitydim", jpype.JInt(2))
cpl.set("input", jsa(["sel_inlet", "sel_outlet", "uni_sides"]))
log("named selections ok")

# ---------- mesh: BL on wall first, then FreeTet ----------
msh = comp.mesh().create("mesh1", "geom1")
bl = msh.create("bl1", "BndLayer")
bl.selection().named("cpl_wall")
blp = bl.create("blp1", "BndLayerProp")
blp.set("blnlayers", jpype.JInt(2))
for prop, val in (("hfirst", "0.03[mm]"), ("firsth", "0.03[mm]"), ("blstretch", 1.2)):
    try:
        blp.set(prop, val)
    except Exception as e:
        print("blprop %s n/a: %s" % (prop, str(e)[:80]))
tet = msh.create("ftet1", "FreeTet")
sz = tet.create("size", "Size")
sz.set("hauto", jpype.JInt(4))
try:
    sz.set("hmax", "0.3[mm]")
    sz.set("hmin", "0.02[mm]")
except Exception as e:
    log("hmax/hmin skipped: %s" % e)
msh.run()
log("mesh built")
try:
    print("elements=%s" % msh.getNElements())
except Exception as e:
    log("mesh stat n/a: %s" % e)
model.save(os.path.join(OUT, "stage2_mesh.mph"))

# ---------- physics ----------
j.param().set("v_in", "1.0[mm/s]", "inlet velocity")
j.param().set("mu_f", "0.00089[Pa*s]", "T3 caliber viscosity")
j.param().set("rho_f", "1000[kg/m^3]", "density")
mat = comp.material().create("mat1", "Common")
mat.label("TPMS fluid")
mat.propertyGroup("def").set("density", "rho_f")
mat.propertyGroup("def").set("dynamicviscosity", "mu_f")
ph = comp.physics().create("spf", "LaminarFlow", "geom1")
inl = ph.create("inl1", "InletBoundary", 2)
inl.selection().named("sel_inlet")
inl.set("U0in", "v_in")
out = ph.create("out1", "OutletBoundary", 2)
out.selection().named("sel_outlet")
out.set("p0", "0[Pa]")
sym = ph.create("sym1", "Symmetry", 2)
sym.selection().named("uni_sides")
log("physics ok: inlet v_in / outlet p=0 / symmetry sides / no-slip wall")

# ---------- study + numericals ----------
st = j.study().create("std1")
st.create("stat", "Stationary")
log("solving v1 = 1.0 mm/s ...")
j.study("std1").run()
log("v1 solved")

r = j.result()
tx = "2*spf.mu*mean(d(u,x))*nx+spf.mu*(mean(d(u,y))+mean(d(v,x)))*ny+spf.mu*(mean(d(u,z))+mean(d(w,x)))*nz"
ty = "spf.mu*(mean(d(u,y))+mean(d(v,x)))*nx+2*spf.mu*mean(d(v,y))*ny+spf.mu*(mean(d(v,z))+mean(d(w,y)))*nz"
tz = "spf.mu*(mean(d(u,z))+mean(d(w,x)))*nx+spf.mu*(mean(d(v,z))+mean(d(w,y)))*ny+2*spf.mu*mean(d(w,z))*nz"
WSS = ("sqrt(("+tx+")^2+("+ty+")^2+("+tz+")^2-("+tx+"*nx+"+ty+"*ny+"+tz+"*nz)^2)")
def mknum(tag, kind, expr, sel, unit, selnum=None):
    n = r.numerical().create(tag, kind)
    try:
        n.set("data", "dset1")
    except Exception as e:
        print("data bind n/a: %s" % str(e)[:60])
    if sel:
        n.selection().named(sel)
    if selnum is not None:
        n.selection().set(jpype.JInt(selnum))
    n.set("expr", jsa([expr]))
    n.set("unit", jsa([unit]))
    return n

mknum("av_pin", "AvSurface", "p", "sel_inlet", "Pa")
mknum("av_pout", "AvSurface", "p", "sel_outlet", "Pa")
mknum("intQ", "IntSurface", "u", "sel_inlet", "mm^3/s")
mknum("avUbar", "AvVolume", "sqrt(u^2+v^2+w^2)", None, "mm/s", selnum=1)
mknum("avWSS", "AvSurface", WSS, "cpl_wall", "Pa")
mknum("maxWSS", "MaxSurface", WSS, "cpl_wall", "Pa")
FXBAL = "(" + tx + "-(" + tx + "*nx+" + ty + "*ny+" + tz + "*nz)*nx)"
mknum("avA_in", "IntSurface", "1", "sel_inlet", "mm^2")
mknum("intV", "IntVolume", "1", None, "mm^3", selnum=1)
mknum("fxbal", "IntSurface", FXBAL, "cpl_wall", "Pa*mm^2")
log("numericals ok")

def numval(tag):
    n = r.numerical(tag)
    n.setResult()
    return float(n.getReal()[0][0])

def collect():
    d = {}
    d["dp_Pa"] = numval("av_pin") - numval("av_pout")
    d["p_out_Pa"] = numval("av_pout")
    d["Q_mm3_s"] = numval("intQ")
    d["Ubar_mm_s"] = numval("avUbar")
    d["wss_mean_Pa"] = numval("avWSS")
    d["wss_max_Pa"] = numval("maxWSS")
    d["V_mm3"] = numval("intV")
    d["A_inlet_mm2"] = numval("avA_in")
    d["Fx_wall_Pa_mm2"] = numval("fxbal")
    return d

v1 = collect()
log("v1 results: %s" % v1)

# ---------- v2 linear cross-check ----------
j.param().set("v_in", "10.0[mm/s]")
try:
    j.study("std1").reset()
except Exception as e:
    print("study.reset n/a: %s" % str(e)[:80])
j.study("std1").run()
v2 = collect()
log("v2 results: v1/v2 results: %s" % v2)
A_box = L*L
ratio = v2["dp_Pa"]/v1["dp_Pa"]
K_bc_v1 = MU*VIN1*L/v1["dp_Pa"]
K_fx_v1 = MU*(v1["Q_mm3_s"]/A_box)*L/v1["dp_Pa"]
K_bc_v2 = MU*VIN2*L/v2["dp_Pa"]
K_fx_v2 = MU*(v2["Q_mm3_s"]/A_box)*L/v2["dp_Pa"]
T3K = 1.1519e-4
S = {}
S["tag"] = "t4_comsol_rve1"
S["geometry"] = STL
S["caliber"] = {"L_mm": L, "eps": 0.70106, "mu_Pas": MU, "rho_kgm3": RHO}
S["caliber"]["v_in_mm_s"] = [VIN1, VIN2]
S["caliber"]["BCs"] = "inlet velocity | outlet p=0 | sides symmetry | wall no-slip"
S["caliber"]["wssExpression"] = WSS
S["caliber"]["K_note"] = "T3: K=mu*v_in*L/dP (BC value as superficial); flux: K=mu*(Q/A)*L/dP"
S["v1"] = v1
S["v2"] = v2
S["linearity"] = {"dp2_over_dp1": ratio, "T3": 10.0}
S["K"] = {"K_bc_v1_mm2": K_bc_v1, "K_flux_v1_mm2": K_fx_v1, "K_bc_v2_mm2": K_bc_v2, "K_flux_v2_mm2": K_fx_v2, "T3_K_mm2": T3K, "ratio_bc": K_bc_v1/T3K, "ratio_flux": K_fx_v1/T3K}
S["status"] = "PASS" if (v1["dp_Pa"]>0 and v1["wss_mean_Pa"]>0 and 9.5<ratio<10.5) else "FAIL"
fh = open(os.path.join(OUT, "t4_summary.json"), "w", encoding="utf-8")
json.dump(S, fh, ensure_ascii=False, indent=1)
fh.close()
model.save(MPH)
log("saved %s" % MPH)
client.remove(model)
log("T4_MPH_DONE ratio=%.4f K_bc=%.4e vs T3_corrected=%.4e agree=%.2f%%" % (ratio, K_bc_v1, 0.11519, 100*abs(K_bc_v1-0.11519)/0.11519))
print("NOTE: T3 raw dp_Pa=30.907/309.171 is mm-kinematic mislabeled as Pa (x1000); corrected dP=0.030907/0.309171 Pa")
