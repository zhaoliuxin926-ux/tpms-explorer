/**
 * openfoam-case-template.ts —— polyMesh ZIP 配套的可运行 OpenFOAM case 模板
 *
 * 生成 0/{U,p,C} + system/{controlDict,fvSchemes,fvSolution} + constant/{physicalProperties,
 * momentumTransport} + README.md，使 `mesh --cfd-polyMesh` 的交付从「网格就绪」升级为
 * 「解压即 foamRun 可解 + 后处理口径预埋」。
 *
 * 字典口径出处（FEA_Bone_Scaffold 论文 62GB CFD 工程验证过的配置，2026-09 借鉴）：
 *   - SIMPLE 稳态（ddtSchemes steadyState + endTime=伪迭代上限）；
 *   - inlet 必须 flowRateInletVelocity（fixedValue 速度会使流量失真）；
 *   - p 场是运动压强 p/ρ（dimensions [0 2 -2]），提取 ΔP 必须 ×ρ；
 *   - div(phi,C) Gauss upwind（limitedLinear01 在 Pe_cell 4-33 必发散）；
 *   - wallShearStress functionObject 只对 wall 类型 patch 生效（导出器侧 fourPatch
 *     的壁面 patch 已用 type wall）；
 *   - 传质壁面 Robin 型 mixed BC（valueFraction 0.0625 沿用论文 ka_eff 标定口径）。
 *
 * 诚实边界：字典经论文工程验证，但平台几何为结构化六面体（与论文 snappy 四面体
 * 网格族不同）；求解器口径 OpenFOAM Foundation v13 foamRun（incompressibleFluid），
 * 其他版本需自查兼容性；绝对值（ΔP/K_int/WSS）须带网格敏感性披露。
 */

export interface CaseTemplateOptions {
  /** boundary 中出现的 patch 名（有序，与 polyMesh/boundary 一致） */
  patches: string[];
  inletPatch: string;
  outletPatch: string;
  /** 无滑移壁 patch（casing_wall + tpms_scaffold_wetted） */
  wallPatches: string[];
  /** 进流体积流量 m³/s（默认 8.33e-9 = 0.5 mL/min 灌注实验口径） */
  flowRateM3s: number;
  /** 运动黏度 m²/s（默认 1.45e-6 = DMEM+10%FBS @37°C） */
  nu: number;
  /** SIMPLE 伪迭代上限（默认 600，收敛由残差判据停） */
  endTime?: number;
}

const HEAD = (cls: string, obj: string) =>
  `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    object      ${obj};\n}\n`;

