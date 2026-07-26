---
node: hologlyph.runtime.renderer
status: done
created: 2026-07-25
---

# Chromium HTML-in-Canvas lensing, as a capability-gated enhancement

Order 5 (`dec.liquid-glass-architecture`). No prerequisite; may run in
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

Work, as landed 2026-07-26:

1. Capability check on both halves of the flag,
   `CanvasRenderingContext2D.prototype.drawElementImage` and
   `WebGL2RenderingContext.prototype.texElementImage2D`, probed at the
   prototype so nothing constructs a context. Off by default; absence is
   normal.
2. Second gate on the SHAPE of the named subtree: an immediate child of a
   `<canvas layoutsubtree>`, which is the only arrangement the spike measured
   and the only one the platform allows. Miss either gate and the engine builds
   the snapshot lens as before.
3. The upload goes through the 2D `drawElementImage` into the source canvas,
   not `texElementImage2D` into a raw GL texture: the head renders through
   three's `WebGPURenderer`, which owns every texture in the TSL graph and may
   be running either backend. Reasons in the module header.
4. Hit-testing: the engine warns when the head covers an interactive control
   inside the refracted subtree. Overlap alone is silent, because refracting
   decorative live content is the point.

Delivered: `src/core/element-lens.ts`, the shared `LensSource` shape in
`src/core/lens.ts`, engine selection in `buildLens`, 33 cases in
`test/core-element-lens.test.ts` plus 5 in `test/core.test.ts`,
`demo/live-lens-lab.html` and `tools/smoke/live-lens-shot.mjs`.

Acceptance, measured against Chrome 150 on 2026-07-26 (all legs pass, see
`tools/smoke/out/live-lens-shot.json`): the capability is detected only with
the flag, the live subtree refracts through the head (46,482 px over 3 luma),
the refracted content keeps moving while the DOM moves (1,904 px against a
0 px floor) where the snapshot path contributes 0, the page outside the
silhouette is untouched, a control under the head is unreachable at its own
layout box and warned about while one beside it focuses normally, and with the
flag off the same page falls through to the snapshot lens with no errors.

Still true, and still the reason this is an enhancement: Chromium only, behind
a flag, origin trial Chrome 148 to 150. `THREE.HTMLTexture` is not in the
pinned three 0.178; only the older `examples/jsm/interactive/HTMLMesh.js`
exists.
