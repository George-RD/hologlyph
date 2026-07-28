import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone app config for the demo pages. The repo root vite.config.ts is a
// library-mode build; this one produces the deployable pages for GitHub
// Pages at https://george-rd.github.io/hologlyph/.
//
// ONE environment, deliberately. The owner, 2026-07-28: "Idea being not having
// to maintain different environments... its confusing for me to have to open all
// sorts of websites when checking." So there is one URL to check, the site
// root, and everything that used to be its own page is folded into it:
//
//   index.html   the studio. The library engine with the glass, which is now the
//                default rather than a lab feature; the melt in a developer
//                tier; the 2026-07-27 rulings as a notes tier.
//   engine.html  NOT linked from anywhere, and not to be folded in: it is the
//                target of `tools/evals/capture.mjs`, so the visual eval needs
//                it to keep existing at a stable URL.
//   feature-shading-lab.html  redirect stub, keeps an old bookmark alive.
//
// Everything else under `demo/` is out of the deployed set and stays out:
//
//   handrolled.html   the previous root. A SECOND renderer, hand-rolled in TSL
//                     rather than built on the library engine. Kept in the repo
//                     as the owner-approved-look reference and as the left half
//                     of compare-lab, but not deployed: two implementations of
//                     one head is exactly what is being consolidated away.
//   compare-lab.html  those two implementations side by side. Its job is done.
//                     The port was checked by eye on 2026-07-27 and the
//                     differences recorded in the liquid-head-melt notes.
//   *-lab.html        nine one-off feature spikes, each superseded by a tier in
//                     the studio. Several reach into `EngineImpl` privates,
//                     which is the other reason they never shipped.
//   *-spike.html, *-variants.html   research artefacts cited by decisions.
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
