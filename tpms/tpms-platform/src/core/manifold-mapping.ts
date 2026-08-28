/**
 * 非欧几里得度规空间映射（阶段 IV）：保形弯曲变形层
 *
 * 位置：Surface Nets 网格生成之后的顶点级连续映射（vertex warp）。
 * 设计依据：连续单射映射保持网格拓扑——水密性/流形性质由构造继承，
 * 无需重网格化。法线由映射后几何重算（调用方 THREE.ComputeVertexNormals
 * 等价路径，或按雅可比逆变换解析法线）。
 *
 * 映射族（均要求：单调/单射、雅可比行列式 > 0、域边界连续）：
 *  - cylinder  圆柱保形弯曲：x 轴环绕 z 轴卷成圆柱（θ = x/R·2π 单整圈包裹，
 *              径向 = R + y），用于多孔管道与环形骨套筒。
 *  - torus     环面闭合：x 绕主圆（R1）、y 绕管圆（R2）双卷，z 沿管径向——
 *              生成真正的环面多孔壳（无边界、闭合 genus-1）。
 *  - hyperbolic 双曲径向映射：r → R·tan(r/R·π/4) 的单调径向密度重映射，
 *              中心致密、外围稀疏（双曲度规的一阶视觉近似）。
 *  - metric    应力线各向异性度量：沿给定轴 n 的线性缩放
 *              p' = p + (s−1)(p·n)n（度量张量 G = MᵀM 的解析最简族）。
 *
 * 周期性对齐：TPMS 场在 (x,y,z) 上以 2π/k 周期；cylinder/torus 的包裹角度
 * 取满整圈（域全长 → 2π），保证弯曲后缝隙为周期副本（零裂缝）。
 * 几何有效性约束（违反 ⇒ 负半径折叠，雅可比变号）：
 *  - cylinder：radius > 域 y 半宽（y ∈ ±half ⇒ R > half）
 *  - torus：R2 = radius·tubeRatio > 域 z 半宽，且 radius > R2 + 域 z 半宽
 *    （例：half=2π 时 radius=15、tubeRatio=0.55 → R2=8.25、外径 23.25）
 *  - hyperbolic/metric：全域单调（无约束）
 */

export type ManifoldKind = 'identity' | 'cylinder' | 'torus' | 'hyperbolic' | 'metric' | 'poincare';

export interface ManifoldConfig {
  kind: ManifoldKind;
  /** 弯曲/映射半径（mm 语义，调用方按域尺度换算），默认 6 */
  radius?: number;
  /** torus 次圆半径系数（相对 radius），默认 0.4 */
  tubeRatio?: number;
  /** metric 各向异性缩放因子（沿轴），默认 1.4 */
  scale?: number;
  /** metric 缩放轴，默认 'z' */
  axis?: 'x' | 'y' | 'z';
}

const TAU = Math.PI * 2;

/** 域半宽（弧度域 wc ∈ [-π·k, π·k]，k=周期数）：调用方传入，用于角度归一 */
export interface ManifoldContext {
  /** 域半宽（弧度） */
  half: number;
}

/**
 * 单点映射。positions 就地版本见 mapGeometry。
 * 数学约束：对 cylinder/torus/hyperbolic，径向半径恒正 ⇒ 雅可比满秩；
 * metric 的缩放 s > 0 ⇒ 线性满秩。
 */
