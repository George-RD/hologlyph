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

## Review, first pass: self-review only

Every delegated route refused on quota. `reviewer`, `scout`, `sonic` and the
general worker all tunnel through Codex (`usage_limit_reached`);
`gemini-reviewer` and `completion(model="smol")` are Cloud Code Assist
(`RESOURCE_EXHAUSTED`, resets 2026-07-28). The session model itself is also
Codex and reported a five-day window. Same wall `demo/LAB-STATUS.md` recorded
on 2026-07-27 for the tier 1 pool change.

The diff was therefore self-reviewed against a hostile brief. Three findings,
all fixed before the merge.

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

Judged clean at the time, and one of those judgements was WRONG. See the
second pass below.

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

## Review, second pass: an independent model, and a shipped bug

`completion(model="default")` still had capacity, so the diff plus the
supporting code went to it under the same hostile brief. That is not a
subagent and it could not read the repo, only what it was handed, so several
findings are about code it never saw. Nineteen raised, each checked against
the source. Five confirmed and fixed, the rest rejected with reasons.

### Confirmed

- **MAJOR, and it had shipped: the predicate ignored the glass.** The lens
  substitutes on the interior wall, and `applyGlassLayering` sets
  `interiorMesh.visible = false` at `skin.glass.amount: 0`, or on a rig with no
  body mesh to clone. So a bound texture with the glass off paints nothing, and
  `lensContributing()` was still standing rung 2 down for it: both rungs off,
  the head showing neither. `HeadLensConfig` had documented "turning the glass
  off turns the lens off with it" in the same file, four paragraphs up from the
  note this change added. Fixed by reading `glassLayeringActive`, the flag
  `applyGlassLayering` set earlier in the same frame, rather than re-deriving
  the condition. Regression test: `brings the layer back when the glass the
  lens rides is turned off`.
- **MAJOR: two restore tests were vacuous.** `brings the layer back when the
  source is dropped` and `... when the lens is mixed out` named the source
  before any frame ran, so their opening `toBeNull()` passed because the layer
  had never been BUILT, not because it was stood down. Both would have
  survived deleting the exclusion. They now run a frame first and assert the
  layer exists.
- **MAJOR: the smoke script passed its leak legs on a degenerate polygon.**
  With `clipPath` empty, `pageMask` collapses to an empty head box, so the away
  mask covers the whole frame and both the leak check and its own coverage
  control report PASS while the frost check fails on NaN. It now throws before
  measuring anything.
- **MAJOR: capture dimensions were never validated.** Every mask indexes
  `y * VIEWPORT.width + x`. A capture at any other size misaddresses every
  pixel without crashing, and the inside/outside split silently becomes an
  arbitrary partition with plausible-looking numbers. Now asserted.
- **MAJOR: the lab could not tell "stood down" from "never buildable".** On a
  browser with no `backdrop-filter`, or with a promoting ancestor, there is no
  layer and there never was, and `verdict()` credited rung 3 anyway. The panel
  now remembers whether it has ever seen a layer on this canvas. It also
  folds `skin.glass.amount` into `asked`, per the first finding, and pads to
  the true longest verdict.

### Rejected, with reasons

- **`hullProjector` retained or projected while suppressed.** No.
  `syncCompositorGlass` runs only under `if (compositorGlass)`, so nothing is
  projected while the layer is down, and retention is per-avatar exactly as it
  is at `compositor.amount: 0`. The model had not been given `engine.ts`
  beyond the diff.
- **`leakCeiling` uses the wrong noise floor.** No. `noise.outside` and
  `frost.outside` are the same population by construction, which is the point
  of computing them over the same mask. `awayCeiling` exists precisely because
  the away mask is a DIFFERENT population.
- **A throw between the old and new call sites strands the layer.** No
  reachable path. `documentRect` is `getBoundingClientRect`, which does not
  throw on a detached element; `lensWindow` and `lensDisplacement` are pure
  arithmetic; `element-lens.draw` wraps `drawElementImage` in try/catch;
  `setLens` only writes uniforms. A lens that did throw would kill the frame
  before `render()` anyway.
- **Per-frame thrash when a host cross-fades `lens.amount`.** A monotonic ramp
  crosses zero once, so it is one transition, not one per frame. Pathological
  jitter around zero would thrash, but identically to the pre-existing
  `compositor.amount` gate, whose branch this deliberately reuses.
- **The warn-once ancestor message repeats on rebuild.** True, and identical
  to toggling `compositor.amount`. Not introduced here.
- **`element-lens` holds rung 2 down with a stale binding when the source is
  hidden.** True that the binding survives a zero-size draw, but the lens is
  still painting, just painting something stale. "Contributing" is the right
  answer; the staleness is the documented lens contract.
- **NaN reaches the shader.** `> 0` already excludes NaN, so rung 2 survives,
  which is the safe direction. The unguarded `clamp01(NaN)` is systemic across
  every amount field in `resolveHeadConfig` and predates this change; fixing it
  belongs in its own change with its own sweep.
- **`rafCb?.()` could be undefined.** The harness assigns it at mount and the
  whole file uses this form. The substance underneath, the vacuous
  assertions, was real and is fixed above.
- **The frost leg's mask is derived from the layer's own clip.** True, and now
  stated as a limit in the script header: it proves confinement, not that the
  hull matches the head. Silhouette geometry is `compositor-shot.mjs`'s claim.
- **Claim 2 is DOM, not pixels.** The DOM absence is the mechanism under test,
  and the pixel legs carry the appearance claim (`between.inside.mean` 31.54).
- **The lab never disposes.** Consistent with all six sibling labs.
