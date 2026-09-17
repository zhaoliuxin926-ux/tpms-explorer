/**
 * region-grad.ts —— 径向双族分区构型（bimodal scaffold，2026-09-17）
 *
 * 数学：域内按归一化半径 r1=√(X²+Y²) 分区——内区（r1 < rSplit）放族 B、外区放族 A，
 * 过渡带 [rSplit−b/2, rSplit+b/2] 内 smoothstep 凸组合：
 *   v(r1) = s·vA + (1−s)·vB，  s = 3t²−2t³，t = clamp((r1 − (rSplit − b/2)) / b, 0, 1)
 * 凸组合同号不变性（vA·vB>0 ⟹ 组合同号）保证过渡带不产生额外零等值面；s 为 C1
 * ⟹ 界面法线连续——surface-nets 对连续场的水密性天然保持（非 MT 管线，水密三硬门同标准）。
 * 两族共享 periods/thickness/iso（跨族晶胞对齐是研究级难题，非本功能口径）。
 *
 * 退化锚（字节级对拍用）：rSplit ≥ 1 ⟹ s 恒 1（纯外族）；rSplit ≤ 0 ⟹ s 恒 0（纯内族）——
 * region 场在该两参数下与单族基准构建结果逐字节一致。
 * 互斥面与 radial-grad 同清单（isoGrad/hybrid/stress/hier/neural/custom/mesh 容器/
 * targetPorosity 二分/radial-grad 本身）。
 */

export interface RegionGradConfig {
  /** 内区曲面族（外区由调用方的 type 承担；custom 不可分区——无解析场语义） */
  innerType: import('../types').TpmType;
  /** 分界面归一化半径（0 ≤ rSplit ≤ 1；端点值=单族字节级退化锚） */
  rSplit: number;
  /** 过渡带全宽（归一化域；0.02 ≤ b ≤ 0.6） */
  blend: number;
}

export function validateRegionGrad(cfg: RegionGradConfig): void {
  if (!cfg.innerType || typeof cfg.innerType !== 'string') throw new Error('region-grad innerType 须为非空曲面族标识');
  if (cfg.innerType === 'custom') throw new Error('region-grad 内区不支持 custom（无解析场语义）');
  if (!(cfg.rSplit >= 0) || cfg.rSplit > 1) throw new Error(`region-grad rSplit 须 0 ≤ r ≤ 1（收到 ${cfg.rSplit}；端点值=单族字节级退化锚）`);
  if (!(cfg.blend >= 0.02) || cfg.blend <= 0 || cfg.blend > 0.6) throw new Error(`region-grad blend（过渡带全宽）须 0.02 ≤ b ≤ 0.6（收到 ${cfg.blend}）`);
}

/** 分区权重 s(r1) ∈ [0,1]：0=纯内区族，1=纯外区族。rSplit 端点退化（见模块注释）。 */
export function regionWeight(r1: number, rSplit: number, blend: number): number {
  if (rSplit <= 0) return 0;
  if (rSplit >= 1) return 1;
  const t = (r1 - (rSplit - blend / 2)) / blend;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
