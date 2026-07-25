---
node: hologlyph.asset.pipeline
status: open
created: 2026-07-25
---

# Silhouette hull bake and per-frame CPU projection

Shared dependency of the live CSS glass layer, the physics participants, and
every fluid tier (`dec.liquid-glass-architecture`). Nothing above rung 1 of the
backdrop ladder can start until this exists.

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
