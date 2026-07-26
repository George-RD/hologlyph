---
node: hologlyph.asset.pipeline
status: done
created: 2026-07-25
---

# Silhouette hull bake and per-frame CPU projection

Order 2 (`dec.liquid-glass-architecture`). No prerequisite; may run in
parallel with the other unblocked items.

Blocking dependency of the live CSS glass layer (item 6) and the physics
participants (item 7), which both need a screen-space outline. The lens rungs do
not need it: they are WebGL texture sources and never touch `clip-path`.

The CSS glass layer must be confined to the head shape with `clip-path`, which
needs a screen-space polygon every frame. Deriving it from canvas alpha would
force a GPU to CPU sync per frame and cost more than the entire effect.

Work:

1. Offline, in `tools/asset-pipeline/`: compute a low-poly outline hull of the
   bust, on the order of 20 to 40 vertices, stored beside the GLB or as an
   extra accessor. Deterministic, covered by the existing regen byte-equality
   test.
2. Runtime: project those vertices through the current head pose on the CPU each
   frame and emit a `polygon()` string. No readback, no allocation per frame.
3. Verify the hull still contains the silhouette under the full range of head
   yaw and pitch, and under emergence.

Later, a metaball or fluid surface emits the same outline, so the consumer side
of this contract survives tier 3 unchanged.

Acceptance: a hull that bounds the rendered silhouette at every pose in the eval
capture set, projected in well under 0.1 ms per frame, with a unit test on the
projection maths and no per-frame allocation.

Landed 2026-07-26. 32 baked points in the GLB scene extras, projected by
`SilhouetteProjector` in `src/asset/hull.ts` at about 3 microseconds per frame.
Containment is checked vertex by vertex over eight poses crossed with four
morph states, with a negative control. The point budget costs 27 to 41 per cent
of extra polygon area against the silhouette's own convex hull; the curve for
trading points against tightness is in the change's implementation notes.
