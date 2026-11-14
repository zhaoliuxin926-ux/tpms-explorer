/**
 * agent-tools-shared.ts — Agent 只读工具共享实现（list/estimate/pareto，2026-11-11 方向 B1 → 2026-11-13 扩围）
 *
 * 纯计算、零页面状态依赖——index.html 与 harness.html 两个壳共用同一实现
 *（双壳工具面单源；mesh/verify 等写态工具走各自执行面：主壳直接执行、
 * harness 壳经 iframe-bridge 驱动主壳）。
 */
import { TOOLS_SCHEMA } from './agent-contract';
import { forwardModel } from '../physics/inverse-design';
import { paretoFront, nearestFrontCandidates, type ParetoPoint } from '../physics/ml-surrogate';
import type { TpmType } from '../types';

/** 2026-11-13 OpenFOAM R48 gyroid 渗透率幂律拟合常数（K [mm²] = A · ε^B，ε ∈ [0.50, 0.80]） */
const GYROID_R48_CFD_A = 0.46123269585707205;
const GYROID_R48_CFD_B = 3.1663;

function getBuiltinTypeEnum(): string[] {
  return (TOOLS_SCHEMA.tools.find((t) => t.name === 'tpms_estimate')?.parameters as { properties?: { type?: { enum?: string[] } } })?.properties?.type?.enum ?? [];
}

export async function agentListExec(): Promise<{ ok: boolean; summary: string }> {
  const { BASE_MODULUS, BASE_YIELD_STRENGTH } = await import('../physics/gibson-ashby');
  const typeEnum = getBuiltinTypeEnum();
  const materials = Object.entries(BASE_MODULUS).map(([k, E]) => `${k}: E=${E}GPa σy=${BASE_YIELD_STRENGTH[k] ?? '?'}MPa`).join('；');
  return { ok: true, summary: `曲面族 ${typeEnum.length} 个：${typeEnum.join(',')}。\n材料：${materials}。` };
}

export async function agentEstimateExec(args: Record<string, unknown>): Promise<{ ok: boolean; summary: string }> {
  const type = String(args.type ?? 'gyroid');
  const p = Number(args.porosity ?? 0.75);
  const material = String(args.material ?? 'tc4');
  const cellSize = Number(args.cellSize ?? args.cell_size ?? 3);
  const { gibsonAshby, plateauStress, BASE_MODULUS, BASE_YIELD_STRENGTH } = await import('../physics/gibson-ashby');
  const pct = p > 1 ? p : p * 100;
  if (!(pct >= 0 && pct < 100)) return { ok: false, summary: `孔隙率口径非法：${p}` };
  const eps = pct / 100;
  const rho = 1 - eps;
  const cs = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 3;
  const { E_Es, sigma_Es, C1 } = gibsonAshby(rho, type);
  const plateau = plateauStress(rho, type);
  const baseE = BASE_MODULUS[material] ?? BASE_MODULUS.tc4;
  const baseS = BASE_YIELD_STRENGTH[material] ?? BASE_YIELD_STRENGTH.tc4;
  const fwd = forwardModel(type as TpmType, eps, cs, 1);
  const kappaKcMm2 = fwd.kappaM2 * 1e6;

  const payload: Record<string, unknown> = {
    type,
    porosity: p > 1 ? Number((pct / 100).toFixed(4)) : pct > 0 ? Number(eps.toFixed(4)) : 0,
    material,
    cellSize_mm: cs,
    E_GPa: Number((E_Es * baseE).toFixed(3)),
    yield_MPa: Number((sigma_Es * baseS).toFixed(2)),
    plateau_MPa: plateau !== undefined ? Number((plateau * baseS).toFixed(2)) : null,
    C1,
    sv_per_mm: Number(fwd.svRatio.toFixed(2)),
    kappa_kc_mm2: Number(kappaKcMm2.toFixed(6)),
    kappa_kc_m2: Number(fwd.kappaM2.toExponential(3)),
    caliber: 'Gibson-Ashby × Kozeny-Carman 解析工程口径（非 FEA/CFD）',
  };
  if (type === 'gyroid') {
    const kappaCfdMm2 = GYROID_R48_CFD_A * Math.pow(eps, GYROID_R48_CFD_B);
    payload.kappa_cfd_r48_mm2 = Number(kappaCfdMm2.toFixed(6));
    payload.kc_ratio = Number((kappaCfdMm2 / Math.max(1e-12, kappaKcMm2)).toFixed(2));
    payload.cfd_caliber = 'OpenFOAM R48 定尺度单胞拟合 K=0.4612·ε^3.1663 mm²（2026-11-13，R²=0.998；ε∈[0.50,0.80] 内插参考）';
  }
  return { ok: true, summary: JSON.stringify(payload) };
}

