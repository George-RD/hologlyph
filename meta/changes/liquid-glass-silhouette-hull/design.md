# Design: liquid-glass-silhouette-hull

## Approach

Two halves: an offline bake that produces an outer bound, and a runtime that
projects it. The value of the split is that all the reasoning lives offline and
the per-frame path is a matrix multiply per point plus a 2D convex hull.

### 1. Bake (`tools/asset-pipeline/silhouette-hull.ts`)

The hull is an outer bound, not a fit. Every position the rig can reach lies
inside it, so the 2D convex hull of the projected points contains the rendered
silhouette for any camera. Two facts make that provable rather than sampled.

**Skinning.** A vertex's skinned position is `sum_j w_j M_j v` with weights
summing to one, so it is a convex combination of its per-joint rigid images.
Build one polytope per joint over every vertex that joint touches and the union
of the transformed polytopes contains the skinned result at any pose. A joint
whose geometry provably stays inside the primary polytope under an arbitrary
rotation of its own bone contributes no polytope at all: the reachable set of a
pure rotation about a pivot is contained in the ball around it, so one radius
against the primary support planes settles it. On the shipped bust that retires
both eyeballs, and every remaining vertex is rigidly bound to `head`, so the
bake emits a single group.

**Morphs.** Three applies morph targets additively, so the positions one vertex
can reach form a zonotope and its support along a direction is the base
projection plus the positive delta projections. Which deltas may sum is the only
judgement call in the bake, and it is bounded by `MORPH_GROUPS`, mirroring how
`MotionEngine.update` composes weights: mouth shapes cross-fade two at a time
(attack of the next viseme over the release of the last), semantic expressions
likewise, and tongue, brow and blink are each a single value. This is a bound on
the engine, not a house rule: the public surface is `Engine.motion`, which takes
semantic expressions and viseme frames, and exposes no raw per-morph write.

The polytope itself is the intersection of eighteen support half-spaces, sampled
on a Fibonacci sphere. Its vertices come from intersecting every plane triple
(816 of them) and keeping the intersections that satisfy all eighteen
half-spaces, which needs no hull algorithm and makes containment obvious: a
point that satisfies every constraint is inside by definition. Eighteen
directions give 32 vertices, inside the todo's 20 to 40 budget.

Determinism, which the regenerate-from-source test enforces: the direction set
is closed-form, the triple enumeration is ordered, coordinates round to six
decimals with negative zero normalised, and the vertex list sorts
lexicographically before it is written.

The bake runs last in `optimize.ts`, after simplify, quantise and meshopt, so it
bounds the geometry that actually ships. It writes to the glTF scene `extras`,
which three's GLTFLoader surfaces as scene `userData`, so the hull travels with
the asset and costs no second fetch.

### 2. Runtime (`src/asset/hull.ts`)

`readSilhouetteHull` validates the extras and returns null for anything it
cannot read: wrong version, ragged point array, short matrix. The hull is an
enhancement and its absence must change nothing, so `LoadedAvatar.silhouetteHull`
is optional and null for every asset without one.

`SilhouetteProjector` allocates every buffer in its constructor. Each `update`
composes `viewProjection * boneMatrixWorld * inverseBind` once per group,
projects the points with explicit `w` handling, and runs Andrew's monotone chain
over a preallocated index array to write the polygon into `xy`. There is no
`subarray`, no sort key array, no vector object: `Int32Array.prototype.sort`
is in place, and the projection reads matrix elements directly.

`polygon()` is the one allocation, and unavoidably so. A CSS `clip-path` value
is an immutable string, so a changing outline costs one fresh string per frame.
Consumers that can take numbers read `xy` and `count` instead. There is no
typed-OM shape value to reuse.

Degradation: any hull point at or behind the eye plane means the camera is
inside the head, where a clip polygon has no meaning, so `update` returns false
and leaves `count` at zero rather than emitting a folded polygon. A stale
outline never leaks: `count` is cleared at the top of every call.

## Verification

The oracle is the geometry, not a re-implementation. `test/asset-bust.test.ts`
loads the shipped GLB, then for eight poses (yaw to 0.6, pitch to 0.45, roll,
and one mid-emergence root offset) crossed with four morph states, skins and
morphs all 17520 vertices on the CPU exactly as three would, projects them with
the shipped camera and requires every one inside the emitted polygon. A negative
control shrinks the baked points five per cent toward the head pivot and
requires the same check to fail, so the oracle demonstrably bites.

Timing and allocation are measured in the same file: 2000 updates against the
real hull, mean per frame asserted under 0.1 ms, with the output buffer identity
checked across 200 posed updates.
