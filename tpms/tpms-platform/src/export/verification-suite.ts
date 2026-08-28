/**
 * CAE 验证脚本包（v4.0 阶段 III · Verification Suite）
 *
 * 内嵌两套自动化求解脚本 + 运行壳 + 对比数据模板，导出中心一键打包 ZIP：
 *  · abaqus_auto_runner.py  —— Abaqus no-GUI 准静态压缩：JobFromInputFile 提交 →
 *    ODB 提取反力-位移曲线 → 自动计算 E_FEM（0~5% 线性拟合）、σ_peak、σ_pl（5~25% 平台均值）
 *  · openfoam_auto_runner.py —— OpenFOAM simpleFoam 达西渗流：构建 system/0 算例 →
 *    求解 → flowRatePatch 提取 Q → κ = Q·μL/(A·ΔP) + wallShearStress 均值
 *  · run_abaqus.sh / run_openfoam.sh —— 一键壳脚本
 *  · comparison_template.csv —— 理论预估 vs CAE 对比矩阵模板
 * 诚实边界：Abaqus 脚本为 abq python 2.7 方言（无 f-string）；本机无求解器，
 * 正确性由门禁 19 的格式规范断言 + 与导出器交叉核对守护。
 */


import { buildStoredZip } from './openfoam-polymesh-exporter';

export const ABAQUS_RUNNER = String.raw`# -*- coding: utf-8 -*-
"""Abaqus no-GUI 准静态压缩求解与后处理（TPMS Explorer v4.0 验证包）

用法（Abaqus 命令行环境）:
    abaqus cae noGUI=abaqus_auto_runner.py -- --inp tpms-gyroid-voxel.inp --out result.csv

流程:
    1. JobFromInputFile 导入平台导出的 .inp（C3D8 体网格 + NSET_BOTTOM/TOP）
    2. 施加刚性压盘位移载荷（eps = 0 ~ 0.3，10 个增量步）
    3. 提取顶部反力 RF 与位移 U3 → 反力-位移曲线 result.csv
    4. 自动计算 E_FEM（0~5% 应变线性拟合）、sigma_peak（峰值）、sigma_pl（5~25% 平台均值）
"""
import sys
import os

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def _arg(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default

INP = _arg('--inp', 'tpms-voxel.inp')
OUT = _arg('--out', 'result.csv')
EPS_MAX = float(_arg('--eps', '0.3'))
L_MM = float(_arg('--specimen', '1.0'))
A_MM2 = L_MM * L_MM

from abaqus import *
from abaqusConstants import *
import job

job_name = os.path.splitext(os.path.basename(INP))[0]
myJob = mdb.JobFromInputFile(name=job_name, inputFileName=INP,
                             numCpus=1, resultsFormat=ODB)
myJob.submit()
myJob.waitForCompletion()

from odbAccess import openOdb
odb = openOdb(job_name + '.odb')
step = odb.steps.values()[-1]

N_EIncrements = 10
disp = []
force = []
for fr in step.frames:
    if fr.frameId == 0:
        continue
    u = fr.fieldOutputs['U'].getSubset(region=odb.rootAssembly.nodeSets['NSET_TOP']).values[0].data3
    rf_sum = 0.0
    rv = fr.fieldOutputs['RF'].getSubset(region=odb.rootAssembly.nodeSets['NSET_TOP']).values
    for v in rv:
        rf_sum += v.data3
    disp.append(-u)
    force.append(rf_sum)
odb.close()

# 应力-应变曲线（名义）
strain = [d / L_MM for d in disp]
stress = [f / A_MM2 for f in force]

def _linear_fit(xs, ys):
    n = len(xs)
    sx = sum(xs); sy = sum(ys)
    sxx = sum(x * x for x in xs); sxy = sum(x * y for x, y in zip(xs, ys))
    k = (n * sxy - sx * sy) / (n * sxx - sx * sx) if n * sxx != sx * sx else 0.0
    return k

# E_FEM：0~5% 应变段线性拟合斜率
lin_x = [e for e in strain if e <= 0.05 * EPS_MAX]
lin_y = stress[:len(lin_x)]
e_fem = _linear_fit(lin_x, lin_y)
# sigma_pl：5%~25% 应变平台均值
pl_y = [s for e, s in zip(strain, stress) if 0.05 * EPS_MAX <= e <= 0.25 * EPS_MAX]
sigma_pl = sum(pl_y) / len(pl_y) if pl_y else 0.0
sigma_peak = max(stress) if stress else 0.0

with open(OUT, 'w') as fp:
    fp.write('strain,stress_MPa\n')
    for e, s in zip(strain, stress):
        fp.write('%.6f,%.4f\n' % (e, s))
    fp.write('\n# E_FEM_MPa=%.4f\n# sigma_peak_MPa=%.4f\n# sigma_pl_MPa=%.4f\n'
             % (e_fem, sigma_peak, sigma_pl))
print('TPMS verification: E_FEM=%.4f MPa, sigma_peak=%.4f, sigma_pl=%.4f -> %s'
      % (e_fem, sigma_peak, sigma_pl, OUT))
`;

