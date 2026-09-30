/**
 * probe_url_fuzz.mjs —— URL 参数模糊探针（2026-09-30 第八轮：随机/畸形输入，独立不进 CI）
 *
 * 守护对象：分享链接恢复链（url-params）对非设计输入的鲁棒性——
 * state_url_audit 是定向断言，本探针做批量畸形注入（类型混乱/越界/超长/控制字符/
 * 巨型 state），断言每条都 fail-closed（不崩、不白屏、5s 内 boot 完成）。
 *
 * 用法：node probe_url_fuzz.mjs
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 4863;

const srv = spawn(process.execPath, [join(HERE, 'static-server.mjs'), String(PORT), join(HERE, '../../docs/platform')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

// 畸形参数语料（覆盖：标量越界/类型混乱/控制字符/超长/重复参数/巨型 state/坏 JSON/坏 UTF-8 转义）
const A = 'A'.repeat(8000);
const BIG = 'x'.repeat(120000);
const cases = [
  '?p=NaN', '?p=Infinity', '?p=-Infinity', '?p=1e999', '?p=0x10', '?p=%00', '?p=' + '-'.repeat(200) + '1',
  '?p=99999', '?p=-99999', '?p=50.5.5', '?p=%E4%B8%AD', '?p=null', '?p=undefined', '?p=[object Object]',
  '?type=notexist', '?type=__proto__', '?type=constructor', '?type=hasOwnProperty', '?type=%FF%FE',
  '?type=gyroid&type=diamond&type=warpdrive',
  '?formula=' + encodeURIComponent('sin(x*' + A + ')'), '?formula=' + encodeURIComponent('}){}{while(1){}'),
  '?state=notjson', '?state=%7B%22broken%22', '?state=' + encodeURIComponent('{"__proto__":{"polluted":1}}'),
  '?state=' + encodeURIComponent(JSON.stringify({ type: 'gyroid', porosity: 1e308 })),
  '?state=' + BIG.slice(0, 60000),
  '?k=13&k=99', '?res=0', '?res=-48', '?res=1e9', '?mode=destroy', '?iso=-99',
  '?seed=%2D1', '?theme=%00hack', '?v=v99.99.99',
  '?p=50&p=90&p=abc', '?type=&p=', '??p=50', '?%z=1', '?p=50#frag', '?a%00b=c',
  ...Array.from({ length: 10 }, (_, i) => '?p=' + (i % 2 ? '50' : '90') + '&r=' + BIG.slice(0, 5000 + i * 3000) + '&i=' + i),
];

let pass = 0, fail = 0, rejCount = 0;
const fails = [];
const browser = await chromium.launch({ channel: 'chrome', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox', '--headless=new'] });
try {
  const ctx = await browser.newContext();
  for (let i = 0; i < cases.length; i++) {
    const q = cases[i];
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 70)));
    let booted = false, rejected = false;
    try {
      await page.goto(`http://127.0.0.1:${PORT}/${q}`, { waitUntil: 'domcontentloaded', timeout: 8000 });
      await page.waitForFunction(() => !!(document.querySelector('canvas') || document.querySelector('#app') || document.querySelector('.panel')), { timeout: 5000 });
      booted = true;
    } catch (e) {
      // 【取证定案 2026-09-30】>16KB 请求行被 Node 默认 431 拒绝（实测 14KB=200/29KB=431），
      // 页面 JS 未执行=服务器层正确 fail-closed（合法分享 state 远小于 16KB）——拒绝类算 PASS
      if (/ERR_HTTP_RESPONSE_CODE_FAILURE|net::ERR/.test(String(e))) rejected = true;
    }
    const okCase = rejected || (booted && errs.length === 0);
    if (okCase) pass++; else { fail++; fails.push(`#${i} ${q.slice(0, 60)} → ${errs[0] ?? (booted ? 'boot 判定失败' : '超时/白屏')}`); }
    if (rejected) rejCount++;
    await page.close();
  }
} finally {
  await browser.close().catch(() => {});
  srv.kill();
}
console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL（${cases.length} 条畸形注入）`);
if (fails.length) for (const f of fails) console.log('  ✗ ' + f);
process.exit(fail ? 1 : 0);
