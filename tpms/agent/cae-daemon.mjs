#!/usr/bin/env node
/**
 * Local CAE Host Daemon (127.0.0.1:4830)
 * Bridges Web Harness -> host Python/nTopCL/Gmsh/WSL-OpenFOAM13/ABAQUS/COMSOL6.2
 * without shipping any desktop binaries or weakening browser sandbox guarantees.
 */

import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SIM_DIR = path.join(REPO_ROOT, 'sim');
const SIM_OUT_DIR = path.join(SIM_DIR, 'out');
const SIM_NTOP_DIR = path.join(SIM_DIR, 'ntop');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.CAE_DAEMON_PORT || 4830);
const WSL_DISTRO = process.env.TPMS_WSL_DISTRO || 'Ubuntu-24.04';

const PATHS = {
  ntopcl: process.env.NTOPCL_EXE || 'D:\\Program Files\\nTopology\\nTopology\\ntopcl.exe',
  abaqus: process.env.ABAQUS_BAT || 'D:\\SIMULIA\\Commands\\abaqus.bat',
  comsolCompile: process.env.COMSOL_COMPILE || 'D:\\Program Files\\COMSOL\\COMSOL62\\Multiphysics\\bin\\win64\\comsolcompile.exe',
  comsolBatch: process.env.COMSOL_BATCH || 'D:\\Program Files\\COMSOL\\COMSOL62\\Multiphysics\\bin\\win64\\comsolbatch.exe',
};

const VALID_TYPES = new Set([
  'gyroid', 'diamond', 'schwarz', 'neovius', 'iwp', 'frd', 'lidinoid', 'splitp', 'fks',
]);
const VALID_STRUCTURES = new Set(['network', 'sheet']);
const VALID_BL_BACKENDS = new Set(['auto', 'ntop', 'gmsh-bl', 'snappy-bl']);
const VALID_MAZE = new Set(['gplus', 'gminus']);
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

/** @type {Map<string, any>} */
const JOBS = new Map();
const MAX_LOG_LINES = 500;

export function isAllowedOrigin(origin) {
  if (!origin) return true; // curl / local Node test without Origin header
  return LOCAL_ORIGIN_RE.test(origin);
}

export function resolveSafeOutPath(relName) {
  if (!relName || typeof relName !== 'string') return null;
  const cleaned = relName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) return null;
  const candidate = path.resolve(SIM_OUT_DIR, cleaned);
  const rootWithSep = SIM_OUT_DIR.endsWith(path.sep) ? SIM_OUT_DIR : (SIM_OUT_DIR + path.sep);
  if (candidate !== SIM_OUT_DIR && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeType(t) {
  const s = String(t || 'gyroid').toLowerCase().trim();
  return VALID_TYPES.has(s) ? s : 'gyroid';
}

function sanitizeStructure(s) {
  const v = String(s || 'network').toLowerCase().trim();
  return VALID_STRUCTURES.has(v) ? v : 'network';
}

function sanitizeBackend(b) {
  const v = String(b || 'auto').toLowerCase().trim();
  return VALID_BL_BACKENDS.has(v) ? v : 'auto';
}

function winToWsl(winPath) {
  const r = path.resolve(winPath);
  const drive = r[0].toLowerCase();
  const rest = r.slice(2).replace(/\\/g, '/');
  return `/mnt/${drive}${rest}`;
}

async function quickExec(cmd, args, timeout = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, out: `${stdout}\n${stderr}`.trim() };
  } catch (err) {
    return { ok: false, out: String(err?.stderr || err?.stdout || err?.message || err).trim() };
  }
}

