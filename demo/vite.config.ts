import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone app config for the demo pages. The repo root vite.config.ts is a
// library-mode build; this one produces the deployable pages for GitHub Pages
// at https://george-rd.github.io/hologlyph/.
//
// The site root is the presentation surface: a mobile-first head, speech and
// expression controls, with the compact live-look drawer hidden by default.
// The previous full studio remains at studio.html as the deep tuning surface.
// engine.html stays at a stable URL for tools/evals/capture.mjs. The old
// feature-shading URL remains a redirect stub for existing bookmarks.
//
// Everything else under demo/ stays outside the deployed set. The one-off labs
// and spikes remain research artefacts rather than parallel public demos.
export default defineConfig({
  base: '/hologlyph/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        studio: fileURLToPath(new URL('studio.html', import.meta.url)),
        engine: fileURLToPath(new URL('engine.html', import.meta.url)),
        labRedirect: fileURLToPath(new URL('feature-shading-lab.html', import.meta.url)),
      },
    },
  },
});
