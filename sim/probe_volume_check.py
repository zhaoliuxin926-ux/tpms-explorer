# -*- coding: utf-8 -*-
"""FE/STL 体积一致性核对（2026-11-01 Codex 第四轮核对条件）。

tet10 精确体积 = 8 子四面体分解（abaqus C3D10 节点序 v[4..9]=m12,m23,m13,m14,m24,m34；
单 tet 1/6 精确校验背书）。用法：python sim/probe_volume_check.py [stem ...]
stem 缺省 = 本日六件（gyroid/diamond k2R24 p50/60/70）；每件输出 FE/STL 体积比与固相。
"""
import sys
import numpy as np
import trimesh
import meshio


def tet10_vol(pts, conn):
    v = pts[conn]
    c0, c1, c2, c3 = v[0], v[1], v[2], v[3]
    m12, m23, m13, m14, m24, m34 = v[4], v[5], v[6], v[7], v[8], v[9]

    def V(a, b, c, d):
        return abs(np.dot(np.cross(b - a, c - a), d - a)) / 6

    return (V(c0, m12, m13, m14) + V(c1, m12, m23, m24) + V(c2, m13, m23, m34)
            + V(c3, m14, m24, m34) + V(m12, m13, m14, m24) + V(m12, m23, m24, m13)
            + V(m13, m23, m34, m24) + V(m12, m14, m24, m34))


stems = sys.argv[1:] or [f'sim/out/{t}_k2_p{p}' for t in ('gyroid', 'diamond') for p in (50, 60, 70)]
for stem in stems:
    stl = trimesh.load(stem + '.stl', force='mesh')
    mio = meshio.read(stem + '.inp')
    pts = mio.points[:, :3]
    fe_vol = sum(tet10_vol(pts, conn) for c in mio.cells if c.type == 'tetra10' for conn in c.data)
    fe_solid = fe_vol / float(np.prod(pts.max(axis=0) - pts.min(axis=0)))
    stl_solid = stl.volume / float(np.prod(stl.bounds[1] - stl.bounds[0]))
    print('%-28s FE/STL 体积比 = %.6f  FE固相=%.5f  STL固相=%.5f' % (stem, fe_vol / stl.volume, fe_solid, stl_solid))
