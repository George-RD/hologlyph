---
node: hologlyph.runtime.shaders
status: blocked
created: 2026-07-25
---

# Tier 4: topology-changing fluid, and the only real viseme trade

Order 9 (`dec.liquid-glass-architecture`). Its stated prerequisite,
`todo.liquid-glass-fluidity-driver`, LANDED 2026-07-27, so this item is
unblocked in principle and stays `blocked` for a different reason.

Two things still gate it, and neither is engineering. Tier 3 ships at
`fluid.amount: 0` and nobody has judged it yet
(`todo.liquid-glass-owner-look-session`), so the thing tier 4 would extend is
not itself approved. And tier 4 is the one stage that gives up authored
visemes, which is a product call about whether the head is ever allowed to stop
being a head. Do not start it without an explicit owner decision superseding
the "possibly never" clause in `dec.liquid-glass-architecture`.

Tier 3 turns fluidity up and down on the rig, which covers sag, wobble, surface
tension, squeeze, and flow. One class of behaviour it cannot do, because a
fixed-topology mesh cannot: **changing topology**. Droplets pinching off,
separate blobs merging, collapsing into a puddle, squeezing through a gap
narrower than the skull.

That needs a surfaced particle field: PBD or SPH with screen-space fluid
rendering, WebGPU compute only.

## The trade, now correctly scoped

A surfaced field has no mesh, so the mouth cannot come from 15 authored viseme
morphs (`RIG_VISEME_MORPHS`). It would have to be an ellipsoid subtracted with a
smooth minimum, driven by open, round, and wide. Vowels survive that; contact
shapes do not, because a smooth minimum cannot press two surfaces together:

- `viseme_pp`, lips shut for P, B, M
- `viseme_ff`, teeth on the lower lip
- `viseme_th`, tongue between the teeth
- `viseme_sil`, the closed rest pose

Screen-space surfacing also blurs detail below the kernel radius, and lips are
below it. Note too that authored visemes embed their own jaw deltas
(`weightsForViseme` pins `jaw_open` to 0), so open-plus-round is not a
decomposition the shipped assets support.

**This does not matter, if tier 4 is only entered when the shape is not a head.**
A puddle has no visemes to get wrong. The trade only becomes real if someone
tries to hold a conversation with a molten head, and the answer to that is
tier 3, which already does everything except topology.

Internals follow the same rule: in a surfaced field they must become rig-driven
analytic primitives, eyeball spheres from the `eye_l` and `eye_r` bone
transforms unioned into the field, `eye_trim` and iris rings dropped. Fine,
because there is no face at that point.

## The handover

The seam is tier 3 to tier 4, and it is far more forgiving than a mid-sentence
swap: it happens at extreme deformation, where the silhouette is already
unrecognisable and heavily refracted.

- Re-forming must complete before `speaking` renders visemes; suppress viseme
  frames until the rig is authoritative.
- If the handover cannot be hidden in the lab, confine tier 4 to full
  submersion, where the pool covers it. That is still worth having.

## Compensating gain

In a volume the text stops being a surface skin and becomes glyphs suspended
inside the glass, sampled at several depths along the view ray, which reads
better as a block of glass than a decal does.

Also required: amend `dec.renderer-posture`, which defers compute shaders and
surface-tension simulation.

## Acceptance

A lab prototype showing pinch-off, merge, and puddle-collapse, entered and left
only at extreme deformation, with the handover inspected frame by frame, and
speech provably running on the rig at all times.
