# -*- coding: utf-8 -*-
"""Phase 2 后处理提取器：ABAQUS ODB -> fit-batch 契约 CSV（ISO 13314 反演直读）。

在 ABAQUS 自带 Python 环境执行（工位机）：
  abaqus python sim/p2_extract_csv.py --odb <job>.odb --h 24.0 --w 20.0 [--t 20.0] [--out sim.csv]

提取路径：FIELD 为主（语义确定：NSET_TOP 上 U3 平均 + RF3 求和），
HISTORY 聚合 region 为快路径（存在且帧数一致时），输出注明用了哪条。
符号口径（协议 §九 / T2 契约）：disp_mm = -U3 >= 0，force_N = -ΣRF3 >= 0。
CSV 契约（fit-batch.mjs）：# lengthMm/widthMm/thicknessMm 元数据行 + displacement_mm,force_N 表头 + (0,0) 首点。
"""
import sys


def extract_curve(odb_path, h_mm, w_mm, t_mm, out_csv):
    from odbAccess import openOdb

    odb = openOdb(odb_path, readOnly=True)
    try:
        step = odb.steps.values()[-1]
        top = odb.rootAssembly.nodeSets["NSET_TOP"]
        n_frames = len(step.frames)

        # 快路径尝试：HISTORY 聚合 region（"Node NSET_TOP"）
        path_used = "FIELD"
        hr = step.historyRegions.get("Node NSET_TOP")
        if hr is not None and "RF3" in hr.historyOutputs and "U3" in hr.historyOutputs:
            rf3 = hr.historyOutputs["RF3"].data
            u3 = hr.historyOutputs["U3"].data
            if len(rf3) == n_frames:
                disp = [0.0] + [-v for v in u3]
                force = [0.0] + [-v for v in rf3]
                path_used = "HISTORY"

        if path_used == "FIELD":
            disp, force = [0.0], [0.0]
            for frame in step.frames:
                if frame.frameId == 0:
                    continue
                u = frame.fieldOutputs["U"].getSubset(region=top).values
                rf = frame.fieldOutputs["RF"].getSubset(region=top).values
                disp.append(-sum(v.data[2] for v in u) / len(u))
                force.append(-sum(v.data[2] for v in rf))
    finally:
        odb.close()

    with open(out_csv, "w") as f:
        f.write("# lengthMm=%.4f\n" % h_mm)
        f.write("# widthMm=%.4f\n" % w_mm)
        f.write("# thicknessMm=%.4f\n" % t_mm)
        f.write("displacement_mm,force_N\n")
        for d, fo in zip(disp, force):
            f.write("%.6f,%.4f\n" % (max(0.0, d), max(0.0, fo)))

    band_ok = any(abs(h_mm - b) <= 1.0 for b in (12.0, 24.0, 34.0))
    print("[extract] %s path -> %s (points=%d, last=%s,%s) %s" % (
        path_used, out_csv, len(disp),
        ("%.4f" % disp[-1]), ("%.2f" % force[-1]),
        "" if band_ok else "[WARN] lengthMm 越档"))


def main():
    args = sys.argv[1:]

    def opt(name, default=None, cast=str):
        return cast(args[args.index(name) + 1]) if name in args else default

    odb_p = opt("--odb")
    h = opt("--h", cast=float)
    if not odb_p or h is None:
        print("usage: abaqus python sim/p2_extract_csv.py --odb <job>.odb --h <mm> --w <mm> [--t <mm>] [--out <csv>]")
        sys.exit(2)
    w = opt("--w", cast=float)
    t = opt("--t", default=w, cast=float)
    out_p = opt("--out", default="sim_result.csv")
    extract_curve(odb_p, h, w, t, out_p)


if __name__ == "__main__":
    main()
