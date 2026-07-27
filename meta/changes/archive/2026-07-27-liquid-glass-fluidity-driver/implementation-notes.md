# Implementation notes: liquid-glass-fluidity-driver

Deviations from the plan and edge cases found while building, in the order they
came up.

## The tier started blocked, and one of its blockers was stale

`todo.liquid-glass-fluidity-driver` was `status: blocked` on
`todo.liquid-glass-tier1-pool`, which landed 2026-07-26. The decision's
recommended-order section additionally said items 7 and 8 "want the owner's
ruling on the pool lab before they start", but only item 7 needs it: item 8 is
recorded there as having "no viseme cost, so no owner gate beyond the usual lab
approval". Item 6 is blocked on Firefox, item 9 on item 8, and item 7 has
nothing to collide with until item 8 exists. So item 8 was the only unblocked
work in the programme.

## WebGPU compute was the wrong tool, and that needed a decision

`dec.liquid-glass-architecture` said tier 3 "needs a simulation and WebGPU
compute". Building it that way would have bought degrees of freedom the tier
cannot spend: the field is masked to near zero over every high-frequency region
of the model, and the surviving band is the low-curvature base and neck. It
would also have cost a WebGPU-only path plus a WebGL2 fallback, and it would
have put the `f = 0` identity behind a GPU state that can only be screenshotted
rather than asserted. `dec.liquid-glass-fluidity` records the deviation, the
price (one global mode, so no per-obstacle response) and the extension point
(`FLUID_MODES` and a loop, when participants land).

## Sag could not be a downward translation

The obvious reading of "sag" is to translate the flowing band downward. That
breaks the four-pass depth scheme: the occlusion mask at `renderOrder 0` is a
`MeshBasicMaterial` clone of the body at the undeformed pose, it does not
receive `positionNode`, and it only bounds the internals while the visible shell
stays outside it. Tier 1 handled this by mapping its breathe to [0,1]; tier 3
does it with `max(0, dot(N, F))`, which bulges the surface on the side the
liquid is piling against and leaves the other side alone. That is also the more
honest read of a viscous blob.

## The hard one-sided clamp creased, and the crease was visible

First lab pass with `max(0, dot(N, F))` produced spiky facets around the ears
and the jawline at high sag: the clamp has a kink at `cos = 0`, and the bust's
normals are high-frequency exactly there. Replaced with
`0.5 * (c + sqrt(c^2 + eps^2))` in cosine space, which is strictly positive
(so the outward bound survives), smooth everywhere, and has the same angular
soft band whatever the flow magnitude. The facets are gone in the lab. The cost
is an `eps^2 / 4` shoulder on surfaces facing directly away from the flow, about
0.8 per cent of the flow magnitude, which is under a tenth of a millimetre at
the default sag.

## Reduced motion was damped twice before it was damped once

The first wiring scaled the drive by `REDUCED_DRIVE` in the VFX engine *and*
took a drive that `fluidDrive` had already damped, which squares the factor and
leaves the reduced response at about five per cent rather than the twenty-two
the constant names. Damping now happens exactly once, in `fluidDrive`, matching
the pool. `test/shaders-fluid.test.ts` pins it. The sag is deliberately not
damped at all: a resting droop is a shape, not a motion.

## `normalWorld` needed nothing

`dec.liquid-glass-architecture` lists `normalWorld` in the matte shade term as
something that must follow the deformation. It already does. Three defines
`normalWorld` as `normalView.transformDirection(cameraViewMatrix)`, and
`normalView` outside the NORMAL sub-build resolves through
`context.setupNormal()` to `material.normalNode`. Assigning `normalNode` carries
the matte term and the specular with it. `bindNormal` is `normalGeometry` and is
untouched, so the glyphs stay welded to the bind pose.

## The carrier signal came from an existing helper

