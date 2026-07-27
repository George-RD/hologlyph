---
id: dec.liquid-glass-participants
nodes:
  - hologlyph.runtime.core
  - hologlyph.runtime.shaders
status: accepted
date: 2026-07-27
informed_by:
  - res.liquid-glass-direction
  - src.owner-vision-2026-07-25
---
# Stage participants: two markers, a modal basis, and transforms as the only write

## Context

Rung 4 of the backdrop ladder (`dec.liquid-glass-architecture`) is what turns
"a glass head on a page" into "a fluid that interacts with the page". It has
been blocked on having something to push against, and both prerequisites have
now landed: `todo.liquid-glass-tier1-pool` gave the head a water surface and
`todo.liquid-glass-fluidity-driver` gave it a body that can be pushed around.

Three facts constrain the shape of this item, and none of them were settled
when the ladder was written.

First, the head knows nothing about the host layout. It has a canvas and a
camera and no notion at all of where the page's own content sits, so it cannot
collide with anything. Whatever fixes that has to acquire host geometry without
acquiring host responsibility: the library must not own layout, must not author
elements, and must not make the drop-in case any more expensive than it is now.

Second, the tier 3 solver is a SINGLE damped mode (`dec.liquid-glass-fluidity`,
Rationale). One global mode cannot squeeze against a page element on one side
only. Worse, it cannot squeeze against two: the displacement is one-sided in
`dot(N, F)`, so two obstacles facing each other produce opposite flow vectors,
and a single mode holding their sum holds nothing. `dec.liquid-glass-fluidity`
recorded `FLUID_MODES` as the extension point for exactly this.

Third, everything about reading the page is a performance trap.
`getBoundingClientRect` forces style recalculation, and it reports the
TRANSFORMED box, so a naive read-modify-write loop both thrashes layout and
folds its own output back into its input.

## Decision

**Two declarative markers on elements the host already owns.**
`data-hologlyph-obstacle` means the fluid is squeezed by this element.
`data-hologlyph-body` means the same collision AND that the element is pushed
back. An element may carry both. There is no third concept and no configuration
element: level 0 of the product is still a single tag, and every extra
capability is an attribute on markup the host already controls
(`dec.api-emphasis`).

**The participants are the gate, not a number.** `stage.amount` defaults to 1,
the way `lens.amount` does, because a page that marks nothing has no rect to
read, no mode to integrate and no transform to write. The engine scans
`canvas.ownerDocument` once at mount with one `querySelectorAll`. If that finds
nothing it installs no observer at all; if it finds something it wires a
`MutationObserver` so later markers are picked up. `Engine.refreshStage()` is
the escape hatch for a host that marks its first participant after mount. A
standing subtree observer over a document that marks nothing is exactly the
cost `dec.performance-budget` forbids.

**The basis grows from one mode to one plus a small fixed set of slots.**
`FLUID_MODES` is 4: mode 0 is the global mode tier 3 shipped with, driven by
gravity, the page drive and the carrier, and weighted by the same
`fluidHeightWeight`. The other three are participant slots, each a damped
oscillator settling at `overlap * squeeze` along its own direction and weighted
by a Gaussian band centred at the bind-space height its element presses at.
Modes are SUMMED, never averaged. An empty slot holds the zero vector, and a
zero flow contributes exactly zero to the vertex graph, so a page that marks
nothing reproduces the tier 3 field bit for bit.

Three slots, not more. Every slot is three uniforms and an unrolled term in the
position graph on both draw passes. Colliders past the third are DROPPED rather
than folded together, because folding is precisely the failure the basis exists
to avoid.

**Both directions of the coupling are gated together, on `fluid.amount`.** The
reaction on a participant is Newton's third law on the same interaction: if the
head is rigid, nothing squeezed it, so nothing may push the page. Without this,
a page that marks an obstacle under the shipped configuration would watch its
own furniture slide about while the glass sat perfectly still. The pool half is
separately gated on `pool.amount`, which is the pool's own existing gate.

