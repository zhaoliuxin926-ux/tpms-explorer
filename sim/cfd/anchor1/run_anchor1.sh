#!/usr/bin/env bash
# Anchor-1 直管 Poiseuille 验证（WSL 内执行）：wsl bash /mnt/d/GITHUB/tpms/sim/cfd/anchor1/run_anchor1.sh
set -e
source /opt/openfoam13/etc/bashrc
H="${1:-0.3}"
CASE="$HOME/OpenFOAM/qi-13/anchor1_h$H"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r /mnt/d/GITHUB/tpms/sim/cfd/anchor1/case/. "$CASE"/
cd "$CASE"
gmshToFoam "/mnt/d/GITHUB/tpms/sim/cfd/anchor1/anchor1_h$H.msh" > log.gmshToFoam 2>&1
echo "[gmshToFoam] $(grep 'cells:' log.gmshToFoam | tail -1)"
createPatch -overwrite > log.createPatch 2>&1
grep -E "cycX0|cycXL" log.createPatch | head -4
checkMesh > log.checkMesh 2>&1
grep -E "cells:|Mesh OK" log.checkMesh
foamRun -solver incompressibleFluid > log.foamRun 2>&1
echo "[foamRun] exit=$?  iters=$(grep -c '^Time = ' log.foamRun)"
tail -16 log.foamRun
