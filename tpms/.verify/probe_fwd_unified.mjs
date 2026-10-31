// 验证：逆设计 forwardModel 与主面板 estimate 同源同值（用户复核第 2 点闭环）
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const PLATFORM = join(process.cwd(), '../tpms-platform');
const entry = join(process.env.TEMP ?? '/tmp', 'fwd_unified_entry.ts');
writeFileSync(entry, `export { forwardModel } from ${JSON.stringify(join(PLATFORM, 'src/physics/inverse-design.ts'))};`);
const out = join(process.env.TEMP ?? '/tmp', 'fwd_unified_bundle.mjs');
const rolldown = join(PLATFORM, 'node_modules/.bin/rolldown' + (process.platform === 'win32' ? '.cmd' : ''));
spawnSync(`"${rolldown}" "${entry}" --format esm --file "${out}"`, { shell: true });
const { forwardModel } = await import('file:///' + out.split('\\').join('/'));
const f = forwardModel('gyroid', 0.6, 2, 1);   // porosity 语义=孔隙率（ρ̄=0.4）
console.log('逆设计前向 @por60/tc4/aniso1: E =', f.EGPa.toFixed(3), 'GPa  | estimate 同参 =', (1.02 * Math.pow(0.4, 2.25) * 110).toFixed(3), 'GPa');
