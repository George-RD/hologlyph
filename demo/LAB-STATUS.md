# Next unit of work

Updated 2026-07-26 after `liquid-glass-snapshot-lens` landed (item 4 of
`dec.liquid-glass-architecture`).

**Start here: `meta/todos/todo.liquid-glass-chromium-lens.md`** (Order 5, node
`hologlyph.runtime.renderer`). `cairn brief` happens to agree this time, but it
agrees by accident: it orders todos alphabetically, and the `Order N` line in
each todo is what is authoritative.

Read it with your eyes open, though. Item 5 is the Chromium half of rung 3 and
the decision says outright that it must never be load-bearing: it is
Chromium-only, behind a flag, on an origin trial that expires at Chrome 150,
and it cannot see the page behind our canvas at all, only immediate children of
it. The measurements are already done in
`meta/research/res.dom-backdrop-capture.md` and the spike is committed at
`demo/html-in-canvas-spike.html`; the work is a capability check and a
detected-only path, not an investigation.

**The higher-value move, if the owner is available, is a look session on the
two labs.** Two features now ship gated off because nobody has judged them:
`pool.amount` at 0 (`demo/pool-lab.html`) and the snapshot lens with no source
named (`demo/lens-lab.html`). A ruling on the pool unblocks items 7
`stage-participants` and 8 `fluidity-driver`, which are far more of the liquid
programme than item 5 is. Say so rather than grinding through the order.

Three follow-ups the snapshot-lens change deliberately left open:

- **Nobody has looked at the lens.** The vision tooling in that session was
  quota-exhausted and the desktop had no screen-recording permission, so every
  claim about it is a measurement and none is a judgement. Frames are at
  `tools/smoke/out/lens-source-off.png`, `lens-aligned.png` and
  `lens-source-on.png`.
- **The head does not magnify.** The displacement is `normalView.xy *
  aThickness`, which is what a slab does and is near zero where the surface
  faces the camera, so the middle of the face shows the page barely moved. True
  magnification needs two surfaces forming an image, which a per-fragment
  screen-space offset cannot express. A radial contraction about a
  screen-space centre would fake it convincingly and is a look decision, not a
  physics one.
- **The compositing seam.** Naming a source makes the head opaque and folds the
  page into the scene, which moves one blend out of the browser compositor's
  encoded space into three's linear one. It is unavoidable from inside the
  scene and it is measured, bounded and explained in
  `meta/changes/liquid-glass-snapshot-lens/implementation-notes.md`. If the
  owner dislikes the tone shift, the answer is a lower `lens.amount`, not a
  cleverer shader.

Four things the last two changes leave you:

- **A same-build A/B proves a gate is inert, never that a build is unchanged.**
  `tools/smoke/pool-shot.mjs` compared `pool.amount` 0 against 0 and reported a
  perfect zero-pixel match while the head was 93 per cent gone, because the
  defect was in the shared material graph. Only `bun run eval`, which scores
  against a committed baseline from another build, caught it.
- **A periodic test pattern is worse than a flat one.** The lens lab hero
  started as 44 px stripes; a displacement of one period is indistinguishable
  from none, to the eye and to a correlation search alike, and it cost a round
  of false conclusions. Both lab backgrounds are aperiodic now, on purpose.
- **`transformNormalToView` normalises.** It ends in `transformDirection`, so
  handing it a vector that can be zero gives NaN, and GLSL `mix(a, NaN, 0)` is
  NaN, not `a`. Perturb inside a unit vector.
- **Gate on the resource, not on the number, when the feature needs one.**
  `pool.amount` is a number gate because the pool is pure computation;
  `lens.amount` ships at 1 and the SOURCE ELEMENT is the gate, because a lens
  with no snapshot would sample a placeholder and fill the head with a flat
  colour. Both reconcile every frame beside `applyGlassLayering`, and both tear
  their resources down rather than hiding them.

Still open from the tier 1 pool change, unchanged:

- Work item 5 of the tier 1 todo is scoped down. The materials the library
  builds fade at the waterline; the authored `mouth_interior` and `eye_trim`
  materials and the eyeball still terminate at the hard clip. Reasoning is in
  the module header of `src/shaders/materials.ts`.
- The tier 1 change never got an independent review; it shipped on a
  self-review after both delegated reviewers hit a provider usage limit.
  `src/shaders/pool-surface.ts` and the breathe block in
  `src/shaders/materials.ts` are the parts worth another pair of eyes.

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
- `directionToFaceDirection` is not re-exported from `three/tsl` and
  `faceDirection` is not the same quantity. If you add a normal override, the
  `FrontSide` front and the `BackSide` interior need their own node.

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
- `demo/lens-lab.html` plus `tools/smoke/lens-shot.mjs` - rung 3 of the
  backdrop ladder: a hero section refracted through the head via a rasterised
  DOM snapshot. Live controls for `lens.amount` and the signed `lens.strength`,
  a source on/off pair, an explicit recapture, and a hero-text button for
  watching the snapshot go stale on purpose. The hero background is APERIODIC
  on purpose; a repeating pattern makes a one-period displacement look like no
  displacement. Dev-only, deliberately absent from `demo/vite.config.ts`. The
  smoke script measures a presence floor, a noise floor, the bound sample
  window against the document-space layout arithmetic, the bounded colour-space
  seam, visible displacement (lensed against lensed, so the seam cancels), an
  untouched page outside the silhouette, the sign response, and exact
  restoration when the source is dropped. The lens ships with no source named:
  the look is not owner-approved yet, and in fact nobody has looked at it.
- `demo/live-lens-lab.html` plus `tools/smoke/live-lens-shot.mjs` - rung 3,
  Chromium half: the same lens fed by LIVE DOM rather than a snapshot. The
  source is an animating subtree inside a `<canvas layoutsubtree>`, which is
  the only arrangement Chromium allows, with the head laid over it and a
  toggle that drops an input into the refracted region to prove the
  control-trap warning. The panel reports the capability, and a source
  three-way (live, snapshot, none) puts both paths side by side. Dev-only,
  deliberately absent from `demo/vite.config.ts`. The smoke script runs the
  page TWICE, once with `--enable-blink-features=CanvasDrawElement` and once
  without, and measures: the capability, a residual-motion floor, engagement,
  liveness (the refracted pixels move while the DOM moves, where the snapshot
  path contributes nothing), an untouched page outside the silhouette,
  reachable and unreachable controls, and a clean fall-through to the snapshot
  lens with the flag off. Needs a real Chrome; nothing in CI runs it.

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
