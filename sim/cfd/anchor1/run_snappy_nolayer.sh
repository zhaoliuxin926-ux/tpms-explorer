#!/usr/bin/env bash
# Anchor-1 snappyHex 近墙判别（2026-11-12）：wsl bash /mnt/d/GITHUB/tpms/sim/cfd/anchor1/run_snappy.sh
# 判据：K 误差 vs hex O-grid −1.27% 基线（tet −13.5%）。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
CASE="$HOME/OpenFOAM/qi-13/anchor1_snappy_nolayer"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r "$SRC"/case/. "$CASE"/
cp "$SRC"/blockMeshDict.snappy "$CASE"/system/blockMeshDict
cp "$SRC"/snappyHexMeshDict.nolayer "$CASE"/system/snappyHexMeshDict
cp "$SRC"/cylinder_wall.stl   "$CASE"/constant/triSurface/ 2>/dev/null || { mkdir -p "$CASE"/constant/triSurface; cp "$SRC"/cylinder_wall.stl "$CASE"/constant/triSurface/; }
cd "$CASE"

echo "== blockMesh =="; blockMesh > log.blockMesh 2>&1; tail -2 log.blockMesh
echo "== snappyHexMesh =="; snappyHexMesh -overwrite > log.snappy 2>&1 || { tail -30 log.snappy; exit 1; }
grep -E "Snapped mesh|Layers added|Added layers|Finished meshing" log.snappy | tail -5
echo "== createPatch =="; createPatch -overwrite > log.createPatch 2>&1; grep -E "cyclicX0|cyclicXL" log.createPatch | head -4
echo "== checkMesh =="; checkMesh > log.checkMesh 2>&1; grep -E "cells:|Max aspect ratio|Mesh OK|Failed" log.checkMesh
echo "== foamRun =="; foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] exit=$?  iters=$(grep -c '^Time = ' log.foamRun)"
tail -14 log.foamRun
echo "== Ubar 末值 =="
tail -3 postProcessing/Ubar/0/volFieldValue.dat 2>/dev/null || tail -3 postProcessing/volFieldValue/0/volFieldValue.dat 2>/dev/null || find postProcessing -name "*.dat" | head -3
