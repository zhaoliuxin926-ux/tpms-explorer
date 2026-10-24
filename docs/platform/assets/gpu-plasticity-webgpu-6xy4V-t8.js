var e=`// 弹塑性本构并行更新内核 —— WGSL（v6.0 阶段 I）
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
`;function t(){return typeof navigator<`u`&&!!navigator.gpu}async function n(t,n,r,i){let a=navigator.gpu,o=a?await a.requestAdapter():null;if(!o)throw Error(`WebGPU：无可用 adapter`);let s=await o.requestDevice(),c=r.length,l=s.createShaderModule({code:e}),u=s.createComputePipeline({layout:`auto`,compute:{module:l,entryPoint:`main`}}),d={STORAGE:128,COPY_SRC:4,COPY_DST:8,UNIFORM:64,MAP_READ:1},f={READ:1},p=(e,t,n)=>{let r=n??(e instanceof ArrayBuffer,e.byteLength),i=s.createBuffer({size:Math.max(16,r),usage:t});return e instanceof ArrayBuffer,s.queue.writeBuffer(i,0,e),i},m=d,h=f,g=m.STORAGE|m.COPY_SRC,_=new ArrayBuffer(32),v=new Uint32Array(_),y=new Float32Array(_);v[0]=c,y[1]=i.lambda,y[2]=i.mu,y[3]=i.sigmaY,y[4]=i.hard;let b=p(_,m.UNIFORM|m.COPY_DST),x=p(t,g),S=p(n,g),C=p(r,g),w=s.createBuffer({size:Math.max(16,t.byteLength),usage:g}),T=s.createBuffer({size:Math.max(16,r.byteLength),usage:g}),E=s.createBindGroup({layout:u.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b}},{binding:1,resource:{buffer:x}},{binding:2,resource:{buffer:S}},{binding:3,resource:{buffer:C}},{binding:4,resource:{buffer:w}},{binding:5,resource:{buffer:T}}]}),D=s.createCommandEncoder(),O=D.beginComputePass();O.setPipeline(u),O.setBindGroup(0,E),O.dispatchWorkgroups(Math.ceil(c/64)),O.end();let k=(e,t)=>{let n=s.createBuffer({size:Math.max(16,t),usage:m.COPY_DST|m.MAP_READ});return D.copyBufferToBuffer(e,0,n,0,t),n},A=k(w,c*6*4),j=k(T,c*4),M=k(S,c*6*4),N=k(C,c*4);s.queue.submit([D.finish()]),await s.queue.onSubmittedWorkDone();let P=new Float32Array(c*6),F=new Float32Array(c),I=new Float32Array(c*6),L=new Float32Array(c),R=async(e,t)=>{await e.mapAsync(h.READ),t.set(new Float32Array(e.getMappedRange().slice(0))),e.unmap(),e.destroy()};await R(A,P),await R(j,F),await R(M,I),await R(N,L);for(let e of[b,x,S,C,w,T])e.destroy();return s.destroy(),{stress:P,vm:F,peeq:L,ep:I}}function r(e,t,n,r,i,a){let o=e.length/3,s=new Float32Array(o*3),c=i>r?i-r:1;for(let i=0;i<o;i++){let o=e[i*3],l=e[i*3+1],u=e[i*3+2],d=Math.min(t-1,Math.max(0,Math.floor((o+1)/2*t))),f=Math.min(t-1,Math.max(0,Math.floor((l+1)/2*t))),p=Math.min(t-1,Math.max(0,Math.floor((u+1)/2*t))),m=n[d+f*t+p*t*t];a((m-r)/c,s,i*3)}return s}export{e as PLASTICITY_WGSL_TEMPLATE,r as mapElementFieldToVertexColors,t as plasticityGpuAvailable,n as runPlasticityConstitutiveGPU};
//# sourceMappingURL=gpu-plasticity-webgpu-6xy4V-t8.js.map