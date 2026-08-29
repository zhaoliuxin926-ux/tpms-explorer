/**
 * gen_neural_weights.mjs —— Stage I SIREN 蒸馏权重生成器（离线一次性工具，非 CI 门禁）
 *
 * 用 Adam 将 4 层正弦激活隐式场（Fourier 特征输入 + 3 隐层 sin + 线性输出）蒸馏到
 * 5 个 TPMS 教师场（gyroid / diamond / lidinoid / schwarz / 分形骨小梁=分级 gyroid），
 * 权重量化后写入 src/core/neural-implicit-weights.ts。
 *
 * 架构要点（与 neural-implicit-field.ts 严格同构）：
 *   输入特征 u = [sin x, cos x, sin y, cos y, sin z, cos z]（精确 2π 周期 ⇒ 网格跨周期水密由构造保证）
 *   h0 = sin(W0 u + b0)；h1 = sin(W1 h0 + b1)；h2 = sin(W2 h1 + b2)；F = (W3·h2 + b3)/scale
 *
 * 复现：node .verify/gen_neural_weights.mjs（H=16, 12³ 教师网格, Adam 4000 步）
 * 产物提交入库（预置蒸馏权重），CI 门禁 32 只消费权重不重训。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = join(HERE, '../tpms-platform');

// ── 打包 tpms-functions（教师场单一语义源，与平台渲染/导出同源）──
const BUNDLE = join(tmpdir(), 'tpms_gen_neural_teacher.mjs');
{
  const entry = join(tmpdir(), 'tpms_gen_neural_entry.ts');
  writeFileSync(entry, [
    `export { TPMS_FUNCTIONS } from ${JSON.stringify(join(PLATFORM, 'src/core/tpms-functions.ts'))};`,
  ].join('\n'));
  const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown.cmd');
  const r = spawnSync(`"${rolldown}" "${entry}" --format esm --file "${BUNDLE}"`, { shell: true, encoding: 'utf8' });
  if (r.status !== 0) { console.error('rolldown 打包失败:', r.stdout, r.stderr); process.exit(1); }
}
const { TPMS_FUNCTIONS } = await import(pathToFileURL(BUNDLE));

// ── 超参数 ──
const H = 16;               // 隐层宽度
const GRID = 12;            // 教师网格 12³
const ITERS = 4000;
const BATCH = 512;
const LR = 3e-3;
const SEED = 20260829;
const MICRO = 0.35;         // 分形骨小梁教师：gyroid + 0.35·gyroid(3x)

let s = SEED >>> 0;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const rndn = () => rnd() * 2 - 1;

// ── 教师场（弧度域 [-π,π]³，归一化到峰值 1）──
function teacherValues(kind) {
  const vals = new Float64Array(GRID ** 3);
  let maxAbs = 0;
  let idx = 0;
  for (let iz = 0; iz < GRID; iz++) {
    const z = -Math.PI + (iz / (GRID - 1)) * 2 * Math.PI;
    for (let iy = 0; iy < GRID; iy++) {
      const y = -Math.PI + (iy / (GRID - 1)) * 2 * Math.PI;
      for (let ix = 0; ix < GRID; ix++) {
        const x = -Math.PI + (ix / (GRID - 1)) * 2 * Math.PI;
        let v;
        if (kind === 'trabecular') {
          v = TPMS_FUNCTIONS.gyroid(x, y, z, [1, 1, 1, 0]) + MICRO * TPMS_FUNCTIONS.gyroid(3 * x, 3 * y, 3 * z, [1, 1, 1, 0]);
        } else {
          const w = kind === 'diamond' ? [1, 1, 1, 1] : kind === 'lidinoid' ? [1, 1, 0, 0] : [1, 1, 1, 0];
          v = TPMS_FUNCTIONS[kind](x, y, z, w);
        }
        vals[idx++] = v;
        if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
      }
    }
  }
  for (let i = 0; i < vals.length; i++) vals[i] /= maxAbs;
  return { vals, scale: maxAbs };
}

// ── 网络前向（训练用 Float64；评估/运行时同构实现见 neural-implicit-field.ts）──
function initNet() {
  const scale0 = Math.sqrt(6 / 6);   // Fourier 特征已是 O(1) 频率，ω0=1
  const scaleH = Math.sqrt(6 / H);
  const mk = (nIn, nOut, sc) => {
    const w = new Float64Array(nIn * nOut);
    for (let i = 0; i < w.length; i++) w[i] = rndn() * sc;
    return { w, b: new Float64Array(nOut), nIn, nOut };
  };
  return { L0: mk(6, H, scale0), L1: mk(H, H, scaleH), L2: mk(H, H, scaleH), L3: mk(H, 1, scaleH) };
}

function forward(net, u, cache) {
  const { L0, L1, L2, L3 } = net;
  const h0 = cache.h0, h1 = cache.h1, h2 = cache.h2;
  for (let o = 0; o < H; o++) {
    let sv = L0.b[o];
    for (let i = 0; i < 6; i++) sv += L0.w[o * 6 + i] * u[i];
    h0[o] = Math.sin(sv);
    // 缓存 cos 供反向（sin 的导数）
    cache.c0[o] = Math.cos(sv);
  }
  for (let o = 0; o < H; o++) {
    let sv = L1.b[o];
    for (let i = 0; i < H; i++) sv += L1.w[o * H + i] * h0[i];
    h1[o] = Math.sin(sv);
    cache.c1[o] = Math.cos(sv);
  }
  for (let o = 0; o < H; o++) {
    let sv = L2.b[o];
    for (let i = 0; i < H; i++) sv += L2.w[o * H + i] * h1[i];
    h2[o] = Math.sin(sv);
    cache.c2[o] = Math.cos(sv);
  }
  let out = L3.b[0];
  for (let i = 0; i < H; i++) out += L3.w[i] * h2[i];
  return out;
}

/** Adam 训练一个专家，返回 {net, rmse} */
function distill(kind) {
  const { vals, scale } = teacherValues(kind);
  const net = initNet();
  const g = {
    L0: { w: new Float64Array(net.L0.w.length), b: new Float64Array(H) },
    L1: { w: new Float64Array(net.L1.w.length), b: new Float64Array(H) },
    L2: { w: new Float64Array(net.L2.w.length), b: new Float64Array(H) },
    L3: { w: new Float64Array(H), b: new Float64Array(1) },
  };
  const copyG = (src) => {
    const dst = {};
    for (const key of Object.keys(src)) dst[key] = { w: new Float64Array(src[key].w), b: new Float64Array(src[key].b) };
    return dst;
  };
  const m = copyG(g);
  const v = copyG(g);
  const cache = { h0: new Float64Array(H), h1: new Float64Array(H), h2: new Float64Array(H), c0: new Float64Array(H), c1: new Float64Array(H), c2: new Float64Array(H) };
  const u = new Float64Array(6);
  const dB = { h2: new Float64Array(H), h1: new Float64Array(H), h0: new Float64Array(H) };
  let t = 0;
  for (let it = 0; it < ITERS; it++) {
    for (const key of Object.keys(g)) { g[key].w.fill(0); g[key].b.fill(0); }
    let loss = 0;
    for (let bi = 0; bi < BATCH; bi++) {
      // 随机采教师网格点（坐标由索引反推，保证与评估网格一致分布）
      const gi = Math.floor(rnd() * vals.length);
      const ix = gi % GRID, iy = Math.floor(gi / GRID) % GRID, iz = Math.floor(gi / (GRID * GRID));
      const x = -Math.PI + (ix / (GRID - 1)) * 2 * Math.PI;
      const y = -Math.PI + (iy / (GRID - 1)) * 2 * Math.PI;
      const z = -Math.PI + (iz / (GRID - 1)) * 2 * Math.PI;
      u[0] = Math.sin(x); u[1] = Math.cos(x); u[2] = Math.sin(y); u[3] = Math.cos(y); u[4] = Math.sin(z); u[5] = Math.cos(z);
      const pred = forward(net, u, cache);
      const err = pred - vals[gi];
      loss += err * err;
      // 反向（dB 逐样本清零：h1/h0 槽位是跨样本累加器）
      dB.h2.fill(0); dB.h1.fill(0); dB.h0.fill(0);
      const dOut = 2 * err / BATCH;
      for (let i = 0; i < H; i++) {
        g.L3.w[i] += dOut * cache.h2[i];
        dB.h2[i] = dOut * net.L3.w[i] * cache.c2[i];
      }
      g.L3.b[0] += dOut;
      for (let o = 0; o < H; o++) {
        const d = dB.h2[o];
        for (let i = 0; i < H; i++) {
          g.L2.w[o * H + i] += d * cache.h1[i];
          dB.h1[i] += d * net.L2.w[o * H + i] * cache.c1[i];
        }
        g.L2.b[o] += d;
      }
      for (let o = 0; o < H; o++) {
        const d = dB.h1[o];
        for (let i = 0; i < H; i++) {
          g.L1.w[o * H + i] += d * cache.h0[i];
          dB.h0[i] += d * net.L1.w[o * H + i] * cache.c0[i];
        }
        g.L1.b[o] += d;
      }
      for (let o = 0; o < H; o++) {
        const d = dB.h0[o];
        for (let i = 0; i < 6; i++) g.L0.w[o * 6 + i] += d * u[i];
        g.L0.b[o] += d;
      }
    }
    // Adam 更新
    t++;
    const lr = it < ITERS * 0.6 ? LR : it < ITERS * 0.85 ? LR * 0.3 : LR * 0.1;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    const upd = (param, grad, mKey) => {
      const pw = param.w, gw = g[mKey].w, mw = m[mKey].w, vw = v[mKey].w;
      for (let i = 0; i < pw.length; i++) {
        const mm = b1 * mw[i] + (1 - b1) * gw[i];
        const vv = b2 * vw[i] + (1 - b2) * gw[i] * gw[i];
        mw[i] = mm; vw[i] = vv;
        const mh = mm / (1 - Math.pow(b1, t));
        const vh = vv / (1 - Math.pow(b2, t));
        pw[i] -= lr * mh / (Math.sqrt(vh) + eps);
      }
      const pb = param.b, gb = g[mKey].b, mb = m[mKey].b, vb = v[mKey].b;
      for (let i = 0; i < pb.length; i++) {
        const mm = b1 * mb[i] + (1 - b1) * gb[i];
        const vv = b2 * vb[i] + (1 - b2) * gb[i] * gb[i];
        mb[i] = mm; vb[i] = vv;
        const mh = mm / (1 - Math.pow(b1, t));
        const vh = vv / (1 - Math.pow(b2, t));
        pb[i] -= lr * mh / (Math.sqrt(vh) + eps);
      }
    };
    upd(net.L0, g, 'L0'); upd(net.L1, g, 'L1'); upd(net.L2, g, 'L2'); upd(net.L3, g, 'L3');
    if ((it + 1) % 800 === 0) {
      // 全网格 RMSE
      let se = 0, cnt = 0;
      for (let iz = 0; iz < GRID; iz++) for (let iy = 0; iy < GRID; iy++) for (let ix = 0; ix < GRID; ix++) {
        const x = -Math.PI + (ix / (GRID - 1)) * 2 * Math.PI;
        const y = -Math.PI + (iy / (GRID - 1)) * 2 * Math.PI;
        const z = -Math.PI + (iz / (GRID - 1)) * 2 * Math.PI;
        u[0] = Math.sin(x); u[1] = Math.cos(x); u[2] = Math.sin(y); u[3] = Math.cos(y); u[4] = Math.sin(z); u[5] = Math.cos(z);
        const pred = forward(net, u, cache);
        const tv = vals[ix + iy * GRID + iz * GRID * GRID];
        se += (pred - tv) ** 2; cnt++;
      }
      console.log(`  [${kind}] iter ${it + 1}/${ITERS} rmse=${Math.sqrt(se / cnt).toFixed(4)} batchLoss=${(loss / BATCH).toExponential(2)}`);
    }
  }
  // 终评（16³ 细网格，含非训练点插值检验）
  let se = 0, cnt = 0, maxAbsPred = 0;
  const GE = 16;
  for (let iz = 0; iz < GE; iz++) for (let iy = 0; iy < GE; iy++) for (let ix = 0; ix < GE; ix++) {
    const x = -Math.PI + (ix / (GE - 1)) * 2 * Math.PI;
    const y = -Math.PI + (iy / (GE - 1)) * 2 * Math.PI;
    const z = -Math.PI + (iz / (GE - 1)) * 2 * Math.PI;
    u[0] = Math.sin(x); u[1] = Math.cos(x); u[2] = Math.sin(y); u[3] = Math.cos(y); u[4] = Math.sin(z); u[5] = Math.cos(z);
    const pred = forward(net, u, cache);
    let tv;
    if (kind === 'trabecular') {
      tv = TPMS_FUNCTIONS.gyroid(x, y, z, [1, 1, 1, 0]) + MICRO * TPMS_FUNCTIONS.gyroid(3 * x, 3 * y, 3 * z, [1, 1, 1, 0]);
    } else {
      const w = kind === 'diamond' ? [1, 1, 1, 1] : kind === 'lidinoid' ? [1, 1, 0, 0] : [1, 1, 1, 0];
      tv = TPMS_FUNCTIONS[kind](x, y, z, w);
    }
    tv /= scale;
    se += (pred - tv) ** 2; cnt++;
    if (Math.abs(pred) > maxAbsPred) maxAbsPred = Math.abs(pred);
  }
  const rmse = Math.sqrt(se / cnt);
  console.log(`  [${kind}] FINAL rmse(16³)=${rmse.toFixed(4)} scale=${scale.toFixed(3)} peak=${maxAbsPred.toFixed(3)}`);
  return { net, rmse, scale };
}

