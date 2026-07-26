# Implementation notes: liquid-glass-interior-glyphs

Deviations from the plan, edge cases found on the way, and every number that
was measured rather than assumed.

## Deviations from the todo

**The motion model is a spring chasing a moving target, not a fictitious
force.** The todo specifies "the head's linear and angular acceleration injects
an offset opposing the acceleration". That is the same physics written the
expensive way: it needs the head's orientation differentiated twice per frame,
and every jitter in the frame time comes back as a kick on every glyph. A
spring-damper whose target is the rest site carried by the head's frame
produces the drag, the overshoot and the settle for free, because that is what
a non-inertial frame IS. Measured: a 0.7 rad yaw step moves the settled field
0.0354 units; 60 ms after the step at `inertia: 0.9` the field is still 0.0347
behind, it settles after about 6 s and then holds to 0.0002. At `inertia: 0`
the same step is tracked to within 0.0005 immediately.

**Thickness is a weight, not a distance.** The todo says "sample a few hundred
points in the interior volume from the thickness field", which reads as
marching inward from a vertex by its thickness. `computeThickness` normalises
to [0,1] by the largest chord in the mesh, so the world scale is gone and
recovering it means a second raycast over the whole body. Thickness instead
weights WHICH vertex is drawn, and the inward slide goes toward a per-slice
body centre line. That still does the job it was needed for, which is keeping
glyphs out of the nose, the ears and the chin.

**A whole-body centroid does not work, and neither does the crown.** The first
version slid each site toward one centroid. On a bust that sits at the
shoulders, so a forehead sample ends up in the neck. Slicing by height, exactly
as `poolRadialProfile` does for the waterline, fixes it. It then exposed the
second problem: at the crown and under the chin the centre line MEETS the
surface, so the slide is zero at any depth and the site lands ON the skin,
where its billboard pokes straight out of the silhouette. Visible in the first
lab capture as a bright cluster above the head. Fixed by
`INTERIOR_MIN_CLEARANCE`: a draw with less than 2% of the bounding diagonal of
inward room is retried up to eight times and then abandoned, so
`sampleInteriorSites` returns AT MOST what it was asked for. Two regression
tests, both of which fail with the constant set to 0.

**Depth desaturates as well as dims.** The todo asks for both; the first
version only dimmed. At `brightness: 1` the field read as a cyan haze competing
with the surface text. `mix(white, tint, dim)` washes the tint out with depth,
which is both what a coloured mote seen through more body does and what stops
the far half of the field pulling the eye.

**No `count` slider rebuild.** `INTERIOR_GLYPH_MAX` sites are sampled once and
`count` picks a prefix, so dragging the slider changes a draw range and a
uniform and nothing else. Resampling per step would teleport every glyph on
every step of the slider, which makes the control useless for judging a look.

## Traps found

**`SkinnedMesh` overrides `updateMatrixWorld`, not `updateWorldMatrix`.** Only
the former refreshes `bindMatrixInverse` in `AttachedBindMode`, and the first
version of `interiorFrame` called the latter. That paired this frame's
`matrixWorld` with the previous frame's inverse, so the avatar root's
emergence travel was applied a second time: at `rootOffsetY: -0.6` the frame
came out at -1.2, half a body low. Found by the Codex review on the pull
request, not by the self-review. Fixed by walking the parents with
`updateWorldMatrix` and then the body with `updateMatrixWorld`, and covered by
a regression test that reads -1.2 without the fix.

**A fixed sleep in the smoke script was measuring the host's frame rate.**
`interiorIntegrate` clamps `dt` to `INTERIOR_MAX_STEP`, so below 20 fps the
simulation advances slower than the wall clock, and a headless page rendering
this scene through software GL runs well below that. The settle leg failed on
a slow run and passed on a fast one for that reason alone. It now polls the
field's centroid until two samples 500 ms apart agree, and reports how long
that took, which is a direct measurement of the claim.