export function buildCaseFiles(opts: CaseTemplateOptions): Record<string, string> {
  const { patches, inletPatch, outletPatch, wallPatches } = opts;
  for (const p of [inletPatch, outletPatch, ...wallPatches]) {
    if (!patches.includes(p)) throw new Error(`patch "${p}" 不在 boundary patch 列表 ${JSON.stringify(patches)}`);
  }
  // 单位制（WSL checkMesh 真跑定案）：polyMesh 几何原生 mm（与 STL 导出同源），
  // 本 case 采用自洽 mm 单位制——物理量由 SI 换算写入：Q[m³/s]×1e9→mm³/s、ν[m²/s]×1e6→mm²/s；
  // 压强输出为运动压强 mm²/s²，物理压降 Pa = Δp × 1e-6 × ρ（README 单位节）
  const Q = opts.flowRateM3s * 1e9;
  const nu = opts.nu * 1e6;
  const endTime = opts.endTime ?? 600;
  const wallBC = (cls: string, obj: string, body: string) =>
    HEAD(cls, obj) + `dimensions DIM;\ninternalField FIELD;\nboundaryField\n{\n${body}\n}\n`;

  const uBody = patches.map((p) => {
    if (p === inletPatch) {
      return `    ${p}\n    {\n        type                flowRateInletVelocity;\n        volumetricFlowRate  constant ${Q.toExponential(6)};\n        value               uniform (0 0 0);\n    }`;
    }
    if (p === outletPatch) return `    ${p} { type pressureInletOutletVelocity; value uniform (0 0 0); }`;
    return `    ${p} { type noSlip; }`;
  }).join('\n');
  const files: Record<string, string> = {};
  // p 是运动压强 p/ρ（dimensions [0 2 -2]）——提取物理压降必须 ×ρ
  files['0/U'] = wallBC('volVectorField', 'U', uBody).replace('DIM', '[0 1 -1 0 0 0 0]').replace('FIELD', 'uniform (0 0 0)');
  const pBody = patches.map((p) => {
    if (p === inletPatch) return `    ${p} { type zeroGradient; }`;
    if (p === outletPatch) return `    ${p} { type fixedValue; value uniform 0; }`;
    return `    ${p} { type zeroGradient; }`;
  }).join('\n');
  files['0/p'] = wallBC('volScalarField', 'p', pBody).replace('DIM', '[0 2 -2 0 0 0 0]').replace('FIELD', 'uniform 0');
  const cBody = patches.map((p) => {
    if (p === inletPatch) return `    ${p} { type fixedValue; value uniform 1; }`;
    if (p === outletPatch) return `    ${p} { type inletOutlet; inletValue uniform 0; value uniform 0; }`;
    // Robin 型壁面消耗（valueFraction 0.0625 = 论文 ka_eff 标定口径，按需调）
    return `    ${p}\n    {\n        type            mixed;\n        refValue        uniform 0;\n        refGradient     uniform 0;\n        valueFraction   uniform 0.0625;\n        value           uniform 0.5;\n    }`;
  }).join('\n');
  files['0/C'] = wallBC('volScalarField', 'C', cBody).replace('DIM', '[0 0 0 0 0 0 0]').replace('FIELD', 'uniform 0.5');

  files['constant/physicalProperties'] = HEAD('dictionary', 'physicalProperties')
    + `viscosityModel  constant;\nnu              [0 2 -1 0 0 0 0] ${nu.toExponential(6)};\n`;
  files['constant/momentumTransport'] = HEAD('dictionary', 'momentumTransport') + 'simulationType  laminar;\n';

  files['system/controlDict'] = HEAD('dictionary', 'controlDict')
    + `solver          incompressibleFluid;\nstartFrom       startTime;\nstartTime       0;\nstopAt          endTime;\nendTime         ${endTime};\ndeltaT          1;\n`
    + `writeControl    timeStep;\nwriteInterval   100;\npurgeWrite      3;\nwriteFormat     binary;\nwritePrecision  8;\n`
    + `functions\n{\n`
    // dP 提取预埋（真跑定案 v13 语法：命令行 -func 'areaAverage(...) of p' 不可用，
    // patchAverage 表面场值模板写入 controlDict 持续输出到 postProcessing/<time>/surfaceFieldValue.dat）
    + `    pin\n    {\n        type surfaceFieldValue; libs ("libfieldFunctionObjects.so");\n        patch ${inletPatch}; fields (p); operation areaAverage; writeFields false;\n        writeControl writeTime; writeInterval 1;\n    }\n`
    + `    pout\n    {\n        type surfaceFieldValue; libs ("libfieldFunctionObjects.so");\n        patch ${outletPatch}; fields (p); operation areaAverage; writeFields false;\n        writeControl writeTime; writeInterval 1;\n    }\n`
    + `    scalarTransportC\n    {\n        type            scalarTransport;\n        libs            ("libsolverFunctionObjects.so");\n        field           C;\n        phi             phi;\n        diffusivity     constant;\n        D               3.0e-09;\n        executeControl  timeStep;\n        executeInterval 1;\n        writeControl    writeTime;\n    }\n`
    + `    wallShearStress\n    {\n        type wallShearStress; libs ("libfieldFunctionObjects.so");\n        patches (${wallPatches.join(' ')}); executeControl writeTime; writeControl writeTime;\n    }\n`
    + `    wallShearStressMag\n    {\n        type mag; libs ("libfieldFunctionObjects.so");\n        field wallShearStress; result wallShearStressMag;\n        executeControl writeTime; writeControl writeTime;\n    }\n}\n`;

  files['system/fvSchemes'] = HEAD('dictionary', 'fvSchemes')
    + `ddtSchemes { default steadyState; }\ngradSchemes { default Gauss linear; grad(U) Gauss linear; }\ndivSchemes { default none; div(phi,C) Gauss upwind;\n    div(phi,U) Gauss linearUpwind grad(U); div((nuEff*dev2(T(grad(U))))) Gauss linear; }\nlaplacianSchemes { default Gauss linear corrected; }\ninterpolationSchemes { default linear; }\nsnGradSchemes { default corrected; }\n`;

  files['system/fvSolution'] = HEAD('dictionary', 'fvSolution')
    + `solvers\n{\n    "C.*"\n    {\n        solver          PBiCGStab;\n        preconditioner  DILU;\n        tolerance       1e-10;\n        relTol          0.0001;\n        maxIter         200;\n    }\n`
    // p 用 PCG/DIC：GAMG(+DICGaussSeidel) 在本模板的结构化六面体网格上死锁（WSL OF v13
    // 真跑实证——500 迭代残差零进展且首步发散，论文 snappy 四面体网格不触发）；
    // PCG/DIC 同网格 600 步收敛至 9.3e-9（2026-09-15 真跑定案）
    + `    p { solver PCG; preconditioner DIC; tolerance 1e-08; relTol 0.001; maxIter 2000; }\n    pFinal { $p; relTol 0; }\n    U { solver PBiCGStab; preconditioner DILU; tolerance 1e-08; relTol 0.0001; maxIter 500; }\n    UFinal { $U; relTol 0; }\n}\n`
    + `SIMPLE { momentumPredictor yes; nNonOrthogonalCorrectors 2; pRefCell 0; pRefValue 0; }\nrelaxationFactors { equations { U 0.5; p 0.3; } }\n`;

  files['README.md'] = buildReadme(opts);
  return files;
}

