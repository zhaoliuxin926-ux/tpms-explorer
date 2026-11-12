#!/usr/bin/env bash
# TPMS 单胞 Darcy 冒烟算例（2026-11-12）：wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms.sh
# 管线：blockMesh[0,2π]³ → snappyHexMesh（anchor 定案参数）→ createPatch x 周期对 → foamRun → K。
# v1 披露：y/z=壁面近似（全 PBC 留后续）；eps 用 p3 实测 fluid_frac（0.5877@k1R24p60）。
# 周期共形失败兜底：cyclicAMI（Anchor-3 路径）。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
CASE="$HOME/OpenFOAM/qi-13/tpms_cell_k1R24p60"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r "$ANCHOR"/case/. "$CASE"/          # 求解字典同源 anchor（drive 0.81/nu=1/1500 iters）
cp "$SRC"/blockMeshDict.tpms  "$CASE"/system/blockMeshDict
cp "$SRC"/snappyHexMeshDict.tpms "$CASE"/system/snappyHexMeshDict
mkdir -p "$CASE"/constant/triSurface
cp "$SRC"/tpms_wall.stl      "$CASE"/constant/triSurface/
cd "$CASE"

echo "== blockMesh =="; blockMesh > log.blockMesh 2>&1; tail -1 log.blockMesh
echo "== snappyHexMesh =="; snappyHexMesh -overwrite > log.snappy 2>&1 || { tail -25 log.snappy; exit 1; }
grep -E "Snapped mesh|Layer mesh|Finished meshing" log.snappy | tail -3
echo "== createPatch =="; createPatch -overwrite > log.createPatch 2>&1 || { tail -20 log.createPatch; echo "[兜底提示] 周期共形失败→cyclicAMI 路径（Anchor-3）"; exit 1; }
grep -E "cyclicX" log.createPatch | head -2
echo "== checkMesh =="; checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed|aspect" log.checkMesh
echo "== foamRun =="; foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] exit=$?  iters=$(grep -c '^Time = ' log.foamRun)"
tail -6 log.foamRun
echo "== Ubar 末值 =="
tail -2 postProcessing/Ubar/0/volFieldValue.dat
# K 对账：eps=0.5877（p3 实测 fluid_frac）——python sim/cfd/anchor1/k_check.py 侧算
