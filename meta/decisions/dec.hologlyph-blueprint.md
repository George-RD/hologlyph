---
id: dec.hologlyph-blueprint
nodes: [hologlyph, hologlyph.runtime, hologlyph.asset, hologlyph.adapter, hologlyph.asset.pipeline]
status: accepted
date: 2026-07-08
informed_by: [res.rendering-stack, res.facial-behavior, res.packaging-delivery, src.deep-research-1, src.deep-research-2]
---

Establishes the Hologlyph architecture blueprint, derived from the two deep-research reports (report-1 maximalist, report-2 pragmatic) and an adversarial debate adjudication.

The system `hologlyph` decomposes into three containers:
- `hologlyph.runtime` (Engine): Core, Renderer, TextSkin, Shaders, Motion, Speech, Audio, Behavior.
- `hologlyph.asset` (Asset): Loader (runtime GLB + shared rig schema) and Pipeline (build-time glTF-Transform/Meshopt + KTX2 tooling).
- `hologlyph.adapter` (Adapter): WebComponent custom element and Frameworks wrappers.

`hologlyph.asset.pipeline` is build-time tooling (under `tools/`), NOT shipped in the runtime bundle; it exists only to hit the < 1.5 MB GLB delivery budget. All lower-level contested decisions (renderer posture, speech architecture, API emphasis, text skin, scroll, behavior, expression vocabulary, performance budget, asset rig) are captured in their own accepted decisions and informed by the research artefacts above.
