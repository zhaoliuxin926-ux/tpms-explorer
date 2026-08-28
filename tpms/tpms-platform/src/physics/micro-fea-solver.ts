/**
 * 浏览器端微观力学 FEA 均质化求解器（v5.0 阶段 I · Micro-FEA J-PCG）
 *
 * 公式：波动场（fluctuation）均质化。u(x) = ε̄·x + ũ(x)：
 *   · 固相体素独占积分（孔隙体素不参与刚度——从公式层面根除 v2.4 档案的
 *     「voidK 高对比舍入崩溃」杀手）；
 *   · KUBC 均匀位移边界（边界节点按 ε̄·x 全量 prescribed——任务宪章明示的
 *     合法边界族）：内域缩减系统 SPD（刚体模态被边界全约束根除），
 *     不存在「应变均值钉扎退化」；
 *   · 均质应力 σ̄ = (1/V)·Σ_固相 ∫σ dV（体积平均应变，系数 = ±1/4）。
 *
 * 求解：无矩阵（Matrix-Free）Jacobi 预条件共轭梯度；6 组单位应变工况逐个 PCG。
 * 单元：8 节点六面体等参 C3D8，2×2×2 完全积分（无沙漏）；全部体素几何相同
 * ⇒ 24×24 单元核只计算一次。归一化：E0=1、h=1（C 乘真实 E0 与尺度换算）。
 */

export interface MicroFEAParams {
  R: number;                 // 体素分辨率/轴（体素网格 R³，节点 (R+1)³）
  solid: Uint8Array;         // R³，1 = 固相体素
  nu?: number;               // 基体泊松比（默认 0.2）
  tol?: number;              // PCG 相对残差阈（默认 1e-7）
  maxIter?: number;          // 每工况最大迭代数（默认 400）
}

export interface MicroFEAResult {
  C: number[][];             // 6×6 Voigt（归一化 E0=1，h=1）
  symmetryErr: number;       // max|Cij−Cji| / max|Cij|
  zenerRatio: number;        // 2·C44/(C11−C12)
  E11: number;               // 等效杨氏模量（立方近似解析）
  iters: number[];
  residuals: number[];
  elapsedMs: number;
  solidVoxels: number;
  converged: boolean;
}

const NODE_XI = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];

/** 8 节点六面体 24×24 单元刚度核（2×2×2 Gauss，各向同性 E=1, ν） */
export function buildElementKe(nu: number): Float64Array {
  const KE = new Float64Array(24 * 24);
  const lambda = nu / ((1 + nu) * (1 - 2 * nu));
  const mu = 1 / (2 * (1 + nu));
  const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const B = new Float64Array(6 * 24);
  for (const gxi of gp) {
    for (const gyi of gp) {
      for (const gzi of gp) {
        B.fill(0);
        for (let a = 0; a < 8; a++) {
          const [xi, eta, zeta] = NODE_XI[a];
          const dNxdx = 0.5 * xi * (1 + gyi * eta) * (1 + gzi * zeta);
          const dNydy = 0.5 * eta * (1 + gxi * xi) * (1 + gzi * zeta);
          const dNzdz = 0.5 * zeta * (1 + gxi * xi) * (1 + gyi * eta);
          const dNxdy = 0.5 * xi * eta * (1 + gzi * zeta);
          const dNxdz = 0.5 * xi * zeta * (1 + gyi * eta);
          const dNydx = 0.5 * eta * xi * (1 + gzi * zeta);
          const dNydz = 0.5 * eta * zeta * (1 + gxi * xi);
          const dNzdx = 0.5 * zeta * xi * (1 + gyi * eta);
          const dNzdy = 0.5 * zeta * eta * (1 + gxi * xi);
          const i0 = a * 3;
          B[0 * 24 + i0] = dNxdx;
          B[1 * 24 + i0 + 1] = dNydy;
          B[2 * 24 + i0 + 2] = dNzdz;
          B[3 * 24 + i0] = dNxdy; B[3 * 24 + i0 + 1] = dNydx;
          B[4 * 24 + i0 + 1] = dNydz; B[4 * 24 + i0 + 2] = dNzdy;
          B[5 * 24 + i0] = dNxdz; B[5 * 24 + i0 + 2] = dNzdx;
        }
        // Ke = Bᵀ·C·B（C 为 Voigt 6×6：对角法向 λ+2μ、法向互 λ、剪切 μ）
        for (let i = 0; i < 24; i++) {
          for (let j = 0; j < 24; j++) {
            let s0 = 0;
            for (let p = 0; p < 6; p++) {
              const bp = B[p * 24 + i];
              if (bp === 0) continue;
              for (let q = 0; q < 6; q++) {
                let c: number;
                if (p === q) c = p < 3 ? lambda + 2 * mu : mu;
                else if (p < 3 && q < 3) c = lambda;
                else c = 0;
                s0 += bp * c * B[q * 24 + j];
              }
            }
            KE[i * 24 + j] += s0;
          }
        }
      }
    }
  }
  return KE;
}