/** 逆设计帕累托扫描：26 族 × 孔隙率 0.55..0.90 × 单胞密度 2..5（与 CLI cmdPareto 同源 832 点域） */
export async function agentParetoExec(args: Record<string, unknown>): Promise<{ ok: boolean; summary: string }> {
  const eV = Number(args.target_e_gpa);
  const kV = Number(args.target_k_nm2);
  const topRaw = args.top === undefined ? 3 : Number(args.top);
  if (!Number.isFinite(eV) || eV <= 0) return { ok: false, summary: `target_e_gpa 非法：${args.target_e_gpa}` };
  if (!Number.isFinite(kV) || kV <= 0) return { ok: false, summary: `target_k_nm2 非法：${args.target_k_nm2}` };
  if (!Number.isInteger(topRaw) || topRaw < 1 || topRaw > 10) return { ok: false, summary: `top 需为 1..10 整数：${args.top}` };

  const kappaM2 = kV * 1e-9;
  const types = getBuiltinTypeEnum();
  const grid: ParetoPoint[] = [];
  for (const ty of types) {
    for (let po = 0.55; po <= 0.905; po += 0.05) {
      const poRound = Number(po.toFixed(2));
      for (const cs of [2, 3, 4, 5]) {
        const f = forwardModel(ty as TpmType, poRound, cs, 1);
        if (f.EGPa > 0 && f.kappaM2 > 0) {
          grid.push({ E: f.EGPa, kappa: f.kappaM2, sea: f.svRatio, type: ty as TpmType, porosity: poRound, cellSize: cs });
        }
      }
    }
  }
  const front = paretoFront(grid);
  const feasible = front.filter((q) => q.E >= eV && q.kappa >= kappaM2);
  const reachable = feasible.length > 0;
  const recs = nearestFrontCandidates(reachable ? feasible : front, eV, kappaM2, topRaw);
  return {
    ok: true,
    summary: JSON.stringify({
      command: 'pareto',
      targetE: eV,
      targetKappaM2: kappaM2,
      top: topRaw,
      scanned: grid.length,
      frontSize: front.length,
      reachable,
      recommendations: recs.map((r, i) => ({
        rank: i + 1,
        type: r.point.type,
        porosity: r.point.porosity,
        cellSize: r.point.cellSize,
        E_GPa: Number(r.point.E.toFixed(3)),
        kappa_m2: Number(r.point.kappa.toExponential(3)),
        sv_per_mm: Number(r.point.sea.toFixed(2)),
        dist_log10: Number(r.dist.toFixed(3)),
        meetsTarget: reachable && r.point.E >= eV && r.point.kappa >= kappaM2,
      })),
      caliber: 'Gibson-Ashby × Kozeny-Carman 解析代理（非 FE/CFD 精确；octet 桁架标定边界见 HONESTY_BOUNDARIES #16）',
    }),
  };
}

