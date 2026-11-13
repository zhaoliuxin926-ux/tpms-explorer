#!/usr/bin/env bash
# R48 全族 K(ε) 扫描（2026-11-13，Phase 3 首批标定曲线）
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_K_scan.sh [lvl2]
# 四档 p50/p60/p70/p80 顺序跑通透池（ΔP=5.089 kinematic/lvl2 网格）；结果汇总 K_scan_result.json
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
LVL="${1:-lvl2}"

for POR in 50 60 70 80; do
  CASE="$HOME/OpenFOAM/qi-13/tpms_darcy_R48_p${POR}_${LVL}"
  rm -rf "$CASE"; mkdir -p "$CASE"/constant "$CASE"/system "$CASE"/0
  cp -r "$ANCHOR"/case/system/.   "$CASE"/system/
  cp -r "$ANCHOR"/case/constant/. "$CASE"/constant/
  mkdir -p "$CASE"/constant/triSurface
  cp "$SRC"/tpms_wall_R48_p${POR}.stl "$CASE"/constant/triSurface/tpms_wall.stl
  cp "$SRC"/blockMeshDict.tpms  "$CASE"/system/blockMeshDict
  cp "$SRC"/snappyHexMeshDict.scan "$CASE"/system/snappyHexMeshDict
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
    cycX0        { type fixedValue; value uniform 5.089; }
    cycXL        { type fixedValue; value uniform 0; }
    sideY        { type zeroGradient; }
    sideZ        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
}
EOF
  cd "$CASE"
  echo "== [$POR] blockMesh+snappy =="
  blockMesh > log.blockMesh 2>&1
  snappyHexMesh -overwrite > log.snappy 2>&1 || { echo "== [$POR] SNAPPY-FAIL（续跑下一档）=="; continue; }
  NCC_OUT=$(grep -c "type            nonConformalCyclic;" constant/polyMesh/boundary || true)
  # 通透池不跑 NCC（死腔教训）——但 snappy 后 boundary 里 cycX0/cycXL 是普通 patch，直接配 Dirichlet
  echo "== [$POR] checkMesh =="
  checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
  echo "== [$POR] foamRun =="
  foamRun -solver incompressibleFluid > log.foamRun 2>&1 || { echo "== [$POR] FOAMRUN-FAIL（续跑下一档）=="; continue; }
  IT=$(grep -c "^Time = " log.foamRun)
  UB=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat)
  echo "== [$POR] DONE iters=$IT Ubar: $UB =="
done
echo "ALL-DONE"