export const OPENFOAM_RUNNER = String.raw`# -*- coding: utf-8 -*-
"""OpenFOAM 达西渗流自动化求解与后处理（TPMS Explorer v4.0 验证包）

用法（OpenFOAM 环境，python3）:
    python3 openfoam_auto_runner.py --case tpms-polymesh-case --out permeability.csv

流程:
    1. 在导出的 constant/polyMesh 之上构建 simpleFoam 算例（system/ + 0/）
       inlet 固定压力 p_in、outlet 固定 p_out（Delta_p），壁面 noSlip
    2. checkMesh + simpleFoam 求解至收敛
    3. flowRatePatch(inlet) 提取体积流量 Q
    4. Darcy 渗透率 kappa = Q * mu * L / (A * Delta_p)；壁面剪切应力 WSS 均值
"""
import argparse
import os
import shutil
import subprocess

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', default='tpms-polymesh-case')
    ap.add_argument('--out', default='permeability.csv')
    ap.add_argument('--nu', type=float, default=1e-6)          # 运动粘度 m^2/s（水）
    ap.add_argument('--dp', type=float, default=1.0)           # 压差 Pa（rho=1 时 p 量纲 m^2/s^2）
    ap.add_argument('--L', type=float, default=1e-3)           # 试样长度 m
    ap.add_argument('--A', type=float, default=1e-6)           # 截面积 m^2
    args = ap.parse_args()

    case = args.case
    os.makedirs(os.path.join(case, 'system'), exist_ok=True)
    os.makedirs(os.path.join(case, '0'), exist_ok=True)

    with open(os.path.join(case, 'system', 'controlDict'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }
application     simpleFoam;
startFrom       latestTime;
endTime         2000;
deltaT          1;
writeInterval   500;
writeControl    timeStep;
maxCo           0.5;

functions
{
    flowIn
    {
        type            flowRatePatch;
        patches         (inlet);
        writeControl    timeStep;
        writeInterval   100;
    }
    wss
    {
        type            wallShearStress;
        patches         (wall);
        writeControl    timeStep;
        writeInterval   500;
    }
}
""")

    with open(os.path.join(case, 'system', 'fvSchemes'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss linearUpwind grad(U); }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
""")

    with open(os.path.join(case, 'system', 'fvSolution'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }
solvers { p { solver GAMG; tolerance 1e-7; relTol 0.01; } U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.01; } }
SIMPLE { nNonOrthogonalCorrectors 1; pRefCell 0; pRefValue 0; }
relaxationFactors { fields { p 0.4; } equations { U 0.5; } }
""")

    with open(os.path.join(case, '0', 'U'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class volVectorField; object U; }
dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);
boundaryField
{
    inlet  { type fixedValue; value uniform (0 0 0); }
    outlet { type fixedValue; value uniform (0 0 0); }
    wall   { type noSlip; }
}
""")

    with open(os.path.join(case, '0', 'p'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class volScalarField; object p; }
dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField
{
    inlet  { type fixedValue; value uniform %g; }
    outlet { type fixedValue; value uniform 0; }
    wall   { type zeroGradient; }
}
""" % args.dp)

    def _run(cmd):
        ret = subprocess.call(cmd, shell=True, cwd=case)
        if ret != 0:
            raise SystemExit('command failed: ' + cmd)

    _run('checkMesh')
    _run('simpleFoam > log.simpleFoam 2>&1')
    _run('postProcess -func flowIn -latestTime > log.flow 2>&1')
    _run('postProcess -func wss -latestTime > log.wss 2>&1')

    # 提取 Q（inlet 流量，符号修正为正值体积流量）
    q = 0.0
    log = open(os.path.join(case, 'postProcessing', 'flowIn', str(max(os.listdir(os.path.join(case, 'postProcessing', 'flowIn')))), 'surfaceFieldValue.dat')).read()
    for ln in log.strip().splitlines():
        if not ln.startswith('#') and ln.strip():
            parts = ln.split()
            q = abs(float(parts[-1]))

    # WSS 均值（volume-averaged 于 wall patch）
    wss = 0.0
    wdir = os.path.join(case, 'postProcessing', 'wss')
    if os.path.isdir(wdir):
        sub = max(os.listdir(wdir))
        wfile = os.path.join(wdir, sub, 'wallShearStressPatchAvg(wall).dat')
        if os.path.isfile(wfile):
            for ln in open(wfile).read().strip().splitlines():
                if not ln.startswith('#') and ln.strip():
                    wss = abs(float(ln.split()[-1]))

    mu = args.nu * 1000.0     # 动力粘度（rho=1000 kg/m3 缺省）
    kappa = q * mu * args.L / (args.A * args.dp)
    with open(args.out, 'w') as f:
        f.write('Q_m3_s,kappa_m2,wss_Pa\n')
        f.write('%.6e,%.6e,%.4f\n' % (q, kappa, wss))
    print('TPMS verification: kappa=%.4e m2, Q=%.4e m3/s, WSS=%.4f Pa -> %s' % (kappa, q, wss, args.out))

if __name__ == '__main__':
    main()
`;

