# Proposal: liquid-glass-snapshot-lens

Implements `meta/todos/todo.liquid-glass-snapshot-lens.md`, item 4 of the
recommended order in `dec.liquid-glass-architecture`.

## Motivation

The head is a transparent canvas over the host page, and today the page behind
it goes straight through undisturbed. The glass reads as a tinted overlay
rather than as a body with volume, because nothing it covers ever bends.

`res.dom-backdrop-capture` measured every route to fixing that. No browser API
hands rendered page pixels to WebGL without a permission prompt. The compositor
can show live page content inside an arbitrary shape but never lets script
touch those pixels, and Chromium's HTML-in-Canvas can only draw immediate
children of the canvas being drawn into. Rasterising a subtree the host names
is the only mechanism that lenses real page content on every engine, which is
why the decision makes it the opt-in rung of the backdrop ladder.

## Scope

- A `HeadLensConfig` block on the contract spine: `amount`, a signed
  `strength`, and a `recaptureMs` debounce.
- Pure projection maths in `src/core/lens.ts`: the document-space window that
  maps three's `screenUV` onto the snapshot, the per-axis displacement scale,
  and the recapture scheduler. No DOM, no GPU, unit-tested against the numbers.
- `src/core/page-lens.ts`: rasterise, upload, and keep the window current. The
  rasteriser is injected; the default lazily imports the optional
  `@zumer/snapdom` peer the first time a host names a subtree.
- A lens term on the interior (far wall) pass in `src/shaders/materials.ts`,
  sampling the snapshot displaced by the view normal and the baked
  `aThickness`, gated shut whenever no texture is bound.
- Engine lifecycle: `setLensSource`, `captureLens`, a per-frame window sync,
  and teardown with the engine.
- A `refract` attribute on `<hologlyph-head>` resolving a selector against the
  owner document.
- Lab page `demo/lens-lab.html` and smoke script `tools/smoke/lens-shot.mjs`.

## Out of scope

- The Chromium HTML-in-Canvas half of rung 3
  (`todo.liquid-glass-chromium-lens`, item 5). Different mechanism, different
  node, explicitly independent in the decision.
- Live compositor glass (`todo.liquid-glass-live-css-layer`, item 6), which
  needs the silhouette hull and the Firefox verification.
- Recapturing on arbitrary content mutation. The snapshot is frozen between
  captures by construction; the API documents it rather than hiding it behind
  a MutationObserver nobody asked for.