**`bakeThickness` threw on a legal rig.** It flagged the upload through
`attr.data`, which only exists because `bakeFeatureMasks` declares the mask as
one channel of an interleaved buffer. A rig arriving with its own `aThickness`
as an ordinary glTF accessor has no `.data`, and the whole mount failed inside
`replaceAvatar` with `Cannot set properties of undefined`. Found because the
new engine test fixture builds exactly that geometry. Fixed and covered by its
own regression test in `test/asset.test.ts`; it is a `Fixed` entry in the
changelog, not part of this feature.

**A fractional render order is the right answer here.** The field has to draw
after the interior wall at `-1` and before the occlusion mask at `0`. The mask
writes the FRONT surface depth, and every interior glyph is behind that surface
by construction, so anything at `renderOrder >= 0` with a depth test is erased
entirely. `-0.5` is deliberate; renumbering the four existing passes to make
room would move numbers that are load bearing for the approved look.

**`needsUpdate` is a set-only accessor in three.** Reading it back gives
`undefined`, so the regression test asserts on `attr.version` instead, which is
the readable side of the same flag.

**Reduced motion cannot be emulated for a determinism win here.** Every other
capture script in `tools/smoke/` sets `reducedMotion: 'reduce'` to stop the
text-skin row flow between frames. That would also switch off the very lag this
one has to measure. So `__interiorLab.pinPose()` zeroes the two text-skin
scroll speeds directly, and reduced motion gets its own page and its own
context.

## Measurements

- **Inertness.** With the pose pinned, two captures at `interior.count = 0`
  differ by 0 pixels. Turning the field on changes about 38,060 px, of which
  all but 11 are inside the silhouette. Turning it back
  to 0 restores the capture exactly: 0 px differ.
- **Visual eval.** `bun run eval` overall pass. `coverage` 0.156 against a
  0.156 baseline, `blendZoneGhosting` 0.635 against 0.640, `flow` 25.802
  against 24.952. The field is off in the eval, so this says the gate is inert
  through the eval's own instruments as well as the smoke script's.
- **Bundle.** `dist/hologlyph.js` goes from 104.67 kB / 32.99 kB gzip on
  `glass` to 120.90 kB / 38.01 kB gzip, so +16.2 kB raw and +5.02 kB gzip.
  Minified on their own the two new modules are 7.3 kB raw / 3.3 kB gzip; the
  rest is the config surface in `contracts.ts`, `normaliseHeadConfig` and the
  engine reconciler, which is not separable. Kept as a static import for
  consistency with `createPoolSurface`, which made the same trade after
  measuring it. `dec.performance-budget` sets no JS bundle number, so nothing
  is breached, but if the owner rejects the look this is the first thing to
  delete, and if the owner accepts it and the number matters, a lazy chunk
  behind the `count > 0` gate would recover about 3 kB gzip at the price of an
  asynchronous reconciler and its three race windows.
- **README correction, unrelated to this change.** The README claimed the main
  bundle "stays at ~20 kB gzip". It was already 32.99 kB gzip on `glass`, so
  the claim was stale before this branch. Corrected to the measured 38 kB
  rather than left to drift further while this change makes it worse.

## What the owner has to judge

The field works and it is measurably inert when off. Whether it should ever be
on is the open question, and there is a real risk it should not be:

- At the shipped surface density the field is subtle head on and obvious in
  three-quarter view, because that is where the skin is thin enough to see
  through. Whether that asymmetry reads as depth or as an inconsistency is a
  taste call.
- `size: 0.02` was picked in the lab, not derived. At `0.012` the glyphs are
  legible only as texture; at `0.045` they read as a second, larger layer of
  text and start to compete with the surface. The whole interesting range is
  narrow.
- Nothing here has been seen in motion by a human. The lag is measured on the
  field's centroid and the stills are captures; the judgement the todo asks for
  still needs somebody to shake the head in `demo/interior-glyph-lab.html` and
  say yes or no.
