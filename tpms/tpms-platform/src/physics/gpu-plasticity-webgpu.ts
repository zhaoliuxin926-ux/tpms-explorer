/**
 * WebGPU 弹塑性本构内核运行时（v6.0 阶段 I）
 *
 * 职责：把 shaders/plasticity.wgsl 的并行径向返回内核跑在 GPU Storage Buffer 上，
 * 输出逐 GP 的 PK2 应力 / von Mises / PEEQ，供视口应力热力图与门禁对拍。
 * 平衡方程求解仍在 CPU（gpu-plasticity-solver.ts 权威路径）——混合管线口径见 §26。
 *
 * 同源契约：PLASTICITY_WGSL_TEMPLATE 与 shaders/plasticity.wgsl 逐字一致
 * （本文件由 gen_gpu_wrapper.py 从 .wgsl 注入生成；gpu_plasticity_audit.mjs 锚定 + CPU 对拍）。
 */

export const PLASTICITY_WGSL_TEMPLATE = `// 弹塑性本构并行更新内核 —— WGSL（v6.0 阶段 I）
// 本文件是 GPU 本构内核的唯一模板源：由 gpu-plasticity-solver.ts 的同套数学
// （StVK + J2 径向返回，Prandtl-Reuss 流向）逐字镜像为 TS 内联模板
// PLASTICITY_WGSL_TEMPLATE，由 .verify/gpu_plasticity_audit.mjs 门禁做
// 逐字同步锚定 + 解析对拍（CPU 权威路径 ≤1e-12）。
//
// 算法与 CPU 权威路径同构：径向返回在【张量空间】执行——
//   1. Voigt 应力 → 张量（应力剪切不加倍！Voigt 存 σ12 本身，应变才存 γ12=2ε12）；
//   2. dev = t − tr/3；dγ = f/(3μ+H)；Δt = −3μ·dγ·dev/σv；
//   3. 张量 → Voigt 应力（剪切不加倍）；塑性应变 dεp = (3/2)·dγ·dev/σv（张量），
//      转 Voigt 工程剪切（剪切加倍）。
// 在 Voigt 空间直接做返回对剪切态方向错误（应力梯度与 dev 不平行），禁止回退。
//
// 布局：uniform（nGP、lambda、mu、sigmaY、H）+ storage（E 试探应变 in、
// Ep 旧塑性应变 in/out、PEEQ in/out、S PK2 应力 out、VM von Mises out）。
// 每 GP 一个线程：径向返回完全并行（无跨线程依赖）。

struct PlasParams {
  nGP : u32,     // Gauss 点总数
  lambda : f32,  // 拉梅第一参数
  mu : f32,      // 拉梅第二参数（剪切模量）
  sigmaY : f32,  // 屈服强度（E0=1 无量纲）
  hard : f32,    // 各向同性硬化模量 H
};

@group(0) @binding(0) var<uniform> P : PlasParams;
@group(0) @binding(1) var<storage, read>       inE    : array<f32>;  // 6×nGP 试探 GL 应变
@group(0) @binding(2) var<storage, read_write> ioEp   : array<f32>;  // 6×nGP 塑性应变
@group(0) @binding(3) var<storage, read_write> ioPeek : array<f32>;  // nGP 累计 PEEQ
@group(0) @binding(4) var<storage, read_write> outS   : array<f32>;  // 6×nGP PK2
@group(0) @binding(5) var<storage, read_write> outVM  : array<f32>;  // nGP von Mises

fn vonMises6(s0: f32, s1: f32, s2: f32, s3: f32, s4: f32, s5: f32) -> f32 {
  return sqrt(0.5 * ((s0 - s1) * (s0 - s1) + (s1 - s2) * (s1 - s2) + (s2 - s0) * (s2 - s0))
    + 3.0 * (s3 * s3 + s4 * s4 + s5 * s5));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= P.nGP) { return; }
  let b6 = i * 6u;

  // ── StVK 试探应力 S = C:(E − Ep)（Voigt 工程剪切口径）──
  let e0 = inE[b6 + 0u] - ioEp[b6 + 0u];
  let e1 = inE[b6 + 1u] - ioEp[b6 + 1u];
  let e2 = inE[b6 + 2u] - ioEp[b6 + 2u];
  let e3 = inE[b6 + 3u] - ioEp[b6 + 3u];
  let e4 = inE[b6 + 4u] - ioEp[b6 + 4u];
  let e5 = inE[b6 + 5u] - ioEp[b6 + 5u];
  let tr = e0 + e1 + e2;
  var s0 = P.lambda * tr + 2.0 * P.mu * e0;
  var s1 = P.lambda * tr + 2.0 * P.mu * e1;
  var s2 = P.lambda * tr + 2.0 * P.mu * e2;
  var s3 = P.mu * e3;
  var s4 = P.mu * e4;
  var s5 = P.mu * e5;

  let vmTrial = vonMises6(s0, s1, s2, s3, s4, s5);
  let yOld = P.sigmaY + P.hard * ioPeek[i];
  let f = vmTrial - yOld;

  if (f > 0.0) {
    // ── J2 径向返回（张量空间，与 CPU 权威路径同构）──
    // Voigt 应力 → 张量（应力剪切不减半）：t = [s0, s3, s5, s3, s1, s4, s5, s4, s2]
    let t0 = s0; let t1 = s3; let t2 = s5;
    let t3 = s3; let t4 = s1; let t5 = s4;
    let t6 = s5; let t7 = s4; let t8 = s2;
    let p3 = (t0 + t4 + t8) / 3.0;
    let d0 = t0 - p3; let d1 = t1; let d2 = t2;
    let d3 = t3; let d4 = t4 - p3; let d5 = t5;
    let d6 = t6; let d7 = t7; let d8 = t8 - p3;
    let dGamma = f / (3.0 * P.mu + P.hard);
    let kFac = -3.0 * P.mu * dGamma / vmTrial;   // Δt = −2μ·dεp = −3μ·dγ·dev/σv
    // 回到 Voigt：应力剪切不加倍；塑性应变剪切加倍（工程剪切）
    let epFac = 1.5 * dGamma / vmTrial;          // dεp = (3/2)·dγ·dev/σv（张量）
    s0 = t0 + kFac * d0;
    s1 = t4 + kFac * d4;
    s2 = t8 + kFac * d8;
    s3 = t1 + kFac * d1;                          // Voigt σ12 = 张量 t01（已按不减半口径）
    s4 = t5 + kFac * d5;                          // Voigt σ23
    s5 = t2 + kFac * d2;                          // Voigt σ13
    ioEp[b6 + 0u] = ioEp[b6 + 0u] + epFac * d0;
    ioEp[b6 + 1u] = ioEp[b6 + 1u] + epFac * d4;
    ioEp[b6 + 2u] = ioEp[b6 + 2u] + epFac * d8;
    ioEp[b6 + 3u] = ioEp[b6 + 3u] + epFac * d1 * 2.0;   // γ12 = 2·ε12
    ioEp[b6 + 4u] = ioEp[b6 + 4u] + epFac * d5 * 2.0;   // γ23
    ioEp[b6 + 5u] = ioEp[b6 + 5u] + epFac * d2 * 2.0;   // γ13
    // ε̄p_new：由 yOld 反解旧值再加增量（ioPeek 此时仍为旧值）
    ioPeek[i] = (yOld - P.sigmaY) / P.hard + dGamma;
  }
  outS[b6 + 0u] = s0; outS[b6 + 1u] = s1; outS[b6 + 2u] = s2;
  outS[b6 + 3u] = s3; outS[b6 + 4u] = s4; outS[b6 + 5u] = s5;
  outVM[i] = vonMises6(s0, s1, s2, s3, s4, s5);
}
`;

