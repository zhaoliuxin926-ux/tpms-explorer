#!/usr/bin/env bash
# TPMS 单胞 Darcy 算例——v13 非共形周期对完整流程（2026-11-12 全链贯通版）
# wsl bash /mnt/d/GITHUB/tpms/sim/cfd/tpms_cell/run_tpms_ami.sh
#
# v13 八坑固化（详见 ~/.zcode/skills/openfoam-cfd/references/v13-syntax.md NCC 段）：
#   ① cyclicAMI 不存在→nonConformalCyclic；② createPatch 走不通→createNonConformalCouples 工具
#   ③ HOME 下非法名目录会炸工具（stripInvalid fatal）；④ 0 场 patch 名单须与网格精确一致
#   ⑤ 偶合字典宏 $../../owner/patchFields；⑥ NCC 自动建 xperiodic_on_*/nonConformalError_on_* 新 patch，
#      原 cycX0/cycXL 成零面空壳须配 harmless BC；⑦ 空壳上 calculated 炸求解；⑧ wall patch 不得配 symmetry BC
#
# 结果基线（k1 gyroid p60 单胞）：83,895 cells/Mesh OK/1500 iters 收敛 1e-9/
#   Ubar=2.10401666e-04 mm/s 千位迭代 8 位稳定 → K=nu*eps*Ubar/G=1.53e-4 mm²（eps=0.5877 fluid_frac）
#   v1 口径披露：y/z=壁面近似（全 PBC 留后续批），K 数值仅作管线贯通证据。
set -e
source /opt/openfoam13/etc/bashrc
SRC=/mnt/d/GITHUB/tpms/sim/cfd/tpms_cell
ANCHOR=/mnt/d/GITHUB/tpms/sim/cfd/anchor1
CASE="$HOME/OpenFOAM/qi-13/tpms_cell_ami"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r "$ANCHOR"/case/. "$CASE"/                      # 求解字典同源 anchor（drive 0.81/nu=1/1500）
cp "$SRC"/blockMeshDict.tpms          "$CASE"/system/blockMeshDict
cp "$SRC"/snappyHexMeshDict.tpms      "$CASE"/system/snappyHexMeshDict
cp "$SRC"/createNonConformalCouplesDict "$CASE"/system/
mkdir -p "$CASE"/constant/triSurface
cp "$SRC"/tpms_wall.stl                "$CASE"/constant/triSurface/
# pre-NCC 0 场（5-patch 名单；cycX0/cycXL 用无害 BC——NCC 会接管为耦合对并改写 0 场；
# 仓内 0/ 目录的 9-patch 版仅作 NCC 后参照，勿直接用于全新流程）
cat > "$CASE"/0/U << 'EOF'
FoamFile { format ascii; class volVectorField; location "0"; object U; }
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{
    cycX0        { type fixedValue; value uniform (0 0 0); }
    cycXL        { type fixedValue; value uniform (0 0 0); }
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
    cycX0        { type zeroGradient; }
    cycXL        { type zeroGradient; }
    sideY        { type zeroGradient; }
    sideZ        { type zeroGradient; }
    scaffoldWall { type zeroGradient; }
}
EOF
cd "$CASE"

echo "== blockMesh ==";      blockMesh > log.blockMesh 2>&1; tail -1 log.blockMesh
echo "== snappyHexMesh ==";  snappyHexMesh -overwrite > log.snappy 2>&1 || { tail -25 log.snappy; exit 1; }
grep -E "Layer mesh|Finished meshing" log.snappy | tail -2
# NCC 建 xperiodic_on_*/nonConformalError_on_* 并改写 0 场耦合 BC（原 cycX0/cycXL 留零面空壳）
echo "== createNonConformalCouples =="; createNonConformalCouples > log.ncc 2>&1 || { tail -20 log.ncc; exit 1; }
grep -c nonConformalCyclic constant/polyMesh/boundary
echo "== checkMesh ==";      checkMesh > log.checkMesh 2>&1; grep -E "cells:|Mesh OK|Failed" log.checkMesh
echo "== foamRun ==";        foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] iters=$(grep -c '^Time = ' log.foamRun)"
tail -2 log.foamRun | head -1
echo "== Ubar 末值（K=nu*eps*Ubar/G，eps 用 p3 fluid_frac）=="
tail -1 postProcessing/Ubar/0/volFieldValue.dat