// ── 主流程 ──
const KINDS = ['gyroid', 'diamond', 'lidinoid', 'schwarz', 'trabecular'];
const results = [];
for (const kind of KINDS) {
  console.log(`蒸馏 ${kind} ...`);
  results.push({ kind, ...distill(kind) });
}

// ── 量化并生成 TS ──
const q = (x) => {
  if (!Number.isFinite(x)) throw new Error('非有限权重');
  return Number(x.toPrecision(7));
};
const arr = (a, indent) => {
  const items = Array.from(a, q);
  const lines = [];
  for (let i = 0; i < items.length; i += 6) lines.push(indent + items.slice(i, i + 6).join(', ') + ',');
  return lines.join('\n');
};

let out = `/**
 * neural-implicit-weights.ts —— Stage I SIREN 蒸馏权重（由 .verify/gen_neural_weights.mjs 生成，勿手改）
 *
 * 5 个拓扑专家（gyroid / diamond / lidinoid / schwarz / trabecular 分形骨小梁），
 * 架构与 neural-implicit-field.ts 严格同构：Fourier 特征输入 → 3 隐层 sin → 线性输出，
 * 输出已按 scale 归一化（峰值 ±1 口径）。NEURAL_ANCHORS 为 8 维潜在空间锚点
 * （8 维 ±3 Walsh 型码字，两两汉明距离 4 ⇒ 锚点间 softmax 交叉权重 ~e^-18）。
 *
 * 蒸馏超参数：H=${H} · 教师网格 ${GRID}³ · Adam ${ITERS} 步 · batch ${BATCH} · seed ${SEED}
 * 终评 RMSE(16³)：${results.map((r) => `${r.kind} ${r.rmse.toFixed(4)}`).join(' · ')}
 */

`;

