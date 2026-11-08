#!/usr/bin/env bash
set -e
source /opt/openfoam13/etc/bashrc
CASE="$HOME/OpenFOAM/qi-13/anchor1_netgen"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r /mnt/d/GITHUB/tpms/sim/cfd/anchor1/case/. "$CASE"/
cd "$CASE"
gmshToFoam "/mnt/d/GITHUB/tpms/sim/cfd/anchor1/anchor1_netgen_h0.3.msh" > log.gmshToFoam 2>&1
createPatch -overwrite > log.createPatch 2>&1
checkMesh > log.checkMesh 2>&1 || true
grep -E "Mesh OK" log.checkMesh | head -1
foamRun -solver incompressibleFluid > log.foamRun 2>&1
UBAR=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat | sed 's/[()]//g' | awk '{print $2}')
python3 -c "import math; u=$UBAR; k=u*math.pi/4/0.81; print(f'[netgen-opt] Ubar=$UBAR K={k:.4f} err={(k-math.pi**3/32)/(math.pi**3/32)*100:+.2f}%')"