export interface PlasGpuParams {
  lambda: number;
  mu: number;
  sigmaY: number;
  hard: number;
}

export interface PlasGpuResult {
  stress: Float32Array;  // 6×nGP PK2
  vm: Float32Array;      // nGP von Mises
  peeq: Float32Array;    // nGP 累计等效塑性应变
  ep: Float32Array;      // 6×nGP 塑性应变
}

export function plasticityGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as { gpu?: unknown }).gpu;
}

/** 单次本构内核 dispatch（nGP 个 Gauss 点并行径向返回） */
export async function runPlasticityConstitutiveGPU(
  strain: Float32Array,       // 6×nGP 试探 GL 应变（Voigt 工程剪切）
  ep: Float32Array,           // 6×nGP 塑性应变（in/out）
  peeq: Float32Array,         // nGP（in/out）
  params: PlasGpuParams,
): Promise<PlasGpuResult> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter() : null;
  if (!adapter) throw new Error('WebGPU：无可用 adapter');
  const device = await (adapter as { requestDevice(): Promise<any> }).requestDevice();
  const nGP = peeq.length;
  const module: any = device.createShaderModule({ code: PLASTICITY_WGSL_TEMPLATE });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } } as any);
  const GPUBufferUsage_: Record<string, number> = { STORAGE: 0x80, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, MAP_READ: 0x1 };
  const GPUMapMode_: Record<string, number> = { READ: 1 };
  void GPUBufferUsage_; void GPUMapMode_;
  const mkBuf = (arr: Float32Array | ArrayBuffer, usage: any, byteLen?: number) => {
    const len = byteLen ?? (arr instanceof ArrayBuffer ? arr.byteLength : arr.byteLength);
    const b = device.createBuffer({ size: Math.max(16, len), usage });
    if (!(arr instanceof ArrayBuffer)) device.queue.writeBuffer(b, 0, arr);
    else device.queue.writeBuffer(b, 0, arr);
    return b;
  };
  const GpuU = GPUBufferUsage_; const GpuM = GPUMapMode_;
  const STOR = GpuU.STORAGE | GpuU.COPY_SRC;
  const uParams = new ArrayBuffer(32);
  const u32 = new Uint32Array(uParams);
  const f32 = new Float32Array(uParams);
  u32[0] = nGP;
  f32[1] = params.lambda;
  f32[2] = params.mu;
  f32[3] = params.sigmaY;
  f32[4] = params.hard;
  const bU = mkBuf(uParams, GpuU.UNIFORM | GpuU.COPY_DST);
  const bE = mkBuf(strain, STOR);
  const bEp = mkBuf(ep, STOR);
  const bPeek = mkBuf(peeq, STOR);
  const bS = device.createBuffer({ size: Math.max(16, strain.byteLength), usage: STOR });
  const bVM = device.createBuffer({ size: Math.max(16, peeq.byteLength), usage: STOR });
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bU } },
      { binding: 1, resource: { buffer: bE } },
      { binding: 2, resource: { buffer: bEp } },
      { binding: 3, resource: { buffer: bPeek } },
      { binding: 4, resource: { buffer: bS } },
      { binding: 5, resource: { buffer: bVM } },
    ],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(Math.ceil(nGP / 64));
  pass.end();

  const readBack = (src: any, size: number) => {
    const tmp = device.createBuffer({ size: Math.max(16, size), usage: GpuU.COPY_DST | GpuU.MAP_READ });
    enc.copyBufferToBuffer(src, 0, tmp, 0, size);
    return tmp;
  };
  const tS = readBack(bS, nGP * 6 * 4);
  const tVM = readBack(bVM, nGP * 4);
  const tEp = readBack(bEp, nGP * 6 * 4);
  const tPeek = readBack(bPeek, nGP * 4);
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();

  const stress = new Float32Array(nGP * 6);
  const vm = new Float32Array(nGP);
  const epOut = new Float32Array(nGP * 6);
  const peeqOut = new Float32Array(nGP);
  const drain = async (tmp: any, out: Float32Array) => {
    await tmp.mapAsync(GpuM.READ);
    out.set(new Float32Array(tmp.getMappedRange().slice(0) as ArrayBuffer));
    tmp.unmap();
    tmp.destroy();
  };
  await drain(tS, stress);
  await drain(tVM, vm);
  await drain(tEp, epOut);
  await drain(tPeek, peeqOut);
  for (const b of [bU, bE, bEp, bPeek, bS, bVM]) b.destroy();
  device.destroy();
  return { stress, vm, peeq: peeqOut, ep: epOut };
}