export function solveMicroFEA(params: MicroFEAParams): MicroFEAResult {
  const t0 = performance.now();
  const R = params.R;
  const nu = params.nu ?? 0.2;
  const tol = params.tol ?? 1e-7;
  const maxIter = params.maxIter ?? 400;
  const solid = params.solid;
  const N1 = R + 1;
  const nNodes = N1 * N1 * N1;
  const nDof = nNodes * 3;

  const solidVoxels: number[] = [];
  for (let i = 0; i < R * R * R; i++) if (solid[i]) solidVoxels.push(i);
  if (solidVoxels.length === 0) throw new Error('微观 FEA：固相体素为空');
  const nSolid = solidVoxels.length;

  const Ke = buildElementKe(nu);

  // 连通性守卫：固相必须与边界连通（孤立岛 ⇒ K_ff 奇异 ⇒ PCG 无意义）。
  // 6 连通 BFS 从边界接触的固相体素出发。
  {
    const seen = new Uint8Array(R * R * R);
    const queue = new Int32Array(R * R * R);
    let head = 0, tail = 0;
    const push = (v: number) => { if (!seen[v] && solid[v]) { seen[v] = 1; queue[tail++] = v; } };
    for (let iz = 0; iz < R; iz++) for (let iy = 0; iy < R; iy++) for (let ix = 0; ix < R; ix++) {
      if (ix === 0 || ix === R - 1 || iy === 0 || iy === R - 1 || iz === 0 || iz === R - 1) push(ix + iy * R + iz * R * R);
    }
    while (head < tail) {
      const v = queue[head++];
      const vx = v % R, vy = ((v / R) | 0) % R, vz = (v / (R * R)) | 0;
      if (vx > 0) push(v - 1);
      if (vx < R - 1) push(v + 1);
      if (vy > 0) push(v - R);
      if (vy < R - 1) push(v + R);
      if (vz > 0) push(v - R * R);
      if (vz < R - 1) push(v + R * R);
    }
    let island = 0;
    for (let i = 0; i < R * R * R; i++) if (solid[i] && !seen[i]) island++;
    if (island > 0) throw new Error('微观 FEA：固相含 ' + island + ' 个不与边界连通的孤立体素（K 奇异），请调整阈值或孔隙率');
  }

  const isBoundary = new Uint8Array(nNodes);
  for (let iz = 0; iz < N1; iz++) {
    for (let iy = 0; iy < N1; iy++) {
      for (let ix = 0; ix < N1; ix++) {
        if (ix === 0 || ix === R || iy === 0 || iy === R || iz === 0 || iz === R) {
          isBoundary[ix + iy * N1 + iz * N1 * N1] = 1;
        }
      }
    }
  }

  // 仿射位移场（6 工况）
  const U0 = new Float64Array(6 * nDof);
  for (let iz = 0; iz < N1; iz++) {
    for (let iy = 0; iy < N1; iy++) {
      for (let ix = 0; ix < N1; ix++) {
        const nd = ix + iy * N1 + iz * N1 * N1;
        U0[0 * nDof + nd * 3] = ix;
        U0[1 * nDof + nd * 3 + 1] = iy;
        U0[2 * nDof + nd * 3 + 2] = iz;
        U0[3 * nDof + nd * 3] = iy;
        U0[4 * nDof + nd * 3 + 1] = iz;
        U0[5 * nDof + nd * 3 + 2] = ix;
      }
    }
  }

  // 固相体素节点列表（热循环零分配）
  const voxelNodeList = new Int32Array(nSolid * 8);
  const nodes = new Int32Array(8);
  for (let s = 0; s < nSolid; s++) {
    const vi = solidVoxels[s];
    const iz = (vi / (R * R)) | 0;
    const iy = ((vi % (R * R)) / R) | 0;
    const ix = vi % R;
    const n = (x: number, y: number, z: number) => x + y * N1 + z * N1 * N1;
    nodes[0] = n(ix, iy, iz); nodes[1] = n(ix + 1, iy, iz); nodes[2] = n(ix + 1, iy + 1, iz); nodes[3] = n(ix, iy + 1, iz);
    nodes[4] = n(ix, iy, iz + 1); nodes[5] = n(ix + 1, iy, iz + 1); nodes[6] = n(ix + 1, iy + 1, iz + 1); nodes[7] = n(ix, iy + 1, iz + 1);
    for (let a = 0; a < 8; a++) voxelNodeList[s * 8 + a] = nodes[a];
  }

  const eu = new Float64Array(24);
  const kv = new Float64Array(24);

  /**
   * 单工况 mat-vec。
   * zeroBoundary=true：纯自由-自由算子 K_ff（PCG 迭代用）；
   * zeroBoundary=false：含仿射代入（边界取 U0），用于计算等效载荷。
   */
  function matVec(x: Float64Array, col: number, y: Float64Array, zeroBoundary: boolean): void {
    y.fill(0, 0, nDof);
    for (let s = 0; s < nSolid; s++) {
      const base = s * 8;
      for (let a = 0; a < 8; a++) {
        const nd = voxelNodeList[base + a];
        for (let d = 0; d < 3; d++) {
          eu[a * 3 + d] = isBoundary[nd] && !zeroBoundary ? U0[col * nDof + nd * 3 + d] : x[nd * 3 + d];
        }
      }
      for (let i = 0; i < 24; i++) {
        const row = i * 24;
        let s0 = 0;
        for (let j = 0; j < 24; j++) s0 += Ke[row + j] * eu[j];
        kv[i] = s0;
      }
      for (let a = 0; a < 8; a++) {
        const nd = voxelNodeList[base + a];
        if (isBoundary[nd]) continue;
        y[nd * 3] += kv[a * 3];
        y[nd * 3 + 1] += kv[a * 3 + 1];
        y[nd * 3 + 2] += kv[a * 3 + 2];
      }
    }
  }

  // Jacobi 对角（节点键连固相体素数 × Ke 对角均值）
  const diag = new Float64Array(nDof);
  {
    let keDiagAvg = 0;
    for (let i = 0; i < 24; i++) keDiagAvg += Ke[i * 24 + i];
    keDiagAvg /= 24;
    const cnt = new Int32Array(nNodes);
    for (let s = 0; s < nSolid; s++) {
      for (let a = 0; a < 8; a++) cnt[voxelNodeList[s * 8 + a]]++;
    }
    for (let nd = 0; nd < nNodes; nd++) {
      const d = (cnt[nd] * keDiagAvg) / 8 || 1;
      diag[nd * 3] = d; diag[nd * 3 + 1] = d; diag[nd * 3 + 2] = d;
    }
  }

  const C: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const iters: number[] = [];
  const residuals: number[] = [];
  let allConverged = true;

  const x = new Float64Array(nDof);
  const b = new Float64Array(nDof);
  const u0col = new Float64Array(nDof);
  const r = new Float64Array(nDof);
  const z = new Float64Array(nDof);
  const p = new Float64Array(nDof);
  const Ap = new Float64Array(nDof);
  const uFull = new Float64Array(nDof);

  for (let lc = 0; lc < 6; lc++) {
    // rhs = −(K·U0 的自由行)（仿射代入算子）
    u0col.set(U0.subarray(lc * nDof, (lc + 1) * nDof));
    matVec(u0col, lc, b, false);
    for (let i = 0; i < nDof; i++) b[i] = -b[i];
    for (let nd = 0; nd < nNodes; nd++) {
      if (isBoundary[nd]) { b[nd * 3] = 0; b[nd * 3 + 1] = 0; b[nd * 3 + 2] = 0; }
    }

    x.fill(0, 0, nDof);
    if ((globalThis as any).__feaDbg) {
      let nz = 0, mx = 0;
      for (let i = 0; i < nDof; i++) { const a2 = Math.abs(b[i]); if (a2 > 0) nz++; if (a2 > mx) mx = a2; }
      (globalThis as any).__feaDbg('case ' + lc + ' b nonzero=' + nz + ' max=' + mx.toExponential(3));
    }
    let bNorm = 0;
    for (let i = 0; i < nDof; i++) bNorm += b[i] * b[i];
    bNorm = Math.sqrt(bNorm);
    // 平凡工况：右端为零（仿射场即离散精确解，如全实心块）⇒ x=0 即解；
    // 但【不得跳过均质化】——C 行仍由 affine 场给出（首版 skip 使 C44/C55/C66=0）。
    // 阈值 1e-11：覆盖 K·U0 的浮点噪声底（~1e-14），远低于真实 b（O(100)）
    let iter = 0;
    let res = bNorm < 1e-11 ? 0 : 1;
    if (bNorm >= 1e-11) {
    for (let i = 0; i < nDof; i++) z[i] = r[i] / (diag[i] || 1);
    p.set(z);
    let rz = 0;
    for (let i = 0; i < nDof; i++) rz += r[i] * z[i];
    for (; iter < maxIter; iter++) {
      matVec(p, lc, Ap, true);
      let pAp = 0;
      for (let i = 0; i < nDof; i++) pAp += p[i] * Ap[i];
      if (!(pAp > 0)) break;
      const alpha = rz / pAp;
      let r2 = 0;
      for (let i = 0; i < nDof; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        r2 += r[i] * r[i];
      }
      res = Math.sqrt(r2) / bNorm;
      if (res < tol) { iter++; break; }
      let rzN = 0;
      for (let i = 0; i < nDof; i++) z[i] = r[i] / (diag[i] || 1);
      for (let i = 0; i < nDof; i++) rzN += r[i] * z[i];
      const beta = rzN / rz;
      for (let i = 0; i < nDof; i++) p[i] = z[i] + beta * p[i];
      rz = rzN;
    }
    }
    iters.push(iter);
    residuals.push(res);
    if (res >= tol) allConverged = false;

    // ── 均质应力：体积平均应变（体平均形函数导数 = ±1/4）──
    uFull.set(U0.subarray(lc * nDof, (lc + 1) * nDof));
    for (let i = 0; i < nDof; i++) uFull[i] += x[i];
    const epsAvg = new Float64Array(6);
    for (let s = 0; s < nSolid; s++) {
      const base = s * 8;
      for (let a = 0; a < 8; a++) {
        const nd = voxelNodeList[base + a];
        for (let d = 0; d < 3; d++) eu[a * 3 + d] = uFull[nd * 3 + d];
      }
      for (let a = 0; a < 8; a++) {
        // 体积平均形函数导数：dN̄a/dx = ξa/4，dN̄a/dy = ηa/4，dN̄a/dz = ζa/4
        // （∫dN/dx dV/V = ξa/4； shear 用对应两轴因子组合，非交叉二阶导）
        const sx = NODE_XI[a][0], sy = NODE_XI[a][1], sz = NODE_XI[a][2];
        const i0 = a * 3;
        epsAvg[0] += (sx / 4) * eu[i0];
        epsAvg[1] += (sy / 4) * eu[i0 + 1];
        epsAvg[2] += (sz / 4) * eu[i0 + 2];
        epsAvg[3] += (sy / 4) * eu[i0] + (sx / 4) * eu[i0 + 1];
        epsAvg[4] += (sz / 4) * eu[i0 + 1] + (sy / 4) * eu[i0 + 2];
        epsAvg[5] += (sx / 4) * eu[i0 + 2] + (sz / 4) * eu[i0];
      }
    }
    for (let k2 = 0; k2 < 6; k2++) epsAvg[k2] /= R * R * R;   // 均质应力按总体积归一
    const lam = nu / ((1 + nu) * (1 - 2 * nu));
    const muu = 1 / (2 * (1 + nu));
    const tr = epsAvg[0] + epsAvg[1] + epsAvg[2];
    C[0][lc] = lam * tr + 2 * muu * epsAvg[0];
    C[1][lc] = lam * tr + 2 * muu * epsAvg[1];
    C[2][lc] = lam * tr + 2 * muu * epsAvg[2];
    // Voigt 工程剪切：σ4 = μ·γ4（epsAvg[3..5] 为工程剪应变 γ）
    C[3][lc] = muu * epsAvg[3];
    C[4][lc] = muu * epsAvg[4];
    C[5][lc] = muu * epsAvg[5];
  }

  let sym = 0, cmax = 0;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    cmax = Math.max(cmax, Math.abs(C[i][j]));
    sym = Math.max(sym, Math.abs(C[i][j] - C[j][i]));
  }
  const symmetryErr = cmax > 0 ? sym / cmax : 0;
  const zenerRatio = (2 * C[3][3]) / (C[0][0] - C[0][1]);
  const E11 = C[0][0] - (2 * C[0][1] * C[0][1]) / (C[0][0] + C[1][1]);

  return {
    C, symmetryErr, zenerRatio, E11, iters, residuals,
    elapsedMs: performance.now() - t0,
    solidVoxels: nSolid,
    converged: allConverged,
  };
}
