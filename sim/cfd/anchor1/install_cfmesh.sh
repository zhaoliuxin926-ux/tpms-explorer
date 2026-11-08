#!/usr/bin/env bash
set -e
source /opt/openfoam13/etc/bashrc
cd "$HOME/OpenFOAM"
if [ -d cfmesh ]; then echo "cfMesh 目录已存在"; else
  git clone --depth 1 https://github.com/creativenvironmentlab/cfMesh.git 2>&1 | tail -1
fi
cd cfmesh
echo "branch: $(git branch --show-current 2>/dev/null), head: $(git log --oneline -1 | head -c 60)"
wmake all 2>&1 | tail -5 || echo "wmake 失败（v13 API 兼容性待查）"
which cartesianMesh || ls platforms/*/bin/cartesianMesh 2>/dev/null || echo "cartesianMesh 未产出"
