#!/usr/bin/env bash
# TPMS k2 双胞通透池（2026-11-15，k2 入口效应分离批）
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_k2.sh
# 域 [0,4pi]x[0,2pi]^2（x 向双胞），同 k1 权威链口径：y/z 壁面、通透池压差驱动、snappy 定案参数。
# 梯度口径：总压差 2x5.089=10.178 kinematic（dP/L 与 k1 严格一致）——入口效应是唯一变量。
# 参照：k1 R48 p60 K=0.0894 mm2 @ eps=0.5999（K_scan_result.json）。
# K = eps*Ubar/(dP/L)，eps 用 p3 STL 实测 fluid_frac（k2=0.6004）。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
CASE="$HOME/OpenFOAM/qi-13/tpms_darcy_R48_p60_k2"

rm -rf "$CASE"; mkdir -p "$CASE"/constant "$CASE"/system "$CASE"/0
cp -r "$ANCHOR"/case/system/.   "$CASE"/system/
cp -r "$ANCHOR"/case/constant/. "$CASE"/constant/
mkdir -p "$CASE"/constant/triSurface
cp "$SRC"/tpms_wall_R48_p60_k2.stl "$CASE"/constant/triSurface/tpms_wall.stl
cp "$SRC"/blockMeshDict.tpms_k2     "$CASE"/system/blockMeshDict
cp "$SRC"/snappyHexMeshDict.scan_k2 "$CASE"/system/snappyHexMeshDict

cat > "$CASE"/constant/fvModels << 'EOF'
FoamFile { format ascii; class dictionary; location "constant"; object fvModels; }
// 通透池：零体力，压差由 0/p Dirichlet 端提供
EOF

cat > "$CASE"/0/U << 'EOF'
FoamFile { format ascii; class volVectorField; location "0"; object U; }
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{
    cycX0        { type zeroGradient; }
    cycXL        { type zeroGradient; }
    sideY        { type fixedValue; value uniform (0 0 0); }
    sideZ        { type fixedValue; value uniform (0 0 0); }
    scaffoldWall { type fixedValue; value uniform (0 0 0); }
}
EOF

cat > "$CASE"/0/p << 'EOF'
FoamFile { format ascii; class volScalarField; location "0"; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    cycX0        { type fixedValue; value uniform 10.178; }
    cycXL        { type fixedValue; value uniform 0; }
    sideY        { type zeroGradient; }
    sideZ        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
}
EOF

cd "$CASE"
echo "== [k2] blockMesh =="
blockMesh > log.blockMesh 2>&1
echo "== [k2] snappyHexMesh =="
snappyHexMesh -overwrite > log.snappy 2>&1
echo "== [k2] checkMesh =="
checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
echo "== [k2] foamRun =="
foamRun -solver incompressibleFluid > log.foamRun 2>&1
IT=$(grep -c "^Time = " log.foamRun)
UB=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat)
echo "== [k2] DONE iters=$IT Ubar: $UB =="
echo "K = 0.6004*Ubar/(10.178/(4*pi)) | k1 ref K=0.0894 @ eps=0.5999 | entry effect = (K2-K1)/K1"
