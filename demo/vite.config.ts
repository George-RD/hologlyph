import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone app config for the demo pages. The repo root vite.config.ts is a
// library-mode build; this one produces the deployable pages for GitHub
// Pages at https://george-rd.github.io/hologlyph/.
//
// Pages: index.html (the text-skinned head with the owner-approved look;
// "tune" opens the shading-lab panel), engine.html (scroll-emergence engine
// demo), studio.html (one organised control surface over the library engine:
// live personalisation, advanced trims folded away, a developer tier for work
// in progress), outcomes.html (the 2026-07-27 look rulings and the melt
// judgement, with studio and the comparison embedded),
// feature-shading-lab.html (redirect stub for the lab's old URL).
//
// The one-off `*-lab.html` spike pages are deliberately NOT here. They are
// dev-only scaffolding and several reach into `EngineImpl` privates.
// studio.html stays on the public surface, which is why it is the one that
// ships. compare-lab.html is the exception: outcomes.html embeds it, so it is
// listed too.
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
        studio: fileURLToPath(new URL('studio.html', import.meta.url)),
        outcomes: fileURLToPath(new URL('outcomes.html', import.meta.url)),
        compareLab: fileURLToPath(new URL('compare-lab.html', import.meta.url)),
        labRedirect: fileURLToPath(new URL('feature-shading-lab.html', import.meta.url)),
      },
    },
  },
});
