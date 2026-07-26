# Next unit of work

Updated 2026-07-26 after `2026-07-26-liquid-glass-solid-body` landed.

**Start here: `meta/todos/todo.liquid-glass-silhouette-hull.md`** (Order 2 of
`dec.liquid-glass-architecture`, node `hologlyph.asset.pipeline`). `cairn brief`
picks the Chromium lens instead because it orders alphabetically; the `Order N`
line in each todo is authoritative, so ignore that recommendation.

What the hull item needs, in one paragraph so you can start cold: compute a 20
to 40 vertex outline hull of the bust offline in `tools/asset-pipeline/`, store
it beside the GLB or as an extra accessor, keep it deterministic so the
regen byte-equality test in `test/asset-bust.test.ts` still holds, then project
those vertices through the current head pose on the CPU each frame and emit a
`polygon()` string with no allocation and no GPU readback. Verify containment
across the full yaw and pitch range and under emergence. It is the blocking
dependency of items 6 and 7.

Three things the solid-body change leaves you:

- `src/asset/rig.ts` now has a grid-accelerated raycaster (`computeThickness`)
  with a correct DDA over triangle buckets and a four-way budget that degrades
  to zero rather than stalling. The hull bake is a different problem, but the
  grid, the stamping and the budget pattern are there to copy.
- Any visual acceptance check MUST pin the bones and every morph influence
  array before capturing, and MUST establish its own noise floor by repeating
  the same capture on the same code first. See `tools/smoke/solid-body-shot.mjs`
  and the measurement-trap section of
  `meta/changes/archive/2026-07-26-2026-07-26-liquid-glass-solid-body/implementation-notes.md`:
  `setMotionFrozen` leaves the head wherever idle motion had drifted to, so any
  change to load-time work shifts every bind-pose-welded glyph and reads as a
  5% pixel diff that is not there.
- `EngineImpl.applyGlassLayering` reconciles the render-list layering with
  `skin.glass.amount` every frame. Anything that adds a layer to the head must
  go through it, or `glass.amount = 0` stops reproducing the approved look.

Other unblocked items, in order: 3 `tier1-pool`, 4 `snapshot-lens`,
5 `chromium-lens`, and 10 `interior-glyphs` (unblocked by this change).

# Feature-shading lab: session state

Updated 2026-07-21 (landing round). The lab and its docs are now COMMITTED;
this file tracks their purpose and what remains owner-session-only.

## Committed lab artefacts

- `demo/index.html` - the LAB is now the landing page (was
  feature-shading-lab.html; a redirect stub remains at the old URL). Live
  TSL uniforms on the real bust: motion (incl. blink hold), zone opacities,
  feature shading, text fit, tone, eyes, expressions, speech, presets,
  config-JSON export. Controls hidden behind the "tune" button (or ?tune).
  Landing shell adds intro copy, a wider default camera (z=2.05), and a
  type-your-own-text speak bar. Speak visemes are word-boundary driven via
  src/speech/visemes.ts (wordAt + visemeSequenceForWord, 75 ms cadence,
  50/120 ms attack/release), with a timer-walked word fallback when the
  voice emits no boundary events. The engine-demo topbar link was removed
  (owner request, 2026-07-21).
  Boot defaults + the 'Owner 07-21' preset are the owner-approved config
  (meta/sources/src.owner-approved-look-2026-07-21.md).
  Serve with `bun run dev`, open /hologlyph/ - deployed to GitHub Pages.
- `demo/engine.html` - the scroll-emergence engine demo (previous landing
  page); no longer linked from the landing but MUST stay: the visual eval
  and demo-smoke capture THIS page.
- `demo/feature-shading-variants.html` - older static side-by-side grid
  (superseded by the lab, kept for comparison).
- `demo/TEXT-LAYERS.md` - explainer of the text layers and their sliders.
- `demo/backdrop-clip-spike.html` plus `tools/smoke/backdrop-clip-spike.mjs` -
  spike for the liquid-glass direction: can a CSS `backdrop-filter` be confined
  to the head silhouette with `clip-path`, and what does rewriting that polygon
  every frame cost. Chrome and real Safari pass; Firefox is unverified because
  its Playwright build will not start on this host. Findings and the wider
  platform survey: meta/research/res.dom-backdrop-capture.md.
- `demo/html-in-canvas-spike.html` plus `tools/smoke/html-in-canvas-spike.mjs` -
  measures Chromium's HTML-in-Canvas API as a refraction source: live DOM into a
  WebGL texture at vsync, but only for immediate children of the canvas being
  drawn into, with cross-origin images and iframes silently dropped and clicks
  landing on the undistorted layout box. Needs Chrome with
  `--enable-blink-features=CanvasDrawElement`.
- `tools/smoke/feature-variants-shot.mjs`, `tools/smoke/lab-shot.mjs`,
  `tools/smoke/landing-shot.mjs` - Playwright captures for the demo pages
  (landing-shot also asserts the speak pipeline animates distinct visemes).
- `tools/smoke/solid-body-shot.mjs` - pose-pinned capture of the engine demo at
  chosen `skin.glass.amount` values, reporting silhouette size, mean luminance
  and a pixel hash. Proves the solid-body glass is inert at
  `glass.amount = 0`; run it on both branches and compare.

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
