---
id: dec.text-skin
nodes: [hologlyph.runtime.textskin, hologlyph.runtime.renderer]
status: accepted
date: 2026-07-08
informed_by: [res.rendering-stack, src.deep-research-1, src.deep-research-2]
---

Text skin is a dynamic `CanvasTexture`, NEVER per-glyph meshes. A static high-density character grid is drawn on an `OffscreenCanvas` (worker context) and uploaded to the GPU only when content changes; all scrolling/scan motion is UV scroll executed in the shader (GPU), not a per-frame CPU `fillText` + `needsUpdate` redraw (measured 15-20 FPS collapse).

Default content is placeholder text; a developer API swaps the source (e.g. live code, chat, or system logs). This is the marquee differentiator and must stay on the GPU path. Projective/UV fragment mapping wraps text on the organic head curves without CPU cost.
