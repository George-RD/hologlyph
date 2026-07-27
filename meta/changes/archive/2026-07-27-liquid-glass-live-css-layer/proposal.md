# Proposal: liquid-glass-live-css-layer

## Motivation

Item 6 of `dec.liquid-glass-architecture` is rung 2 of the backdrop ladder and
the cross-browser default the ladder was designed around: a `backdrop-filter`
layer behind the transparent canvas, confined to the projected silhouette by
`clip-path`, so genuinely live page content shows inside the head. It is the
only rung that carries video, animation and cross-origin images without a
rasteriser.

It had been `blocked` since 2026-07-25 on `todo.liquid-glass-firefox-verify`,
which two sessions failed to answer because this host cannot photograph a
Firefox. That blocker turned out to rest on a bug Mozilla closed in 2022. The
real risk was somewhere else entirely and nobody had looked for it: a
`backdrop-filter` samples only as far back as its backdrop root, and
`<hologlyph-head>` renders into a shadow root whose host carries
`contain: layout paint`. Both facts are established in `dec.liquid-glass-compositor`.

## Scope

- `HeadCompositorConfig` in the contract spine, gated at `amount: 0`.
- `src/core/compositor-glass.ts`: the layer, its styles, the per-frame clip, and
  a backdrop-root ancestor walk that diagnoses a host layout that would make the
  feature silently show nothing.
- An optional world-space waterline floor on `SilhouetteProjector.update`, so
  the frost stops where the emergence clip stops.
- Engine reconciliation beside `applyGlassLayering`, and the per-frame sync,
  placed after `render()` so the outline and the pixels it clips cannot
  disagree by a frame.
- `demo/compositor-lab.html`, a sixth gated lab for the owner session.
- `tools/smoke/backdrop-root-spike.mjs` (the evidence) and
  `tools/smoke/compositor-shot.mjs` (the acceptance capture).
- Closing `todo.liquid-glass-firefox-verify` on tracker evidence.

## Out of scope

- Turning anything on. The layer ships at `amount: 0` like every other
  unapproved item in the programme, and waits for
  `todo.liquid-glass-owner-look-session`.
- Per-pixel refraction. This rung frosts and tints; that is what rungs 3 and 5
  already do and they are unaffected.
- Fixing the two fatal ancestor shapes. They are host page structures the
  library does not own; it diagnoses them and carries on.
- Item 9, tier 4, which remains a product call.
