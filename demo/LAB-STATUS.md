# Next unit of work

Updated 2026-07-26 after `liquid-glass-tier1-pool` landed.

**Start here: `meta/todos/todo.liquid-glass-snapshot-lens.md`** (Order 4 of
`dec.liquid-glass-architecture`, node `hologlyph.runtime.core`). `cairn brief`
picks the Chromium lens instead because it orders alphabetically; the `Order N`
line in each todo is authoritative, so ignore that recommendation.

What the snapshot item needs, in one paragraph so you can start cold: opt-in
true per-pixel lensing on every engine, by rasterising a host-named DOM subtree
to a texture the skin can refract, rather than the compositor path which can
only frost and tint. Read
`meta/research/res.dom-backdrop-capture.md` first: no browser API returns
rendered page pixels to script without a permission prompt, so this rung is a
rasterisation the host opts into, not a capture. It needs no new asset and no
contract beyond a way to name the subtree.

Two follow-ups this change deliberately left open, either of which is a
legitimate next unit instead:

- The pool is lab-only. `pool.amount` ships at 0 and the look has not been
  through an owner session. Showing `demo/pool-lab.html` and taking a ruling
  is cheap and unblocks items 7 and 8.
- Work item 5 of the tier 1 todo is scoped down. The materials the library
  builds fade at the waterline; the authored `mouth_interior` and `eye_trim`
  materials and the eyeball still terminate at the hard clip. The reasoning is
  in the module header of `src/shaders/materials.ts`.

Four things this change leaves you:

- **A same-build A/B proves a gate is inert, never that a build is unchanged.**
  `tools/smoke/pool-shot.mjs` compared `pool.amount` 0 against 0 and reported a
  perfect zero-pixel match while the head was 93 per cent gone, because the
  defect was in the shared material graph. Only `bun run eval`, which scores
  against a committed baseline from another build, caught it. For a real
  cross-build number, run `tools/smoke/solid-body-shot.mjs` on both branches
  and diff the PNGs; the eval's own captures are not pose-pinned and have a
  12,000 pixel noise floor.
- **`transformNormalToView` normalises.** It ends in `transformDirection`, so
  handing it a vector that can be zero gives NaN, and GLSL `mix(a, NaN, 0)` is
  NaN, not `a`. Perturb inside a unit vector. Same trap waits for anything that
  builds a direction from a gradient.
- **`directionToFaceDirection` is not re-exported from `three/tsl`** and
  `faceDirection` is not the same quantity. If you add a normal override, the
  `FrontSide` front and the `BackSide` interior need their own node.
- **`EngineImpl.applyPoolLayer`** reconciles the pool against `pool.amount`
  every frame beside `applyGlassLayering`, and tears the pool down rather than
  hiding it. Anything that adds a scene-level object for the liquid programme
  should follow that shape, or the shipped configuration starts paying for it.

Other unblocked items, in order: 5 `chromium-lens` and 10 `interior-glyphs`.
Items 7 `stage-participants` and 8 `fluidity-driver` are unblocked by this
change, but both want the owner's ruling on the pool first.

Earlier handoff, kept for the hull and solid-body traps:

- Any visual acceptance check MUST pin the bones and every morph influence
  array before capturing, and MUST establish its own noise floor by repeating
  the same capture on the same code first. See `tools/smoke/solid-body-shot.mjs`
  and the measurement-trap section of
  `meta/changes/archive/2026-07-26-2026-07-26-liquid-glass-solid-body/implementation-notes.md`.
- `EngineImpl.applyGlassLayering` reconciles the render-list layering with
  `skin.glass.amount` every frame. Anything that adds a layer to the head must
  go through it, or `glass.amount = 0` stops reproducing the approved look.
- `src/asset/rig.ts` has a grid-accelerated raycaster (`computeThickness`) with
  a correct DDA over triangle buckets and a budget that degrades to zero rather
  than stalling.

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
- `demo/pool-lab.html` plus `tools/smoke/pool-shot.mjs` - tier 1 of the liquid
  glass: the head emerging from a rippling pool, with live controls for every
  field of `HeadPoolConfig`, a raised camera (the shipped camera sits on the
  waterline and sees a horizontal plane edge on), submerge and emerge and speak
  scenarios, a jaw-open toggle for checking morphs against the breathe, and a
  frame-time readout. Dev-only, deliberately absent from
  `demo/vite.config.ts`, so it is not deployed. The smoke script measures a
  silhouette floor, inertness at `pool.amount = 0`, morph survival under
  maximum breathe, and, with `--cost`, a vsync-free frame cost against a real
  Chrome. `pool.amount` ships at 0: the look is not owner-approved yet.

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
