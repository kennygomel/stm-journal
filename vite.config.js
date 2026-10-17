import { defineConfig } from 'vite';

export default defineConfig({
  // The site is served from the host root (https://app<id>.tgcloud.ai/).
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
  server: { host: true, port: 5173 },
});
