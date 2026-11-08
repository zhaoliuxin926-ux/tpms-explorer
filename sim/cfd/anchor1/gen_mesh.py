# Anchor-1 直管 Poiseuille 验证算例网格生成（2026-11-07）
# 几何：[0,2π]³ 周期盒内 R=0.5L 轴向贯通圆管；流体域=管内（固相不剖分）
# 解析解：K = eps*R^2/8 = pi^3/32 ~= 0.9690；eps = pi/4
import sys, math
import gmsh

L = 2.0 * math.pi
R = L / 2.0
h = float(sys.argv[1]) if len(sys.argv) > 1 else 0.30

gmsh.initialize()
gmsh.model.add("anchor1")
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

# 共形周期对：slave(x=L) = master(x=0) 平移 L
gmsh.model.mesh.setPeriodic(2, [dL], [d0],
                            [1,0,0,L, 0,1,0,0, 0,0,1,0, 0,0,0,1])

gmsh.model.addPhysicalGroup(2, [lateral], name="scaffoldWall")
gmsh.model.addPhysicalGroup(2, [d0], name="cycX0")
gmsh.model.addPhysicalGroup(2, [dL], name="cycXL")
gmsh.model.addPhysicalGroup(3, [cyl], name="fluid")

gmsh.option.setNumber("Mesh.MeshSizeMax", h)
gmsh.option.setNumber("Mesh.Algorithm", 6)
gmsh.option.setNumber("Mesh.Algorithm3D", 1)
gmsh.option.setNumber("Mesh.ElementOrder", 1)
gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)
gmsh.option.setNumber("Mesh.Binary", 0)
gmsh.option.setNumber("Mesh.Optimize", 1)
gmsh.option.setNumber("Mesh.OptimizeNetgen", 1)
gmsh.model.mesh.generate(3)
out = __file__.replace("gen_mesh.py", "anchor1_h%.3g.msh" % h)
gmsh.write(out)
print("msh:", out)
print("tets:", len(gmsh.model.mesh.getElementsByType(4)[0]))
gmsh.finalize()
