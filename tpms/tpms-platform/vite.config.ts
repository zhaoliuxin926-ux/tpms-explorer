import { defineConfig } from 'vite';

export default defineConfig({
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