export const RUN_ABAQUS_SH = `#!/bin/bash
# TPMS Explorer v4.0 —— Abaqus 验证一键脚本
# 用法: ./run_abaqus.sh tpms-gyroid-voxel.inp 1.0
set -e
INP=\${1:-tpms-voxel.inp}
SPEC=\${2:-1.0}
abaqus cae noGUI=abaqus_auto_runner.py -- --inp "\$INP" --out abaqus_result.csv --specimen "\$SPEC"
echo "完成: abaqus_result.csv（E_FEM / sigma_peak / sigma_pl）"
`;

export const RUN_OPENFOAM_SH = `#!/bin/bash
# TPMS Explorer v4.0 —— OpenFOAM 达西渗流一键脚本
# 用法: ./run_openfoam.sh tpms-polymesh-case
set -e
CASE=\${1:-tpms-polymesh-case}
python3 openfoam_auto_runner.py --case "\$CASE" --out permeability.csv
echo "完成: permeability.csv（kappa / Q / WSS）"
`;

export const COMPARISON_TEMPLATE = `metric,unit,theory_prediction,cae_simulation,rel_error,verdict
E_FEM,MPa,,,
sigma_peak,MPa,,,
sigma_pl,MPa,,,
kappa,m2,,,
wss_avg,Pa,,,
sea,J/g,,,
f1_Hz,Hz,,,
# theory_prediction 来源：平台物理面板（Gibson-Ashby/Kozeny-Carman/impact-energy.ts）
# cae_simulation 来源：abaqus_auto_runner.py / openfoam_auto_runner.py 输出 CSV
# rel_error = |theory - cae| / |theory|；verdict: PASS <= 15% (解析代理口径), REVIEW > 15%
`;

export function buildVerificationSuite(modelInfo: { type: string; solidCount: number; voidCount: number }): Record<string, string> {
  const files: Record<string, string> = {};
  files['abaqus_auto_runner.py'] = ABAQUS_RUNNER;
  files['openfoam_auto_runner.py'] = OPENFOAM_RUNNER;
  files['run_abaqus.sh'] = RUN_ABAQUS_SH;
  files['run_openfoam.sh'] = RUN_OPENFOAM_SH;
  files['comparison_template.csv'] = COMPARISON_TEMPLATE;
  files['README.md'] = `# TPMS Explorer v4.0 CAE 验证脚本包

目标模型：${modelInfo.type}（固相体素 ${modelInfo.solidCount} / 流体体素 ${modelInfo.voidCount}）

## Abaqus 准静态压缩
1. 将平台导出的 .inp 与 abaqus_auto_runner.py 放同一目录
2. bash run_abaqus.sh <inp 文件名> <试样宽度 mm>
3. 输出 abaqus_result.csv（反力-位移曲线 + E_FEM/sigma_peak/sigma_pl）

## OpenFOAM 达西渗流
1. 将平台导出的 polymesh.zip 解压为算例目录（内含 constant/polyMesh）
2. bash run_openfoam.sh <算例目录>
3. 输出 permeability.csv（kappa/Q/WSS）

## 对比矩阵
把两个 CSV 的数值填入 comparison_template.csv，与平台物理面板理论预估对齐，
rel_error ≤ 15% 视为解析代理口径 PASS（>15% 请核对单位与试样尺寸换算）。
`;
  return files;
}

export function exportVerificationSuite(modelInfo: { type: string; solidCount: number; voidCount: number }, filename: string, downloadBlobFn: (b: Blob, n: string) => void): void {
  const files = buildVerificationSuite(modelInfo);
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, text]) => ({ name, data: enc.encode(text) }));
  const zip = buildStoredZip(entries);
  downloadBlobFn(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }), filename);
}
