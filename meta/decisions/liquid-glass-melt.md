---
id: dec.liquid-glass-melt
nodes:
  - hologlyph.runtime.shaders
status: accepted
date: 2026-07-27
informed_by:
  - src.owner-look-2026-07-27
  - src.owner-vision-2026-07-25
  - src.owner-consolidation-2026-07-28
  - res.melt-internals-material-audit
---
# The liquid direction is a vertex melt on the real bust

## Context

Tier 3, the modal fluidity driver, was judged on 2026-07-27 and missed. The
owner's words, from `src.owner-look-2026-07-27`:

> "i turn on liquid, and its just like a gravity effect? and it all bulges"

A damped modal solver perturbing the rig gives sag and wobble. It does not give
the thing that was actually wanted, which the owner then stated directly:

> "I want to be able to morph the whole head, from a flat puddle, up into the
> head. And i want to be bale to make the head squeeze and move between things."

The pool was cut in the same session, so there is no longer a waterline for the
head to rise out of. The puddle is the head, not a separate body of liquid the
head emerges from.

`todo.liquid-glass-topology-fluid` proposes a PBD or SPH particle field with
screen-space surfacing on WebGPU compute as the answer to this class of look.
That is a large piece of work with a capability branch, a new asset bake, and no
WebGL2 fallback, and it would have to be built before anything could be judged.

## Decision

The liquid direction is a vertex melt on the real bust, not a surfaced particle
field.

Neither of the owner's two asks changes topology. A flattened closed surface is
still a closed surface, and a surface squeezed through a gap is still a closed
surface. A particle field is only strictly necessary for droplets pinching off
and for separate blobs merging, and neither was asked for.

So the melt deforms the shipped mesh. It keeps the rig, the authored visemes,
the glyphs, and the glass; it runs on WebGL2; and it costs one displacement term
plus the closed-form normal transform that term implies. It is gated at
`melt.amount: 0`, where it is an exact identity rather than an approximate one,
and it is judged in `demo/melt-lab.html` before any default moves.

The two asks are ordered. The morph is built and judged first. The squeeze is
the same melt driven by the stage colliders and is deliberately not in the first
change, because building it on an unapproved melt would repeat the mistake that
produced tier 3.

## Rationale

Displacement first because it is the cheap experiment that answers the
expensive question. If a melted bust reads as liquid, the particle field is
weeks of work bought for nothing. If it does not, the lab shows exactly why, and
the escalation is then evidence-backed rather than speculative.

It also preserves everything the owner has already approved. The glyphs stay
welded to the bind pose and flow with the surface, which is the approved look
recorded in `src.owner-approved-look-2026-07-21`. The 15 authored visemes stay
upstream of the displacement in three's `setupPosition` order, exactly as tier 3
established. The glass shading is unchanged. A particle field would have to
re-derive all three from scratch and would lose the visemes outright.

The map is deliberately a function of `y` alone. That is what makes its Jacobian
triangular and closed form, so the normal transform is exact rather than a
finite-difference approximation, and it is what makes the identity at
`amount: 0` exact.

### The escalation criterion

Quoted from the change plan, and it is the question the lab session exists to
answer:

> if the puddle at `melt.amount: 1` reads as a squashed head rather than as
> liquid, specifically if the rim shows facial features instead of a
> surface-tension edge, mesh displacement has failed and the particle field in
> `todo.liquid-glass-topology-fluid` is warranted.

If it fires, `todo.liquid-glass-topology-fluid` remains the answer, and that is
a separate change with its own decision artefact amending
`dec.renderer-posture`, which currently defers compute shaders. The judgement is
recorded in the change's `implementation-notes.md` before anything further is
built.

### Scope of a future particle field

Bounded now, per the owner's ruling in `src.owner-look-2026-07-27`, so that an
escalation cannot quietly take the mouth with it:

The fluid field is entered only where there is no face. Whenever there is a
head, the rig owns it and speech runs on the 15 authored visemes. Viseme frames
are suppressed while re-forming is in flight and resume once it completes. A
particle field never approximates a mouth.

## Consequences

- Tier 3 (`fluid.*`) and the stage participants (`stage.*`) are superseded as
  the liquid direction but are not deleted. The stage collider plumbing is what
  the squeeze reuses, and the fluid's per-zone mask and normal-gate pattern is
  the template the melt follows.
- `pool.*` is cut outright as a look. `poolRadialProfile` and `PoolProfile`
  survive as the melt's source of the bust's bind extent, and
  `poolWaterlineRadius` still floors the compositor outline. The profile is
  built at avatar load and is not gated on `pool.amount`, so cutting the pool
  does not remove it.
- The melt is not volume conserving. `spread` is a look control tuned by eye,
  not a physical constraint. A puddle that reads too thin or too wide is fixed
  by moving `spread` and `floor`, not by changing the map.
- The melt runs in bind space, so a yawed head carries its puddle round with it.
  Acceptable for a spike judged with motion frozen. The fix, if the owner wants
  to judge it with idle motion running, is to blend the rig toward the bind pose
  as `melt.amount` rises, which is also physically sensible: a melting head
  loses its pose.
- The occlusion mask has to melt with the body. It is currently a plain
  `MeshBasicMaterial`, which cannot take a `positionNode`, and a rigid mask
  behind a melting body would show the mouth cavity and the eyeballs through the
  puddle. Ownership of that material moves to `buildSkinMaterial`, which brings
  its dispose with it.
- Normals are the failure mode. The melt is not a scalar along the vertex
  normal, so it cannot reuse the existing `surfaceGradient` path; it needs the
  inverse transpose of its own Jacobian, and the `g'` denominator reaches 0 at
  full melt. An unguarded divide puts an infinity into the fresnel, which
  reaches the alpha, and the silhouette collapses. That exact failure is already
  recorded in `src/shaders/materials.ts`.

## Confirmed by the owner, 2026-07-28

> "the head liquid/melting is the right direction!"

And, unprompted, on the floating internals:

> "i was aware of the eyeballs/internals thing, i could see, which is why i just
> approved the directio here!"

So the approval was given with the known defects in view, not because they were
hidden. Recorded as `src.owner-consolidation-2026-07-28`.

**Status change.** The melt is promoted from experimental spike to the active
liquid direction. It is active development and NOT ready: `melt.amount` still
ships at 0, the map is still an exact identity there, and the controls live in
the studio's developer tier rather than beside the personalisation knobs.

The escalation criterion is settled rather than pending. It did not fire, the
owner has confirmed the direction by eye, and
`todo.liquid-glass-topology-fluid` stays unwarranted.

Two consequences for how the work is presented, from the same session:

- The glass is the default rather than one option shown beside others, since
  every alternative shown beside it was ruled against on 2026-07-27.
- There is one environment. The studio is the site root, the melt is a developer
  tier inside it, and the pages that used to hold these features separately are
  out of the deployed set.
