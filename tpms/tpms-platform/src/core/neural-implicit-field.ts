/**
 * 隐式神经场求值器（Stage I · Generative INR / SIREN）
 *
 * 纯浮点零依赖 4 层 MLP（正弦周期激活），突破代数三角级数的构型限制：
 *   u  = [sin x, cos x, sin y, cos y, sin z, cos z]   ← Fourier 特征输入
 *   h0 = sin(W0·u + b0)；h1 = sin(W1·h0 + b1)；h2 = sin(W2·h1 + b2)
 *   F  = (W3·h2 + b3)
 *
 * 关键设计定案：
 * 1. **Fourier 特征输入 ⇒ 精确 2π 周期**：跨周期水密由构造保证（原始 SIREN 直接吃
 *    坐标在周期边界存在拟合误差缝，会破坏 Surface Nets 水密性——已用特征化根治）。
 * 2. **预置蒸馏权重**：5 个拓扑专家（gyroid/diamond/lidinoid/schwarz/trabecular）由
 *    .verify/gen_neural_weights.mjs 离线 Adam 蒸馏（教师场与平台渲染/导出同源，
 *    TPMS_FUNCTIONS 单一语义源），RMSE(16³) 0.7%~8%（分形多尺度最难，如实标注）。
 * 3. **8 维潜在空间**：专家混合解码 m = softmax(−‖z−A_i‖²/2σ²)，锚点 A_i 为 ±3
 *    Walsh 码字（两两汉明距离 4 ⇒ 交叉权重 e^-72），z 插值产生拓扑间非线性流形变形。
 * 4. **Lipschitz 有界**：|sin'|≤1 ⇒ 全局 Lipschitz 常数 L ≤ Π‖W_i‖₂（幂迭代谱范数），
 *    门禁 32 断言乘积界有限 + 采样梯度上界一致。
 * 5. 输入坐标口径：mx ∈ 周期-1 弧度域（surface-nets 侧除以周期数 k 后喂入）。
 */

import {
  NEURAL_ANCHORS,
  NEURAL_EXPERT_NAMES,
  NEURAL_EXPERT_WEIGHTS,
  NEURAL_LATENT_DIM,
} from './neural-implicit-weights';

export { NEURAL_LATENT_DIM, NEURAL_EXPERT_NAMES };
export type NeuralExpertName = (typeof NEURAL_EXPERT_NAMES)[number];

/** 潜在分量钳制幅值（= 锚点码字幅值；UI 滑块与 URL 解析同口径） */
export const NEURAL_Z_LIMIT = 3;
/** 混合 softmax 带宽（σ=2：锚点交叉权重 e^-18 仍单峰主导，插值路径斜率更平缓） */
const MIX_SIGMA = 2.0;
/** 单专家快路径阈值：混合权重占比超过该值时跳过其余专家（HD 重建提速 ~5×） */
const FAST_PATH_RATIO = 0.999;

interface Expert {
  name: string;
  w0: Float64Array; b0: Float64Array;
  w1: Float64Array; b1: Float64Array;
  w2: Float64Array; b2: Float64Array;
  w3: Float64Array; b3: Float64Array;
  /** 教师场峰值归一化尺度 */
  scale: number;
  /** 缓存的谱范数 Lipschitz 乘积界（幂迭代，惰性计算） */
  lipschitz: number | null;
}

const experts: Expert[] = NEURAL_EXPERT_WEIGHTS.map((w) => ({
  name: w.name,
  w0: new Float64Array(w.w0), b0: new Float64Array(w.b0),
  w1: new Float64Array(w.w1), b1: new Float64Array(w.b1),
  w2: new Float64Array(w.w2), b2: new Float64Array(w.b2),
  w3: new Float64Array(w.w3), b3: new Float64Array(w.b3),
  scale: w.scale,
  lipschitz: null,
}));

export function expertCount(): number {
  return experts.length;
}

