/**
 * agent-tools-shared.ts — Agent 只读工具共享实现（list/estimate，2026-11-11 方向 B1）
 *
 * 纯计算、零页面状态依赖——index.html 与 harness.html 两个壳共用同一实现
 *（双壳工具面单源；mesh/verify 等写态工具走各自执行面：主壳直接执行、
 * harness 壳经 iframe-bridge 驱动主壳）。
 */
import { TOOLS_SCHEMA } from './agent-contract';

export async function agentListExec(): Promise<{ ok: boolean; summary: string }> {
  const { BASE_MODULUS, BASE_YIELD_STRENGTH } = await import('../physics/gibson-ashby');
  const typeEnum = (TOOLS_SCHEMA.tools.find((t) => t.name === 'tpms_estimate')?.parameters as { properties?: { type?: { enum?: string[] } } })?.properties?.type?.enum ?? [];
  const materials = Object.entries(BASE_MODULUS).map(([k, E]) => `${k}: E=${E}GPa σy=${BASE_YIELD_STRENGTH[k] ?? '?'}MPa`).join('；');
  return { ok: true, summary: `曲面族 ${typeEnum.length} 个：${typeEnum.join(',')}。\n材料：${materials}。` };
}

export async function agentEstimateExec(args: Record<string, unknown>): Promise<{ ok: boolean; summary: string }> {
  const type = String(args.type ?? 'gyroid');
  const p = Number(args.porosity ?? 0.75);
  const material = String(args.material ?? 'tc4');
  const { gibsonAshby, plateauStress, BASE_MODULUS, BASE_YIELD_STRENGTH } = await import('../physics/gibson-ashby');
  const pct = p > 1 ? p : p * 100;
  if (!(pct >= 0 && pct < 100)) return { ok: false, summary: `孔隙率口径非法：${p}` };
  const rho = 1 - pct / 100;
  const { E_Es, sigma_Es, C1 } = gibsonAshby(rho, type);
  const plateau = plateauStress(rho, type);
  const baseE = BASE_MODULUS[material] ?? BASE_MODULUS.tc4;
  const baseS = BASE_YIELD_STRENGTH[material] ?? BASE_YIELD_STRENGTH.tc4;
  return {
    ok: true,
    summary: JSON.stringify({
      type, porosity: pct > 1 ? pct / 100 : pct, material,
      E_GPa: Number((E_Es * baseE).toFixed(3)), yield_MPa: Number((sigma_Es * baseS).toFixed(2)),
      plateau_MPa: plateau !== undefined ? Number((plateau * baseS).toFixed(2)) : null,
      C1, caliber: 'Gibson-Ashby 解析工程口径（非 FEA）',
    }),
  };
}
