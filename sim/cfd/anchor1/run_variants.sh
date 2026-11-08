#!/usr/bin/env bash
# snGrad 变体对照 v2（保留 0/，只清结果目录；判别近壁梯度高估机制）
set -e
source /opt/openfoam13/etc/bashrc
BASE="$HOME/OpenFOAM/qi-13/anchor1_h0.3"
run_variant() {
  NAME="$1"; SCH="$2"
  CASE="$HOME/OpenFOAM/qi-13/anchor1_v_$NAME"
  rm -rf "$CASE"; cp -r "$BASE" "$CASE"
  cd "$CASE"
  rm -rf postProcessing
  find . -maxdepth 1 -type d -name '[0-9]*' ! -name '0' -exec rm -rf {} +
  rm -f log.variant log.foamRun
  python3 - "$SCH" << 'PYEOF'
import sys, re
sch = sys.argv[1]
p = 'system/fvSchemes'
s = open(p).read()
s = re.sub(r'snGradSchemes\s*\{[^}]*\}', 'snGradSchemes { default ' + sch + '; }', s)
open(p, 'w').write(s)
PYEOF
  createPatch -overwrite > log.createPatch 2>&1
  checkMesh > log.checkMesh 2>&1 || true
  foamRun -solver incompressibleFluid > log.foamRun 2>&1 || true
  if ! grep -q "^End" log.foamRun; then echo "[$NAME] foamRun 未跑完（见 log.foamRun）"; return 0; fi
  UBAR=$(tail -1 postProcessing/Ubar/0/volFieldValue.dat | sed 's/[()]//g' | awk '{print $2}')
  python3 -c "import math; u=$UBAR; k=u*math.pi/4/0.81; print(f'[$NAME] snGrad=$SCH Ubar=$UBAR K={k:.4f} err={(k-math.pi**3/32)/(math.pi**3/32)*100:+.2f}%')"
}
run_variant ortho "orthogonal"
run_variant lim50 "limited 0.5"
echo "variants-done"