out += `export interface NeuralExpertWeights {
  name: string;
  w0: number[]; b0: number[];
  w1: number[]; b1: number[];
  w2: number[]; b2: number[];
  w3: number[]; b3: number[];
  /** 教师场峰值归一化尺度（弧度域教师 → 峰值 ±1） */
  scale: number;
}

export const NEURAL_LATENT_DIM = 8;
export const NEURAL_EXPERT_NAMES = [${KINDS.map((k) => `'${k}'`).join(', ')}] as const;

/** 8 维潜在锚点（行 = 专家序）：±3 Walsh 码字（8 阶 Hadamard 前 5 行，两两汉明距离 4 ⇒ 锚点间 softmax 交叉权重 ~e^-72） */
export const NEURAL_ANCHORS: number[][] = [
${results.map((_, i) => {
  const code = [];
  for (let j = 0; j < 8; j++) {
    let pc = 0; let xx = i & j; while (xx) { pc += xx & 1; xx >>= 1; }
    code.push(pc % 2 === 0 ? 3 : -3);
  }
  return `  [${code.join(', ')}],`;
}).join('\n')}
];

export const NEURAL_EXPERT_WEIGHTS: NeuralExpertWeights[] = [
`;
for (const r of results) {
  out += `  {\n    name: '${r.kind}',\n`;
  out += `    w0: [\n${arr(r.net.L0.w, '      ')}\n    ],\n`;
  out += `    b0: [${Array.from(r.net.L0.b, q).join(', ')}],\n`;
  out += `    w1: [\n${arr(r.net.L1.w, '      ')}\n    ],\n`;
  out += `    b1: [${Array.from(r.net.L1.b, q).join(', ')}],\n`;
  out += `    w2: [\n${arr(r.net.L2.w, '      ')}\n    ],\n`;
  out += `    b2: [${Array.from(r.net.L2.b, q).join(', ')}],\n`;
  out += `    w3: [${Array.from(r.net.L3.w, q).join(', ')}],\n`;
  out += `    b3: [${q(r.net.L3.b[0])}],\n`;
  out += `    scale: ${q(r.scale)},\n  },\n`;
}
out += `];\n`;
writeFileSync(join(PLATFORM, 'src/core/neural-implicit-weights.ts'), out);
console.log(`\n已写入 ${join(PLATFORM, 'src/core/neural-implicit-weights.ts')}`);
console.log(`RMSE 汇总: ${results.map((r) => `${r.kind}=${r.rmse.toFixed(4)}`).join(' ')}`);
