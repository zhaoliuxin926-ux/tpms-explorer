# -*- coding: utf-8 -*-
"""Phase 1 几何体检：对 specimens STL 做水密/连通域/体积/相对密度验证。

管线第一环。验证标准（plan §7 Phase 1）：
  - is_watertight == True
  - 连通域数符合预期（network 型整体试样 = 1）
  - 网格体积 vs sidecar 目标孔隙率对账
用法：python sim/p1_geom_check.py [stl路径 ...]（缺省跑 S1/S3 四组 TPMS 基件）
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import trimesh

REPO = Path(__file__).resolve().parents[1]


def check(stl_path: Path) -> dict:
    t0 = time.time()
    mesh = trimesh.load_mesh(stl_path, process=False)
    elapsed = time.time() - t0

    # 连通域（按面 adjacency）
    components = mesh.split(only_watertight=False)
    # 体积份额排序，取最大域
    vols = [c.volume if c.is_volume and c.volume > 0 else 0.0 for c in components]
    main_frac = (max(vols) / sum(vols)) if sum(vols) > 0 else 0.0

    sidecar = stl_path.with_suffix(".json")
    side = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else {}

    bbox = mesh.bounds[1] - mesh.bounds[0]
    porosity = 1.0 - mesh.volume / float(np.prod(bbox))

    return {
        "file": stl_path.name,
        "faces": int(len(mesh.faces)),
        "watertight": bool(mesh.is_watertight),
        "winding": bool(mesh.is_winding_consistent),
        "components": len(components),
        "main_frac": round(main_frac, 6),
        "volume_mm3": round(float(mesh.volume), 2),
        "bbox_mm": [round(float(x), 2) for x in bbox],
        "porosity_bbox": round(porosity, 4),
        "sidecar_target": side.get("targetPorosity", side.get("porosity", None)),
        "sidecar_mm": side.get("specimenSizeMm", None),
        "load_s": round(elapsed, 1),
    }


def main() -> int:
    args = sys.argv[1:]
    if args:
        paths = [Path(a) for a in args]
    else:
        paths = [REPO / "specimens" / f"{n}.stl" for n in
                 ("S1_G60", "S2_G75", "S3_D60", "S4_D75")]
    ok = True
    for p in paths:
        if not p.exists():
            print(f"[MISS] {p}")
            ok = False
            continue
        r = check(p)
        flag = "PASS" if (r["watertight"] and r["winding"] and r["components"] == 1) else "FAIL"
        if flag == "FAIL":
            ok = False
        print(f"[{flag}] {r['file']}: faces={r['faces']} watertight={r['watertight']} "
              f"winding={r['winding']} comp={r['components']} main={r['main_frac']:.4f} "
              f"porosity_bbox={r['porosity_bbox']} target={r['sidecar_target']} "
              f"bbox={r['bbox_mm']} mm vol={r['volume_mm3']}mm3 load={r['load_s']}s")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
