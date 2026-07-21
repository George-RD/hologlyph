# Feature-shading lab: session state

Updated 2026-07-21 (landing round). The lab and its docs are now COMMITTED;
this file tracks their purpose and what remains owner-session-only.

## Committed lab artefacts

- `demo/index.html` - the LAB is now the landing page (was
  feature-shading-lab.html; a redirect stub remains at the old URL). Live
  TSL uniforms on the real bust: motion (incl. blink hold), zone opacities,
  feature shading, text fit, tone, eyes, expressions, speech, presets,
  config-JSON export. Controls hidden behind the "tune" button (or ?tune).
  Boot defaults + the 'Owner 07-21' preset are the owner-approved config
  (meta/sources/src.owner-approved-look-2026-07-21.md).
  Serve with `bun run dev`, open /hologlyph/ - deployed to GitHub Pages.
- `demo/engine.html` - the scroll-emergence engine demo (previous landing
  page); the visual eval and demo-smoke capture THIS page.
- `demo/feature-shading-variants.html` - older static side-by-side grid
  (superseded by the lab, kept for comparison).
- `demo/TEXT-LAYERS.md` - explainer of the text layers and their sliders.
- `tools/smoke/feature-variants-shot.mjs`, `tools/smoke/lab-shot.mjs` -
  Playwright captures for the two demo pages.

## Where the approved look lives

- Ratified defaults: meta/sources/src.owner-approved-look-2026-07-21.md
  (also the lab's boot state). The library port MUST seed its TDD pins from
  it - see meta/todos/todo.textskin-port-owner-config.md.

## Open follow-ups (meta/todos/)

- todo.textskin-port-owner-config - port shading system into src/ properly.
- todo.lab-control-refinements - caruncle SIZE control, tighter lips band,
  hard-edge glyph overlap seam.
- todo.background-adaptive-look - lab background switcher; opaque-core +
  translucent text shell exploration; day/night theming.
- Earlier staged items (neck weights, iris patterns, eyelid occlusion
  physics) recorded in meta/research/res.feature-shading-exploration.md.
