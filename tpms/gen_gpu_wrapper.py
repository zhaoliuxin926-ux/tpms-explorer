# 一次性生成脚本：从 plasticity.wgsl 注入 TS 模板，保证逐字同步
import io

wgsl = io.open('tpms-platform/src/physics/shaders/plasticity.wgsl', encoding='utf-8').read()
esc = wgsl.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')

body = '''/**
 * WebGPU 弹塑性本构内核运行时（v6.0 阶段 I）
 *
 * 职责：把 shaders/plasticity.wgsl 的并行径向返回内核跑在 GPU Storage Buffer 上，
 * 输出逐 GP 的 PK2 应力 / von Mises / PEEQ，供视口应力热力图与门禁对拍。
 * 平衡方程求解仍在 CPU（gpu-plasticity-solver.ts 权威路径）——混合管线口径见 §26。
 *
 * 同源契约：PLASTICITY_WGSL_TEMPLATE 与 shaders/plasticity.wgsl 逐字一致
 * （本文件由 gen_gpu_wrapper.py 从 .wgsl 注入生成；gpu_plasticity_audit.mjs 锚定 + CPU 对拍）。
 */

export const PLASTICITY_WGSL_TEMPLATE = `__WGSL__`;

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
'''

ts = body.replace('__WGSL__', esc)
io.open('tpms-platform/src/physics/gpu-plasticity-webgpu.ts', 'w', encoding='utf-8', newline='\n').write(ts)
print('written', len(ts))
