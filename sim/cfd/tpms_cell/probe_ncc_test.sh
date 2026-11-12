#!/usr/bin/env bash
# 官方 NCC test 用例复跑探针：看 createNonConformalCouples 后的终态拓扑（面到底去哪）
set -e
source /opt/openfoam13/etc/bashrc
T=/tmp/ncc_test
rm -rf "$T"
mkdir -p "$T"
cp -r /opt/openfoam13/test/Lagrangian/boundaries/. "$T"/
cd "$T"
blockMesh > log.bm 2>&1 || { tail -5 log.bm; exit 1; }
createNonConformalCouples -overwrite > log.ncc 2>&1 || { tail -8 log.ncc; exit 1; }
echo "=== NCC 后 boundary ==="
python3 - << 'EOF'
import re
s = open("/tmp/ncc_test/constant/polyMesh/boundary").read()
for m in re.finditer(r"(\w+)\s*\n\s*\{\s*\n\s*type\s+(\w+);\s*\n(?:\s*inGroups[^\n]*\n)?\s*nFaces\s+(\d+);", s):
    print(f"{m.group(1):28s} {m.group(2):22s} faces={m.group(3)}")
EOF
echo "=== NCC 是否改写 0 场 ==="
grep -A3 "nonCouple" /tmp/ncc_test/0/U | head -10