export function mapPoint(kind: ManifoldKind, cfg: ManifoldConfig, ctx: ManifoldContext, x: number, y: number, z: number, out: [number, number, number]): void {
  const R = Math.max(cfg.radius ?? 6, 1e-6);
  switch (kind) {
    case 'cylinder': {
      // x ∈ [-half, half] → θ ∈ [0, 2π)（单整圈，周期副本对齐）
      const theta = ((x + ctx.half) / (2 * ctx.half)) * TAU;
      const rad = R + y;
      // (sinθ, cosθ) 序：保持 det(J) = +rad·π/half > 0（(cos,sin) 序为镜像映射）
      out[0] = rad * Math.sin(theta);
      out[1] = rad * Math.cos(theta);
      out[2] = z;
      return;
    }
    case 'torus': {
      const tubeRatio = cfg.tubeRatio ?? 0.4;
      const R2 = R * tubeRatio;
      const u = ((x + ctx.half) / (2 * ctx.half)) * TAU;
      const v = ((y + ctx.half) / (2 * ctx.half)) * TAU;
      const tube = R2 + z;
      const ring = R + tube * Math.cos(v);
      out[0] = ring * Math.cos(u);
      out[1] = ring * Math.sin(u);
      out[2] = tube * Math.sin(v);
      return;
    }
    case 'hyperbolic': {
      // 径向双曲重映射：r → R·tan(r/R·π/4)；单调、可微、r=0 处恒等
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r < 1e-12) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
      const rH = R * Math.tan((r / R) * (Math.PI / 4));
      const s = rH / r;
      out[0] = x * s; out[1] = y * s; out[2] = z * s;
      return;
    }
    case 'poincare': {
      // 【v4.0 阶段 II】庞加莱双曲度规映射：r' = 2R₀²·r/(R₀²−r²)（自中心向外围
      // 非线性加密），径向截断正则化 r_c = 0.95·R₀——r ≤ r_c 走双曲段，
      // r > r_c 以截点斜率线性延拓（单射性保持：斜率恒正，无坐标发散/网格折叠）
      const R0 = R;
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r < 1e-12) { out[0] = 0; out[1] = 0; out[2] = 0; return; }
      const rC = 0.95 * R0;
      const f = (rr: number) => (2 * R0 * R0 * rr) / (R0 * R0 - rr * rr);
      const fpc = f(Math.min(rC, 0.999 * R0));
      let rp: number;
      if (r <= rC) {
        rp = f(r);
      } else {
        const fpC = (2 * R0 * R0 * (R0 * R0 + 3 * rC * rC)) / Math.pow(R0 * R0 - rC * rC, 2);
        rp = fpc + fpC * (r - rC);
      }
      const sc = rp / r;
      out[0] = x * sc; out[1] = y * sc; out[2] = z * sc;
      return;
    }
    case 'metric': {
      const sc = cfg.scale ?? 1.4;
      const n = cfg.axis ?? 'z';
      const c = n === 'x' ? x : n === 'y' ? y : z;
      const add = (sc - 1) * c;
      out[0] = x + (n === 'x' ? add : 0);
      out[1] = y + (n === 'y' ? add : 0);
      out[2] = z + (n === 'z' ? add : 0);
      return;
    }
    default:
      out[0] = x; out[1] = y; out[2] = z;
  }
}

/**
 * 就地映射几何顶点（positions：xyz 交错 Float32Array）。
 * 返回映射后的包围半径（供调用方缩放视角）。
 */
export function mapGeometry(kind: ManifoldKind, cfg: ManifoldConfig, ctx: ManifoldContext, positions: Float32Array): number {
  const out: [number, number, number] = [0, 0, 0];
  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    mapPoint(kind, cfg, ctx, positions[i], positions[i + 1], positions[i + 2], out);
    positions[i] = out[0]; positions[i + 1] = out[1]; positions[i + 2] = out[2];
    const r2 = out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
    if (r2 > maxR) maxR = r2;
  }
  return Math.sqrt(maxR);
}

/**
 * 解析雅可比行列式（采样验证映射单射性/定向性；det > 0 = 保定向无折叠）。
 * 中心差分近似（步长 1e-4·half）。
 */
export function jacobianDet(kind: ManifoldKind, cfg: ManifoldConfig, ctx: ManifoldContext, x: number, y: number, z: number): number {
  const h = ctx.half * 1e-4;
  const p = (dx: number, dy: number, dz: number): [number, number, number] => {
    const o: [number, number, number] = [0, 0, 0];
    mapPoint(kind, cfg, ctx, x + dx, y + dy, z + dz, o);
    return o;
  };
  const p00 = p(h, 0, 0), p0p = p(0, h, 0), p00m = p(0, 0, h);
  const p0 = p(-h, 0, 0), p0m = p(0, -h, 0), p00n = p(0, 0, -h);
  // J 的三列
  const c0 = [0, 1, 2].map((i) => (p00[i] - p0[i]) / (2 * h));
  const c1 = [0, 1, 2].map((i) => (p0p[i] - p0m[i]) / (2 * h));
  const c2 = [0, 1, 2].map((i) => (p00m[i] - p00n[i]) / (2 * h));
  return c0[0] * (c1[1] * c2[2] - c1[2] * c2[1])
       - c0[1] * (c1[0] * c2[2] - c1[2] * c2[0])
       + c0[2] * (c1[0] * c2[1] - c1[1] * c2[0]);
}
