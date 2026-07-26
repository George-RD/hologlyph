---
node: hologlyph.runtime.core
status: open
created: 2026-07-25
---

# Opt-in lensing of a declared subtree via a DOM rasteriser

Order 4 of 9 (`dec.liquid-glass-architecture`). No prerequisite; may run in
parallel with the other unblocked items.

Rung 3 of the backdrop ladder, cross-browser half
(`dec.liquid-glass-architecture`). This is the only way to get true per-pixel
refraction of real page content on every engine.

Mechanism, as validated by reading `liquidGL` (`res.dom-backdrop-capture`):
rasterise a subtree the host names, upload it as a texture, and offset the
sample coordinates by the head's thickness and normals. Scrolling is free
because the snapshot is in document space: only the sampled window moves.

Work:

1. A `refract` attribute or config field naming one element. Never `body` by
   default: the fidelity traps scale with what is inside.
2. Lazy-load the rasteriser so the core bundle is untouched when the feature is
   unused. Prefer `snapdom` over `html2canvas` on speed.
3. Recapture policy: on resize, on host request, and debounced during scroll,
   never per frame.
4. Feed the texture into the existing refraction path in
   `src/shaders/materials.ts`, which already offsets by fresnel-weighted normals.

Known limits to document at the API, not to hide: content behind the snapshot is
frozen between captures, cross-origin images need CORS headers or they come out
blank, `position: fixed` elements are typically excluded, and the first capture
costs 10 to 150 ms of main thread.

Acceptance: naming a hero section produces visible lensing of that content
through the head, with no bundle growth when the attribute is absent, and a
documented staleness and CORS contract.
