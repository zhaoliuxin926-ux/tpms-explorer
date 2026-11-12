# Anchor-1 snappyHex 路线：圆柱侧壁面网格 STL 生成（2026-11-12）
# 几何与 gen_mesh.py 同源：[0,2π]³ 盒、轴向 x、R=π——只输出 lateral 表面（snap 目标面）。
# 用法：python gen_snappy_surface.py [h=0.12]
import sys, math
import gmsh

L = 2.0 * math.pi
R = L / 2.0
h = float(sys.argv[1]) if len(sys.argv) > 1 else 0.12

gmsh.initialize()
gmsh.model.add("anchor1_wall")
gmsh.model.occ.addCylinder(0, L/2, L/2, L, 0, 0, R)
gmsh.model.occ.synchronize()
# 删除两端圆盘（周期面由背景盒提供，绝不能进 STL——否则被当成 wall patch）
discs = [(2, t) for (d, t) in gmsh.model.getEntities(2) if gmsh.model.getType(2, t) != "Cylinder"]
gmsh.model.occ.remove(discs, recursive=False)
gmsh.model.occ.synchronize()
lateral = [t for (d, t) in gmsh.model.getEntities(2) if gmsh.model.getType(2, t) == "Cylinder"]
gmsh.model.addPhysicalGroup(2, lateral, name="scaffoldWall")
gmsh.option.setNumber("Mesh.MeshSizeMin", h)
gmsh.option.setNumber("Mesh.MeshSizeMax", h)
gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
gmsh.model.mesh.generate(2)
out = __file__.replace("gen_snappy_surface.py", "cylinder_wall.stl")
gmsh.write(out)
n = len(gmsh.model.mesh.getElementsByType(2)[0])
print("stl:", out, " tris:", n)
gmsh.finalize()
