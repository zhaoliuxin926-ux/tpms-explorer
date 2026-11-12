#!/usr/bin/env bash
# TJunctionFan-NCC 教程探针：fan0/fan1 在 createBaffles 后的 mesh patch 类型 + 0 场 BC 终态
set -e
source /opt/openfoam13/etc/bashrc
T=/tmp/fan_test
rm -rf "$T"
mkdir -p "$T"
cp -r /opt/openfoam13/tutorials/incompressibleFluid/TJunctionFan/. "$T"/
cd "$T"
blockMesh > log.bm 2>&1 || { tail -5 log.bm; exit 1; }
createZones > log.cz 2>&1 || { tail -5 log.cz; exit 1; }
createBaffles -dict system/createBafflesDict.NCC -overwrite > log.cb 2>&1 || { tail -8 log.cb; exit 1; }
createNonConformalCouples > log.ncc 2>&1 || { tail -8 log.ncc; exit 1; }
echo "=== boundary patches ==="
python3 - << 'EOF'
import re
s = open("/tmp/fan_test/constant/polyMesh/boundary").read()
for m in re.finditer(r"^    (\w+)\s*\n\s*\{\s*\n\s*type\s+(\w+);(?:\s*\n\s*inGroups[^\n]*\n)?(?:\s*\n\s*nFaces\s+(\d+);)?", s, re.M):
    print(f"{m.group(1):28s} {m.group(2):20s} faces={m.group(3)}")
EOF
echo "=== 0/p fan BC（NCC 后）==="
grep -B1 -A6 "^    fan0" /tmp/fan_test/0/p | head -12
