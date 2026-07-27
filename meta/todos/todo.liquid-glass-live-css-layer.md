---
node: hologlyph.runtime.renderer
status: done
created: 2026-07-25
---

# Live compositor glass: backdrop-filter clipped to the silhouette

Order 6 (`dec.liquid-glass-architecture`). LANDED 2026-07-27 as
`liquid-glass-live-css-layer`. Shipped gated at `compositor.amount: 0` and
lab-only in `demo/compositor-lab.html` until the owner approves the look.

Its stated blocker, `todo.liquid-glass-firefox-verify`, was closed on tracker
evidence rather than answered: Mozilla 1579957 has been RESOLVED FIXED since
2022-05-18. The constraint that actually decided the design was a different one
nobody had looked for, the backdrop root, and both are recorded in
`dec.liquid-glass-compositor`.

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

What the hull gives you (2026-07-26): `avatar.silhouetteHull` carries 32 baked
points and `SilhouetteProjector` (`src/asset/hull.ts`) turns them into a
screen-space polygon plus a `clip-path` value in about 3 microseconds, with no
per-frame buffer allocation. Containment is exact for any head pose, because
every silhouette-bearing vertex of the bust is rigidly bound to one bone, and
is bounded by model rather than by proof for morphs: the bake bounds the morph
states MotionEngine composes, not thirty simultaneous morphs at full weight.
The 20 to 40 point budget makes the polygon 27 to 41 per cent
larger in area than the silhouette's own convex hull. If that halo of frost
reads badly, raising `DIRECTION_COUNT` in
`tools/asset-pipeline/silhouette-hull.ts` tightens it on a known curve (60
points for 1.21x, 252 for 1.05x) and needs a decision superseding the point
budget in `todo.liquid-glass-silhouette-hull`. The measurements are in
`meta/changes/archive/*-liquid-glass-silhouette-hull/implementation-notes.md`.

The hull is not clipped at the waterline, so during emergence it still bounds
the submerged part of the head. Clip the layer against the pool separately.

Known limit: frost and tint only. No per-pixel lensing, which is what
`todo.liquid-glass-snapshot-lens` and `todo.liquid-glass-chromium-lens` add.

Acceptance, all met and measured in
`meta/changes/archive/2026-07-27-liquid-glass-live-css-layer/implementation-notes.md`:
live page content visible and correctly shaped inside the head on Chrome, no
edge tearing while the head moves or the page scrolls, inside the 1 ms budget,
and an unchanged look when the feature is absent. Real Safari is unverified for
the backdrop-root leg, because headless WebKit composites no `backdrop-filter`
at all and this host cannot photograph a real one.
