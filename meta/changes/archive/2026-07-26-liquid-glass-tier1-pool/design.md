# Design: liquid-glass-tier1-pool

## Shape

Three pieces, split along the line the repo already draws between pure logic
and GPU objects.

`src/shaders/pool.ts` is the arithmetic and nothing else: the damped wave
update, the fixed-rate step count, the drive that turns scroll and emergence
speed into a ring impulse, the radial profile of the body, and the analytic
meniscus and contact ring. It imports no GPU type, so `test/shaders-pool.test.ts`
can pin the CFL bound and the profile behaviour under happy-dom.

`src/shaders/pool-surface.ts` is the only file that owns GPU objects. A
ping-pong pair of half-float render targets carries the field, an offscreen
quad advances it with exactly the update `poolWaveStep` defines, and a
subdivided plane reads it back as vertex displacement plus the meniscus.

`src/shaders/materials.ts` carries the two pool terms that live on the body
rather than on the water: the outward breathe and the waterline fade. They
belong to the skin's node graph, so they cannot live anywhere else.

`EngineImpl` owns the lifecycle, as it does for every other subsystem. It bakes
the radial profile when an avatar loads, reconciles the pool against
`pool.amount` every frame beside `applyGlassLayering`, and feeds it the scroll
and emergence speeds the frame measured.

## Decisions inside the decision

**The gate is a gate, not a fade.** At `pool.amount = 0` the engine builds no
pool object, allocates no render targets and adds no draw call, and every node
added to the skin graph collapses to an exact multiplicative 1 or additive 0.
Proven rather than asserted: the smoke script captures the lab twice for a
noise floor, then compares a never-enabled page against one taken back down to
0. Both are 0 pixels.

**The bias is the amplitude bound.** The renderer's clipping plane is global,
with no per-material opt-out, so anything below world Y 0 is discarded and a
clipped trough would punch a visible hole in the water. The surface therefore
rests at `bias` and the wave is clamped to plus or minus `bias`: one number is
both the rest height and the bound, and a trough can reach the plane but never
cross it.

**The simulation quad is lifted clear of that plane.** three's own `QuadMesh`
straddles the world origin, so the global clip would discard the lower half of
every simulation pass and silently freeze half the field. The pass owns a quad
at world Y 8 with its own orthographic camera instead.

**Ping-pong swaps materials, not texture values.** `TextureNode.sample()`
clones share their value through `referenceNode`, so mutating one node's
`value` would probably work. Two materials with fixed bindings cost one extra
pipeline, built once, and cannot silently freeze the surface.

**One ring source, not two emitters.** Scroll and emergence both push the same
contour, which is where a body entering water actually makes its wave, so they
sum into a single drive and inject at the waterline radius.

**The waterline radius is measured off the rig.** A replacement bust must not
inherit the shipped one's waterline, so the hole in the water is sized from a
48-slice radial profile of the loaded body's bind-pose positions.

**The breathe is written as `positionLocal.add(...)`.** `NodeMaterial.setupPosition`
runs morph targets, then skinning, then assigns `positionNode` over
`positionLocal`. Deriving the offset from `positionGeometry` or `normalGeometry`
would silently discard every viseme and all bone skinning, which is exactly
what the todo's acceptance line forbids.

**The deformed shading normal is a mix, not a substitution.** `normalView` is a
per-vertex varying renormalised per fragment; a hand-rolled equivalent would
not be numerically identical even with a zero gradient, and `pool.amount = 0`
would stop reproducing the approved look for a reason unrelated to the pool.
`material.normalNode = mix(normalView, perturbed, gate)` is exactly the first
operand at gate 0, and every existing `normalView` and `normalWorld` in the
graph follows the override for free.

**The perturbation happens in local space, inside a unit vector.**
`transformNormalToView` ends in `transformDirection`, which normalises, so
handing it the perturbation on its own is `normalize(vec3(0))` and therefore
NaN at every fragment when the pool is off. See the implementation notes: that
mistake collapsed the silhouette by 93 per cent and the same-build smoke could
not see it.

**The two sides get their own normal node.** three flips `normalView` through
`directionToFaceDirection`, which reads `material.side` and is not re-exported
from `three/tsl`; the per-fragment `faceDirection` is a different quantity.
The front is `FrontSide` and the interior is `BackSide`, both known at build
time, so the negation is written out.

## Inertness, measured

Pose-pinned with `tools/smoke/solid-body-shot.mjs` on this branch and on
`glass`: 3 pixels of 307200 differ, by at most 1 of 255, against a same-build
noise floor of exactly 0. Silhouette and mean luminance are equal to the digit.
The precedent accepted for the solid-body change was 115 pixels at 3 of 255.

## Cost

Measured on this host in Chrome with a WebGPU backend, using
`device.queue.onSubmittedWorkDone()` to await real GPU completion rather than
rAF deltas, which are vsync-clamped and would read the same either way:

| pool | GPU ms, median | mean | p95 |
| --- | --- | --- | --- |
| off | 1.90 | 1.89 | 2.2 |
| on | 2.20 | 2.22 | 2.5 |
| off again | 1.90 | 1.93 | 2.4 |

Added: 0.30 ms, against a budget of about 1 ms.
