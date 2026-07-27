---
node: hologlyph.runtime.core
status: done
created: 2026-07-25
---

# Opt-in lensing of a declared subtree via a DOM rasteriser

Order 4 (`dec.liquid-glass-architecture`). No prerequisite; may run in
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

LANDED 2026-07-26. `refract="#hero"` on the element, or
`engine.setLensSource(el)`, binds a rasterised snapshot that the interior glass
pass samples displaced by `normalView.xy * aThickness`. The rasteriser is an
injected function whose default lazily imports the optional `@zumer/snapdom`
peer, so the first-load bundle carries none of it. Verified in a browser by
`tools/smoke/lens-shot.mjs`: the bound sample window matches the document-space
layout arithmetic exactly, displacement moves 9,327 px inside the head box and
14,681 more when the sign flips, and the page outside the silhouette is
bit-identical. One consequence is documented rather than fixed: switching the
lens on moves the head-over-page blend from the compositor's encoded space into
the scene's linear one, which no formulation inside the scene can avoid. See
`meta/changes/archive/2026-07-26-liquid-glass-snapshot-lens/implementation-notes.md`.
