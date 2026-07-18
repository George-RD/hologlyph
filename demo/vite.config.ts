import { defineConfig } from 'vite';

// Standalone app config for the demo page. The repo root vite.config.ts is a
// library-mode build; this one produces a deployable index.html for GitHub
// Pages at https://george-rd.github.io/hologlyph/.
export default defineConfig({
  base: '/hologlyph/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
