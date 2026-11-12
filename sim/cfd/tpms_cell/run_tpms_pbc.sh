#!/usr/bin/env bash
# TPMS 单胞 Darcy v2——全 PBC（x/y/z 三对非共形周期，2026-11-12）
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_pbc.sh
# 对照 v1（y/z=wall，K=1.53e-4 mm²）：两值之差=y/z 壁面效应实测（自查题判据）。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
CASE="$HOME/OpenFOAM/qi-13/tpms_cell_pbc"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r "$ANCHOR"/case/. "$CASE"/
cp "$SRC"/blockMeshDict.pbc      "$CASE"/system/blockMeshDict
cp "$SRC"/snappyHexMeshDict.tpms "$CASE"/system/snappyHexMeshDict
cp "$SRC"/createNonConformalCouplesDict.pbc "$CASE"/system/createNonConformalCouplesDict
mkdir -p "$CASE"/constant/triSurface
cp "$SRC"/tpms_wall.stl          "$CASE"/constant/triSurface/
# pre-NCC 0 场：7-patch 名单（六周期面+TPMS 壁），全 harmless BC，NCC 接管耦合对
cat > "$CASE"/0/U << 'EOF'
FoamFile { format ascii; class volVectorField; location "0"; object U; }
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{
    cycX0        { type fixedValue; value uniform (0 0 0); }
    cycXL        { type fixedValue; value uniform (0 0 0); }
    cycY0        { type fixedValue; value uniform (0 0 0); }
    cycYL        { type fixedValue; value uniform (0 0 0); }
    cycZ0        { type fixedValue; value uniform (0 0 0); }
    cycZL        { type fixedValue; value uniform (0 0 0); }
    scaffoldWall { type fixedValue; value uniform (0 0 0); }
}
EOF
cat > "$CASE"/0/p << 'EOF'
FoamFile { format ascii; class volScalarField; location "0"; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    cycX0        { type zeroGradient; }
    cycXL        { type zeroGradient; }
    cycY0        { type zeroGradient; }
    cycYL        { type zeroGradient; }
    cycZ0        { type zeroGradient; }
    cycZL        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
}
EOF
cd "$CASE"

echo "== blockMesh ==";      blockMesh > log.blockMesh 2>&1; tail -1 log.blockMesh
echo "== snappyHexMesh ==";  snappyHexMesh -overwrite > log.snappy 2>&1 || { tail -25 log.snappy; exit 1; }
grep -E "Layer mesh|Finished meshing" log.snappy | tail -2
echo "== createNonConformalCouples =="; createNonConformalCouples > log.ncc 2>&1 || { tail -20 log.ncc; exit 1; }
grep -c "type            nonConformalCyclic;" constant/polyMesh/boundary
echo "== checkMesh ==";      checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
echo "== foamRun ==";        foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] iters=$(grep -c '^Time = ' log.foamRun)"
tail -2 log.foamRun | head -1
echo "== Ubar 末值 =="
tail -1 postProcessing/Ubar/0/volFieldValue.dat
