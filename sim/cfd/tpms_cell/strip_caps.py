# TPMS 单胞 snappy 用 wall-only STL：剔除 6 个盒面端盖三角（边界由背景盒面承担）
# 用法：python strip_caps.py <in.stl> <out.stl>
import sys
import numpy as np
import trimesh

L = 2.0 * np.pi
m = trimesh.load(sys.argv[1])
tri = m.triangles
on_plane = (
    np.isclose(tri[:, :, 0], 0, atol=1e-4).all(axis=1) | np.isclose(tri[:, :, 0], L, atol=1e-4).all(axis=1)
    | np.isclose(tri[:, :, 1], 0, atol=1e-4).all(axis=1) | np.isclose(tri[:, :, 1], L, atol=1e-4).all(axis=1)
    | np.isclose(tri[:, :, 2], 0, atol=1e-4).all(axis=1) | np.isclose(tri[:, :, 2], L, atol=1e-4).all(axis=1)
)
keep = ~on_plane
out = trimesh.Trimesh(vertices=m.vertices, faces=m.faces[keep], process=False)
out.export(sys.argv[2])
print(f"faces {len(m.faces)} -> {len(out.faces)}（剔端盖 {int(on_plane.sum())}）")
