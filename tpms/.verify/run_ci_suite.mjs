// run_ci_suite.mjs —— 一键 CI 套件调度器（Task 6）
//
// 串联三道门：mesh_audit（几何质量）→ parity_math（数学同源）→ run_all（6 套 UI 回归）。
// run_all 自带服务编排与清理（4814 平台 / 8125 文档），本脚本只负责顺序调度、
// 兜底端口清扫与彩色汇总。用法：
//   cd tpms/tpms-platform && npm run test:all
//   （等价于 node ../.verify/run_ci_suite.mjs）
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const DEPLOYED = path.join(ROOT, 'docs/platform');
const WIN32 = process.platform === 'win32';

const C = process.stdout.isTTY || process.env.FORCE_COLOR
  ? { b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m', rst: '\x1b[0m' }
  : { b: '', dim: '', red: '', grn: '', ylw: '', cyn: '', rst: '' };

// ── 部署门禁：run_all 服务的是部署产物，产物缺失时提前失败并给出修法 ──
if (!existsSync(path.join(DEPLOYED, 'index.html'))) {
  console.error(`${C.red}✗ 缺少部署产物 docs/platform/index.html${C.rst}`);
  console.error(`  先执行: cd tpms/tpms-platform && npm run build`);
  console.error(`  再拷贝 dist/* → docs/platform/（删除 assets/*.map）`);
  process.exit(2);
}

// ── 端口兜底清扫（win32）：run_all 正常退出会自清其服务；
//    若它中途崩死留下孤儿监听，这里按端口找 PID 强杀（仅 LISTENING 态）。──
function sweepPorts(ports) {
  if (!WIN32) return;
  let out = '';
  try {
    out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  } catch { return; }
  const pids = new Set();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    // TCP  Local  Foreign  STATE  PID —— 本地列精确以 :port 结尾（防 :4814 误吞 :48140）
    if (cols.length >= 5 && cols[3] === 'LISTENING' && /^\d+$/.test(cols[4])
      && ports.some((pt) => cols[1].endsWith(':' + pt))) pids.add(cols[4]);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      console.log(`${C.ylw}[清扫] 强杀孤儿服务进程 PID ${pid}${C.rst}`);
    } catch { /* 已自行退出则忽略 */ }
  }
}

function runStep(name, script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    console.log(`\n${C.cyn}${C.b}▶ ${name}${C.rst} ${C.dim}(${script})${C.rst}`);
    const p = spawn(process.execPath, [path.join(HERE, script)], {
      cwd: HERE,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const grab = (d) => {
      const s = d.toString();
      tail += s;
      process.stdout.write(s);
    };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    p.on('close', (code) => {
      // 汇总行兼容两种格式："RESULT: X PASS / Y FAIL" 与 "PASS X / Y"
      const m = tail.match(/RESULT:\s*(\d+)\s*PASS\s*\/\s*(\d+)\s*FAIL/) || tail.match(/PASS (\d+) \/ (\d+)/);
      const okAll = code === 0;
      const summary = m ? `${m[1]} PASS / ${m[2]} FAIL` : (okAll ? 'exit=0' : `exit=${code}`);
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(okAll
        ? `${C.grn}${C.b}✓ ${name} — ${summary}（${dur}s）${C.rst}`
        : `${C.red}${C.b}✗ ${name} — ${summary}（${dur}s）${C.rst}`);
      resolve(okAll);
    });
  });
}

console.log(`${C.b}══════ TPMS 全量 CI 套件 ══════${C.rst} ${C.dim}${new Date().toLocaleString()}${C.rst}`);

const results = [];
try {
  results.push(['mesh_audit 几何质量门（29 案例）', await runStep('几何质量门', 'mesh_audit.mjs')]);
  results.push(['parity_math 数学同源（74 断言）', await runStep('数学同源', 'parity_math.mjs')]);
  results.push(['sim_export_check 仿真导出（CFD 分块 + 曲率健壮性）', await runStep('仿真导出校验', 'sim_export_check.mjs')]);
  results.push(['endplate_audit 端板专项（水密/满填/体积增量）', await runStep('端板审计', 'endplate_audit.mjs')]);
  results.push(['micro_physics_audit 迂曲度+各向异性刚度', await runStep('微物理审计', 'micro_physics_audit.mjs')]);
  results.push(['run_all UI 回归（6 套件）', await runStep('UI 回归', 'run_all.mjs')]);
} finally {
  sweepPorts([4814, 8125]); // 无论成败，回收可能的孤儿服务
}

const failed = results.filter(([, ok]) => !ok);
const pad = Math.max(...results.map(([n]) => n.length));
console.log(`
${C.b}╔══════════════════════════════════════╗${C.rst}
${C.b}║          测 试 结 果 汇 总           ║${C.rst}
${C.b}╠══════════════════════════════════════╣${C.rst}`);
for (const [n, ok] of results) {
  console.log(`${ok ? `${C.grn}║ ✓` : `${C.red}║ ✗`} ${C.rst}${n.padEnd(pad)}${ok ? C.grn : C.red}${C.rst}`);
}
const verdict = failed.length === 0
  ? `${C.grn}${C.b}全部通过 · ${results.length}/${results.length} 门通过${C.rst}`
  : `${C.red}${C.b}失败 ${failed.length}/${results.length}${C.rst}`;
console.log(`${C.b}╠══════════════════════════════════════╣${C.rst}\n║ ${verdict}\n${C.b}╚══════════════════════════════════════╝${C.rst}`);
process.exit(failed.length ? 1 : 0);
