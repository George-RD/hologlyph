---
node: hologlyph.runtime.core
status: blocked
created: 2026-07-25
---

# Stage participants: the opt-in contract that lets the fluid touch the page

Order 7 (`dec.liquid-glass-architecture`). Blocked on
`todo.liquid-glass-tier1-pool`.

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
