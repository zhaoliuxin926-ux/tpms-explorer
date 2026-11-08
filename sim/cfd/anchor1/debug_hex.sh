#!/usr/bin/env bash
CASE="$HOME/OpenFOAM/qi-13/anchor1_hex"
for f in log.blockMesh log.createPatch log.checkMesh log.foamRun; do
  echo "== $f"
  tail -4 "$CASE/$f" 2>/dev/null
done