function buildReadme(o: CaseTemplateOptions): string {
  const Q = o.flowRateM3s * 1e9;
  const nu = o.nu * 1e6;
  return `# OpenFOAM 可运行 case（TPMS Explorer 生成）

solver: incompressibleFluid（OpenFOAM Foundation v13 foamRun，SIMPLE 稳态层流）
patch: inlet=${o.inletPatch} / outlet=${o.outletPatch} / walls=${o.wallPatches.join(' + ')}

## 跑法
1. foamRun（在本 case 目录）——收敛由残差判据；endTime=${o.endTime ?? 600} 为伪迭代上限，
   **foamRun 不保证遵守 endTime，长跑需轮询 \`grep -c "Time =" log.foamRun\` 到目标步后 kill**；
2. 压降已预埋自动输出（controlDict functions: pin/pout surfaceFieldValue 面积平均）——
   末值在 \`postProcessing/pin/0/surfaceFieldValue.dat\` 与 \`postProcessing/pout/0/surfaceFieldValue.dat\`
   （目录名 = 记录起始时间 0，末行即收敛值；pout 为 fixedValue 0 参考点，ΔP 即 pin 末值）；
   提取 WSS（面积加权）：foamPostProcess -func 'patchAverage(patch=${o.wallPatches[0]}, fields=(wallShearStressMag))' -latestTime
   （v13 命令行语法为 patchAverage(patch=…, fields=(…)) 键值式，areaAverage(…) of … 不可用）
3. 两流量点渗透率：改 \`0/U\` 的 volumetricFlowRate（如 ×2、×10）重跑 → 用平台
   \`node tpms.mjs cfd-post --q1 ... --dp1 ... --q2 ... --dp2 ... --kinematic\` 做 Forchheimer
   两点分离出 K_int（--kinematic 直接吃 mm²/s² 运动压差自动 ×1e-6×ρ 转 Pa）。

## 单位制（重要）
本 case 几何为 mm（polyMesh 原生），全部物理量按 mm 单位制自洽配套：
- 当前流量 Q=${o.flowRateM3s.toExponential(3)} m³/s = ${Q.toExponential(3)} mm³/s、
  ν=${o.nu.toExponential(3)} m²/s = ${nu.toExponential(3)} mm²/s（DMEM@37°C 口径）；
- p 场输出为运动压强 **mm²/s²**——物理压降 Pa = (p_in − p_out) × 1e-6 × ρ（ρ 默认 1000 kg/m³）；
- 平台 \`cfd-post --kinematic --rho 1000\` 可直接吃 mm²/s² 口径压差自动换算；
- 换用 SI 几何：points 全坐标 ×1e-3 并同步把 0/U 流量与 physicalProperties 的 nu 换回 SI。

## 已知坑（继承论文工程验证经验）
- inlet 必须保持 flowRateInletVelocity（改 fixedValue 速度会流量失真）；
- div(phi,C) 保持 Gauss upwind（limitedLinear01 在 Pe_cell 4-33 必发散）；
- wallShearStress 只对 wall 类型 patch 生效（本 case 壁面 patch 已为 wall 类型）。

## 诚实边界
字典配置经 62GB 论文 CFD 工程验证，但本几何为结构化六面体（与 snappy 四面体网格族不同）；
绝对值（ΔP/K_int/WSS）须带网格敏感性披露（未做网格收敛研究前不报 GCI）；
传质壁面 Robin BC valueFraction=0.0625 为论文 ka_eff 标定口径，按需调整。
`;
}
