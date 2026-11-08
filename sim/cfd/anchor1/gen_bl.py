# Anchor-1 棱柱层判别算例：OCC 圆柱 + BoundaryLayer 场（2026-11-08）
# 目的：OCC 路线 gmsh 3D BL 可行性最小实验（宿舍侧证伪的是离散 STL 路线，OCC 未测）
import sys, math
import gmsh

L = 2.0 * math.pi
R = L / 2.0
h = float(sys.argv[1]) if len(sys.argv) > 1 else 0.30

gmsh.initialize()
gmsh.model.add("anchor1_bl")
cyl = gmsh.model.occ.addCylinder(0, L/2, L/2, L, 0, 0, R)
gmsh.model.occ.synchronize()

lateral, discs = None, {}
for d, t in gmsh.model.getEntities(2):
    if gmsh.model.getType(2, t) == "Cylinder":
        lateral = t
    else:
        com = gmsh.model.occ.getCenterOfMass(2, t)
        discs[round(com[0], 6)] = t
d0, dL = discs[round(0.0, 6)], discs[round(L, 6)]

gmsh.model.mesh.setPeriodic(2, [dL], [d0],
                            [1,0,0,L, 0,1,0,0, 0,0,1,0, 0,0,0,1])

gmsh.model.addPhysicalGroup(2, [lateral], name="scaffoldWall")
gmsh.model.addPhysicalGroup(2, [d0], name="cycX0")
gmsh.model.addPhysicalGroup(2, [dL], name="cycXL")
gmsh.model.addPhysicalGroup(3, [cyl], name="fluid")

# BoundaryLayer 棱柱层：贴壁 5 层，总厚 h*1.2，其余体素保持 h
try:
    gmsh.model.mesh.field.add("BoundaryLayer", 1)
    gmsh.model.mesh.field.setNumbers(1, "FacesList", [lateral])
    gmsh.model.mesh.field.setNumber(1, "Thickness", h * 1.2)
    gmsh.model.mesh.field.setNumber(1, "NbLayers", 5)
    gmsh.model.mesh.field.setNumber(1, "NodesFar", max(2, int(h * 1.2 / 0.05)))
    gmsh.model.mesh.field.setAsBackgroundMesh(1)
    print("BL field set: SurfacesList=[%d] Thickness=%.3f NbLayers=5" % (lateral, h * 1.2))
except Exception as e:
    print("BL setup failed:", e)
    gmsh.finalize()
    sys.exit(2)

gmsh.option.setNumber("Mesh.MeshSizeMax", h)
gmsh.option.setNumber("Mesh.Algorithm", 6)
gmsh.option.setNumber("Mesh.Algorithm3D", 1)
gmsh.option.setNumber("Mesh.ElementOrder", 1)
gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)
gmsh.option.setNumber("Mesh.Binary", 0)
gmsh.model.mesh.generate(3)
# 统计棱柱（type 6=prism/wedge）与四面体
tets = len(gmsh.model.mesh.getElementsByType(4)[0])
prisms = len(gmsh.model.mesh.getElementsByType(6)[0])
out = __file__.replace("gen_bl.py", "anchor1_bl_h%.3g.msh" % h)
gmsh.write(out)
print("msh:", out, "tets:", tets, "prisms:", prisms)
gmsh.finalize()
