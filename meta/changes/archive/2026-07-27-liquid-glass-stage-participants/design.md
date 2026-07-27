# Design: liquid-glass-stage-participants

## Approach

Four pieces, in the order data flows through them.

**The stage.** `src/core/participants.ts` is the whole of the library's
knowledge of host layout. It scans `canvas.ownerDocument` once for
`[data-hologlyph-obstacle],[data-hologlyph-body]`, adopts what it finds, and
exposes exactly three operations: `measure()` (one batched read, skipped unless
something invalidated it), `participants` (rects and markers), and
`write(offsets)` (one batched CSS transform pass). Invalidation comes from a
`ResizeObserver`, an `IntersectionObserver` and a passive capturing scroll
listener, all wired only once the first scan finds something. Its maths
(`stageProjection`, `projectRect`, `stageCollider`) is pure and is what the
tests drive.

**The map.** A perspective camera looking down -Z sees a half-height of
`tan(fov/2) * |cameraZ|` at the head's plane. Participant rects project onto
that plane, CSS Y flipping to world Y, and the body is a solid of revolution
about world X 0 whose radius at any height is the same `PoolProfile` the pool
waterline reads. The collision is the gap from the rect's nearest point to the
axis against that radius, and the direction is from the obstacle toward the
axis, which is the way the liquid is squeezed out.

**The basis.** `FLUID_MODES` grows from 1 to 4. Mode 0 is unchanged: gravity,
page drive, carrier drag, weighted by `fluidHeightWeight`. The three
participant slots are damped oscillators settling at `overlap * squeeze` along
their own direction (`fluidTargetAccel`, the same `omega^2` trick
`fluidGravity` uses), weighted by a Gaussian band centred at the bind-space
height their element presses at. The shader unrolls the sum:

```
d(p) = amount * [ heightWeight(y) * face(p) * ramp(N, F0)
                + sum_i band(y, c_i) * face(p) * ramp(N, F_i) ]
```

**The pool.** Each participant that crosses the waterline becomes a
`PoolObstacle` with a circular footprint and a dent depth in field units. The
simulation blends the field toward the dent inside the footprint, on BOTH
channels of the ping-pong target, which is a soft Dirichlet condition: waves
reflect off it and nothing accumulates behind it.

**The reaction.** The engine reads the flow the VFX engine solved last frame,
converts it through `pixelsPerWorldUnit`, negates the horizontal (world +X
means the body went right, so the obstacle is pushed left) and keeps the
vertical (world Y up, CSS Y down), caps the magnitude, and hands the offsets to
`stage.write`.

## Changes

ADDED:
- `src/core/participants.ts` - the stage, the projection and the collision.
- `meta/decisions/liquid-glass-participants.md` -
  `dec.liquid-glass-participants`.
- `demo/stage-lab.html` - lab page with the sliders and three marked cards.
- `tools/smoke/stage-shot.mjs` - measured headless smoke.
- `test/core-participants.test.ts` - 19 tests over the map, the collision and
  the DOM stage.

MODIFIED:
- `src/contracts.ts` - `HeadStageConfig`, `HeadConfig.stage`, defaults,
  `StageCollider`, `VFXEngine.setStageColliders`, `VFXEngine.stageFlow`,
  `Engine.refreshStage`.
- `src/shaders/fluid.ts` - `FLUID_MODES`, `FLUID_PARTICIPANT_MODES`,
  `fluidBandWeight`, `fluidSqueezeTarget`, `fluidTargetAccel`,
  `fluidReaction`.
- `src/shaders/materials.ts` - stage uniforms, the unrolled modal sum and its
  gradient, `normaliseHeadConfig` stage block.
- `src/shaders/pool-surface.ts` - `PoolObstacle`, obstacle slots, the soft
  Dirichlet dent.
- `src/shaders/index.ts` - participant solver states, `setStageColliders`,
  `stageFlow`, barrel exports.
- `src/core/engine.ts` - stage lifecycle and the per-frame reconcile.
- `cairn.blueprint` - `test/core-participants.test.ts` path claim on
  `hologlyph.runtime.core`.
- `test/core.test.ts`, `test/element.test.ts`, `test/shaders.test.ts`,
  `test/shaders-fluid.test.ts` - fakes, pinned config and new coverage.
- `demo/LAB-STATUS.md` - the new lab and smoke script.

REMOVED: none. RENAMED: none.

## Identity at the gate

Three separate zeros have to be exact, not approximate:

- **No participants.** Every slot holds the zero flow vector.
  `ramp(N, 0) * |0|` is `0.5 * eps * 0`, which is exactly 0, and `x + 0` leaves
  the tier 3 field bit for bit unchanged.
- **No dents.** An empty pool slot has presence 0, and `mix(x, ., 0)` is
  exactly `x`, so the tier 1 field is what tier 1 simulated.
- **A rigid head.** Both halves of the coupling are gated on the same effective
  `fluid.amount`, so a page that marks obstacles under the shipped
  configuration gets neither a bulge nor a moved element.
