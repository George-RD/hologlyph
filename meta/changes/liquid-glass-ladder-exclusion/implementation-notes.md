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
