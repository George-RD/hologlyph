# Current handover

Updated 2026-07-31, seventh pass. Four implementation units landed today:

- **#88, public camera pose:** `Engine.setView`, resolved `Engine.view`, and
  `EngineOptions.view` provide clamped declarative framing without exposing the
  renderer camera. Five labs migrated off private camera access.
- **#89, studio showcase overhaul:** the visible-stage framing fix, public
  camera orbit, gaze interaction, and engine-owned speak/viseme flow landed
  with browser smoke coverage.
- **#90, melt internals:** eyeballs, mouth interior, and eye trim share the
  melt displacement; authored internal material state is preserved through
  owned node-material conversion.
- **#91, silhouette hull tightening:** 32 directions bake 60 hull points,
  reducing the resting convex-area ratio from 1.29x to 1.21x. The compositor
  remains gated at `amount: 0`, so no shipped feature changes today.

## One open item

`todo.silhouette-hull-halo` is **blocked** on the owner's eye in
`demo/compositor-lab.html`. The tighter crown and upper sides still leave a
conspicuous wedge left of the jaw and shoulder. If it still reads as a halo,
the recorded escalation is a concave outline, not more points on a convex hull.

## Landing and maintenance

Merging `glass` into `main` remains the owner's call: pushing to `main`
redeploys the live demo. The Cairn 0.9 filename migration is deliberately
deferred; it flags the repository's established `dec.`/`res.`/`src.` artefact
names and has no rename-and-reference-rewrite migration command.

Two traps found today are worth preserving:

- `build-bust.ts` used to default to the shipped GLB, so a bare build could
  overwrite the optimised asset while a following optimise step consumed stale
  raw data. It now defaults to the `.build` raw intermediate.
- A smoke script aimed at a non-existent page can pass against Vite's dev
  history fallback. Smoke scripts must assert their resolved pathname.

Everything below this line is the sixth pass, kept for the reasoning.

Updated 2026-07-28, sixth pass. **There is one page now.**

The owner approved the melt direction, having already seen the floating
internals before approving, and asked for the environments to be consolidated:

So: **the site root is the studio.** One URL. The glass is its default rather
than a lab option, the melt is a developer tier inside it, and the 2026-07-27
rulings are a notes tier inside it. `src.owner-consolidation-2026-07-28` has all
three rulings verbatim.

What moved:

- `demo/index.html` IS the studio. What used to be at the root, a second
  renderer hand-rolled in TSL rather than built on the library engine, is now
  `demo/handrolled.html` and is no longer deployed. It stays in the repo as the
  owner-approved-look reference and as the left half of `compare-lab.html`.
- `demo/outcomes.html` is gone. Its content is the studio's notes tier.
- The deployed set is three files: the root, `feature-shading-lab.html` (a
  redirect stub) and `engine.html`, which is linked from nowhere but is the
  target of `tools/evals/capture.mjs` and so must keep existing.
- Everything else under `demo/`, including all nine feature labs and
  `compare-lab.html`, stays in the repo and out of the deployed set. Each lab is
  superseded by a tier in the studio, and several reach into `EngineImpl`
  privates, which is why they never shipped.

The next unit of work is the owner's: `todo.studio-showcase-overhaul`, a
presentation pass on the studio with the design skill loaded. It wants
`todo.public-camera-pose` first, because a page whose job is to show the head off
cannot currently frame it.

Everything below this line is the fifth pass, kept for the reasoning.

Updated 2026-07-27, fifth pass. **The owner look session happened.** Most of
the liquid-glass programme was ruled against. The verbatim rulings are in
`meta/sources/src.owner-look-2026-07-27.md` and every affected todo carries an
annotation pointing at it.

What the session decided:

- **The pool is cut.** "thats not at all what i was getting at, so we can cut
  hte pool". `pool.amount` stays 0 permanently and it is not a direction to
  revisit. `poolRadialProfile` survives, because the melt reads the bust extent
  from it.
- **Tier 3 fluid missed.** "i turn on liquid, and its just like a gravity
  effect? and it all bulges". `fluid.amount` stays 0.
- **Stage participants missed.** "the bumping into objects is a bit weird, and
  doesnt hit the mark". The collider plumbing stays, because the squeeze will
  reuse it.
