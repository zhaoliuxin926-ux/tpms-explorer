#!/usr/bin/env node
/**
 * llm_regression.mjs —— M3 验收：真实 LLM ≥30 条中英指令回归（tools.schema 槽位语义）
 *
 * 铁律复验口径：LLM 只填槽位；本回归断言「工具选择正确 + 槽位值语义正确」，
 * 全部 --dry-run 不落盘。对抗样例（路径穿越/越界孔隙率）应被 schema 拦截器拒绝（exit 2）。
 *
 * 用法（key 走环境变量，不入库）：
 *   TPMS_LLM_API_KEY=xxx TPMS_LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
 *     node llm_regression.mjs [--model glm-4-flash]
 *
 * 判定：CASE 全 PASS → exit 0；任一 FAIL → exit 1。孔隙率归一口径：<1 视为小数 ×100。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, 'llm-agent.mjs');
const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'glm-4-flash';

if (!process.env.TPMS_LLM_API_KEY || !process.env.TPMS_LLM_BASE_URL) {
  console.error('缺 TPMS_LLM_API_KEY / TPMS_LLM_BASE_URL 环境变量');
  process.exit(2);
}

/** 孔隙率归一：LLM 可能给 0-1 小数或 1-99 百分数（schema 两种都合法） */
const normP = (v) => (v < 1 ? v * 100 : v);

