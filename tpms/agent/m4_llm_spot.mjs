import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const cases = [
  { name: 'fcks R96 薄壁自触（期望：升 R120 或换族）', design: { type: 'fcks', porosity: 0.6, resolution: 96 }, file: 'm4llm1.json' },
  { name: 'gprime k6 R96 薄壁自触（期望：降周期/换族/升 R）', design: { type: 'gprime', porosity: 0.6, resolution: 96 }, file: 'm4llm2.json' },
];
for (const c of cases) {
  writeFileSync('C:/Users/qi/AppData/Local/Temp/' + c.file, JSON.stringify(c.design));
  const r = spawnSync(process.execPath, ['tpms-driver.mjs', '--design', 'C:/Users/qi/AppData/Local/Temp/' + c.file, '--provider', 'openai', '--model', 'glm-4.6', '--max-rounds', '5', '--json'], {
    encoding: 'utf8', timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TPMS_LLM_API_KEY: process.env.TPMS_LLM_API_KEY, TPMS_LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4' },
  });
  let rep = null;
  try { rep = JSON.parse(r.stdout); } catch { /* 失败路径 */ }
  console.log(`\n== ${c.name} ==`);
  console.log(`exit=${r.status} verdict=${rep?.verdict} rounds=${rep?.rounds}`);
  if (rep?.file) console.log(`交付: ${rep.file} 实测孔隙率 ${(rep.metrics?.porosityEstimate * 100).toFixed(2)}% R=${rep.resolutionUsed}`);
  if (rep?.reason) console.log(`不可达原因: ${rep.reason}`);
  for (const h of rep?.history ?? []) if (h.decision) console.log(`  R${h.round}: ${h.decision.action} ${JSON.stringify(h.decision.patches ?? {})} — ${h.decision.reason?.slice(0, 80)}`);
  if (!rep) console.log((r.stderr ?? '').slice(-300));
}