- **The compositor layer was rejected on its shape**, not its content: "its
  just a weird patch behind the head? though i do see objects on the page
  through the head, so thats working well". That patch is the hull halo, now
  tracked as `todo.silhouette-hull-halo`.
- **Interior glyphs stay, experimental and default off.** The glyphs leak out
  of the body at high drift; tracked as `todo.interior-glyph-containment`.
- **Of the two backdrop rungs the lens wins**, which is what
  `dec.liquid-glass-rung-exclusion` already encodes.

What the owner asked for instead: "I want to be able to morph the whole head,
from a flat puddle, up into the head. And i want to be bale to make the head
squeeze and move between things."

**Start here: `demo/melt-lab.html`.** That is the first half of the ask,
shipped 2026-07-27 as `liquid-head-melt` and gated at `melt.amount: 0`
(`dec.liquid-glass-melt`). A vertex melt on the real bust, not a particle
field: neither ask changes topology, so the rig, the authored visemes, the
glyphs and the glass all survive and it runs on WebGL2. Press **cycle** in the
lab and watch the whole sweep.

Two things will be obvious and both are known, written up in
`meta/changes/liquid-head-melt/implementation-notes.md`:

1. **The internals do not melt.** Two eyeballs and the mouth cavity hang in
   mid-air above the puddle from about `amount 0.6`. The eyeball is a node
   material and could take the map; `mouth_interior` and `eye_trim` are
   authored glTF materials that cannot take a `positionNode` at all. Tracked as
   `todo.melt-internals`. A visibility gate was deliberately not built: hiding
   a mesh mid-sweep is the popping the acceptance forbids.
2. **The puddle has no thickness at exactly `amount 1`.** Every height
   collapses onto one plane, so the shell's front and back coincide and the
   glass has no volume left. The one-line fix, a collapse band rather than a
   plane, is written up in the notes and needs a decision because the map is
   fixed by `dec.liquid-glass-melt`.

**The escalation criterion did not fire.** At `amount 1` the rim is a smooth
ellipse with no facial features on it, so mesh displacement has not failed and
the particle field in `todo.liquid-glass-topology-fluid` is not warranted on
this evidence. What is missing is thickness and three unwired meshes, and
neither is something a particle field would fix for free.

The other lab that landed with it is `demo/compare-lab.html`: the hand-rolled
`demo/index.html` head beside the library `demo/engine.html` head, which the
owner asked for and which had never been checked by eye. The one shading
difference that is not explained by their different framing is recorded in the
same notes: the library head carries a broad specular sheen where the
hand-rolled one has tighter highlights, and its feature contrast is flatter.

Serve them with `bun run dev` and open the paths directly; none of the labs is
in `demo/vite.config.ts`, so none is deployed.

**What is left after the melt, in order.**

1. **The second half of the ask: the squeeze.** The melt driven by the stage
   colliders. Deliberately not built yet, because building it on an unapproved
   melt is exactly what produced tier 3. It needs the melt judged first.
2. **`todo.melt-internals`**, which has to be settled before the melt can be
   shown properly: the floating eyeballs are the loudest thing in the lab and
   they are not a statement about the direction.
3. **The independent review `demo/pool-lab.html`'s change never got.** Listed
   under "Still open from the tier 1 pool change" below:
   `src/shaders/pool-surface.ts` and the breathe block in
   `src/shaders/materials.ts` shipped on a self-review and have never been
   read by anything but their author. Less urgent now the pool is cut, but the
   breathe block is still shipped code.

   Worth knowing what a self-review costs. Every delegated route was
   quota-refused (`reviewer`, `scout`, `sonic` and the general worker all
   tunnel through Codex; `gemini-reviewer` is Cloud Code Assist), so the ladder
   exclusion went out on a self-review. A later pass through
   `completion(model="default")` raised nineteen findings, five real, one a
   **shipped bug**: the exclusion predicate ignored `skin.glass.amount`. Fixed
   in #81. The melt used the same route deliberately and it found two more
   real ones.
