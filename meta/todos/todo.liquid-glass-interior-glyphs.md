---
node: hologlyph.runtime.shaders
status: blocked
created: 2026-07-25
---

# Sparse interior glyphs drifting inside the glass

Order 10 (`dec.liquid-glass-architecture`). Blocked on
`todo.liquid-glass-solid-body`. Lab exploration, last in the queue, decorative
only.

Owner direction (2026-07-25): scatter a few glyphs inside the head, suspended
between the near and far surfaces, and let them move as though they were
floating in fluid. Moving or shaking the head should drag them off course and
they should settle again afterwards.

This makes the block of glass read as full of text rather than coated in it. It
is deliberately additive: the surface text skin does not change, so the approved
look is not at risk.

## Why it waits for solid-body

Item 1 produces the two things this needs: a per-vertex thickness bake, which
gives the interior volume to place glyphs in, and a backface pass, which gives
somewhere to draw them. Interior glyphs render between the backface and
frontface passes so they are correctly occluded by both.

## Motion model

Positions live in head-local space, so the head carrying them is free. The
interesting part is the lag, and the cheapest credible model is a fictitious
force in the non-inertial head frame:

- each glyph has a spring-damper toward its rest position in head space
- the head's linear and angular acceleration injects an offset opposing the
  acceleration, so a shake throws them and the spring settles them
- a slow curl-noise drift on top so they never look frozen when the head is
  still

That gives inertia without a solver. If tier 3 lands later
(`todo.liquid-glass-fluidity-driver`) the same velocity field can drive them
instead, but this must not depend on it.

## Work

1. Sample a few hundred points in the interior volume from the thickness field.
   Sparse: this is a hint of depth, not a snow globe.
2. Draw them as camera-facing sprites sampling cells from the existing text-skin
   canvas, so no new asset and no new atlas.
3. Sort back to front within the interior pass.
4. Dim and desaturate with depth so they read as behind the surface, and never
   brighter than the skin glyphs.
5. `setReduced(true)` damps the drift and removes the shake response, as
   everywhere else.

## Risks to judge in the lab

- Reading as a particle cloud or a snow globe rather than as text in glass.
  Sparsity and depth dimming are the controls.
- Competing with the surface text for legibility. `glyphLegibility` sits at
  9.842 and front `coverage` at 0.138; if this ever moves into `src/`, neither
  may regress in `bun run eval`.
- Sorting cost if the count creeps up. Keep it in the hundreds.

## Acceptance

This is a spike, so the deliverable is a judgement, not a landing. A lab page
with count, drift, and inertia sliders, plus a capture under
`tools/smoke/`. At rest the interior reads as depth rather than as snow.
Shaking the head visibly drags the glyphs and they settle. Surface text and
visemes untouched, reduced motion respected. Owner reaction decides whether any
of it becomes library work.
