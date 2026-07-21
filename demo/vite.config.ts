import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone app config for the demo pages. The repo root vite.config.ts is a
// library-mode build; this one produces the deployable pages for GitHub
// Pages at https://george-rd.github.io/hologlyph/.
//
// Pages: index.html (the text-skinned head with the owner-approved look;
// "tune" opens the shading-lab panel), engine.html (scroll-emergence engine
// demo), feature-shading-lab.html (redirect stub for the lab's old URL).
export default defineConfig({
  base: '/hologlyph/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        engine: fileURLToPath(new URL('engine.html', import.meta.url)),
        labRedirect: fileURLToPath(new URL('feature-shading-lab.html', import.meta.url)),
      },
    },
  },
});
