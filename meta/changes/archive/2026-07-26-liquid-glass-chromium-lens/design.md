# Design: liquid-glass-chromium-lens

## Approach

The enhancement is a second implementation of one interface, not a branch
inside the existing lens. `src/core/lens.ts` gains `LensSource`, the shape the
engine binds to the glass, and the two implementations sit either side of it:

- `createPageLens` rasterises on demand and works everywhere.
- `createElementLens` uploads live DOM every frame and works only where
  Chromium says so.

The projection maths, `lensWindow` and `lensDisplacement`, is already pure and
shared, so the live source reuses it exactly. Downstream, `VFXEngine.setLens`
takes the same `LensBinding` and cannot tell them apart. That is what makes
"its absence changes nothing" structural rather than a promise: the snapshot
path is not modified, it is simply the one that gets built.

### Which canvas is drawn into, and why the host must own it

The measured restriction is that only immediate children of the canvas being
drawn into may be drawn; ancestors and loose elements throw
`InvalidStateError`. The spike only ever measured one arrangement, the one it
built: `probeCanvas.append(child)` and then `probeCanvas.getContext('2d')
.drawElementImage(child, 0, 0)`. Drawing an element that lives under canvas A
into canvas B was never measured, so nothing here assumes it.

That fixes the shape of the gate. The named element must already be an
immediate child of a `<canvas layoutsubtree>`, and the lens draws into THAT
canvas. The library moves no DOM: reparenting a host's subtree is not something
a drop-in component gets to do. `layoutsubtree` is required rather than merely
expected, because without it the child is never laid out, there is no cached
paint record, and the draw throws on the first frame; requiring the attribute
turns a per-frame exception into a clean fall-through.

The visible consequence is benign and worth stating: the host's canvas shows
its own laid-out subtree, undistorted and interactive, because the lens is
drawing it there every frame. The head refracts a copy.

### Why not `texElementImage2D`

The todo names `gl.texElementImage2D` and it is the cheaper route: DOM straight
into a GPU texture, no round trip. It is not the route taken.

The head renders through three's `WebGPURenderer`, which auto-selects WebGPU or
WebGL2 and owns every texture in the TSL node graph. Handing it a raw GL
texture means reaching into the backend and pinning WebGL2, on a renderer whose
whole posture (`dec.renderer-posture`) is that the backend is not the author's
business. The 2D `drawElementImage` route costs one canvas upload per frame,
which is exactly what the text skin already pays, and works on both backends
with no renderer knowledge at all.

The capability check still requires `texElementImage2D`, because both halves
ship together behind one flag and one without the other means the shape changed
under us. The safe reading of that is "gone".

### Failure policy

Every failure degrades. The bounded one is the missing paint record: a freshly
laid-out subtree throws `InvalidStateError: No cached paint record for element`
until the canvas has painted once. So a failed upload calls `requestPaint()`
and retries, and only after `MAX_LIVE_LENS_FAILURES` consecutive failures, half
a second at 60 Hz, does the lens report once and stop for good. A good frame
resets the budget. The alternatives were both worse: giving up on the first
throw loses a recoverable startup race, and retrying forever throws once a
frame for the life of the page.

### Hit-testing

`getElementTransform` returns a `DOMMatrix` and a lens is not affine, so a
distorted region can never be reconciled with hit-testing: a control under the
head is unreachable at the place it appears, and reachable only at its
undistorted layout box, which the head is covering. The library cannot move the
host's DOM, so it warns.

The warning is on trapped CONTROLS, not on overlap. Overlap is the normal,
intended arrangement: the head refracts what is behind it. Warning on it would
fire on every correct use, which is the same as not warning at all.

## Changes

ADDED:
- `src/core/element-lens.ts` - capability probe, subtree gate, the live
  `LensSource`, and interactive-control counting.
- `test/core-element-lens.test.ts` - 33 cases over all four.
- `demo/live-lens-lab.html` - lab page with an animating subtree inside a
  `<canvas layoutsubtree>`, a live/snapshot/none source three-way, and a toggle
  that drops a control into the refracted region.
- `tools/smoke/live-lens-shot.mjs` - runs that page twice, flag on and flag
  off, over eleven legs.

MODIFIED:
- `src/core/lens.ts` - `LensSource`, and `documentRect` lifted out of
  `page-lens` so both implementations share it.
- `src/core/page-lens.ts` - `PageLens` is now an alias for the shared shape.
- `src/core/engine.ts` - selection in `buildLens`, the trapped-control warning,
  and `pageLens` renamed to `lens` because it is no longer always one.
- `test/core.test.ts` - five cases on which lens gets built.
- `cairn.blueprint`, `README.md`, `CHANGELOG.md`, `demo/LAB-STATUS.md`,
  `tools/smoke/README.md`.

REMOVED:
- Nothing.

RENAMED:
- `EngineImpl.pageLens` -> `EngineImpl.lens` (private).
