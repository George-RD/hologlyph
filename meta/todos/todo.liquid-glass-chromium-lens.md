---
node: hologlyph.runtime.renderer
status: open
created: 2026-07-25
---

# Chromium HTML-in-Canvas lensing, as a capability-gated enhancement

Order 5 of 9 (`dec.liquid-glass-architecture`). No prerequisite; may run in
parallel with the other unblocked items.

Rung 3 of the backdrop ladder, Chromium half
(`dec.liquid-glass-architecture`). Must never be load-bearing.

Measured in `demo/html-in-canvas-spike.html` against Chrome 150 with
`--enable-blink-features=CanvasDrawElement`: live DOM uploads into a WebGL2
texture every frame and refracts correctly at vsync, 8.33 ms per frame over 480
frames, with a CSS animation, a per-frame ticker, and a live `input` all visible
through a lens shader.

Four constraints, all measured, that shape how it can be used:

- Only immediate children of the canvas being drawn into may be drawn. Ancestors
  and outside elements throw `InvalidStateError`. It cannot see the page behind
  our canvas; content must be moved inside it.
- Cross-origin images are silently omitted, no error. Cross-origin iframes paint
  as a blank box.
- Hit-testing follows the undistorted layout box. `getElementTransform` returns a
  `DOMMatrix`, so a lens or fluid distortion, being non-affine, can never be
  reconciled. Distorted regions cannot host interactive controls.
- Chromium only, behind a flag, origin trial Chrome 148 to 150. Nothing shipped
  against the trial keeps working when it lapses.

Work, when a showcase build wants it:

1. Capability check on `gl.texElementImage2D`, off by default, absence is normal.
2. Real signature is arity 3: `texElementImage2D(target, internalformat, element)`
   with a sized internalformat. The Chrome blog's six-argument form throws.
3. Track the trial and `THREE.HTMLTexture`, which is not in the pinned three
   0.178; only the older `examples/jsm/interactive/HTMLMesh.js` exists.

Acceptance: the enhancement engages only where detected, its absence changes
nothing, and no interactive control is ever placed inside a distorted region.