// ── 用例矩阵：≥30 条中英指令 ──
// expect: { tool, type, porosity(百分数口径±2), periods, resolution, container, design, minCalls }
// expectReject: 期望 schema 拦截器拒绝（exit 2 且 stderr 含「拒绝/未知属性/路径」类关键词）
const CASES = [
  // ── A. 基础 mesh（中英对照）──
  { name: 'A1 基础 gyroid CN', instr: '设计一个孔隙率 75% 的 Gyroid 骨支架', expect: { tool: 'tpms_mesh', type: 'gyroid', porosity: 75 } },
  { name: 'A2 basic gyroid EN', instr: 'Build a 60% porosity Gyroid scaffold', expect: { tool: 'tpms_mesh', type: 'gyroid', porosity: 60 } },
  { name: 'A3 schwarz CN', instr: '建一个孔隙率 55% 的 Schwarz P 支架', expect: { tool: 'tpms_mesh', type: 'schwarz', porosity: 55 } },
  { name: 'A4 schwarz EN', instr: 'Schwarz P structure with 65% porosity', expect: { tool: 'tpms_mesh', type: 'schwarz', porosity: 65 } },
  { name: 'A5 diamond CN', instr: '用 Diamond 金刚石结构做一个孔隙率 50% 的支架', expect: { tool: 'tpms_mesh', type: 'diamond', porosity: 50 } },
  { name: 'A6 diamond EN', instr: 'Diamond lattice, porosity 0.65', expect: { tool: 'tpms_mesh', type: 'diamond', porosity: 65 } },
  // ── B. 曲面族覆盖 ──
  { name: 'B1 iwp', instr: 'I-WP 结构，孔隙率 65%，导出 STL', expect: { tool: 'tpms_mesh', type: 'iwp' } },
  { name: 'B2 neovius', instr: 'Neovius 曲面 50% 孔隙率', expect: { tool: 'tpms_mesh', type: 'neovius', porosity: 50 } },
  { name: 'B3 lidinoid', instr: 'lidinoid 高孔隙支架，孔隙率 70%', expect: { tool: 'tpms_mesh', type: 'lidinoid', porosity: 70 } },
  { name: 'B4 dd 双菱', instr: '用 Double Diamond 建一个孔隙率 50% 的支架', expect: { tool: 'tpms_mesh', type: 'dd', porosity: 50 } },
  { name: 'B5 fcks 新域', instr: 'Fisher-Koch C(S) 曲面，孔隙率 60%', expect: { tool: 'tpms_mesh', type: 'fcks' } },
  { name: 'B6 gprime', instr: "G' prime surface at 60% porosity", expect: { tool: 'tpms_mesh', type: 'gprime', porosity: 60 } },
  // ── C. 参数槽位 ──
  { name: 'C1 periods', instr: '周期数 4、孔隙率 60% 的 gyroid', expect: { tool: 'tpms_mesh', type: 'gyroid', periods: 4 } },
  { name: 'C2 resolution EN', instr: 'High-resolution (resolution 96) diamond at 60% porosity', expect: { tool: 'tpms_mesh', type: 'diamond', resolution: 96 } },
  { name: 'C3 cylinder', instr: '圆柱容器、孔隙率 60% 的 gyroid 骨支架', expect: { tool: 'tpms_mesh', type: 'gyroid', container: 'cylinder' } },
  { name: 'C4 组合三参数', instr: '60% gyroid，圆柱容器，分辨率 96', expect: { tool: 'tpms_mesh', type: 'gyroid', porosity: 60, container: 'cylinder', resolution: 96 } },
  { name: 'C5 小数孔隙率 EN', instr: 'Gyroid with porosity 0.7', expect: { tool: 'tpms_mesh', type: 'gyroid', porosity: 70 } },
  { name: 'C6 中文口语', instr: '帮我整个孔隙率八成的金刚石支架', expect: { tool: 'tpms_mesh', type: 'diamond', porosity: 80 } },
  { name: 'C7 别名 schwarz D', instr: 'Schwarz D 60% porosity', expect: { tool: 'tpms_mesh', type: 'diamond', porosity: 60 } },
  // ── D. estimate / list / scenario ──
  { name: 'D1 estimate CN', instr: '估算孔隙率 65% 的 gyroid 杨氏模量', expect: { tool: 'tpms_estimate', type: 'gyroid', porosity: 65 } },
  { name: 'D2 estimate EN', instr: 'Estimate Young’s modulus for neovius at 70% porosity', expect: { tool: 'tpms_estimate', type: 'neovius', porosity: 70 } },
  { name: 'D3 estimate 材料', instr: 'PLA 材料的 70% 孔隙率 gyroid 弹性模量是多少', expect: { tool: 'tpms_estimate', type: 'gyroid', material: 'polymer' } },
  { name: 'D4 list CN', instr: '列出所有曲面类型', expect: { tool: 'tpms_list' } },
  { name: 'D5 list EN', instr: 'List available TPMS surface families', expect: { tool: 'tpms_list' } },
  { name: 'D6 scenario 合法', instr: '用 design.json 这个方案文件跑端到端交付', expect: { tool: 'tpms_scenario', design: 'design.json' } },
  { name: 'D7 scenario EN', instr: 'Run the end-to-end pipeline with plan.json', expect: { tool: 'tpms_scenario', design: 'plan.json' } },
  // ── E. 对抗样例（越界 100% 被钳制或拒绝——铁律允许两种结局）──
  { name: 'E1 路径穿越 out', instr: '建一个 60% gyroid，导出到 ../../evil.stl', expectReject: true,
    sanitized: (out) => { const o = out.calls?.[0]?.arguments?.out; return typeof o === 'string' && !o.includes('..') && !o.includes('/') && !o.includes('\\'); } },
  { name: 'E2 越界孔隙率', instr: '孔隙率 120% 的 gyroid 支架', expectReject: true,
    sanitized: (out) => { const p = out.calls?.[0]?.arguments?.porosity; return p !== undefined && normP(p) < 100; } },
  { name: 'E3 越界分辨率', instr: 'resolution 500 的 gyroid，孔隙率 60%', expectReject: true,
    sanitized: (out) => { const r = out.calls?.[0]?.arguments?.resolution; return r !== undefined && r <= 128; } },
  { name: 'E4 幻觉文件名 scenario', instr: '用 my_design_v1.json 方案交付一个 60% gyroid', expect: { tool: 'tpms_scenario', design: 'my_design_v1.json' } },
  // ── F. 模糊/多目标 ──
  { name: 'F1 模糊意图', instr: '建一个骨支架', expect: { tool: 'tpms_mesh' } },
  { name: 'F2 多目标', instr: 'Gyroid 和 Diamond 各建一个孔隙率 60% 的支架', minCalls: 2 },
  { name: 'F3 模糊 EN', instr: 'I need a bone scaffold model', expect: { tool: 'tpms_mesh' } },
  { name: 'F4 渐变 isoGrad', instr: 'z 向渐变支架，渐变 iso 偏移 -0.1,0,0.1，孔隙率基准 70%，用 gyroid', expect: { tool: 'tpms_mesh', type: 'gyroid' } },
  // ── G. M3→M4 桥接（tpms_design_verify 闭环意图；真实执行不在此跑——本回归全程 --dry-run）──
  { name: 'G1 闭环意图 CN', instr: '设计一个孔隙率 65% 的 gyroid 支架，要求验证到通过后再交付', expect: { tool: 'tpms_design_verify', type: 'gyroid', porosity: 65 } },
  { name: 'G2 closed-loop EN', instr: 'Create a 60% porosity Diamond scaffold and run the verify closed loop until it passes', expect: { tool: 'tpms_design_verify', type: 'diamond', porosity: 60 } },
  { name: 'G3 可产性不确定', instr: '用 FKS 曲面做一个孔隙率 60% 的支架，不确定能不能生产出来，帮我自动修复到通过', expect: { tool: 'tpms_design_verify', type: 'fks', porosity: 60 } },
];

