import { defineConfig } from 'tsup';

const buildWorkerConfig = defineConfig({
  entry: ['./worker.ts'],
  outDir: '.vite-env-dist',
  format: ['esm'],
  platform: 'browser',
  noExternal: [/.*/],
});

export default [buildWorkerConfig];
