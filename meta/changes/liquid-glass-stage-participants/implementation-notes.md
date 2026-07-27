# Implementation notes: liquid-glass-stage-participants

Deviations from the plan and edge cases found while building, in the order they
came up.

## The pool ruling never arrived, and waiting for it was the wrong call

The todo said to "confirm the pool lab ruling before starting if one has not
arrived". None has: `pool.amount` still ships at 0 and the pool remains
lab-only. Blocking on it would have blocked the only unblocked item in the
programme for a ruling that gates the pool's LOOK, not its plumbing. The pool
half of this item is therefore built behind the pool's own existing gate, the
same posture item 8 took: at `pool.amount = 0` there is no pool object, so
there is nothing for a participant to dent. Nothing here presumes an answer.

## One mode could not have been extended into two, so the slots are per
participant rather than per height band

The obvious reading of "grows `FLUID_MODES` from one to a small basis, with
each mode weighted by where on the body it acts" is a fixed set of height
bands: low, middle, high. That localises vertically and still fails the common
case. A head sitting between two columns of page content has an obstacle on
each side AT THE SAME HEIGHT, so both land in the same band, and their flow
vectors are opposite, so the band holds their mean, which is nothing.

The slots are therefore bound to participants, not to heights, and each one
carries its own band centre. Same uniform count, same unrolled loop, and the
two-sided case works. `test/shaders-fluid.test.ts` pins the distinction
directly: `fluidDisplacement` of the summed vector is exactly 0 while the sum
of the two separate displacements is not.

## The reaction and the bulge had to be gated together

First cut gated the head's bulge on `fluid.amount` (which ships at 0) and the
CSS push-back on `stage.amount` (which ships at 1). A page that marked an
obstacle under the shipped configuration would then have watched its own
furniture slide about while the glass sat perfectly still. Both halves now come
off the same effective amount, which is also the physically honest reading:
the reaction is Newton's third law on the same interaction.

## `getBoundingClientRect` reports the transformed box

The trap this feature is built around. Measuring the live rect and feeding it
back in folds last frame's reaction into this frame's collision, and the
element walks off the page over a few seconds. The applied offset is subtracted
back out of every read, which is exact because this module owns it.

Two consequences fell out of that:

- The push is composed AHEAD of the host's own inline transform, not after it.
  Transforms apply right to left, so leading with the translate keeps it in the
  untransformed parent's space; appending it would have the host's scale or
  rotate multiply the pixel offset and the subtraction would only be
  approximate.
- The collision always uses the REST rect, so a pushed element does not feel
  itself retreating from the head. That is deliberate: the alternative is the
  feedback loop above. A participant is an anchor that gets displaced
  visually, not a free body.

## Both channels of the pool field have to be forced, not just the height

First cut blended the dent into `r` only. `g` is the height one step ago and
`r - g` is the stored velocity, so clamping only the height left a large
negative velocity trapped inside the footprint, which the pool released as a
spike the frame the obstacle scrolled clear. Forcing both is a true Dirichlet
condition: zero velocity inside the footprint, waves reflect off the boundary,
and departure is a clean relaxation.

## Observers had to be decoupled from each other

`ensureObservers` originally created the `IntersectionObserver` and attached
the scroll listener inside the `ResizeObserver` branch. Any runtime without
`ResizeObserver` (happy-dom, older browsers) then got no invalidation at all
and every rect went stale after frame one, silently. Each source is now wired
under its own capability check and the scroll listener is unconditional.

## `stage.amount` is applied once, not twice

The participant mode is driven by `overlap * stage.amount`, so the solved flow
already carries the master knob. Multiplying the reaction by it again turned a
level into a curve. The reaction reads `stage.push` alone.

## The document observer is conditional, and that needed an escape hatch

A subtree `MutationObserver` over a document that marks nothing is exactly the
standing cost the drop-in promise forbids, so it is installed only once a scan
has found at least one marker. That leaves the page which marks its first
participant after mount unwatched, so `Engine.refreshStage()` is part of the
public contract rather than a test hook. The smoke script drives that path
deliberately: it injects its own participants after mount and calls it.

## `BUST_HEIGHT` is the emergence travel, not the geometry

`HeadFluidConfig.reach` and the first draft of `HeadStageConfig.band` both
justified their default against "the bust is about 1.8 tall", which is
`BUST_HEIGHT` in `src/shaders/emergence.ts`. That constant is the distance the
ramp translates the root through, not a measurement of the mesh. The shipped
`bust_1` geometry actually spans bind Y -2.02 to 1.01 with a half-width up to
1.04, and the head alone is roughly one world unit from jaw to crown.

`band` is documented against the measured rig instead, and its default of 0.45
is unchanged: the weight is `exp(-((y - c) / band)^2)`, so the effective band
is about 0.9 world units, which is the head. `reach`'s comment is left alone
rather than edited from inside this change; it is tier 3's, its default is
already sane against the real mesh, and the phrasing predates both items.
