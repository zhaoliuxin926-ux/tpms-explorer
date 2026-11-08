# Anchor-1 hex 判别算例：blockMesh O-grid 结构化六面体圆柱（2026-11-08 凌晨）
# 目的：tet 近壁梯度高估假说的终审——hex 若 err<0.5% 则诊断实锤+拿到验证基准
import math

L = 2.0 * math.pi
R = L / 2.0
y0 = z0 = L / 2
b = 2.0                      # 内方半边
d45 = math.sqrt(2) / 2
nRad, nArc, nAx = 30, 24, 60

cos45 = R * d45              # 外环 45° 系半径分量
in45 = b * d45               # 内方对角分量
# 顶点：x=0 环 0..7（O45,O135,O225,O315,I45,I135,I225,I315），x=L 环 8..15
angles = [(cos45, cos45), (-cos45, cos45), (-cos45, -cos45), (cos45, -cos45)]
inner = [(in45, in45), (-in45, in45), (-in45, -in45), (in45, -in45)]
verts = []
for x in (0.0, L):
    for (dy, dz) in angles:
        verts.append((x, y0 + dy, z0 + dz))
    for (dy, dz) in inner:
        verts.append((x, y0 + dy, z0 + dz))
vlines = "\n".join(f"    ({v[0]:.8f} {v[1]:.8f} {v[2]:.8f})" for v in verts)

def arc(i, j, k):  # 环内第 k 条弧（mid 由环 x 与角度定）
    th = (math.pi / 2) + (math.pi / 2) * (k % 4)  # 弧中点角（90°+90k）
    x = verts[i][0]
    m = (x, y0 + R * math.cos(th), z0 + R * math.sin(th))
    return f"    arc {i} {j} ({m[0]:.8f} {m[1]:.8f} {m[2]:.8f})"
edges = "\n".join([arc(0, 1, 0), arc(1, 2, 1), arc(2, 3, 2), arc(3, 0, 3),
                   arc(8, 9, 0), arc(9, 10, 1), arc(10, 11, 2), arc(11, 8, 3)])

blocks = [
    (4, 5, 6, 7, 12, 13, 14, 15),      # 中心方柱
    (0, 1, 5, 4, 8, 9, 13, 12),        # 扇区 1
    (1, 2, 6, 5, 9, 10, 14, 13),       # 扇区 2
    (2, 3, 7, 6, 10, 11, 15, 14),      # 扇区 3
    (3, 0, 4, 7, 11, 8, 12, 15),       # 扇区 4
]
def bline(idx, blk):
    n2 = nArc if idx == 0 else nRad  # 中心方柱两个切向都是 nArc
    a, b_, c, d, e, f_, g, h = blk
    return f"    hex ({a} {b_} {c} {d} {e} {f_} {g} {h}) ({nArc} {n2} {nAx}) simpleGrading (1 1 1)"
blines = "\n".join(bline(i, blk) for i, blk in enumerate(blocks))

walls = [
    ((0, 1, 9, 8),), ((1, 2, 10, 9),), ((2, 3, 11, 10),), ((3, 0, 8, 11),),
]
wall_lines = "\n".join(
    f"    wall{i}\n    {{\n        type wall;\n        faces (({f[0][0]} {f[0][1]} {f[0][2]} {f[0][3]}));\n    }}"
    for i, f in enumerate(walls))
x0_faces = "(4 5 6 7) (0 1 5 4) (1 2 6 5) (2 3 7 6) (3 0 4 7)"
xL_faces = "(12 13 14 15) (8 9 13 12) (9 10 14 13) (10 11 15 14) (11 8 12 15)"

dict_text = f"""FoamFile
{{
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}
convertToMeters 1;
vertices
(
{vlines}
);
edges
(
{edges}
);
blocks
(
{blines}
);
boundary
(
{wall_lines}
    x0
    {{
        type patch;
        faces
        (
            {x0_faces}
        );
    }}
    xL
    {{
        type patch;
        faces
        (
            {xL_faces}
        );
    }}
);
mergePatchPairs ();
"""
open('D:/GITHUB/tpms/sim/cfd/anchor1/blockMeshDict.hex', 'w', encoding='utf-8', newline='\n').write(dict_text)
print(f"blockMeshDict.hex written: nRad={nRad} nArc={nArc} nAx={nAx} cells={nArc*nRad*nAx + (nArc**2)*nAx}")
