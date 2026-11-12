#!/usr/bin/env bash
# TPMS 单胞 Darcy——压差驱动通透池（路线 B，2026-11-12）
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_darcy.sh [lvl2|lvl3]
#
# 背景判据：NCC 外部周期流耦合未证通（xperiodic 恒 0 面⇒周期驱动=死腔伪值，bugs.md 11-12 条）。
# 本路线：x 两端 Dirichlet 压差（kinematic p'，ΔP=G·L=5.089 mm²/s² 对齐 anchor 口径量级），
# 零体力；K = nu*eps*q/(ΔP/L)，q=eps*Ubar（Ubar=volAverage 孔隙内=本征速度）。
# 口径披露：y/z=壁面（有限方试样语义）；单胞长度入口效应（后续 k2/三胞栈缓解）。
# 网格复用：tpms_cell_ami（lvl2 83.9k）/ tpms_cell_lvl3（lvl3 299.6k）的 snappy 产物。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
WHICH="${1:-lvl2}"
[ "$WHICH" = "lvl2" ] && MESH_SRC="$HOME/OpenFOAM/qi-13/tpms_cell_ami" || MESH_SRC="$HOME/OpenFOAM/qi-13/tpms_cell_lvl3"
CASE="$HOME/OpenFOAM/qi-13/tpms_darcy_$WHICH"
rm -rf "$CASE"; mkdir -p "$CASE"/constant "$CASE"/system "$CASE"/0
cp -r "$ANCHOR"/case/system/.        "$CASE"/system/
cp -r "$ANCHOR"/case/constant/.      "$CASE"/constant/   # momentumTransport/physicalProperties
cp -r "$MESH_SRC"/constant/polyMesh  "$CASE"/constant/
# 零体力：清空 fvModels（纯压差驱动）
cat > "$CASE"/constant/fvModels << 'EOF'
FoamFile { format ascii; class dictionary; location "constant"; object fvModels; }
// 通透池模式：零体力，压差由 0/p 的 Dirichlet 端提供
EOF
# 0 场：cycX0=p 入口 5.089 / cycXL=p 出口 0；U 两端 zeroGradient；壁面 no-slip；NCC 遗留 0 面补丁配无害 BC
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
    xperiodic_on_cycX0       { type nonConformalCyclic; }
    xperiodic_on_cycXL       { type nonConformalCyclic; }
    nonConformalError_on_cycX0  { type nonConformalError; }
    nonConformalError_on_cycXL  { type nonConformalError; }
}
EOF
cat > "$CASE"/0/p << 'EOF'
FoamFile { format ascii; class volScalarField; location "0"; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    cycX0        { type fixedValue; value uniform 5.089; }   // ΔP = G_anchor·L = 0.81×6.2832
    cycXL        { type fixedValue; value uniform 0; }
    sideY        { type zeroGradient; }
    sideZ        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
    xperiodic_on_cycX0       { type nonConformalCyclic; }
    xperiodic_on_cycXL       { type nonConformalCyclic; }
    nonConformalError_on_cycX0  { type nonConformalError; }
    nonConformalError_on_cycXL  { type nonConformalError; }
}
EOF
cd "$CASE"
echo "== checkMesh ($WHICH) =="; checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
echo "== foamRun =="; foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] iters=$(grep -c '^Time = ' log.foamRun)"
tail -2 log.foamRun | head -1
echo "== Ubar 末值（K = nu*eps*Ubar/(ΔP/L) = 0.5877*Ubar/0.80981）=="
tail -1 postProcessing/Ubar/0/volFieldValue.dat
