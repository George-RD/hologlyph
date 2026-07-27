# Design: liquid-glass-live-css-layer

Binding decision: `dec.liquid-glass-compositor`. It carries the spike table and
the four commitments; this file is how they are built.

## The layer

`createCompositorGlass({ canvas })` inserts one `div` as the canvas's
immediately preceding sibling and returns a `Disposable`. It authors no
wrapper, which is the whole point: the spike measured that a wrapper carrying
`opacity` below 1, or a clipping `overflow` with a rounded corner, promotes a
backdrop root and leaves the frost sampling nothing.

Styles, all set directly rather than through a stylesheet, because the layer
lives in whatever tree the host gave the canvas and must not depend on one:

- `position: absolute; inset: 0`, so it covers the canvas box. This requires the
  canvas's parent to be a positioned containing block; `:host` already is, and a
  parent that is not gets a warning.
- `pointer-events: none`, permanently. It covers the canvas box, so anything
  else would swallow clicks meant for the host page.
- `visibility: hidden` until the first outline arrives. An unclipped layer would
  frost the entire canvas box for a frame, which is the most visible way this
  feature can be wrong.
- `backdrop-filter` and its `-webkit-` spelling from `blur` and `saturate`.
- `background-color` from `tint` at `tintOpacity`, and element `opacity` from
  `amount`. `amount` is the single master mix, exactly as it is for the pool and
  the glass; scaling the tint alpha by it as well would fade the colour
  quadratically against the frost.

Two gates, in order. `CSS.supports` for `backdrop-filter` in either spelling,
which is the only thing that can refuse the feature. Then the ancestor walk,
which only warns.

## The ancestor walk

`findBackdropRootAncestor` climbs from the canvas to the document element,
hopping `ShadowRoot` to `host` so it crosses the element's own boundary, and
returns the first element carrying `opacity` below 1, a `filter`, a
`backdrop-filter`, a `mask-image`, or a clipping `overflow` together with a
rounded corner. Every property is read through `getPropertyValue`, not the
camel-cased accessor: those accessors are optional, and happy-dom returns
`undefined` for `maskImage` while the property is set, which would be a warning
that never fires.

It runs once per layer build, never per frame.

## The waterline

`SilhouetteProjector.update` grew an optional `floorY`. When it is finite, each
hull point is taken to world space, its Y clamped up onto the floor, and then
projected by hand; when it is absent the previous single-matrix path runs
untouched, so omitting it is byte-identical.

Clamping preserves the hull's one load-bearing property by construction: the
hull is an OUTER bound on the body, and a point moved up onto the floor at the
same x and z still outer-bounds the clipped body there. The 2D alternative,
intersecting the polygon with the plane's vanishing line, is exact but is the
kind of code that is correct until the camera tilts.

The engine passes `-clippingPlane.constant`. `THREE.Plane` stores
`normal . p + constant = 0` and `src/shaders/index.ts` builds it with a `+Y`
normal, so the drawn half-space is `y > -constant`.

## Engine reconciliation

`applyCompositorGlass` sits in the frame beside `applyGlassLayering`,
`applyPoolLayer` and `applyInteriorGlyphs`, and reconciles from the live config
for the same reason they do: `engine.vfx.setHeadConfig` is a public surface that
renders nothing itself.

A number gate, like the pool's. At `amount: 0` the layer is disposed if present
and nothing is built. `compositorUnavailable` records a refused build so an
engine without `backdrop-filter` does not re-enter the constructor every frame
for the life of the page; it is cleared by teardown, which is the only thing
that can change the answer.

`syncCompositorGlass` runs AFTER `sysRenderer.render()`. Three refreshes the
scene graph and the camera's inverse world matrix at the top of its render, so
projecting first would either read last frame's pose or duplicate that walk.
Both the canvas backing store and a style written afterwards are committed by
the same compositing step at the end of the rAF callback, so the outline and
the pixels it clips cannot disagree by a frame.

The projector is built in `replaceAvatar`, because it resolves and holds the
rig's bones and the hull class contract says a replaced avatar invalidates it.
An asset with no baked hull leaves it null and the layer simply never becomes
visible, which is the enhancement-shaped degradation the hull module already
promises.

Teardown reaches the layer from `dispose()` and from a remount onto a different
canvas. The second matters: the layer is parented next to the OLD canvas, so
without it a remount strands a frosted div in the host page.

## Change detection

`sync` takes raw `xy` and a count rather than a string, and rebuilds the
`clip-path` only when the outline actually moved. A `clip-path` value is
immutable so a changing outline costs one string per frame, which is
unavoidable; a still head, a frozen demo and a reduced-motion session all avoid
it entirely. Fewer than three points hides the layer rather than clearing the
clip.

## Acceptance

`tools/smoke/compositor-shot.mjs` against a real Chrome, under emulated reduced
motion so the glyph rows stop scrolling and the noise floor is real. Eleven
checks including a same-state noise floor, the frost inside the silhouette
against the page outside it, and a liveness leg that steps the backdrop phase
while holding the pose, which a rasterised snapshot would fail.
