---
id: dec.performance-budget
nodes: [hologlyph.runtime.core, hologlyph.asset.loader]
status: accepted
date: 2026-07-08
informed_by: [res.packaging-delivery, src.deep-research-1, src.deep-research-2]
---

Performance discipline is architectural, not the host site's responsibility:

- Asset: KTX2 (Basis Universal) + Meshopt compression; GLB delivery target < 1.5 MB.
- One reused `AudioContext`; never recreated per utterance.
- Automatic suspension of render loop, audio analysis, and idle behaviors when the tab is hidden (Page Visibility) or the host is offscreen.
- Hard `dispose()` guarantees for geometries, materials, texture sources, audio nodes, observers, and workers on `disconnectedCallback` (SPA route changes, A/B variants).
- `prefers-reduced-motion`: shorten/fade/disable non-essential motion (pool emergence, idle sway, camera-follow).
- Autoplay compliance: `AudioContext` resumed only from a user gesture; speech is user-initiated.