export const SAFE_DESIGN_NAME_RE = /^(?!\.{1,2}$)(?!(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll])(?:\.|$))[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/;

export interface ScenarioPresetSpec {
  design: string;
  label: string;
  type: TpmType;
  porosity: number;
  periods: number;
  material: 'tc4' | 'ti' | 'ss316l' | 'polymer' | 'thermal';
  specimenSizeMm: number;
  mode: 'solid_network' | 'shell';
  container: 'cube' | 'cylinder';
  nominalStrain: number;
}

export const SCENARIO_PRESETS: Readonly<Record<string, ScenarioPresetSpec>> = {
  'bone_scaffold.json': {
    design: 'bone_scaffold.json',
    label: 'M5 骨科植入物多孔支架（Ti-6Al-4V · Gyroid 65%）',
    type: 'gyroid',
    porosity: 0.65,
    periods: 3,
    material: 'tc4',
    specimenSizeMm: 12,
    mode: 'solid_network',
    container: 'cube',
    nominalStrain: 0.05,
  },
  'gyroid_implant.json': {
    design: 'gyroid_implant.json',
    label: 'Gyroid 生物固定支架（Ti-6Al-4V · 70%）',
    type: 'gyroid',
    porosity: 0.70,
    periods: 3,
    material: 'tc4',
    specimenSizeMm: 9,
    mode: 'solid_network',
    container: 'cube',
    nominalStrain: 0.05,
  },
  'diamond_load.json': {
    design: 'diamond_load.json',
    label: 'Diamond 承压骨小梁试样（Ti-6Al-4V · 60%）',
    type: 'diamond',
    porosity: 0.60,
    periods: 3,
    material: 'tc4',
    specimenSizeMm: 12,
    mode: 'solid_network',
    container: 'cube',
    nominalStrain: 0.05,
  },
  'primitive_flow.json': {
    design: 'primitive_flow.json',
    label: 'Schwarz-P 高灌注流道支架（Ti-6Al-4V · 75%）',
    type: 'schwarz',
    porosity: 0.75,
    periods: 3,
    material: 'tc4',
    specimenSizeMm: 12,
    mode: 'solid_network',
    container: 'cube',
    nominalStrain: 0.05,
  },
  'iwp_stiff.json': {
    design: 'iwp_stiff.json',
    label: 'IWP 高比刚度承重单胞（Ti-6Al-4V · 60%）',
    type: 'iwp',
    porosity: 0.60,
    periods: 3,
    material: 'tc4',
    specimenSizeMm: 12,
    mode: 'solid_network',
    container: 'cube',
    nominalStrain: 0.05,
  },
};

export function resolveScenarioPreset(
  designRaw: string,
): { ok: true; design: string; preset: ScenarioPresetSpec | null; useCurrentViewport: boolean } | { ok: false; error: string } {
  const design = String(designRaw ?? '').trim();
  if (!SAFE_DESIGN_NAME_RE.test(design)) {
    return {
      ok: false,
      error: `design 文件名 "${design}" 非法（仅允许单段安全文件名，禁止 .. / 路径分隔符 / 设备名）`,
    };
  }
  const key = design.toLowerCase();
  if (key === 'current.json' || key === 'current') {
    return { ok: true, design, preset: null, useCurrentViewport: true };
  }
  const hit = SCENARIO_PRESETS[key] ?? null;
  return { ok: true, design, preset: hit, useCurrentViewport: hit === null };
}

/** Headless / 无桥降级版 tpms_scenario 执行体（与 main.ts agentScenarioExec 共享场景映射与物理估标口径） */
export async function agentScenarioFallbackExec(
  args: Record<string, unknown>,
  currentState?: { type?: string; porosity?: number; periods?: number; material?: string; specimenSizeMm?: number | null },
): Promise<{ ok: boolean; summary: string }> {
  const resolved = resolveScenarioPreset(String(args.design ?? ''));
  if (!resolved.ok) return { ok: false, summary: resolved.error };
  const preset = resolved.preset;
  const type = preset?.type ?? String(currentState?.type ?? 'gyroid');
  const rawPor = preset?.porosity ?? Number(currentState?.porosity ?? 0.70);
  const porosity = rawPor > 1 ? rawPor / 100 : rawPor;
  const periods = preset?.periods ?? Number(currentState?.periods ?? 3);
  const material = preset?.material ?? String(currentState?.material ?? 'tc4');
  const specimenSizeMm = preset?.specimenSizeMm ?? (currentState?.specimenSizeMm ?? periods);
  const est = await agentEstimateExec({ type, porosity, material, cellSize: specimenSizeMm / Math.max(1, periods) });
  const estJson = est.ok ? (JSON.parse(est.summary) as Record<string, unknown>) : {};
  return {
    ok: true,
    summary: JSON.stringify({
      command: 'scenario',
      design: resolved.design,
      source: preset ? 'builtin-preset' : 'viewport-state',
      label: preset?.label ?? `当前视口场景 (${type} p=${Math.round(porosity * 100)}%)`,
      params: { type, porosity, periods, material, specimenSizeMm },
      estimate: estJson,
      deliverables: [`${type}-p${Math.round(porosity * 100)}.stl`, `${type}-voxel.inp`, `${type}-polymesh.zip`, 'scenario-report.json'],
      caliber: 'M5 场景共享估标（离线无网格口；完整水密门+悬垂审计需在工程壳视口执行）',
    }),
  };
}
