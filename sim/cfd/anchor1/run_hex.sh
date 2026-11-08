#!/usr/bin/env bash
set -e
source /opt/openfoam13/etc/bashrc
CASE="$HOME/OpenFOAM/qi-13/anchor1_hex"
rm -rf "$CASE"; mkdir -p "$CASE"
cp -r /mnt/d/GITHUB/tpms/sim/cfd/anchor1/case/. "$CASE"/
cp /mnt/d/GITHUB/tpms/sim/cfd/anchor1/blockMeshDict.hex "$CASE/system/blockMeshDict"
cp /mnt/d/GITHUB/tpms/sim/cfd/anchor1/createPatchDict.hex "$CASE/system/createPatchDict"
cd "$CASE"
blockMesh > log.blockMesh 2>&1
echo "[blockMesh] $(grep -c 'cells:' log.blockMesh >/dev/null && grep 'cells:' log.blockMesh | tail -1)"
createPatch -overwrite > log.createPatch 2>&1
checkMesh > log.checkMesh 2>&1 || true
grep -E "Mesh OK|non-orthogonality" log.checkMesh | head -2
foamRun -solver incompressibleFluid > log.foamRun 2>&1
UBAR=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat | sed 's/[()]//g' | awk '{print $2}')
python3 -c "import math; u=$UBAR; k=u*math.pi/4/0.81; print(f'[hex-Ogrid] Ubar=$UBAR K={k:.4f} err={(k-math.pi**3/32)/(math.pi**3/32)*100:+.3f}%')"