**Reads are batched and skipped; writes are CSS transforms and nothing else.**
`Stage.measure()` reads the canvas rect and every visible participant's rect in
one pass with no interleaved write, and returns immediately unless a
`ResizeObserver`, an `IntersectionObserver` or a passive capturing scroll
listener invalidated the last batch. `Stage.write()` is the only style write in
the frame and is skipped below a sub-pixel threshold. The module owns
`style.transform` on a participant and composes ITS OWN translate FIRST, then
restores the host's inline value verbatim on release.

**The rest rect is recovered by subtraction, not by re-measurement.**
`getBoundingClientRect` reports the transformed box, so the applied offset,
which this module knows exactly, is subtracted back out of every read. Leading
with our translate is what makes that subtraction exact rather than
approximate: transforms apply right to left, so a host base transform carrying
a scale or a rotate then leaves the pixel offset alone.

**The pool dent is a soft Dirichlet condition, not a source.** A submerged
participant holds a Gaussian dent in the height field, blended into BOTH
channels of the ping-pong target. Both, because `g` is the height one step ago
and `r - g` is the stored velocity: forcing only the height would trap a large
negative velocity inside the footprint and release it as a spike the frame the
obstacle scrolls clear. Depth is expressed in the field's own units, where 1 is
the amplitude bound the surface already clamps to, so an obstacle can never
punch the water through the global clip plane.

## Consequences

The head collides with page furniture on the side the furniture is on, both
sides at once, and at the height it actually sits at. Scrolling a marked
element past the bust squeezes the body, dents the water and, for a
`data-hologlyph-body` element, pushes the element itself.

The costs are real and are accepted:

- **A participant must tolerate being transformed.** The library owns
  `style.transform` on any element carrying either marker. An element whose
  layout or animation depends on its own inline transform must not be marked.
  This is documented on the contract, on the lab page and here.
- **At most three participants couple.** A page that marks ten gets the first
  three that actually overlap the body, in document order. This is a hard
  bound, not a soft one.
- **The map is a plane, not a mesh.** Participants are resolved against the
  body's radial profile on world Z 0, the same profile the pool waterline uses.
  A participant is never ray-cast against the geometry, so the collision is as
  accurate as a solid of revolution and no more. Given the flow field is three
  damped modes masked to near zero over every high-frequency region of the
  model, accuracy beyond that is unspendable.
- **The reaction is one frame behind.** The engine reads the flow the VFX
  engine solved last frame, which is the flow currently on screen. Reading this
  frame's would push the page before the glass it is reacting to has been
  drawn. On an already damped spring this is not visible.
- **Offscreen participants are inert.** An `IntersectionObserver` releases
  their transform once and stops measuring them, which is also what keeps a
  long page with many marked elements cheap.

## Alternatives rejected

**One mode with a summed flow vector.** Free, and wrong: it is the exact case
`dec.liquid-glass-fluidity` flagged. Two obstacles facing each other cancel,
and one obstacle at the crown moves the base as hard as the crown.

**Height-banded modes rather than per-participant modes.** A fixed basis of
three height bands localises vertically but still averages two obstacles that
share a height, which is the common case for a head between two columns of page
content. Per-participant slots cost the same uniforms and do not have that
failure.

**Polling rects on a `requestAnimationFrame` timer.** Simple, and it is the
layout thrash the acceptance criteria explicitly forbid. Observers plus a
passive scroll flag give the same liveness with the read skipped entirely on a
still page.

**Writing back through layout properties (`top`, `left`, margins).** Would
reflow the host page on every frame and could not be undone cleanly. Transforms
compose, never reflow, and restore exactly.

**A `stage` root attribute the host must also add.** Two levels of opt-in for
one capability. The scan is one selector match and the observer is conditional,
so the extra attribute buys nothing the conditional observer does not already
buy.