The solver wanted the head-carrying bone's velocity, and `MotionEngine` exposes
no readable pose. Rather than widen the contract, the frame loop reuses
`EngineImpl.interiorFrame`, which already recomposes the bone's frame-to-world
matrix for the interior glyph field. Its translation, differenced across frames,
is the carrier velocity. First sample after a mount or an avatar swap is forced
to zero, because differencing against nothing is a teleport;
`fluidCarrierSeeded` is cleared at both teardown sites.

## One-frame latency on the drive, taken deliberately

`sysVfx.update(dt)` runs early in the frame and the carrier pose is only correct
after `sysMotion.update`. Rather than split the drive across the frame, the loop
writes `setFluidDrive` at the end and the solver consumes it on the next tick.
One frame of latency on an already damped spring is not visible, and the
alternative was reading a stale pose instead, which is the same latency with
worse ordering.

## Test scope trimmed once

An engine test for the carrier seed across an avatar swap was written and then
replaced: there is no public avatar-swap API on `Engine` to drive it through.
The seeded-first-sample behaviour is covered instead by asserting the first
recorded carrier is `[0, 0, 0]`, and the reset lines at both teardown sites stay
as defence.

## Firefox verification, still blocked, now precisely

`todo.liquid-glass-firefox-verify` was attempted first, since it is the only
other item whose blocker looked movable and a real Firefox 141.0.3 is installed
on this host. Four routes were tried and all four are closed by host
capability, not by the web platform: Playwright's BiDi channel against the stock
build hangs at launch, macOS Screen Recording permission is denied to this
process so neither the computer tool nor `screencapture` can photograph a headed
window, headless Firefox fails with `RenderCompositorSWGL failed mapping default
framebuffer`, and `--remote-debugging-port` never opens a listener. Recorded in
`src.dom-capture-survey-2026-07-25` with the exact blocker: Screen Recording
permission, or a human looking at the window.

## Review

Four independent review subagents were dispatched (two specialist reviewers,
then two general workers as a fallback) and all four failed immediately with
`usage_limit_reached`. The review below was therefore done in-session rather
than independently, which is a weaker check and is recorded as such.

What was verified rather than asserted:

- **`normalWorld` follows `normalNode`.** Read from source, not assumed.
  `NodeMaterial.setupNormal()` returns `vec3(this.normalNode)` when one is set
  (`node_modules/three/src/materials/nodes/NodeMaterial.js:902`), it is
  installed as `builder.context.setupNormal` (:449), TSL `normalView` outside
  the NORMAL and VERTEX sub-builds resolves through that context hook, and
  `normalWorld` is `normalView.transformDirection(cameraViewMatrix)`
  (`accessors/Normal.js`). So the matte shade term and the specular both follow
  the deformation once `normalNode` is assigned.
- **Substep stability.** `h` is `min(dt, FLUID_MAX_STEP * FLUID_MAX_SUBSTEPS) /
  steps`, which is 1/120 s for every `dt` from a 60 Hz frame up to a two-minute
  backgrounded tab. At the stiff end `omega * h` is 0.217, well inside the
  semi-implicit Euler bound of 2.
- **The outward bound holds for every finite input.** `sqrt(c^2 + eps^2) >=
  |c| >= -c`, so the ramp is non-negative; the mask and the amount are
  non-negative; and at zero flow the `.max(1e-6)` guard yields `c = 0`, ramp
  `eps/2`, and a product with `|F| = 0` that is exactly zero rather than
  epsilon. The guard cannot amplify: below the floor, `|c|` is bounded by 1.
- **No aliasing.** `fluidFlow` is copied into each binding's own `Vector3`
  rather than assigned; `setFluidDrive` copies the carrier tuple element-wise;
  `interiorFrame` recomposes from scratch and `InteriorGlyphField.update` reads
  `.elements` synchronously and retains nothing, so calling it twice in one
  frame is safe.

Left for a real reviewer when the budget allows: whether the default
`sag: 0.05`, `reach: 0.6` and `crisp: 2` are the right lab starting points.
They are starting points, not an approved look, and the feature ships at
`amount: 0`.