4. **The hull halo**, `todo.silhouette-hull-halo`, now that the owner has named
   it. Raising `DIRECTION_COUNT` in `tools/asset-pipeline/silhouette-hull.ts`
   tightens the polygon on a known curve, and needs a decision superseding the
   point budget in `todo.liquid-glass-silhouette-hull` plus an asset rebake.
5. **Merging `glass` into `main`** is still the owner's call, not an agent's.
   Pushing to `main` redeploys the live demo, so `main` only receives `glass`
   once the owner is happy with the look end to end. Nothing in the melt change
   moves a shipped default, so the live demo is unaffected either way.

What the ladder exclusion leaves you, beyond
`meta/changes/archive/2026-07-27-liquid-glass-ladder-exclusion/implementation-notes.md`:

- **The rungs are now exclusive and nobody has looked at the transition.** On
  a page with both gates open the frost draws first, the snapshot resolves
  about 100 ms later, and the frost is removed as the lens takes over. One
  step, in the direction of more fidelity, and measured but not judged.
  `demo/ladder-lab.html` is where to judge it.
- **The compositor clip polygon is NOT the head silhouette.** It is cut at the
  emergence waterline, so at 1000x800 it bottoms at y 406 while the head still
  occupies pixels down to y 567. Any capture script that treats "outside the
  polygon" as "page" counts the shoulders as page and fails a correct engine.
  `tools/smoke/ladder-shot.mjs` carries a second mask for exactly this.
- **A host cannot have both.** The only lever for keeping the frost while a
  subtree is named is `lens.amount: 0`, which keeps paying for captures nobody
  looks at, so the documented answer is `setLensSource(null)`. If a real
  integration wants both at once, that is a new decision superseding
  `dec.liquid-glass-rung-exclusion`, not a bug.

What item 6 leaves you, beyond
`meta/changes/archive/2026-07-27-liquid-glass-live-css-layer/implementation-notes.md`:

- **Nobody has judged the frost.** Every number is a measurement: 24.00 mean
  delta inside the silhouette against 0.04 outside, on a zero noise floor.
  Whether a frosted head over a live page reads as glass or as a smudge is a
  taste call.
- **Two ancestor shapes are fatal and the library cannot fix them.** An
  ancestor of the canvas carrying `opacity` below 1, or `overflow: hidden` with
  a rounded corner, promotes a backdrop root and the frost samples nothing. The
  engine warns naming the element. `demo/compositor-lab.html` has buttons that
  reproduce both.
- **Real Safari and real Firefox are unverified for the backdrop-root leg.**
  Headless WebKit composites no `backdrop-filter` at all, so it is not evidence.
- **Any new capture script must read `img.channels`.** `decodePng` returns
  three bytes per pixel for a colour-type-2 PNG. Hard-coding four does not
  crash: it reads a neighbouring pixel's bytes and produces plausible numbers
  attributed to the wrong coordinates.
- **A visual check on a head page needs reduced motion, not frozen motion.**
  `setMotionFrozen` stops the skeleton but not the text skin, whose glyph rows
  scroll on their own clock and put a mean delta of 25 between two captures of
  an unchanged page. Playwright's `reducedMotion: 'reduce'` takes that floor to
  exactly 0.

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

- `demo/handrolled.html` - WAS the landing page until 2026-07-28, and before
  that was feature-shading-lab.html (a redirect stub remains at that old URL).
  A second renderer, hand-rolled in TSL rather than built on the library engine,
  now out of the deployed set and kept as the owner-approved-look reference. Live
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
  Serve with `bun run dev`, open /hologlyph/handrolled.html. NOT deployed since
  2026-07-28: the root is the studio and this is the second implementation the
  consolidation moved out of the way.
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
- `demo/compositor-lab.html` plus `tools/smoke/compositor-shot.mjs` - item 6,
  rung 2: compositor glass, the only backdrop rung that shows live page content
  without a rasteriser and without the host naming a subtree. Live controls for
  every field of `HeadCompositorConfig` (`amount`, `blur`, `saturate`,
  `tintOpacity`), the `skin.glass` pair the frost has to sit under, jaw and
  freeze buttons, and two "host trap" buttons that wrap the head in the
  ancestor shapes measured as fatal so the warning can be seen firing. The
  backdrop is a FIXED aperiodic field behind everything rather than a section
  background, because content the head never covers cannot demonstrate live
  content inside the head; `--phase` drives it so a capture can step it to an
  exact value instead of racing a CSS animation. `window.__compositorLab`
  exposes `set`, `layer`, `setMotionFrozen`, `setFieldPhase` and `panelRect`.
  Dev-only, deliberately absent from `demo/vite.config.ts`.
  Measured at a 1000x800 viewport under emulated reduced motion, against a
  zero-pixel noise floor: the frost is 24.00 mean delta inside the silhouette
  and 0.04 outside it, stepping the backdrop phase moves 29.22 inside while the
  pose is held, and half the amount gives 12.10. `compositor.amount` ships at
  0, so on the shipped build no element is authored at all: the look is not
  owner-approved yet.
