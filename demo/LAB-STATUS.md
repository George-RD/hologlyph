# Next unit of work

Updated 2026-07-26 after `liquid-glass-interior-glyphs` landed (item 10 of
`dec.liquid-glass-architecture`), which was the last item that was both open
and unblocked.

**There is no next todo. `cairn brief` will hand you nothing, and that is
correct.** Every remaining item in the liquid-glass programme is `blocked`,
and every one of them is blocked on the same thing.

**Start here: get the owner in front of the three labs.** Three features now
ship gated off because nobody has judged them:

- `demo/pool-lab.html`, `pool.amount` at 0 (item 3).
- `demo/lens-lab.html`, the snapshot lens with no source named (item 4), plus
  `demo/live-lens-lab.html` for the Chromium half (item 5).
- `demo/interior-glyph-lab.html`, `interior.count` at 0 (item 10).

Serve them with `bun run dev` and open the paths directly; none of the three is
in `demo/vite.config.ts`, so none is deployed.

A ruling on the pool is the one that pays: it unblocks item 7
`stage-participants` and item 8 `fluidity-driver`, which are most of what is
left of the programme. Item 6 additionally needs
`todo.liquid-glass-firefox-verify`, which needs a host where the Firefox
Playwright build actually starts, and this one does not.

If the owner is not available, the honest options are, in order:

1. `todo.liquid-glass-firefox-verify` on a machine where Firefox starts. It is
   the only blocker in the programme that is not a taste call.
2. The three non-liquid follow-ups at the bottom of this file
   (`todo.lab-control-refinements`, `todo.background-adaptive-look`,
   `todo.textskin-port-owner-config`).
3. Say the programme is owner-blocked and stop, rather than starting item 7 or
   8 against a look nobody has approved.

What item 10 leaves you, beyond what is in
`meta/changes/archive/2026-07-26-liquid-glass-interior-glyphs/implementation-notes.md`:

- **Nobody has watched the interior field move either.** The lag is measured on
  the field's centroid, not judged: a 0.7 rad yaw step leaves it 0.0347 units
  behind out of 0.0354 of travel, and it settles after about 6 s. Whether that
  READS as text floating in fluid is unanswered. Shake it in the lab.
- **The useful size range is narrow.** `interior.size` at 0.012 is texture, at
  0.045 it is a competing second layer of text. 0.02 is the current default and
  it was picked by eye in the lab, not derived.
- **The field is subtle head on and obvious in three-quarter view**, because
  that is where the skin is thin enough to see through. Judge both.

Item 10 also leaves a lab and a capture, listed with the rest below.

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
- `demo/fluid-lab.html` - item 8, tier 3: the fluidity knob. Live controls for
  every field of `HeadFluidConfig` (`amount`, `sag`, `wobble`, `tension`,
  `crisp`, `reach`), a rigid/molten pair for A/B-ing the gate, the pool lab's
  raised camera so the flowing band at the base is not viewed edge on, a shake
  scenario that drives the carrier bone hard from side to side, pointer drag on
  `MotionEngine.setHeadTarget`, a "pool on" button so tiers 1 and 3 can be
  judged together, a scroll kick, a reduced-motion toggle and a frame-time
  readout. `window.__hologlyphEngine` is the handle, as on the other labs.
  Dev-only, deliberately absent from `demo/vite.config.ts`. The look to judge:
  at `amount 0` the render must be the approved look exactly (`bun run eval`
  agrees, overall pass); at 1 the base and shoulders should sag, wobble and
  slosh while the face stays crisp and the glyphs stay welded to the skin.
  `fluid.amount` ships at 0: the look is not owner-approved yet.
- `demo/interior-glyph-lab.html` plus `tools/smoke/interior-glyph-shot.mjs` -
  item 10: glyphs suspended inside the glass, with live controls for every
  field of `HeadInteriorConfig`, a skin-opacity and glass pair for looking at
  the field on its own, a closer camera than the shipped framing (a few
  hundred sprites of 0.02 units are too small to judge at 2.4 units out), a
  shake and a nod scenario, a held-yaw slider that works with procedural
  motion frozen, and a frame-time readout. `window.__interiorLab` exposes
  `setInterior`, `setYaw` and `pinPose` for the smoke script. Dev-only,
  deliberately absent from `demo/vite.config.ts`. The smoke script measures a
  silhouette floor, a noise floor, engagement split inside and outside the
  silhouette, exact inertness back at `count: 0`, the lag after a yaw step
  with a rigid `inertia: 0` control, and reduced motion removing that lag.
  `interior.count` ships at 0: the look is not owner-approved yet, and nobody
  has watched it move.

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