export function expertName(i: number): string {
  return experts[i]?.name ?? '';
}

/** 锚点拷贝（UI 锚点按钮直接 set 潜在码） */
export function neuralAnchor(i: number): number[] {
  const a = NEURAL_ANCHORS[i];
  if (!a) throw new Error(`专家锚点越界：${i}`);
  return [...a];
}

/** 最近专家（UI 高亮当前锚点） */
export function nearestExpertIndex(z: number[]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NEURAL_ANCHORS.length; i++) {
    let d = 0;
    for (let j = 0; j < NEURAL_LATENT_DIM; j++) d += (z[j] - NEURAL_ANCHORS[i][j]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** 潜在码消毒：长度/有限性校验 + 钳制（非法输入抛错，URL/UI 单一入口） */
export function sanitizeLatent(z: unknown): number[] {
  if (!Array.isArray(z) || z.length !== NEURAL_LATENT_DIM) {
    throw new Error(`潜在码必须是长度 ${NEURAL_LATENT_DIM} 的数组`);
  }
  const out: number[] = [];
  for (const v of z) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('潜在码含非有限值');
    out.push(Math.min(NEURAL_Z_LIMIT, Math.max(-NEURAL_Z_LIMIT, n)));
  }
  return out;
}

/** 专家混合权重（softmax over −‖z−A_i‖²/2σ²） */
export function mixtureWeights(z: number[]): number[] {
  const logits = NEURAL_ANCHORS.map((a) => {
    let d = 0;
    for (let j = 0; j < NEURAL_LATENT_DIM; j++) d += (z[j] - a[j]) ** 2;
    return -d / (2 * MIX_SIGMA * MIX_SIGMA);
  });
  const mx = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - mx));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / sum);
}

/** 单专家前向（u = 6 维 Fourier 特征；h/h2 为调用方预分配 scratch）。
 *  输出即归一化场（训练目标 = 教师场/峰值，scale 仅为元数据不参与运算）。 */
function expertForward(e: Expert, u: Float64Array, h: Float64Array, h2: Float64Array): number {
  const H = e.b0.length;
  for (let o = 0; o < H; o++) {
    let s = e.b0[o];
    for (let i = 0; i < 6; i++) s += e.w0[o * 6 + i] * u[i];
    h[o] = Math.sin(s);
  }
  for (let o = 0; o < H; o++) {
    let s = e.b1[o];
    for (let i = 0; i < H; i++) s += e.w1[o * H + i] * h[i];
    h2[o] = Math.sin(s);
  }
  for (let o = 0; o < H; o++) {
    let s = e.b2[o];
    for (let i = 0; i < H; i++) s += e.w2[o * H + i] * h2[i];
    h[o] = Math.sin(s);
  }
  let out = e.b3[0];
  for (let i = 0; i < H; i++) out += e.w3[i] * h[i];
  return out;
}

/**
 * 创建神经隐式场闭包（输入 = 周期-1 弧度域坐标）。
 * 混合权重 ≥ FAST_PATH_RATIO 时走单专家快路径（锚点态 HD 重建成本 ≈ 单专家）。
 */
export function createNeuralField(z: number[]): (mx: number, my: number, mz: number) => number {
  const zz = sanitizeLatent(z);
  const mix = mixtureWeights(zz);
  const u = new Float64Array(6);
  const H = experts[0].b0.length;
  const h = new Float64Array(H);
  const h2 = new Float64Array(H);
  if (mix.length !== experts.length) throw new Error('专家/锚点数量不一致');
  return (mx, my, mz) => {
    u[0] = Math.sin(mx); u[1] = Math.cos(mx);
    u[2] = Math.sin(my); u[3] = Math.cos(my);
    u[4] = Math.sin(mz); u[5] = Math.cos(mz);
    // 快路径：单专家主导
    let best = 0;
    for (let i = 1; i < mix.length; i++) if (mix[i] > mix[best]) best = i;
    if (mix[best] >= FAST_PATH_RATIO) {
      return expertForward(experts[best], u, h, h2);
    }
    let acc = 0;
    for (let i = 0; i < experts.length; i++) {
      if (mix[i] < 1e-4) continue;
      acc += mix[i] * expertForward(experts[i], u, h, h2);
    }
    return acc;
  };
}