- `tools/smoke/backdrop-root-spike.mjs` - the evidence behind
  `dec.liquid-glass-compositor`. Mounts the layer inside a shadow root under
  seven ancestor shapes and probes screenshot pixels with the filter on and
  off. No dev server: the page is built inline. Run it before assuming any
  layout is safe for a `backdrop-filter`.
- `demo/melt-lab.html` - the melt (`dec.liquid-glass-melt`), the owner's
  puddle-to-head ask. Live controls for every field of `HeadMeltConfig`
  (`amount`, `spread`, `floor`, `lag`), a head/puddle pair for A/B-ing the
  gate, and a **cycle** button that sweeps 0 to 1 to 0 over six seconds,
  because the morph is what is being judged and a hand-dragged slider does not
  show it. Motion is frozen on boot: the melt runs in bind space, so a yawed
  head carries its puddle round with it. The panel states the escalation
  criterion so whoever runs the session knows what question they are
  answering. `melt.amount` ships at 0, where the map is an exact identity.
  Dev-only, deliberately absent from `demo/vite.config.ts`.
- `demo/compare-lab.html` - the hand-rolled head beside the library head, which
  the owner asked for and which had never been checked by eye. Two same-origin
  iframes at 50vw by 100vh, `./index.html` on the left and `./engine.html` on
  the right, each page's own chrome hidden by an injected stylesheet and the
  right one driven to `setScrollProgress(1)` on a retry loop because
  `demo/main.ts` drives emergence from page scroll and an iframe never
  scrolls. Cameras are deliberately NOT synchronised: the two pages frame the
  bust differently and the comparison is of the look, not of pixels. Dev-only.

## Where the approved look lives

- Ratified defaults: meta/sources/src.owner-approved-look-2026-07-21.md
  (also the lab's boot state). The library port MUST seed its TDD pins from
  it - see meta/todos/todo.textskin-port-owner-config.md.

## Open follow-ups (meta/todos/)

- todo.liquid-glass-owner-look-session - DONE. The session ran on 2026-07-27;
  the ruling is `src.owner-look-2026-07-27` and it is summarised at the top of
  this file.
- todo.melt-internals - OPEN, and the next thing the melt needs: the eyeballs,
  mouth cavity and eye trim do not melt with the shell.
- todo.interior-glyph-containment - OPEN. Glyphs translate through the skin at
  high drift; the clearance is already sampled at seed time.
- todo.silhouette-hull-halo - OPEN. The frost patch the owner named. Needs a
  decision superseding the point budget, plus an asset rebake.
- todo.liquid-glass-firefox-verify - BLOCKED on a photographable Firefox.
- todo.liquid-glass-live-css-layer - DONE, and now ruled against on shape
  rather than content. See the hull halo above.
- todo.liquid-glass-topology-fluid - BLOCKED on an explicit owner decision, and
  the melt's escalation criterion did not fire, so nothing warrants it yet.
  `dec.liquid-glass-melt` bounds its scope if it is ever taken: entered only
  where there is no face, and the rig keeps the 15 authored visemes.
- The feature-shading follow-ups this section used to list
  (todo.textskin-port-owner-config, todo.lab-control-refinements,
  todo.background-adaptive-look) are all `status: done`. Their lab artefacts
  are still described above; the work is not outstanding.
- Earlier staged items (neck weights, iris patterns, eyelid occlusion
  physics) recorded in meta/research/res.feature-shading-exploration.md.