export async function probeCaeEnvironment() {
  fs.mkdirSync(SIM_OUT_DIR, { recursive: true });
  const ntopFiles = fs.existsSync(SIM_NTOP_DIR)
    ? fs.readdirSync(SIM_NTOP_DIR).filter((f) => f.toLowerCase().endsWith('.ntop'))
    : [];

  const [pyRes, ntopVer, wslRes] = await Promise.all([
    quickExec('python', ['--version'], 5000),
    fs.existsSync(PATHS.ntopcl) ? quickExec(PATHS.ntopcl, ['--version'], 6000) : Promise.resolve({ ok: false, out: 'missing' }),
    quickExec('wsl', ['-d', WSL_DISTRO, 'bash', '-lc', 'test -d /opt/openfoam13 && echo OF13_OK; which gmsh >/dev/null && gmsh --version 2>/dev/null | head -n 1'], 8000),
  ]);

  const abaqusInstalled = fs.existsSync(PATHS.abaqus);
  const comsolInstalled = fs.existsSync(PATHS.comsolCompile) && fs.existsSync(PATHS.comsolBatch);

  const ofReady = wslRes.ok && wslRes.out.includes('OF13_OK');
  const gmshWslLine = wslRes.out.split(/\r?\n/).find((l) => /^\d+\.\d+/.test(l.trim())) || null;

  const recentFiles = [];
  if (fs.existsSync(SIM_OUT_DIR)) {
    for (const ent of fs.readdirSync(SIM_OUT_DIR, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      const fp = path.join(SIM_OUT_DIR, ent.name);
      const st = fs.statSync(fp);
      recentFiles.push({
        name: ent.name,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        mtimeIso: new Date(st.mtimeMs).toISOString(),
      });
    }
    recentFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  return {
    ok: true,
    daemon: 'tpms-cae-daemon',
    port: DEFAULT_PORT,
    repoRoot: REPO_ROOT,
    outDir: SIM_OUT_DIR,
    checkedAt: new Date().toISOString(),
    engines: {
      python: { available: pyRes.ok, version: pyRes.out },
      ntop: {
        installed: fs.existsSync(PATHS.ntopcl),
        path: PATHS.ntopcl,
        version: ntopVer.ok ? ntopVer.out : null,
        templates: ntopFiles,
        templateCount: ntopFiles.length,
      },
      gmshBl: {
        available: pyRes.ok,
        wslGmshVersion: gmshWslLine,
      },
      openfoam: {
        available: ofReady,
        distro: WSL_DISTRO,
        root: '/opt/openfoam13',
      },
      abaqus: {
        available: abaqusInstalled,
        path: PATHS.abaqus,
      },
      comsol: {
        available: comsolInstalled,
        compilePath: PATHS.comsolCompile,
        batchPath: PATHS.comsolBatch,
      },
    },
    recentFiles: recentFiles.slice(0, 32),
  };
}

function appendLog(job, chunk) {
  const lines = String(chunk).replace(/\r/g, '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    job.logs.push(line);
    if (job.logs.length > MAX_LOG_LINES) {
      job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
    }
  }
}

function runSubprocess(job, cmd, args, cwd = REPO_ROOT) {
  return new Promise((resolve) => {
    appendLog(job, `$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      appendLog(job, s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      appendLog(job, s);
    });
    child.on('error', (err) => {
      appendLog(job, `[spawn-error] ${err.message}`);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function parseLastJson(text) {
  const lines = String(text || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        return JSON.parse(s);
      } catch {
        // continue scanning
      }
    }
  }
  return null;
}

function parseLatestPostProcessingScalar(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const times = fs.readdirSync(dirPath)
    .filter((d) => /^\d+(\.\d+)?$/.test(d))
    .sort((a, b) => Number(a) - Number(b));
  if (!times.length) return null;
  const latest = path.join(dirPath, times[times.length - 1], 'surfaceFieldValue.dat');
  if (!fs.existsSync(latest)) return null;
  const lines = fs.readFileSync(latest, 'utf8').trim().split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!lines.length) return null;
  const parts = lines[lines.length - 1].trim().split(/\s+/);
  const val = Number(parts[parts.length - 1]);
  return Number.isFinite(val) ? val : null;
}

async function runOpenFoamDarcyTwoPoint(job, caseDir, L_mm, vIn_mm_s, rhoKgM3 = 1000, muPaS = 0.00089) {
  const wslCase = winToWsl(caseDir);
  const v2 = Number((vIn_mm_s * 2.0).toFixed(6));
  const script = [
    'set -e',
    'source /opt/openfoam13/etc/bashrc',
    `cd "${wslCase}"`,
    'foamRun > log.foamRun.v1 2>&1',
    `rm -rf "${wslCase}_v2"`,
    `cp -r "${wslCase}" "${wslCase}_v2"`,
    `cd "${wslCase}_v2"`,
    `sed -i 's/uniform (${vIn_mm_s}/uniform (${v2}/g' 0/U`,
    'rm -rf 100 200 300 400 500 600 postProcessing',
    'foamRun > log.foamRun.v2 2>&1',
  ].join('\n');
  const scriptPath = path.join(caseDir, 'run_darcy_2pt.sh');
  fs.writeFileSync(scriptPath, script, 'utf8');
  const wslScript = winToWsl(scriptPath);
  const res = await runSubprocess(job, 'wsl', ['-d', WSL_DISTRO, 'bash', '-lc', `bash "${wslScript}"`]);
  if (res.code !== 0) {
    throw new Error(`OpenFOAM foamRun exited with code ${res.code}`);
  }

  const pIn1 = parseLatestPostProcessingScalar(path.join(caseDir, 'postProcessing', 'patchAvgInletP'));
  const pOut1 = parseLatestPostProcessingScalar(path.join(caseDir, 'postProcessing', 'patchAvgOutletP')) ?? 0;
  const pIn2 = parseLatestPostProcessingScalar(path.join(`${caseDir}_v2`, 'postProcessing', 'patchAvgInletP'));
  const pOut2 = parseLatestPostProcessingScalar(path.join(`${caseDir}_v2`, 'postProcessing', 'patchAvgOutletP')) ?? 0;

  // Kinematic pressure in mm^2/s^2 -> Pa = p_kin * rho * 1e-6
  const dp1_Pa = pIn1 !== null ? Math.abs(pIn1 - pOut1) * rhoKgM3 * 1e-6 : null;
  const dp2_Pa = pIn2 !== null ? Math.abs(pIn2 - pOut2) * rhoKgM3 * 1e-6 : null;
  const v1_ms = vIn_mm_s * 1e-3;
  const v2_ms = v2 * 1e-3;
  const L_m = L_mm * 1e-3;
  const K1_m2 = (dp1_Pa && dp1_Pa > 0) ? (v1_ms * muPaS * L_m) / dp1_Pa : null;

  return {
    v1_ms,
    dp1_Pa,
    v2_ms,
    dp2_Pa,
    permeabilityM2: K1_m2,
    caseV1: caseDir,
    caseV2: `${caseDir}_v2`,
  };
}

async function executeJob(job) {
  const p = job.params || {};
  const ftype = sanitizeType(p.type);
  const structure = sanitizeStructure(p.structure);
  const k = Math.round(clampNum(p.k, 1, 4, 1));
  const R = Math.round(clampNum(p.R, 12, 48, 24));
  const por = clampNum(p.por, 0.25, 0.90, 0.70);
  const solid = clampNum(p.solid, 0.10, 0.75, 0.30);
  const cellSize = clampNum(p.cellSize, 1.0, 20.0, 4.0);
  const blLayers = Math.round(clampNum(p.blLayers, 1, 10, 3));
  const blFirstH = clampNum(p.blFirstHeight, 0.005, 0.5, 0.03);
  const blGrowth = clampNum(p.blGrowth, 1.05, 1.8, 1.25);
  const vIn = clampNum(p.vInMmS, 0.01, 50.0, 1.0);
  const execute = p.execute === true;

  try {
    const cfdPeriods = p.cfdPeriods != null
      ? Math.round(clampNum(p.cfdPeriods, 1, k, 1))
      : (k > 1 ? 1 : k);

    if (job.kind === 'preprocess-bl') {
      const backend = sanitizeBackend(p.backend);
      const args = [
        path.join(SIM_DIR, 'p1_bl_mesh.py'),
        '--backend', backend,
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--cfd-periods', String(cfdPeriods),
        '--R', String(R),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--bl-layers', String(blLayers),
        '--bl-first-height', String(blFirstH),
        '--bl-growth', String(blGrowth),
        '--v-in', String(vIn),
        '--json',
      ];
      if (p.maze && VALID_MAZE.has(String(p.maze))) {
        args.push('--maze', String(p.maze));
      }
      if (backend === 'snappy-bl' && p.runSnappy === true) {
        args.push('--run-snappy');
      }
      const res = await runSubprocess(job, 'python', args);
      const parsed = parseLastJson(res.stdout);
      if (res.code !== 0 || !parsed) {
        throw new Error(`p1_bl_mesh failed (code=${res.code})`);
      }
      job.result = parsed;
    } else if (job.kind === 'openfoam-cfd') {
      const backend = sanitizeBackend(p.backend || 'auto');
      const blArgs = [
        path.join(SIM_DIR, 'p1_bl_mesh.py'),
        '--backend', backend,
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--cfd-periods', String(cfdPeriods),
        '--R', String(Math.min(R, 20)),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--bl-layers', String(blLayers),
        '--bl-first-height', String(blFirstH),
        '--bl-growth', String(blGrowth),
        '--v-in', String(vIn),
        '--json',
      ];
      if (backend === 'snappy-bl' && execute) blArgs.push('--run-snappy');
      const blRes = await runSubprocess(job, 'python', blArgs);
      const parsed = parseLastJson(blRes.stdout);
      if (blRes.code !== 0 || !parsed) {
        throw new Error(`OpenFOAM BL prep/mesh failed (code=${blRes.code})`);
      }

      const v1Ms = clampNum(p.v1Ms, 1e-5, 0.2, Math.max(1e-4, vIn * 1e-3));
      const v2Ms = clampNum(p.v2Ms, 1e-4, 0.5, Math.max(v1Ms * 10, 0.01));
      const solveArgs = [
        path.join(SIM_DIR, 'p3_openfoam_solve.py'),
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--cfd-periods', String(cfdPeriods),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--v1', String(v1Ms),
        '--v2', String(v2Ms),
        '--grid-n', String(Math.round(clampNum(p.gridN, 16, 36, 24))),
        '--json',
      ];
      if (parsed.snappy?.caseDir) {
        solveArgs.push('--case-dir', parsed.snappy.caseDir);
      }
      if (execute || p.preferWsl === true) {
        solveArgs.push('--prefer-wsl');
      }
      const solveRes = await runSubprocess(job, 'python', solveArgs);
      const cfdSummary = parseLastJson(solveRes.stdout);
      if (solveRes.code !== 0 || !cfdSummary) {
        throw new Error(`p3_openfoam_solve failed (code=${solveRes.code})`);
      }

      const darcy = {
        v1_ms: cfdSummary.v1_ms,
        dp1_Pa: cfdSummary.dp1_Pa,
        v2_ms: cfdSummary.v2_ms,
        dp2_Pa: cfdSummary.dp2_Pa,
        permeabilityM2: cfdSummary.K_m2,
        betaM1: cfdSummary.beta_m1,
        Fo: cfdSummary.Fo_v2,
        wssMean_mPa: cfdSummary.wssMean_mPa,
        wssOsteogenicWindowRatio: cfdSummary.wssOsteogenicWindowRatio,
        caseV1: parsed.snappy?.caseDir || null,
        solverTier: cfdSummary.solverTier,
      };
      job.result = {
        mode: execute ? 'solved' : 'fvm-solved',
        preprocess: parsed,
        cfdSummary,
        darcy,
      };
    } else if (job.kind === 'comsol-cfd') {
      const args = [
        path.join(SIM_DIR, 'p4_comsol_setup.py'),
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--R', String(R),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--bl-layers', String(blLayers),
        '--bl-first-height', String(blFirstH),
        '--v-in', String(vIn),
        execute ? '--run' : '--compile',
        '--json',
      ];
      const res = await runSubprocess(job, 'python', args);
      const parsed = parseLastJson(res.stdout);
      if (res.code !== 0 || !parsed) {
        throw new Error(`p4_comsol_setup failed (code=${res.code})`);
      }
      job.result = parsed;
    } else if (job.kind === 'abaqus-fea') {
      const abqDir = path.join(SIM_OUT_DIR, 'abq');
      fs.mkdirSync(abqDir, { recursive: true });
      const tag = `${ftype}_${structure}_k${k}_R${R}_p${Math.round(por * 100)}_cs${cellSize}`;
      const stlPath = path.join(abqDir, `${tag}.stl`);
      const inpMeshPath = path.join(abqDir, `${tag}.inp`);
      const strain = clampNum(p.strain, 0.005, 0.60, 0.05);
      const L_mm = k * cellSize;

      const r0 = await runSubprocess(job, 'python', [
        path.join(SIM_DIR, 'p0_generate.py'),
        '--type', ftype,
        '--k', String(k),
        '--R', String(R),
        '--por', String(por),
        '--structure', structure,
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--out', stlPath,
      ]);
      if (r0.code !== 0) throw new Error(`p0_generate failed (code=${r0.code})`);

      const r1 = await runSubprocess(job, 'python', [
        path.join(SIM_DIR, 'p1_mesh.py'),
        stlPath,
        '--lmax', String(Number(Math.max(0.12, L_mm / 10).toFixed(3))),
      ]);
      if (r1.code !== 0) throw new Error(`p1_mesh failed (code=${r1.code})`);

      const p2Args = [
        path.join(SIM_DIR, 'p2_static_setup.py'),
        inpMeshPath,
        '--strain', String(strain),
      ];
      if (strain >= 0.10) {
        p2Args.push('--plastic', '--nlgeom', '--contact', '--contact-stab');
      }
      if (strain >= 0.30) {
        p2Args.push('--explicit', '2.0', '--mass-dt', '2e-7');
      }
      const r2 = await runSubprocess(job, 'python', p2Args);
      if (r2.code !== 0) throw new Error(`p2_static_setup failed (code=${r2.code})`);

      const staticCands = fs.readdirSync(abqDir)
        .filter((f) => f.startsWith(tag) && f.endsWith('_static.inp'))
        .map((f) => ({ f, m: fs.statSync(path.join(abqDir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m);
      const staticInpPath = staticCands.length
        ? path.join(abqDir, staticCands[0].f)
        : path.join(abqDir, `${tag}_static.inp`);

      let odbSummary = null;
      if (execute) {
        if (!fs.existsSync(PATHS.abaqus)) {
          throw new Error(`abaqus.bat not found at ${PATHS.abaqus}`);
        }
        const jobName = `tpms_${tag}`.replace(/[^A-Za-z0-9_]/g, '_');
        const r3 = await runSubprocess(job, 'cmd.exe', ['/c', PATHS.abaqus, `job=${jobName}`, `input=${staticInpPath}`, 'interactive'], abqDir);
        if (r3.code !== 0) throw new Error(`ABAQUS solve failed (code=${r3.code})`);
        const odbPath = path.join(abqDir, `${jobName}.odb`);
        const csvPath = path.join(abqDir, `${jobName}_curve.csv`);
        const r4 = await runSubprocess(job, 'cmd.exe', [
          '/c', PATHS.abaqus, 'python',
          path.join(SIM_DIR, 'p2_extract_csv.py'),
          '--odb', odbPath,
          '--h', String(L_mm),
          '--w', String(L_mm),
          '--t', String(L_mm),
          '--out', csvPath,
        ], abqDir);
        if (r4.code === 0 && fs.existsSync(csvPath)) {
          odbSummary = { odbPath, csvPath, csvText: fs.readFileSync(csvPath, 'utf8') };
        }
      }

      job.result = {
        mode: execute ? 'solved' : 'prepared',
        stlPath,
        meshInpPath: inpMeshPath,
        staticInpPath,
        abaqusCommand: `${PATHS.abaqus} job=tpms_${tag} input=${staticInpPath} interactive`,
        odbSummary,
      };
    } else if (job.kind === 'pipeline') {
      const mode = p.mode === 'fast' ? 'fast' : 'full';
      const pipeCfdPeriods = p.cfdPeriods != null ? Math.round(clampNum(p.cfdPeriods, 1, k, 1)) : (k > 1 ? 1 : k);

      // 1) nTopCL + RVE BL + Mesh Doctor
      const blRes = await runSubprocess(job, 'python', [
        path.join(SIM_DIR, 'p1_bl_mesh.py'),
        '--backend', 'auto',
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--cfd-periods', String(pipeCfdPeriods),
        '--R', String(Math.min(R, 20)),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--bl-layers', String(blLayers),
        '--bl-first-height', String(blFirstH),
        '--bl-growth', String(blGrowth),
        '--v-in', String(vIn),
        '--json',
      ]);
      const preprocess = parseLastJson(blRes.stdout);
      if (blRes.code !== 0 || !preprocess) {
        throw new Error(`Pipeline Step 1 (BL Mesh) failed (code=${blRes.code})`);
      }

      // 2) Dual-velocity CFD & WSS window extraction
      const v1Ms = clampNum(p.v1Ms, 1e-5, 0.2, Math.max(1e-4, vIn * 1e-3));
      const v2Ms = clampNum(p.v2Ms, 1e-4, 0.5, Math.max(v1Ms * 10, 0.01));
      const solveArgs = [
        path.join(SIM_DIR, 'p3_openfoam_solve.py'),
        '--type', ftype,
        '--structure', structure,
        '--k', String(k),
        '--cfd-periods', String(pipeCfdPeriods),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--v1', String(v1Ms),
        '--v2', String(v2Ms),
        '--grid-n', String(Math.round(clampNum(p.gridN, 16, 32, 24))),
        '--json',
      ];
      if (preprocess.snappy?.caseDir) solveArgs.push('--case-dir', preprocess.snappy.caseDir);
      if (execute || p.preferWsl === true) solveArgs.push('--prefer-wsl');
      const solveRes = await runSubprocess(job, 'python', solveArgs);
      const cfdSummary = parseLastJson(solveRes.stdout);
      if (solveRes.code !== 0 || !cfdSummary) {
        throw new Error(`Pipeline Step 2 (Dual CFD) failed (code=${solveRes.code})`);
      }

      // 3) COMSOL 6.2 Java compilation / readiness
      let comsol = null;
      const cRes = await runSubprocess(job, 'python', [
        path.join(SIM_DIR, 'p4_comsol_setup.py'),
        '--type', ftype,
        '--structure', structure,
        '--k', String(pipeCfdPeriods),
        '--R', String(Math.min(R, 20)),
        '--por', String(por),
        '--solid', String(solid),
        '--cell-size', String(cellSize),
        '--bl-layers', String(blLayers),
        '--bl-first-height', String(blFirstH),
        '--v-in', String(vIn),
        execute && p.runComsol === true ? '--run' : '--compile',
        '--json',
      ]);
      if (cRes.code === 0) {
        comsol = parseLastJson(cRes.stdout);
      }

      // 4) ABAQUS structural INP prep (skipped in fast mode if not needed)
      let abaqus = { mode: 'skipped_fast', staticInpPath: null };
      if (mode === 'full') {
        const abqDir = path.join(SIM_OUT_DIR, 'abq');
        fs.mkdirSync(abqDir, { recursive: true });
        const abqK = Math.min(k, 2);
        const abqTag = `${ftype}_${structure}_k${abqK}_R${Math.min(R, 20)}_p${Math.round(por * 100)}_cs${cellSize}`;
        const stlPath = path.join(abqDir, `${abqTag}.stl`);
        const inpMeshPath = path.join(abqDir, `${abqTag}.inp`);
        const r0 = await runSubprocess(job, 'python', [
          path.join(SIM_DIR, 'p0_generate.py'),
          '--type', ftype,
          '--k', String(abqK),
          '--R', String(Math.min(R, 20)),
          '--por', String(por),
          '--structure', structure,
          '--solid', String(solid),
          '--cell-size', String(cellSize),
          '--out', stlPath,
        ]);
        if (r0.code === 0) {
          const r1 = await runSubprocess(job, 'python', [
            path.join(SIM_DIR, 'p1_mesh.py'),
            stlPath,
            '--lmax', String(Number(Math.max(0.16, (abqK * cellSize) / 9).toFixed(3))),
          ]);
          if (r1.code === 0) {
            const r2 = await runSubprocess(job, 'python', [
              path.join(SIM_DIR, 'p2_static_setup.py'),
              inpMeshPath,
              '--strain', String(clampNum(p.strain, 0.005, 0.60, 0.05)),
            ]);
            const cands = fs.existsSync(abqDir)
              ? fs.readdirSync(abqDir).filter((f) => f.startsWith(abqTag) && f.endsWith('_static.inp'))
              : [];
            abaqus = {
              mode: r2.code === 0 ? 'prepared' : 'setup_failed',
              stlPath,
              meshInpPath: inpMeshPath,
              staticInpPath: cands.length ? path.join(abqDir, cands[0]) : null,
            };
          }
        }
      }

      const report = {
        ok: true,
        mode,
        generatedAt: new Date().toISOString(),
        params: { type: ftype, structure, k, cfdPeriods: pipeCfdPeriods, por, solid, cellSize },
        preprocess,
        cfdSummary,
        darcy: {
          v1_ms: cfdSummary.v1_ms,
          dp1_Pa: cfdSummary.dp1_Pa,
          v2_ms: cfdSummary.v2_ms,
          dp2_Pa: cfdSummary.dp2_Pa,
          permeabilityM2: cfdSummary.K_m2,
          betaM1: cfdSummary.beta_m1,
          Fo: cfdSummary.Fo_v2,
          wssMean_mPa: cfdSummary.wssMean_mPa,
          wssOsteogenicWindowRatio: cfdSummary.wssOsteogenicWindowRatio,
          solverTier: cfdSummary.solverTier,
        },
        comsol,
        abaqus,
      };
      const reportPath = path.join(SIM_OUT_DIR, 'multifidelity_verification_report.json');
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      report.reportJson = reportPath;
      job.result = report;
    } else {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }

    job.status = 'completed';
    job.exitCode = 0;
  } catch (err) {
    job.status = 'failed';
    job.exitCode = 1;
    job.error = err?.message || String(err);
    appendLog(job, `[error] ${job.error}`);
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

function sendJson(res, status, obj, origin) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function readJsonBody(req, limitBytes = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

const ALLOWED_JOB_KINDS = new Set([
  'preprocess-bl',
  'openfoam-cfd',
  'abaqus-fea',
  'comsol-cfd',
  'pipeline',
]);

const ALLOWED_RAW_EXTS = new Set([
  '.stl', '.csv', '.json', '.msh', '.bdf', '.inp', '.java', '.txt',
]);

function enqueueCaeJob(kind, params, origin, res) {
  if (!ALLOWED_JOB_KINDS.has(kind)) {
    return sendJson(res, 400, { ok: false, error: `Unsupported job kind: ${kind}` }, origin);
  }
  const id = `cae_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const job = {
    id,
    kind,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    params: params || {},
    logs: [],
    result: null,
    error: null,
  };
  JOBS.set(id, job);
  void executeJob(job);
  return sendJson(res, 202, { ok: true, jobId: id, status: 'running' }, origin);
}

export function resolveArtifactRawPath(rawInput) {
  let clean = String(rawInput || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) return null;
  if (clean.startsWith('sim/out/')) clean = clean.slice('sim/out/'.length);
  const resolved = resolveSafeOutPath(clean);
  if (!resolved) return null;
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_RAW_EXTS.has(ext)) return null;
  return resolved;
}

export function createCaeServer() {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (origin && !isAllowedOrigin(origin)) {
      return sendJson(res, 403, { ok: false, error: 'Forbidden origin' }, '');
    }
    if (req.method === 'OPTIONS') {
      return sendJson(res, 204, {}, origin);
    }

    const url = new URL(req.url || '/', `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/cae/env') {
      const env = await probeCaeEnvironment();
      return sendJson(res, 200, env, origin);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/cae/job/')) {
      const id = pathname.slice('/api/cae/job/'.length).trim();
      if (!SAFE_NAME_RE.test(id)) {
        return sendJson(res, 400, { ok: false, error: 'Invalid jobId' }, origin);
      }
      const job = JOBS.get(id);
      if (!job) {
        return sendJson(res, 404, { ok: false, error: 'Job not found' }, origin);
      }
      return sendJson(res, 200, { ok: true, job }, origin);
    }

    if (req.method === 'POST' && (pathname === '/api/cae/job' || pathname === '/api/cae/openfoam-cfd' || pathname === '/api/cae/pipeline')) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message }, origin);
      }
      const forcedKind = pathname === '/api/cae/openfoam-cfd'
        ? 'openfoam-cfd'
        : pathname === '/api/cae/pipeline'
          ? 'pipeline'
          : String(body.kind || '').trim();
      const params = body.params && typeof body.params === 'object' ? body.params : body;
      return enqueueCaeJob(forcedKind, params, origin, res);
    }

    if (req.method === 'GET' && pathname === '/api/cae/file') {
      const name = url.searchParams.get('name') || '';
      const resolved = resolveSafeOutPath(name);
      if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return sendJson(res, 404, { ok: false, error: 'File not found or outside sim/out' }, origin);
      }
      const text = fs.readFileSync(resolved, 'utf8').slice(0, 65536);
      return sendJson(res, 200, { ok: true, name, content: text }, origin);
    }

    if (req.method === 'GET' && pathname === '/api/cae/artifact-raw') {
      const rawParam = url.searchParams.get('name') || url.searchParams.get('path') || '';
      const resolved = resolveArtifactRawPath(rawParam);
      if (!resolved) {
        return sendJson(res, 400, { ok: false, error: 'Invalid or disallowed artifact path' }, origin);
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return sendJson(res, 404, { ok: false, error: 'Artifact not found' }, origin);
      }
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.stl'
        ? 'model/stl'
        : ext === '.json'
          ? 'application/json; charset=utf-8'
          : ext === '.csv'
            ? 'text/csv; charset=utf-8'
            : 'text/plain; charset=utf-8';
      const buf = fs.readFileSync(resolved);
      const headers = {
        'Content-Type': mime,
        'Content-Length': String(buf.length),
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      };
      if (origin && isAllowedOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
      }
      res.writeHead(200, headers);
      res.end(buf);
      return;
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' }, origin);
  });
}

async function runSelfTest() {
  const env = await probeCaeEnvironment();
  const checks = {
    envOk: env.ok === true,
    ntopTemplateReady: Array.isArray(env.engines?.ntop?.templates) && env.engines.ntop.templates.length > 0,
    originLocalAllowed: isAllowedOrigin('http://127.0.0.1:4825'),
    originEvilBlocked: !isAllowedOrigin('https://evil.example.com'),
    traversalBlocked: resolveSafeOutPath('../../etc/passwd') === null && resolveSafeOutPath('..\\..\\Windows\\win.ini') === null,
    rawTraversalBlocked: resolveArtifactRawPath('../../etc/passwd') === null && resolveArtifactRawPath('sim/out/../../secret.stl') === null && resolveArtifactRawPath('bad.exe') === null,
    rawValidStl: resolveArtifactRawPath('sim/out/test_fluid.stl') !== null && resolveArtifactRawPath('test_fluid.stl') !== null,
    validOutPath: resolveSafeOutPath('test_file.json') !== null,
  };
  const allOk = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ ok: allOk, checks, env }, null, 2));
  process.exit(allOk ? 0 : 1);
}

const isCliMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isCliMain) {
  if (process.argv.includes('--self-test')) {
    void runSelfTest();
  } else {
    const portFlagIdx = process.argv.indexOf('--port');
    const port = portFlagIdx >= 0 ? Number(process.argv[portFlagIdx + 1] || DEFAULT_PORT) : DEFAULT_PORT;
    const server = createCaeServer();
    server.listen(port, DEFAULT_HOST, () => {
      console.log(`[cae-daemon] listening on http://${DEFAULT_HOST}:${port} (REPO=${REPO_ROOT})`);
    });
  }
}
