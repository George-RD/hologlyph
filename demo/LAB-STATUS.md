# Next unit of work

Updated 2026-07-27, second pass. Items 7 and 8 landed and both changes are now
archived under `meta/changes/archive/`, so `meta/changes/` is empty and
`cairn scan` is down to three deliberate source-unverified infos. Item 7 was
the last item that was both open and unblocked.

**There is no next todo. `cairn brief` will hand you nothing, and that is
correct.** Every remaining item in the liquid-glass programme is `blocked`,
and the two blockers are an owner ruling and a Firefox host.

**Start here: get the owner in front of the five labs.** Tracked as
`todo.liquid-glass-owner-look-session`, which carries the walk order and what a
ruling has to produce. Five features now ship gated off because nobody has
judged them:

- `demo/pool-lab.html`, `pool.amount` at 0 (item 3).
- `demo/lens-lab.html`, the snapshot lens with no source named (item 4), plus
  `demo/live-lens-lab.html` for the Chromium half (item 5).
- `demo/interior-glyph-lab.html`, `interior.count` at 0 (item 10).
- `demo/fluid-lab.html`, `fluid.amount` at 0 (item 8).
- `demo/stage-lab.html`, which needs `fluid.amount` above 0 to show anything at
  all, so it is judged with item 8 rather than after it (item 7).

Serve them with `bun run dev` and open the paths directly; none of the five is
in `demo/vite.config.ts`, so none is deployed.

The ruling that pays is now the FLUID one, not the pool one. Items 7 and 8 are
built and measured but both hang off `fluid.amount`, which ships at 0, so a
judgement there decides whether roughly half the programme ever appears on
screen. The pool ruling still gates item 3 and the participant dent that rides
on it. Item 6 additionally needs `todo.liquid-glass-firefox-verify`, which
needs a host where a Firefox can be photographed, and this one cannot: five
non-interactive routes are closed and the todo lists all five, so do not
rediscover them.

What is genuinely left after a ruling is item 6
(`todo.liquid-glass-live-css-layer`, which also wants Firefox) and item 9,
tier 4 (`todo.liquid-glass-topology-fluid`), which additionally needs an
explicit owner decision because it is the one stage that gives up authored
visemes.

If the owner is not available, the honest options are, in order:

1. `todo.liquid-glass-firefox-verify` on a machine where Firefox starts AND can
   be photographed. It is the only blocker in the programme that is not a taste
   call. Note that headless does not count: macOS headless Firefox composites
   through SWGL rather than the GPU WebRender path Firefox bug 1579957 is
   about, so a verdict read from it would not be evidence.
2. The independent review `demo/pool-lab.html`'s change never got, listed under
   "Still open from the tier 1 pool change" below. `src/shaders/pool-surface.ts`
   and the breathe block in `src/shaders/materials.ts` shipped on a self-review.
3. Say the programme is owner-blocked and stop, rather than tuning a look
   nobody has approved. The three non-liquid follow-ups that used to be offered
   here are all `status: done` and are no longer an escape hatch.

What item 7 leaves you, beyond what is in
`meta/changes/archive/2026-07-27-liquid-glass-stage-participants/implementation-notes.md`:

- **Nobody has watched a page get shoved.** The reaction is measured (a
  `data-hologlyph-body` element takes exactly the capped 24 px and an
  obstacle takes 0) but whether a card sliding 24 px as the head squeezes past
  reads as fluid or as a layout bug is a taste call. Scroll
  `demo/stage-lab.html` and judge it.
- **The three-mode cap is observable, not tuned.** Tick the late-arrival box in
  the lab and the fourth card is dropped rather than merged. Whether three is
  the right number for a real page is unanswered.
- **`stage.squeeze` at 0.5 is a lab starting point.** So are `push` at 0.6 and
  `maxPush` at 24. None was derived.

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

Items 7 and 10 also leave labs and captures, listed with the rest below.

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
  `meta/changes/archive/2026-07-26-liquid-glass-snapshot-lens/implementation-notes.md`. If the
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
- `demo/stage-lab.html` plus `tools/smoke/stage-shot.mjs` - item 7, rung 4:
  stage participants, the opt-in contract that lets the fluid touch the page.
  A 320vh scrolling page with three marked cards that sweep past a fixed head:
  a `data-hologlyph-obstacle` pair flanking the head, which is the case a
  single global mode could not express, and one card carrying only
  `data-hologlyph-body`, which is the one that gets shoved. Live controls for
  every field of `HeadStageConfig`, the `fluid.amount` gate with a shut/open
  pair, `pool.amount` and `pool.bias` for the dent half, a checkbox that marks
  a FOURTH element at runtime and calls `engine.refreshStage()`, jump buttons,
  a coupling readout (per-slot flow straight off `VFXEngine.stageFlow` plus the
  transform the engine actually wrote) and a frame-time readout.
  `window.__stageLab` exposes `setStage`, `setFluid`, `setPool`, `addLate`,
  `removeLate`, `pushOf`, `restOf`, `activeSlots`, `flow` and `pinPose` for the
  smoke script. The camera is FIXED here where the other labs make it live:
  `stageProjection` assumes an eye looking down -Z, so an orbit control would
  put every participant where it is not, and the card offsets are world
  distances written in vh that only mean what they say at this eye. Half the
  viewport has to hold the panel, that world-space gap and a readable card, so
  a media query narrows the panel and the cards below 1400 px; under about
  1230 px the panel simply covers the left-hand card, which costs paint and not
  measurement. Dev-only, deliberately absent from `demo/vite.config.ts`.
  Measured in the lab at a 1440x900 viewport: the flanking pair solves two
  equal and opposite modes rather than the one averaged mode that would
  cancel, the drifter saturates the 24 px `maxPush` cap (37.3 px uncapped),
  marking a fourth element leaves the three solved modes bit-identical
  because the rescan walks the document in order and stops at three, and with
  `pinPose` holding the frame the gate at 0 against the gate at 1 differs by
  118120 pixels against a zero-pixel noise floor and restores to a one-pixel
  match. `fluid.amount` ships at 0, so on the shipped build a page
  may mark whatever it likes and nothing couples: the look is not
  owner-approved yet.

## Where the approved look lives

- Ratified defaults: meta/sources/src.owner-approved-look-2026-07-21.md
  (also the lab's boot state). The library port MUST seed its TDD pins from
  it - see meta/todos/todo.textskin-port-owner-config.md.

## Open follow-ups (meta/todos/)

- todo.liquid-glass-owner-look-session - the ruling gate above. BLOCKED on the
  owner, and the only reason the backlog looks empty.
- todo.liquid-glass-firefox-verify - BLOCKED on a photographable Firefox.
- todo.liquid-glass-live-css-layer - BLOCKED on the above.
- todo.liquid-glass-topology-fluid - BLOCKED on an explicit owner decision.
- The feature-shading follow-ups this section used to list
  (todo.textskin-port-owner-config, todo.lab-control-refinements,
  todo.background-adaptive-look) are all `status: done`. Their lab artefacts
  are still described above; the work is not outstanding.
- Earlier staged items (neck weights, iris patterns, eyelid occlusion
  physics) recorded in meta/research/res.feature-shading-exploration.md.
