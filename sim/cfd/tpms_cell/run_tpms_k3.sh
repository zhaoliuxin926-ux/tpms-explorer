#!/usr/bin/env bash
# k3 三胞 p70 预言验证（2026-11-15 Gemini Q1 判据）：K(3)/K(1)=0.9467±0.006 锁死端面旁路机制
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_k2_scan.sh
# 同 run_tpms_k2.sh 口径：域 [0,4pi]x[0,2pi]^2、同梯度 dP=10.178、同 snappy 定案参数。
# eps 从 k2_eps.json 读（Windows 侧 p3 生成时实测写入）；K 对照 K_scan_result.json 同档 k1。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1

for POR in 70; do
  CASE="$HOME/OpenFOAM/qi-13/tpms_darcy_R48_p${POR}_k3"
  rm -rf "$CASE"; mkdir -p "$CASE"/constant "$CASE"/system "$CASE"/0
  cp -r "$ANCHOR"/case/system/.   "$CASE"/system/
  cp -r "$ANCHOR"/case/constant/. "$CASE"/constant/
  mkdir -p "$CASE"/constant/triSurface
  cp "$SRC"/tpms_wall_R48_p${POR}_k3.stl "$CASE"/constant/triSurface/tpms_wall.stl
  cp "$SRC"/blockMeshDict.tpms_k3     "$CASE"/system/blockMeshDict
  cp "$SRC"/snappyHexMeshDict.scan_k3 "$CASE"/system/snappyHexMeshDict

  EPS=0.7005
  DPTOT=15.267
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

  cat > "$CASE"/0/p << EOF
FoamFile { format ascii; class volScalarField; location "0"; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    cycX0        { type fixedValue; value uniform $DPTOT; }
    cycXL        { type fixedValue; value uniform 0; }
    sideY        { type zeroGradient; }
    sideZ        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
}
EOF

  cd "$CASE"
  echo "== [k2 p$POR] blockMesh =="
  blockMesh > log.blockMesh 2>&1
  echo "== [k2 p$POR] snappyHexMesh =="
  if ! snappyHexMesh -overwrite > log.snappy 2>&1; then echo "== [k2 p$POR] SNAPPY-FAIL（续跑下一档）=="; cd "$SRC"; continue; fi
  echo "== [k2 p$POR] checkMesh =="
  checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
  echo "== [k2 p$POR] foamRun =="
  if ! foamRun -solver incompressibleFluid > log.foamRun 2>&1; then echo "== [k2 p$POR] FOAMRUN-FAIL（续跑下一档）=="; cd "$SRC"; continue; fi
  IT=$(grep -c "^Time = " log.foamRun)
  UB=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat)
  echo "== [k2 p$POR] DONE iters=$IT eps=$EPS Ubar: $UB =="
  cd "$SRC"
done
echo "ALL-DONE: K3 = 0.7005*Ubar_x/(15.267/(6*pi)) | 预言 K(3)/K(1)=0.9467±0.006"
