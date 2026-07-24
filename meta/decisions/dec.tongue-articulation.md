---
id: dec.tongue-articulation
nodes: [hologlyph.asset.pipeline, hologlyph.asset.loader, hologlyph.runtime.motion]
status: accepted
date: 2026-07-23
informed_by: [res.morph-authoring, src.tongue-articulation-2026-07-23]
---

# Canonical tongue corrective morphs

This extends the canonical vocabulary chosen in `dec.asset-rig-schema`.

The shared rig expands from 27 to 30 morph targets with `tongue_up`, `tongue_out`, and `tongue_back`. The asset pipeline consumes committed sparse source-vertex corrections authored against the pinned neutral topology. Non-mouth primitives carry zero deltas so every morph-bearing primitive retains an identical target list.

Motion derives tongue weights from canonical visemes: coronal and sibilant shapes drive `tongue_up`, `viseme_th` drives `tongue_out`, and `viseme_kk` drives `tongue_back`. Existing attack and release smoothing applies. Reduced motion damps only the new corrective amplitude, preserving lip-sync intelligibility.

Older and custom rigs remain loadable. Rig validation reports missing tongue targets through the existing structured warning path.