/** 幂迭代谱范数（对称化乘幂法，50 轮足够 16×16） */
function spectralNorm(w: Float64Array, n: number, m: number): number {
  // A = W^T W (m×m)，幂迭代求 sqrt(λmax)
  const x = new Float64Array(m).fill(1 / Math.sqrt(m));
  const y = new Float64Array(n);
  let lambda = 1;
  for (let it = 0; it < 50; it++) {
    y.fill(0);
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let c = 0; c < m; c++) s += w[r * m + c] * x[c];
      y[r] = s;
    }
    x.fill(0);
    for (let r = 0; r < n; r++) {
      const yr = y[r];
      if (yr === 0) continue;
      for (let c = 0; c < m; c++) x[c] += w[r * m + c] * yr;
    }
    let norm = 0;
    for (let c = 0; c < m; c++) norm += x[c] * x[c];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) return 0;
    for (let c = 0; c < m; c++) x[c] /= norm;
    lambda = norm;
  }
  return lambda;
}

/** 专家 Lipschitz 乘积界 L = ‖W0‖·‖W1‖·‖W2‖·‖W3‖（|sin'|≤1 ⇒ 全局上界），惰性缓存 */
export function expertLipschitzBound(i: number): number {
  const e = experts[i];
  if (!e) throw new Error(`专家越界：${i}`);
  if (e.lipschitz === null) {
    const n1 = spectralNorm(e.w0, e.b0.length, 6);
    const n2 = spectralNorm(e.w1, e.b0.length, e.b0.length);
    const n3 = spectralNorm(e.w2, e.b0.length, e.b0.length);
    const n4 = spectralNorm(e.w3, 1, e.b0.length);
    e.lipschitz = n1 * n2 * n3 * n4;
  }
  return e.lipschitz;
}

/** 专家在网格上的采样梯度上界（FD，供门禁与乘积界对照） */
export function expertGradientSup(i: number, halfExtent = Math.PI, samples = 24): { sup: number; at: [number, number, number] } {
  const e = experts[i];
  const H = e.b0.length;
  const h = new Float64Array(H);
  const h2 = new Float64Array(H);
  const u = new Float64Array(6);
  const fn = (x: number, y: number, z: number) => {
    u[0] = Math.sin(x); u[1] = Math.cos(x); u[2] = Math.sin(y); u[3] = Math.cos(y); u[4] = Math.sin(z); u[5] = Math.cos(z);
    return expertForward(e, u, h, h2);
  };
  const hStep = 1e-4;
  let sup = 0;
  const at: [number, number, number] = [0, 0, 0];
  for (let iz = 0; iz < samples; iz++) {
    const z = -halfExtent + (iz / (samples - 1)) * 2 * halfExtent;
    for (let iy = 0; iy < samples; iy++) {
      const y = -halfExtent + (iy / (samples - 1)) * 2 * halfExtent;
      for (let ix = 0; ix < samples; ix++) {
        const x = -halfExtent + (ix / (samples - 1)) * 2 * halfExtent;
        const gx = (fn(x + hStep, y, z) - fn(x - hStep, y, z)) / (2 * hStep);
        const gy = (fn(x, y + hStep, z) - fn(x, y - hStep, z)) / (2 * hStep);
        const gz = (fn(x, y, z + hStep) - fn(x, y, z - hStep)) / (2 * hStep);
        const g = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (g > sup) { sup = g; at[0] = x; at[1] = y; at[2] = z; }
      }
    }
  }
  return { sup, at };
}
