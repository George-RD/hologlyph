# Implementation notes: liquid-glass-ladder-exclusion

Deviations from `design.md` and everything discovered on the way.

## The frame order was not a tidiness question

`applyCompositorGlass()` sat before the lens block in `frame()`, and the design
called moving it "cleaner". It is required. Both `createPageLens` and
`createElementLens` publish `binding` from inside `sync()`, never from
`capture()`, so a reconciler that runs first sees last frame's value. The
observable symptom is one frame of frost after a snapshot resolves, and the
engine test `stands the layer down on the first frame a bound lens contributes`
runs exactly one `rafCb` after the capture settles to pin it.

Nothing between the old and new call sites touches the returned handle:
`syncCompositorGlass` consumes it after `render()`, at the end of the frame.

## The compositor clip polygon is not the head silhouette

Found while writing `tools/smoke/ladder-shot.mjs`, and it cost a first draft of
the leak check.

The compositor outline is cut at the emergence waterline, because the layer
must not frost a submerged head that is not drawn. The BUST is drawn below that
line. Measured at 1000x800 in the lab: the clip polygon bottoms at y 406, while
the head still occupies pixels down to y 567. Rung 3 shades the whole head, so
judging its leak against "outside the polygon" counts the shoulders as page and
fails a correct engine. That is what the first run did, at 2.00 mean against a
1.00 ceiling.

The script now carries two masks. `polygonMask` is exact and keeps the rung 2
claims, which are about the frost being confined to the silhouette.
`pageMask` is "away from the head": the polygon's own x-range plus a 24 px
margin, taken down to the bottom of the viewport. It is derived from the
polygon rather than from the comparison it gates, because a region fitted to
the measured difference could not fail, and it carries a coverage control
asserting the protected page is at least a third of the frame. It measures 39
per cent here; the lab's own control panel is a quarter of the viewport and is
excluded from every mask, which is why the bar is a third and not a half.

## Restore legs needed a starting state

`lens.amount 0 gives the frost back` and `dropping the source gives the frost
back` both passed on a build that never removed the layer, because the layer
was present the whole time. Each now records whether the layer was absent
immediately before the restore, so the negative control fails them too.

## Negative control

`lensContributing()` forced to `return false`, dev server hot-reloaded, script
re-run: 3 of 11 legs fail (`naming a source removes the layer from the tree`
plus both restore legs), the rest pass. Restored and re-run: 11 of 11 pass.
`exclusionMs` measured at 103 to 105 ms, which is the snapshot resolving rather
than the reconciler reacting; the poll interval is 100 ms.

## Incidental fix

`README.md` documented `skin.lens.amount`. The config path is `lens.amount`:
`lens` and `compositor` are top-level members of `HeadConfig`, not members of
`HeadSkinConfig`. Corrected in the paragraph this change was already editing.

## Not done, deliberately

- No default changed. `compositor.amount` and `lens.amount` both still ship at
  0, so a drop-in head is byte-identical.
- No blend of the two rungs. `dec.liquid-glass-rung-exclusion` records why no
  weight between them means anything.
- `bun run eval` re-run and passing (`overall: pass`, blend-zone ghosting 0.642
  against a 0.768 cutoff), but not recalibrated: nothing about the shipped look
  moved.

## Review

All four delegated reviewers refused on quota: `reviewer` twice
(`usage_limit_reached`), `gemini-reviewer` and the general worker
(`RESOURCE_EXHAUSTED`, resets 2026-07-28). Same wall
`demo/LAB-STATUS.md` recorded on 2026-07-27 for the tier 1 pool change. The
diff was self-reviewed against the same hostile brief; three findings, all
fixed in the follow-up commit.

- **Restore test was half vacuous.** `brings the layer back when the source is
  dropped` asserted the element exists but not that it was configured.
  Suppression clears `appliedCompositorConfig`, so a rebuild that forgot to
  push config would return an unstyled transparent rectangle and pass. Now
  asserts `backdropFilter` and a `polygon(...)` clip.
- **Lab readout overstated rung 3.** With `compositor.amount` at 0 there is no
  layer to observe, so the page cannot tell whether the snapshot has landed;
  it claimed "rung 3, lens" anyway. Now says "unconfirmed" and points at the
  compositor gate as the way to confirm. Also `'nothing (rung 2 unavailable
  here)'` was 33 characters against a `padEnd(28)`, which broke the
  fixed-width claim the comment above it makes; the longest verdict is now 28.
- **`clip pts` read 01 with no clip.** `''.split(',')` is `['']`, length 1.
  Reads 0 now. (`demo/compositor-lab.html` has the same line and was left
  alone: out of scope, and it only ever reads it with a clip present.)

Checked and clean:

- **Thrash.** Neither lens flaps `binding`. `page-lens` sets it once a capture
  lands and never clears it short of dispose; `element-lens` retains the last
  binding through a transient failed draw and only nulls it after
  `MAX_LIVE_LENS_FAILURES`, after which `sync()` returns at the top forever.
  So the build/teardown cycle, which costs an ancestor walk, cannot run per
  frame.
- **NaN.** `clamp01(NaN)` is NaN, so a host passing `lens.amount: NaN` makes
  `lensContributing()` false and the frost stays. That is the safe direction,
  and `> 0` matches the coupling gate at `src/shaders/index.ts:522`.
- **`compositorUnavailable`.** Untouched by suppression, which is right: it
  records a property of the canvas and its tree, not of the lens.
- **`hullProjector`.** Stateless with respect to layer identity, so a rebuilt
  layer clips correctly on its first frame.
- **Remount with a lens bound.** `mount()` tears both down and rebuilds the
  lens with a null binding, so the frost returns for the ~100 ms until the new
  snapshot lands, then goes again. One cycle, correct.