/**
 * 逐单元标量场 → 表面顶点色（最近体素采样，Cool-Warm 谱）。
 * positions 为 Surface Nets 物理域 [-1,1]；体素中心域映射 ix = clamp(floor((px+1)/2·R))。
 * sampleInto 传 sampleCoolWarmInto（geometry/vertex-coloring 同源）。
 */
export function mapElementFieldToVertexColors(
  positions: Float32Array,
  R: number,
  field: Float32Array,        // R³ 逐单元标量
  vmin: number,
  vmax: number,
  sampleInto: (s: number, colors: Float32Array, i3: number) => void,
): Float32Array {
  const nVert = positions.length / 3;
  const colors = new Float32Array(nVert * 3);
  const span = vmax > vmin ? vmax - vmin : 1;
  for (let v = 0; v < nVert; v++) {
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const ix = Math.min(R - 1, Math.max(0, Math.floor(((px + 1) / 2) * R)));
    const iy = Math.min(R - 1, Math.max(0, Math.floor(((py + 1) / 2) * R)));
    const iz = Math.min(R - 1, Math.max(0, Math.floor(((pz + 1) / 2) * R)));
    const val = field[ix + iy * R + iz * R * R];
    sampleInto((val - vmin) / span, colors, v * 3);
  }
  return colors;
}
