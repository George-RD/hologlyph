---
id: dec.renderer-posture
nodes: [hologlyph.runtime.renderer, hologlyph.runtime.shaders, hologlyph.runtime.textskin]
status: accepted
date: 2026-07-08
informed_by: [res.rendering-stack, src.deep-research-1, src.deep-research-2]
---

WebGPU-first, WebGL2-safe. Use Three.js `WebGPURenderer` (auto-falls back to WebGL2). Author the flagship "alive code skin" materials in TSL/NodeMaterial as a SINGLE source so one material serves both backends (this rejects the reformer's two-codebase concern and the conservative's separate WebGL/WebGPU authoring).

v1 emergence/submergence uses a clipping plane + root-group translation + optional shader edge treatment. The heavy vertex surface-tension displacement and ripple heightmap from report-1 are DEFERRED to a later phase, not v1. Text projection uses a cheap UV/projective fragment mapping. Selective HDR bloom on emissive text is allowed as standard post.

Rationale (adjudicated from adversarial debate): maximizes browser reach on day one while preserving the WebGPU quality ceiling, and defers the highest-risk shader simulation until the asset/rig pipeline is proven. A pure WebGL-first posture would permanently cap the visual quality that justifies the library.
