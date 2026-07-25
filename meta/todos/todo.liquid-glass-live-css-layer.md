---
node: hologlyph.runtime.renderer
status: open
created: 2026-07-25
---

# Live compositor glass: backdrop-filter clipped to the silhouette

Rung 2 of the backdrop ladder (`dec.liquid-glass-architecture`), and the
cross-browser default for the liquid look. Depends on
`todo.liquid-glass-silhouette-hull`.

Script cannot read the page behind a transparent canvas
(`res.dom-backdrop-capture`), but the compositor can show it: a
`backdrop-filter` layer confined by `clip-path` puts genuinely live page content
inside the head shape, including video, animation, and cross-origin images.

Measured in the spike (`demo/backdrop-clip-spike.html`): clipping works in
Chrome and real Safari 26, and rewriting a 60-point polygon every frame costs
0.44 to 0.59 ms with vsync disabled, up to blur radius 64 and full-viewport
coverage.

Work:

1. An element-owned layer behind the canvas carrying
   `backdrop-filter: blur() saturate()`, driven from `HeadConfig`.
2. Per-frame `clip-path` from the projected hull.
3. The WebGL head keeps drawing glyphs, fresnel, specular, and ink over it, so
   the two layers must agree on the silhouette within a frame or the edge tears.
4. Feature-detect and degrade: no `backdrop-filter` means the shipped flat
   colour adaptation, unchanged.

Known limit: frost and tint only. No per-pixel lensing, which is what
`todo.liquid-glass-snapshot-lens` and `todo.liquid-glass-chromium-lens` add.

Acceptance: live page content visible and correctly shaped inside the head on
Chrome and Safari, no edge tearing while the head moves or the page scrolls,
under 1 ms added per frame, and an unchanged look when the feature is absent.
