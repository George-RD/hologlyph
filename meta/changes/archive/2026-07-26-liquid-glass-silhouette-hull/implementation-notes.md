# Implementation notes: liquid-glass-silhouette-hull

Deviations from the todo, and what the measurements changed.

## The morph reachability model is the whole design, and the naive one is useless

The todo says nothing about morphs. It matters more than the pose range.

Three applies morph targets additively, so the set a vertex can reach is the
zonotope `v + sum_m w_m d_m` over `w in [0,1]^30`, and its support along a
direction is `v.d + sum_m max(0, d_m.d)`. That is exact, and it is unusable: the
shipped bust's downward support goes from 0.5 to 1.2669 and its forward support
from 0.3301 to 0.5618, because thirty morphs all move the jaw region and the sum
assumes every one of them is at full weight at once. The head is 1.0 tall, so a
naive bound inflates the hull by three quarters of the head's height.

Excluding `mouth_interior` does not fix it, which was worth measuring before
assuming: the exterior `bust` primitive on its own has a per-vertex absolute
delta sum of 1.307 in Y.

So the bake bounds simultaneity per anatomical group (`MORPH_GROUPS`), taken
from what `MotionEngine.update` actually writes: two mouth shapes cross-fading,
two semantic expressions cross-fading, one tongue, one brow, one blink. Measured
against the naive bound, that is not a fudge, it is most of the accuracy:

| model | x+ | y+ | y- | z+ | z- |
| --- | --- | --- | --- | --- | --- |
| no morphs | 0.3672 | 0.5000 | 0.5000 | 0.3301 | 0.3301 |
| grouped (shipped) | 0.3672 | 0.5000 | 0.5063 | 0.4268 | 0.3301 |
| all thirty at once | 0.4129 | 0.5000 | 1.2669 | 0.5618 | 0.7224 |

The grouped model costs 0.006 downward and 0.097 forward, and forward is depth
for the shipped camera, so it barely shows on screen.

This is a bound on the engine, not on the type system. `LoadedAvatar.setMorph`
clamps each morph independently and would honour thirty ones, but `LoadedAvatar`
is not reachable from the public surface: `Engine.motion` is a `MotionEngine`,
which takes semantic expressions and viseme frames. If a future contract exposes
raw morph writes, this bound has to be revisited, and the table above says what
it would cost to drop it.

## The rig made the skinning argument free

Every skinned vertex of the shipped bust has a single joint at weight 1:
15285 on `head`, 1114 and 1121 on `eye_l`/`eye_r`, none on `root` or `neck`
despite both bones existing and being animated. So the union-of-per-joint-hulls
argument, which in general is needed because linear blend skinning of hull
vertices is not the hull of skinned vertices, collapses to one group here.

The eyeballs are retired by a containment proof rather than an assumption: a
pure rotation about a pivot keeps geometry inside the ball of its own maximum
radius, and that ball clears the head's support planes by 0.0715 and 0.0937.
The bake records them in `containedJoints` so the claim is auditable, and falls
back to giving a joint its own polytope when the check fails.

## What the 20 to 40 point budget costs, measured

The polygon is a strict outer bound at every pose tested (worst overshoot of a
mesh vertex outside it: 0.00 px at 512 px). It is also loose. Against the convex
hull of the projected mesh itself, at 512 px:

| pose | polygon points | polygon area | silhouette hull area | ratio |
| --- | --- | --- | --- | --- |
| neutral | 16 | 83282 | 64059 | 1.300 |
| yaw 0.6 | 14 | 89774 | 63738 | 1.408 |
| pitch 0.45 | 15 | 87548 | 68723 | 1.274 |

That is the geometry of the budget, not a defect in the construction. A convex
polytope's radial error against a smooth body falls as roughly `1/n`, so the
alternatives measured were:

| construction | baked points | screen-space cost |
| --- | --- | --- |
| 18 support planes (shipped) | 32 | area ratio 1.29 at rest |
| 32 support planes | 60 | area ratio 1.21 |
| 128 support planes | 252 | area ratio 1.05 |
| inner hull of support points, 32 directions | 27 | 12.9 px *inside* the silhouette |
| inner hull, 64 directions | 55 | 5.2 px inside |
| inner hull, 96 directions | 77 | 2.7 px inside |

Inner hulls are tighter per point but do not contain, and the isotropic dilation
that would fix them costs more than it saves (a 1.19 to 1.50 scale, measured).
Containment is the acceptance criterion the todo states, so the outer
construction wins and the looseness is recorded here rather than traded away.

The consumer decides whether it is enough. `todo.liquid-glass-live-css-layer`
carries a note: if a 30 per cent halo of frost around the head reads badly,
raising `DIRECTION_COUNT` is a one-line change with a known cost curve, and the
budget in the todo is what needs an accepted decision, not the maths.

## Emergence needs nothing, and is not tight

