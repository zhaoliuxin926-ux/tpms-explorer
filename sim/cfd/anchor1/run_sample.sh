#!/usr/bin/env bash
set -e
source /opt/openfoam13/etc/bashrc
CASE="$HOME/OpenFOAM/qi-13/anchor1_h0.15"
cd "$CASE"
rm -rf "$CASE/system/functions"
foamPostProcess -funcs "(writeCellCentres)" -latestTime > log.sample 2>&1
echo "exit=$?"
find . -name "C*" -newer log.gmshToFoam 2>/dev/null | grep -v log | head -3
