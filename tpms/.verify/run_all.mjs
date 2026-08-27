// 一键全量回归 runner：起服务 → 依序跑全部正式回归套件 → 汇总
// 用法：node run_all.mjs   （在 tpms/.verify/ 下运行；Node 26+ 直跑 TS 导入）
// 前置：工程版已构建并部署到 docs/platform/（本脚本服务部署产物，不自行构建）
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PLAT_DIR = path.join(ROOT, 'docs/platform');
const DOCS_DIR = path.join(ROOT, 'docs');
const PORT_PLAT = 4814;
const PORT_DOCS = 8125;
const BASE_PLAT = `http://localhost:${PORT_PLAT}/`;

const suites = [
  { name: 'evaluator（求值器安全 37 项）', cmd: ['node', 'evaluator_check.mjs'], env: {} },
  { name: 'fix_check（工程版接线 23 项）', cmd: ['node', 'fix_check.mjs'], env: { BASE: BASE_PLAT } },
  { name: 'verify_fixes（红队复验 10 项）', cmd: ['node', 'redteam/verify_fixes.mjs'], env: { BASE: BASE_PLAT } },
  { name: 'verify_followups（遗留修复 10 项）', cmd: ['node', 'redteam/verify_followups.mjs'], env: { BASE: BASE_PLAT } },
  { name: 'verify_tip_toggle（tip 收纳 10 项）', cmd: ['node', 'redteam/verify_tip_toggle.mjs'], env: {} },
  { name: 'verify（单文件版 18 项）', cmd: ['node', 'verify.mjs'], env: { BASE: `http://localhost:${PORT_DOCS}/` } },
];

function startServer(port, dir) {
  const p = spawn('python', ['-m', 'http.server', String(port), '--directory', dir.replace(/\//g, '\\')], {
    stdio: 'ignore', detached: false,
  });
  return p;
}

function runSuite({ name, cmd, env }) {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], [cmd[1]], {
      cwd: HERE,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', (code) => {
      const m = out.match(/== RESULT: (\d+) PASS \/ (\d+) FAIL ==/) || out.match(/PASS (\d+) \/ (\d+)/);
      // 两种输出格式："RESULT: X PASS / Y FAIL" 与 "PASS X / Y"（单文件版总分行）
      const isResultFmt = /== RESULT:/.test(out);
      const summary = isResultFmt && m ? `${m[1]} PASS / ${m[2]} FAIL` : m ? `${m[1]} / ${m[2]} 全过` : `exit=${code}`;
      console.log(`[${code === 0 ? 'OK ' : 'ERR'}] ${name} — ${summary}`);
      if (code !== 0) console.log(out.split('\n').filter(l => l.includes('FAIL')).slice(0, 5).join('\n'));
      resolve(code === 0);
    });
  });
}

const srvPlat = startServer(PORT_PLAT, PLAT_DIR);
const srvDocs = startServer(PORT_DOCS, DOCS_DIR);

// 端口就绪轮询替代固定 sleep(3000)：新构建产物落在联想管家实时扫描窗口时，
// 固定等待会间歇性 ERR_CONNECTION_REFUSED（fix_check 假阴性 flake，2026-08-27 实录）
import net from 'node:net';
function waitPort(port, timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function probe() {
      const s = net.connect({ host: 'localhost', port, timeout: 800 });
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => retry());
      s.on('timeout', () => { s.destroy(); retry(); });
      function retry() {
        if (Date.now() - t0 > timeoutMs) reject(new Error(`端口 ${port} 未就绪`));
        else setTimeout(probe, 300);
      }
    })();
  });
}
await Promise.all([waitPort(PORT_PLAT), waitPort(PORT_DOCS)]);
console.log('[服务] 4814(docs/platform) 与 8125(docs) 已就绪');

const results = [];
for (const s of suites) results.push([s.name, await runSuite(s)]);

srvPlat.kill(); srvDocs.kill();
const failed = results.filter(([, ok]) => !ok);
console.log('\n===== 全量回归汇总 =====');
results.forEach(([n, ok]) => console.log(`${ok ? '✓' : '✗'} ${n}`));
console.log(`共 ${results.length} 套，失败 ${failed.length} 套`);
process.exit(failed.length ? 1 : 0);
