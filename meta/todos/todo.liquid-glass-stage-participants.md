---
node: hologlyph.runtime.core
status: open
created: 2026-07-25
---

# Stage participants: the opt-in contract that lets the fluid touch the page

Order 7 (`dec.liquid-glass-architecture`). Unblocked 2026-07-27: both
prerequisites have landed. `todo.liquid-glass-tier1-pool` gave it a water
surface (2026-07-26) and `todo.liquid-glass-fluidity-driver` gave it a body
that can be pushed around (2026-07-27), which is what work item 2 below means
by "feed them to the simulation as colliders".

One thing changed shape while item 8 was built: the tier 3 solver is a SINGLE
damped mode (`dec.liquid-glass-fluidity`), and one global mode cannot squeeze
against a page element on one side only. This item therefore also grows
`FLUID_MODES` in `src/shaders/fluid.ts` from one to a small basis, with each
mode weighted by where on the body it acts. That is a constant and a loop, not
a redesign, and the decision records it as the intended extension point.

The pool half of this item still touches the look the owner has not ruled on,
so confirm the pool lab ruling before starting if one has not arrived.

Rung 4 of the backdrop ladder (`dec.liquid-glass-architecture`). This is what
turns "a glass head on a page" into "a fluid that interacts with the page", and
it is what the owner's squeeze-past and migrate-and-re-emerge ideas require.

The head knows nothing about the host layout today, so it cannot collide with
anything. Participants fix that without taking ownership of the page.

Work:

1. Declarative markers on elements the host already owns, for example
   `data-hologlyph-obstacle` and `data-hologlyph-body`.
2. Read their rects with batched measurement, never interleaved with writes, and
   feed them to the simulation as colliders.
3. Write results back as CSS transforms only. Document that participants must
   tolerate being transformed.
4. Track layout changes with `ResizeObserver` and `IntersectionObserver` rather
   than polling.
5. Zero participants is the normal case and must behave exactly as today.

This keeps the drop-in product intact: level 0 is still a single tag, and every
extra capability is an attribute on markup the host already controls.

Acceptance: with two or three participants declared, the pool and head visibly
collide with and flow around them while scrolling; with none declared, no
measurable cost and no behaviour change; no layout thrash in the profiler.
