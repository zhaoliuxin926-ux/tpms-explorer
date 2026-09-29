/**
 * server_edge_check.mjs —— static-server 边缘行为探针（红队 D L-1 回归钉，2026-09-29）
 *
 * 守护对象：静态服务器的三条边缘路径（run_all UI 门禁全量依赖此服务器，
 * 但此前只测过 200 路径——畸形请求的失败语义无断言）：
 *   1. 畸形百分号转义（/%zz）→ 400 而非 500（500 会污染门禁日志为假信号）
 *   2. 多斜杠折叠（//app.html）→ 200（run_all BASE 尾斜杠拼出的形状，历史坑）
 *   3. 正常 /index.html → 200
 *   4. 路径穿越（/../package.json）→ 拒绝（403/404 任一，不得 200）
 *
 * 用法：node server_edge_check.mjs（在 tpms/.verify/ 下运行）
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 4859;

const srv = spawn(process.execPath, [join(HERE, 'static-server.mjs'), String(PORT), join(HERE, '../../docs/platform')], { stdio: 'ignore' });

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`PASS ${name}`); };
const bad = (name, detail) => { fail++; console.log(`FAIL ${name} — ${detail}`); };

const http = await import('node:http');
const req = (path) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path }, (res) => {
    res.resume();
    resolve(res.statusCode);
  });
  r.on('error', (e) => resolve('ERR ' + String(e).slice(0, 60)));
  r.end();
});

// 等服务就绪
let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const c = await req('/index.html');
  ready = c === 200;
}

try {
  if (!ready) { bad('服务启动', '40×250ms 内 /index.html 未 200'); }
  else {
    ok('服务启动（static-server 服务 docs/platform）');

    const c1 = await req('/%zz');
    c1 === 400 ? ok('畸形转义 /%zz → 400（非 500 假信号）') : bad('畸形转义 /%zz', `got ${c1}（期望 400）`);

    const c2 = await req('//index.html');
    c2 === 200 ? ok('多斜杠折叠 //index.html → 200') : bad('多斜杠折叠', `got ${c2}`);

    const c3 = await req('/../package.json');
    (c3 === 403 || c3 === 404) ? ok(`路径穿越 /../package.json → ${c3}（拒绝且非 200）`) : bad('路径穿越拒绝', `got ${c3}`);
  }
} finally {
  srv.kill();
}

console.log(`\n== RESULT: ${pass} PASS / ${fail} FAIL ==`);
if (pass < 3) { console.error(`GUARD FAIL: 断言执行数 ${pass} < 基线 3`); process.exit(1); }
process.exit(fail ? 1 : 0);
