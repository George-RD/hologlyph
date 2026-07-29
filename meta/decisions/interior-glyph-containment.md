---
id: dec.interior-glyph-containment
nodes: [hologlyph.runtime.shaders]
status: accepted
date: 2026-07-29
informed_by: [src.owner-look-2026-07-27]
---

# A suspended glyph may not leave the room it has

`todo.interior-glyph-containment` came out of the owner look session: "the
glyphs pop out the head when i increase drift". The cause was that
`interiorDriftTargets` moved every glyph by one global `config.drift`, with no
term for how much room that glyph had.

## What is bounded, and against what

Each site is measured at seed time for its exact distance to the nearest point
on the body's triangles, `InteriorSites.clearances`. That number, less the
sprite's own half-diagonal and less `INTERIOR_DRIFT_MARGIN`, is the radius the
glyph may leave its carried rest position by. It bounds two things:

- the drift offset's LENGTH, in `interiorDriftTargets`, and
- the integrated world position, in `interiorContain`, after the spring.

Both, because a bounded target is not a bounded glyph: the spring is
deliberately under-damped and chases its target through a frame the head is
turning, so the lag and the overshoot each leave any ball the target was held
in. A site whose clearance cannot hold its own sprite at all gets a budget of 0
and is culled from the draw rather than drawn poking out at rest.

## The trade this forces, and the owner's ruling

Bounding the integrated position necessarily bounds the INERTIA DRAG, which is
`dec.liquid-glass-architecture` item 10's own approved look and what the lab
page invites the viewer to try. On the shipped bust a 0.7 rad yaw step used to
leave the field 0.98 of its travel behind; it now leaves it 0.10 to 0.20 behind,
measured across runs, and still settles over about 3 s. The drag has not gone:
it is now proportional to how much room each glyph actually has, so glyphs deep
in the skull wallow and glyphs against the cheek hold still.

The owner was given the trade explicitly on 2026-07-29 and took it, over the
two alternatives:

- **A runtime nearest-surface query.** A uniform grid over the body's triangles,
  queried per drawn glyph per frame, would preserve the drag wherever there is
  genuine room. Rejected as a collision system inside the glyph field for a
  feature that is off by default. It stays the upgrade path if the calmer shake
  is ever judged too calm.
- **Clipping the glyphs to the body's silhouette** with a stencil or depth
  prepass. This satisfies "no pixels cross" by CUTTING a glyph at the outline
  rather than keeping it inside, which reads as a masking bug on a glass head,
  and the silhouette the engine already has (`SilhouetteProjector`) is convex,
  so it would still leak at the neck and the ears. Rejected on the look, not on
  the cost.
- **Bounding the drift alone**, which is the literal complaint. Rejected
  because the lab copy invites a shake, and a shake was the case that leaked
  furthest.

`tools/smoke/interior-glyph-shot.mjs` leg 3 asserted a lag of at least half the
travel. A fixed fraction is the wrong oracle for a bounded lag. That leg runs at
`drift: 0`, so the spread across runs is not the drift phase: it is which sites
the seeding drew, and so how much room each glyph has, together with the frame
the step lands in. The leg now asserts the DISTINCTION instead: the lag must
exceed the settle noise, and must be at least three times the same step's lag at
inertia 0, which is the same field with no lag at all. Measured 18 to 90 times
it across four runs. This is the only oracle the ruling moves; the leg's other
claims, that the step is exercised, that the field settles and stays settled,
and that inertia 0 tracks rigidly, are unchanged.

Leg 3 also had a pre-existing race that containment exposed: `settleField`
returned on one quiet window while the caller measured the residual over the
following second, which an exponential tail can fail. It now confirms forward
over the caller's own span.

## What is not bounded

The clearance is measured against the body in BIND space, which is the same
space the sites are sampled in. Blendshape and skinning deformation of the skin
itself is not tracked, so a glyph behind a surface the jaw has moved is bounded
against where that surface rests. `INTERIOR_DRIFT_MARGIN` keeps a fifth of every
clearance in reserve partly to absorb that.

## Blueprint

`hologlyph.runtime.shaders` claims one new path,
`./test/shaders-interior-field.test.ts`. The field's GPU half had no test file
of its own because its pure halves carried the coverage; containment cannot be
demonstrated that way, because the claim is about the composition of the drift,
the spring and a moving frame.
