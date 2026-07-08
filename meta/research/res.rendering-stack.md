---
id: res.rendering-stack
nodes: [hologlyph.runtime.renderer, hologlyph.runtime.textskin, hologlyph.runtime.shaders]
sources: [src.deep-research-1, src.deep-research-2]
date: 2026-07-08
---

Both reports agree Three.js is the core and WebGPU is the forward path with a WebGL2 fallback (Three.js `WebGPURenderer` already falls back to WebGL2 when WebGPU is unavailable). Text skin: a `CanvasTexture` sourced from an `OffscreenCanvas` worker, drawn as a static high-density character grid and uploaded to the GPU only when content changes; all scrolling/scan motion is UV scroll executed in the shader (GPU), never a per-frame CPU `fillText` + `needsUpdate` redraw. Naive per-frame redraw is explicitly rejected (measured 15-20 FPS collapse on larger canvases). Both converge on this; the marquee differentiator (text-as-skin) stays on the GPU path.

Contested: v1 shader fidelity. Report-1 argues TSL node materials as primary plus elaborate fluid shaders (surface-tension vertex displacement, ripple heightmap, projective text mapping, selective HDR bloom). Report-2 argues a conservative WebGL material baseline retained for reach, flagship effects authored in the node/TSL path, and emergence via clipping plane + root translation. Resolved by accepted decision `dec.renderer-posture`: WebGPU-first/WebGL2-safe via WebGPURenderer, single TSL/NodeMaterial authoring source, v1 emergence = clipping plane + root translation (heavy surface-tension/ripple deferred).