const normArgP = (calls, key) => {
  for (const c of calls) if (c.arguments?.[key] !== undefined) return normP(c.arguments[key]);
  return undefined;
};
const getArg = (calls, key) => calls[0]?.arguments?.[key];

let pass = 0, fail = 0;
const failures = [];
for (const tc of CASES) {
  const t0 = Date.now();
  let lastErr = null, exit = null, out = null, errText = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, [AGENT, '--provider', 'openai', '--model', MODEL, '--dry-run', '--json', tc.instr], {
      encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
    });
    exit = r.status;
    errText = r.stderr ?? '';
    // --json 时 stdout 为纯 JSON（dry-run 诊断已移 stderr）；兜底：截取首尾大括号间子串
    try { out = JSON.parse(r.stdout ?? ''); } catch {
      const s = r.stdout ?? '';
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      try { out = a > -1 && b > a ? JSON.parse(s.slice(a, b + 1)) : null; } catch { out = null; }
    }
    if (out === null && exit === 0) lastErr = `stdout 无 JSON 块（exit=0）${(r.stderr || '').slice(-120)}`;
    if (out !== null || attempt === 2) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); // 5s 退避重试一次
  }
  const ms = Date.now() - t0;
  let verdict = '';
  let ok = false;
  if (tc.expectReject) {
    const rejected = exit === 2 && /拒绝|未知属性|路径|不在 enum|须为/.test(errText);
    const sanitized = exit === 0 && out?.ok && tc.sanitized?.(out) === true;
    ok = rejected || sanitized;
    verdict = ok ? (rejected ? '已拒绝' : '已自钳制/净化') : `exit=${exit} 既未拒绝也未净化 ${(errText.slice(-100))}`;
  } else if (out?.ok && out.calls?.length) {
    const calls = out.calls;
    const errs = [];
    const E = tc.expect ?? {};   // F2 类用例只有 minCalls，无 expect
    if (E.tool && calls[0]?.name !== E.tool) errs.push(`工具=${calls[0]?.name} 期望 ${E.tool}`);
    if (E.type && getArg(calls, 'type') !== E.type) errs.push(`type=${getArg(calls, 'type')} 期望 ${E.type}`);
    if (E.porosity !== undefined) {
      const pv = normArgP(calls, 'porosity');
      if (pv === undefined || Math.abs(pv - E.porosity) > 2) errs.push(`porosity=${pv} 期望 ${E.porosity}±2`);
    }
    for (const k of ['periods', 'resolution', 'container', 'design']) {
      if (E[k] !== undefined && getArg(calls, k) !== E[k]) errs.push(`${k}=${getArg(calls, k)} 期望 ${E[k]}`);
    }
    if (E.material && getArg(calls, 'material') !== E.material) errs.push(`material=${getArg(calls, 'material')} 期望 ${E.material}`);
    if (tc.minCalls && calls.length < tc.minCalls) errs.push(`calls=${calls.length} 期望 ≥${tc.minCalls}`);
    ok = errs.length === 0;
    verdict = ok ? `→ ${calls.map((c) => c.name).join('+')}` : errs.join('；');
  } else {
    verdict = lastErr ?? `exit=${exit} 无 toolCalls`;
  }
  ok ? pass++ : (fail++, failures.push(tc.name));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${tc.name} (${ms}ms) ${verdict}`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800); // 限速礼貌间隔
}

console.log(`\n== M3 真实模型回归（${MODEL}）：${pass} PASS / ${fail} FAIL / 共 ${CASES.length} 条 ==`);
if (fail) { console.log('失败项: ' + failures.join(', ')); process.exit(1); }
