// TPMS 体素场并行求值内核 —— WGSL 模板（v3.0 阶段 I）
// 本文件是 compute shader 的唯一模板源：占位符（下方双花括号标记）由
// webgpu-evaluator.ts 的标量指令 IR 在每次构建时填充（8 类内置 TPMS /
// AST 自定义方程 / 四向波前 Hybrid 统一编译）。禁止手改生成后的内核
// 文本——数学语义源在指令 IR，由 .verify/webgpu_parity_audit.mjs 门禁
// 对拍 CPU 权威路径（≤1e-6 / 10,000 格点），并逐字锚定本文件与 TS 内联模板同步。
//
// 布局：uniform（N, R, k, pad）+ storage read_write（V 场，N³ = (R+1)³ f32）。
// 网格节点语义与 CPU 管线完全一致：ix∈[0,R]，mx = (-π + ix/R·2π)·k（弧度域），
// px = ix/R·2-1（物理域），输出索引 ix + iy·N + iz·N²。

struct EvalParams {
  n : u32,      // N = R+1（节点数/轴，含两端）
  res : f32,    // R（分辨率/轴）
  kk : f32,     // 周期数（频率倍率）
  pad : u32,
};
@group(0) @binding(0) var<uniform> P : EvalParams;
@group(0) @binding(1) var<storage, read_write> outV : array<f32>;

{{FIELD_FN}}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  let n = P.n;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let mx = (-1.5707963267948966 + f32(gid.x) / P.res * 6.283185307179586) * P.kk;
  let my = (-1.5707963267948966 + f32(gid.y) / P.res * 6.283185307179586) * P.kk;
  let mz = (-1.5707963267948966 + f32(gid.z) / P.res * 6.283185307179586) * P.kk;
  let px = (f32(gid.x) / P.res) * 2.0 - 1.0;
  let py = (f32(gid.y) / P.res) * 2.0 - 1.0;
  let pz = (f32(gid.z) / P.res) * 2.0 - 1.0;
  outV[gid.x + gid.y * n + gid.z * n * n] = fieldFn(mx, my, mz, px, py, pz);
}
