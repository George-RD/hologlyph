# Design: liquid-glass-fluidity-driver

## Approach

Three pieces, in the order data flows through them.

**The solver.** `src/shaders/fluid.ts` is pure arithmetic: one damped harmonic
oscillator in three dimensions, semi-implicit Euler, substepped to 1/120 s and
capped at eight substeps so a backgrounded tab cannot diverge it. Its state is
one displacement vector, the flow vector `F`, and one velocity. Gravity is
scaled by the stiffness (`fluidGravity(sag, tension) = sag * omega^2`) so the
rest droop is exactly the configured `sag` at every tension and `tension`
governs only the wobble about it.

**The field.** The skin material weights that one vector into a per-vertex
scalar:

```
w(p) = exp(-max(0, y - waterY) / reach) * (1 - max(six feature masks))^crisp
d(p) = amount * w(p) * softRamp(dot(N, F) / |F|) * |F|
offset = N * d(p)
```

The ramp is `0.5 * (c + sqrt(c^2 + eps^2))`, not `max(0, c)`. Both are one-sided,
which is what keeps the shell outside the depth-only occlusion mask, but the
hard clamp creases along the contour where the surface turns away from the flow
and that crease read as faceting on the bust's ears and jawline in the lab.
Softening in cosine space rather than in the dot product keeps the soft band the
same angular width whatever the flow magnitude.

**The drive.** `EngineImpl.frame` writes `setFluidDrive(state, drive, carrier)`
at the end of the frame, after motion, so the carrier velocity is this frame's
pose. `sysVfx.update` consumes it next tick. Everything is gated on the
configured amount: at 0 no matrix is recomposed, no bone is read, the solver is
never entered and every fluid uniform is exactly 0.

## Changes

ADDED:
- `src/shaders/fluid.ts` - solver, drive, behaviour gain, spatial weights.
- `meta/decisions/liquid-glass-fluidity.md` - `dec.liquid-glass-fluidity`.
- `demo/fluid-lab.html` - lab page with the fluidity slider.
- `test/shaders-fluid.test.ts` - 20 tests over the solver, the gate and the
  wiring.

MODIFIED:
- `src/contracts.ts` - `HeadFluidConfig`, `HeadConfig.fluid`, defaults,
  `VFXEngine.setFluidDrive`.
- `src/shaders/materials.ts` - fluid uniforms, the field, the combined
  displacement and gradient shared with the tier 1 breathe.
- `src/shaders/index.ts` - solver state, reconcile, integration, barrel
  exports.
- `src/core/engine.ts` - carrier tracking and the per-frame drive.
- `test/core.test.ts`, `test/shaders.test.ts` - fake and pinned-config updates.
- `meta/sources/src.dom-capture-survey-2026-07-25.md` - the Firefox retry.

REMOVED: none. RENAMED: none.

## Identity at the gate

Two features now write `positionNode` and `normalNode`, so both had to keep
their zero exact rather than approximate:

- `surfaceOffset = breatheOffset + fluidOffset`. Each term multiplies through
  its own `amount` uniform, so the feature that is off contributes exact zero
  and `x + 0` leaves the other bit for bit unchanged.
- `surfaceNormalGate = max(poolNormalGate, fluidNormalGate)`. `max(x, 0)` is
  exactly `x`, so a head with the pool on and the fluid off lands on the tier 1
  value it shipped with.

`bun run eval` reports `overall: pass` at the shipped default, which is the
check that the approved look is untouched.
