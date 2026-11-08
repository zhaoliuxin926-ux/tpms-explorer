# netgen 优化器变体：gmsh 原生 tet + Optimize/OptimizeNetgen 近壁质量改善实验
import sys
src = open('D:/GITHUB/tpms/sim/cfd/anchor1/gen_mesh.py', encoding='utf-8').read()
add = '''
gmsh.option.setNumber("Mesh.Optimize", 1)
gmsh.option.setNumber("Mesh.OptimizeNetgen", 1)
gmsh.option.setNumber("Mesh.OptimizeThreshold", 0.3)
'''
s2 = src.replace('gmsh.model.mesh.generate(3)', add + 'gmsh.model.mesh.generate(3)')
s2 = s2.replace('anchor1_h%.3g.msh', 'anchor1_netgen_h%.3g.msh')
open('D:/GITHUB/tpms/sim/cfd/anchor1/gen_netgen.py', 'w', encoding='utf-8', newline='\n').write(s2)
print('gen_netgen.py written')
