import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// MIT 合规插件（2026-09-29）：esbuild minify 会剥离 rollup banner 与源内 legal 注释
//（banner/legalComments 两路均被吞，实证）——closeBundle 后置注入是唯一确定路径，
// 且对 `npx vite build` 直跑同样生效（CI 用此入口）。
const LICENSES: Record<string, string> = {
  three: '/*! three.js | MIT License | (c) 2010-2026 three.js authors | https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE */',
  self: '/*! TPMS Explorer | MIT License | (c) 2026 zhaoliuxin926-ux | https://github.com/zhaoliuxin926-ux/tpms-explorer/blob/main/LICENSE */',
};
function licenseHeaders(): Plugin {
  return {
    name: 'license-headers',
    closeBundle() {
      const dir = join(process.cwd(), 'dist/assets');
      try {
        for (const f of readdirSync(dir)) {
          if (!f.endsWith('.js')) continue;
          const p = join(dir, f);
          const head = readFileSync(p, 'utf8');
          if (head.startsWith('/*!')) continue;
          const lic = f.startsWith('three-') ? LICENSES.three : LICENSES.self;
          writeFileSync(p, lic + '\n' + head);
        }
      } catch (e) { console.warn('[license-headers] skip:', String(e).slice(0, 80)); }
    },
  };
}

export default defineConfig({
  plugins: [licenseHeaders()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Three.js 被单独拆为 vendor chunk，体积天然偏大；提升阈值避免无意义告警
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
