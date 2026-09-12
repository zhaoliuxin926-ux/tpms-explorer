# render_orientation_figure.py — 论文图二渲染：定向传播三态对比
# 数据：fig_orientation_data.json（gen_orientation_figure.mjs 产出）
# 输出：fig_orientation_comparison.pdf（LaTeX 直用）+ .png（预览）
import json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

with open('fig_orientation_data.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

LIM = math.pi  # wc 域 ±π
states = [
    ('(a) Raw extractor output', d['rawExtractor']['misoriented'], d['rawExtractor']['edgeMidpoints']),
    ('(b) Per-triangle voting writer', d['votingWriter']['misoriented'], d['votingWriter']['edgeMidpoints']),
    ('(c) Constructive propagation writer', d['constructiveWriter']['misoriented'], []),
]

fig = plt.figure(figsize=(12.0, 4.3))
for i, (title, mis, mids) in enumerate(states):
    ax = fig.add_subplot(1, 3, i + 1, projection='3d')
    ax.set_xlim(-LIM, LIM); ax.set_ylim(-LIM, LIM); ax.set_zlim(-LIM, LIM)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=18, azim=35)
    ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])
    if mids:
        xs = [p[0] for p in mids]; ys = [p[1] for p in mids]; zs = [p[2] for p in mids]
        ax.scatter(xs, ys, zs, s=0.6, c='#c0392b', alpha=0.35, depthshade=True, linewidths=0)
    else:
        ax.text(0, 0, 0, f'0\nmisoriented\nedges', ha='center', va='center',
                fontsize=13, color='#1e8449', fontweight='bold')
    ax.set_title(f'{title}\n{mis:,} misoriented edges', fontsize=10)
    ax.set_xlabel('x', labelpad=-6, fontsize=7); ax.set_ylabel('y', labelpad=-6, fontsize=7); ax.set_zlabel('z', labelpad=-6, fontsize=7)

fig.suptitle('Misoriented edge midpoints, F-RD lattice (R96, $k$=6, 838,008 triangles)', fontsize=11, y=0.98)
fig.tight_layout(rect=[0, 0, 1, 0.94])
fig.savefig('fig_orientation_comparison.pdf')
fig.savefig('fig_orientation_comparison.png', dpi=140)
print('written fig_orientation_comparison.pdf / .png')