Emergence is a root translation plus a world-space clip plane, so the rendered
silhouette during it is a subset of the unclipped one and containment is free.
The hull is simply baggy below the waterline. Clipping the polygon there is not
a 2D line clip (a plane's image under perspective is not a half-plane), it needs
the hull's edge list and a 3D clip, so it is deliberately not built until a
consumer wants it. The pool of item 3 covers that region anyway.

## Traps

`PrimitiveTarget.getName()` exists (it inherits from `Property`), despite
looking absent in the narrowed interface docs; `test/asset-bust.test.ts` already
relied on it.

Reading positions after `optimize.ts` is safe only because base `POSITION` stays
float32 on this asset by an existing quantisation policy; morph deltas are
quantised and `Accessor.getElement` denormalises them. The bake refuses to run
against a skinned node with a non-identity transform rather than silently
ignoring a scale that glTF says to ignore.

Andrew's monotone chain written as a symmetric two-pass loop is wrong: the lower
pass needs a stack floor of 2 and the closing point is dropped once at the end,
not once per pass. Caught by the cube projection test expecting four corners.

## Provenance

The regenerated GLB grows by 1096 bytes and is geometrically identical to the
previous one, checked accessor by accessor with a sha256 digest over every
POSITION, NORMAL, JOINTS_0, WEIGHTS_0, TEXCOORD_0, index buffer and morph target
of both files. Only the scene extras differ, so no visual eval is implicated.
The regenerate-from-source byte-equality test passes, which is what certifies
the bake deterministic.

The projector is tree-shaken out of `dist/hologlyph.js`; the bundle grows from
23.77 kB to 24.20 kB gzip: the hull reader and its validation on the avatar
load path, plus the mouth-blend diagnostic in MotionEngine.

## What the reviews changed

Two independent reviews ran against the staged change: a correctness pass and an
adversarial pass on another model. Between them they moved real ground.

**The morph model was unsound as first written, and the fix is the interesting
part.** The adversarial pass built a public call sequence that broke it:
`engine.motion.applyVisemeFrame` takes an unrestricted `Record<string, number>`,
so a frame driving all fifteen visemes at once puts a vertex 71.8 px outside the
emitted polygon. Two of the three budgets it exceeded were the engine's own
doing and cost nothing to fix, measured: `setBlinkHold` drives all three blink
morphs together (blink 1 -> 3) and `tongueTargets` derives three channels that
smooth independently (tongue 1 -> 2), and both widenings leave every axis
support identical on the shipped bust. The third, the mouth, is the expensive
one (a third simultaneous mouth shape costs 0.112 downward) and is the one a
host can actually exceed.

Rescaling the frame inside `applyVisemeFrame` was considered and rejected: it
would silently change what every caller asked for, and the project's own motion
tests already drive a 1.7-weight mouth frame, so a sum-to-one rescale would move
asserted values in another node's suite. Instead `VisemeFrame` documents the
budget, MotionEngine warns once per engine past it and changes nothing, and the
acceptance grid now saturates every group the engine itself can saturate.

**Soundness gaps closed:** the retirement proof for rotating joints used a
directional reach where a radius belonged and compared a ball against non-unit
plane normals without scaling; it now uses a per-group morph radius and
`R * |n|`. It also read padded supports, spending slack it did not own, and now
reads raw ones. Multi-skin documents, unskinned mesh nodes, primitives with no
joint attributes, empty or duplicate joint names, and a degenerate direction set
were all silently mis-baked and now raise `SilhouetteHullUnsupported`.

**The optimiser is a general tool.** The bake first made it fail on every GLB
without a rig. It is now a note, not a failure, and a stale hull on the input is
dropped before the transforms run so a re-optimised asset can never keep a bound
that describes geometry it no longer has.

**Exactness:** support planes are padded by 2e-6 so six-decimal rounding and the
runtime's float32 narrowing cannot pull the bound inside the reachable set; the
near-zero morph delta filter became an exact-zero test for the same reason.
With that the acceptance tolerance is 0, not the half pixel it started at.

**Allocation:** `TypedArray.prototype.sort` allocates two backing arrays
whenever a comparator is supplied (V8 `TypedArraySortCommon`), so the per-frame
claim was false. Replaced with an in-place insertion sort, which is faster at
forty points anyway.

**Resolution:** three's GLTFLoader sanitises node names and keeps the original
in `userData.name`, so `head bone` and `head_bone` in one rig would both resolve
to the first bone. The original name is matched first, only bones count, and a
hull that does not resolve in full makes the projector unusable rather than
emitting an outline missing whatever the absent group bounded.

Two findings were closed as documentation rather than code, both on the exported
`halfSpaceVertices` helper and neither reachable from any production path: it
requires pre-padded supports, and it treats a plane triple below a determinant
floor as parallel. Both are now stated preconditions.
