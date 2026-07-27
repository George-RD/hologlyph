# Implementation notes: liquid-glass-live-css-layer

## Deviations from the plan

**The todo's blocker was stale, and the real one was somewhere else.** The item
was `blocked` on photographing a Firefox. Mozilla 1579957 turns out to be
RESOLVED FIXED since 2022-05-18, with its dependency 1765525 VERIFIED FIXED on
2022-06-06, both before Firefox 103 shipped `backdrop-filter` unflagged. No
release Firefox has ever had the defect. Meanwhile nothing in the todo, the
research note or the survey mentioned backdrop roots, which is the constraint
that actually decides whether this feature can work at all. Reasoning is in
`dec.liquid-glass-compositor`.

**A spike ran before any module shape was chosen.** Worth stating because the
temptation was to start with the projector work, which is the interesting part.
Had the shadow host's `contain: layout paint` promoted a backdrop root, the
answer would have been to move the layer out of the shadow tree entirely, and
the projector work would have been built on a design that could not ship.

**The waterline is clipped in 3D, not in 2D.** The plan said "clip the layer
against the pool separately". Intersecting the polygon with the plane's
vanishing line is exact but delicate; clamping hull points up onto the floor
before projecting is four lines and preserves the outer-bound invariant by
construction.

## Discovered edge cases

**`decodePng` returns three bytes per pixel, not four.** `tools/evals/score.mjs`
reports the stride in `img.channels` and every existing consumer honours it. The
first version of the smoke script hard-coded four, which does not crash and does
not obviously misbehave: it reads a neighbouring pixel's bytes for every sample,
so the deltas stay plausible while being attributed to the wrong coordinates.
It produced a confident inside-versus-outside split that was meaningless, and a
`NaN` mean that was the only visible symptom. Any new capture script must read
`channels`.

**A visual check on this page needs reduced motion, not just frozen motion.**
`engine.setMotionFrozen(true)` stops the skeleton but not the text skin, whose
glyph rows scroll on their own clock. Two captures of an unchanged page differed
by a mean of 25.14 inside the silhouette, against a frost of 44.89: a
signal-to-floor ratio under two. Mounting the page under Playwright's
`reducedMotion: 'reduce'` pauses the row flow and takes the floor to exactly
0.00, at which point the frost reads 24.00 inside and 0.04 outside. Same
feature, same code, a measurement that means something only in the second case.

**One probe pixel is not a measurement.** The first version sampled the clip
polygon's centroid and reported a frost delta of 1.02, which reads as "the
feature does nothing". The centroid happens to sit on a smooth part of the
backdrop, where a blur is very nearly the identity. Over the whole polygon the
same capture gives 24.00. Frost has to be measured over the region, not at a
point.

**Headless WebKit composites no `backdrop-filter` at all.** Every row of the
spike, including the unwrapped control, came back dead. It is not evidence
either way, in the same class as the headless-Firefox SWGL problem already
recorded in `src.dom-capture-survey-2026-07-25`.

**Blink promotes a backdrop root on `overflow: hidden` with a rounded corner.**
Not in Filter Effects 2, measured directly, and it independently reproduces the
case Mozilla bug 1782876 comment 3 still lists as open in Firefox 133. Plain
`overflow: hidden` with square corners does NOT promote, and is deliberately
not reported: warning about it would train hosts to ignore the warning.

**happy-dom returns `''` for an unset computed `position`,** where a browser
returns `static`. The parent-position warning treats both as static, which is
correct in both environments since `static` is the initial value.

## Self-review findings, all fixed here

Independent review was attempted and all three reviewer models were
quota-exhausted, which is the same wall `todo.liquid-glass-tier1-pool` hit. The
seven-area review was run here instead, and it found three real defects. Each
carries a regression test that fails without its fix.

1. **The layer was re-requested every frame on an engine that cannot build
   one.** `applyCompositorGlass` guarded on `!this.compositor`, which is true
   forever once the constructor returns null, so an open gate meant a
   `CSS.supports` call per frame for the life of the page. The doc comment
   claimed the opposite, which is how it survived being written. Fixed with
   `compositorUnavailable`, cleared only by teardown. Test: "asks for the layer
   once on an engine that cannot composite one".

2. **A remount onto a different canvas stranded the layer.** The layer is
   parented next to the canvas, and `doMount` tore down the lens and the stage
   on a canvas change but not this. The old frosted div would have stayed in the
   host page forever. Test: "does not strand the layer beside a canvas it has
   been remounted off".

3. **The tint was scaled by `amount` twice**, once in its own alpha and again by
   the layer's opacity, so the colour faded quadratically and never reached the
   configured value. `amount` is now the single master mix. The smoke script
   gained a half-amount leg that measures it: 12.10 against 24.00 at full, a
   clean linear response, which also confirms that opacity on the filter element
   itself does not kill the backdrop in Blink.

## Verification

`bunx tsc --noEmit` clean. `bunx vitest run` 565 passed. `bun run build`
succeeds. `bun run lint` reports one pre-existing warning in a demo file,
untouched here. `bun run eval` overall pass. `cairn hook all` passes.

`tools/smoke/compositor-shot.mjs` against a real Chrome, all eleven checks:

| leg | inside | outside |
| --- | --- | --- |
| noise floor, same state twice | 0.00 | 0.00 |
| frost, layer off versus on | 24.00 | 0.04 |
| liveness, backdrop phase stepped | 29.22 | 70.42 |
| half amount | 12.10 | 0.02 |

The confinement number is the one worth keeping: 24.00 inside against 0.04
outside, on a zero noise floor, is the frost being genuinely blob-shaped rather
than a rectangle. The liveness row is what separates this rung from the lens
rungs, and its outside column is the control that says the page really moved.

Cost was not re-measured. `demo/backdrop-clip-spike.html` measured 0.44 to
0.59 ms for a 60-point polygon rewritten every frame at blur up to 64 with full
viewport coverage; this ships 12 to 32 points at blur 18, strictly inside that
envelope and inside the todo's 1 ms budget.

## Left open

- **Nobody has judged it.** Every number above is a measurement. Whether a
  frosted head over a live page reads as glass or as a smudge is the owner's
  call, and `demo/compositor-lab.html` is the sixth lab waiting on
  `todo.liquid-glass-owner-look-session`.
- **The hull halo.** The clip polygon is 27 to 41 per cent larger in area than
  the true silhouette, so the frost extends slightly past the head. Invisible
  against the shipped dark page, possibly not against a bright one. Raising
  `DIRECTION_COUNT` tightens it on a known curve and needs a decision
  superseding the point budget in `todo.liquid-glass-silhouette-hull`.
- **Real Safari and real Firefox are unverified for the backdrop-root leg.**
  Headless WebKit cannot answer it and this host cannot photograph either
  browser. The clip-path leg was verified in real Safari 26 by an earlier
  session, and the Firefox clip bug is closed on the tracker.
- **Rung 2 and rung 3 together are unexplored.** Naming a lens source makes the
  head opaque, which would hide the frost behind it. Nothing stops a host doing
  both and the result is undefined by anything except the draw order.
