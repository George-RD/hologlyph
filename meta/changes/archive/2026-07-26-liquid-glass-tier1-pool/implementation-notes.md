# Implementation notes: liquid-glass-tier1-pool

Deviations from the todo, what the measurements changed, and what the browser
found that no test would have.

## The global clipping plane shapes the whole feature

`RendererHost.setClippingPlane` assigns `renderer.clippingPlanes`, which three
applies globally with no per-material opt-out. Everything below world Y 0 is
discarded, and that is not a detail the pool can route around; it decides two
things outright.

First, the wave cannot go below the waterline. A clipped trough is not a dark
trough, it is a hole through to the page. So the surface rests at `bias` and
the wave is clamped to plus or minus `bias`: the rest height and the amplitude
bound are the same number, and the todo's "surface breathes" is bounded by
construction rather than by hoping the simulation stays small. At the default
0.04, and with the lab camera about 0.55 above the water, that is roughly 20
screen pixels of travel, which is plenty.

Second, the simulation pass cannot use three's `QuadMesh`. That quad straddles
the world origin, so the global clip would discard its lower half and freeze
half the height field, silently and permanently. The pass owns a 2x2 quad at
world Y 8 with its own orthographic camera instead. This cost about fifteen
lines and would have been an extremely confusing bug.

## Two defects only the browser found

Neither of these is reachable from a unit test, and both were obvious within
one frame of looking at the lab.

**The hole in the water never closed.** `poolProfileRadiusAt` clamps above its
top slice, which is right for interpolation and wrong for the waterline: once
the bust submerged completely, the profile kept reporting the crown radius and
a head-sized black ellipse floated on the surface. `poolWaterlineRadius` now
returns 0 at or above `maxY`, because a body entirely under the plane does not
cross it. The bound is inclusive, not exclusive: full submersion puts the
waterline at exactly `BUST_HEIGHT`, which is exactly `maxY` on a rig authored
to the ramp's height, so an exclusive test would miss by one boundary in
precisely the state that was broken.

**The wave crests were stair-stepped.** The field targets were `NearestFilter`,
which is the reflex for a GPGPU ping-pong, but the rendered surface has 192
segments reading a 256 texel field and point sampling turned every crest into
visible blocks. `LinearFilter` fixes it and is exact for the simulation as
well: the simulation pass runs on a fullscreen quad, so every fragment lands on
a texel centre and every neighbour tap is one whole texel away, which means a
linear fetch returns the texel value with no blend.

## The lazy chunk was built, measured, and thrown away

`pool-surface.ts` is the only file that touches render targets, the shipped
configuration never runs it, and it looked like an obvious candidate for a lazy
chunk. It was implemented, with an in-flight guard and dispose-during-load
handling, and then measured:

| build | first-load gzip | on demand |
| --- | --- | --- |
| baseline, before this change | 24.20 kB | - |
| static import | 28.18 kB | - |
| dynamic import | 26.90 kB (0.18 stub + 26.72 shared) | 2.19 kB |

The lazy version moves only 0.9 kB off the first-load path, because rollup
hoists everything the chunk shares with the entry into a third file, and it
splits `dist/hologlyph.js` into a stub plus that shared chunk. Nine hundred
bytes is not worth an asynchronous build path with three race windows in it
(duplicate imports while one is in flight, dispose during load, and the amount
returning to 0 during load), so the static import stands and the measurement is
recorded here rather than the option being silently skipped.

The remaining 3.98 kB is mostly irreducible: the breathe and fade nodes live in
the skin's node graph and are in the bundle whatever `pool.amount` says.

## The shading normal, and the day it ate the head

`pool.amount = 0` had to reproduce the approved look, and the honest number is
not "identical". Measured pose-pinned with `tools/smoke/solid-body-shot.mjs`,
which freezes every bone quaternion and every morph influence array, run on
this branch and on `glass`:

| comparison | pixels differing | worst channel |
| --- | --- | --- |
| same build, two runs | 0 of 307200 | 0 |
| this branch against `glass` | 3 of 307200 | 1 of 255 |

Silhouette and mean luminance are equal to the digit (49706 px, 70.702). Three
pixels at one least-significant bit is the extra `mix` instruction in the
normal chain being reassociated by the driver; the precedent this repo already
accepted for the solid-body change was 115 pixels at 3 of 255, so this is an
order of magnitude inside it. It is a residual, not a nil, and calling it
bit-identical would be a lie.

Getting there took one genuine disaster, which is the most useful thing in
this file.

**`transformNormalToView` normalises, and I fed it a zero vector.** It ends in
`cameraViewMatrix.transformDirection(...)`, and `transformDirection` is
documented as "transforms the direction of a vector by a matrix and then
normalizes the result". The first version of the normal correction computed
the perturbation on its own and transformed that, so at `pool.amount = 0`,
where the gradient is exactly zero, every fragment evaluated
`normalize(vec3(0))` and got NaN. GLSL `mix` multiplies rather than branches,
so `mix(a, NaN, 0)` is NaN too. The NaN reached the fresnel, the fresnel
reached the alpha, and the shell was discarded: the visual eval's silhouette
fell from 50311 pixels to 3452, a 93 per cent collapse, at the setting that is
supposed to change nothing.

The fix is to perturb inside a vector that is already unit length,
`transformNormalToView(normalLocal.sub(tangential))`, so the argument is never
zero. At gate 0 that is exactly how three builds `normalView` itself.

**The smoke could not see it, and that is the lesson.** The inertness leg
compares two states of the same build. A change that breaks the shell in both
states reads as a perfect 0 pixel difference, and it did: the smoke reported
inert while the head was 93 per cent gone. Only `bun run eval`, which scores
against a committed baseline from another build, caught it. `pool-shot.mjs`
now opens with a silhouette floor as a local canary, and the rule is worth
stating plainly: a same-build A/B proves a gate is inert, never that a build
is unchanged.

**`directionToFaceDirection` is not re-exported from `three/tsl`,** and
`faceDirection` is not a substitute for it. The first is what three applies to
`normalView`, and it reads `material.side`: identity on `FrontSide`, negated
on `BackSide`. The second is the per-fragment front-facing sign, which is only
the same thing on a `DoubleSide` material. Since `buildSkinMaterial` builds a
known `FrontSide` front and a known `BackSide` interior, the two get their own
node, `breatheNormalFront` and `breatheNormalInterior`, and the negation is
written out rather than inferred.

The gate itself is derived rather than configured, and closes whenever the
breathe amplitude is zero, because at zero amplitude the perturbed normal is
only mathematically equal to `normalView`, not numerically.

Overriding `material.normalNode` turned out to be the cheap way to satisfy the
decision's requirement that shading normals follow the deformation. three
resolves `normalView` to the override in the fragment stage and derives
`normalWorld` from `normalView`, so the fresnel, the refraction offset, the
matte shade term and the Blinn highlight all follow with no edit to any of
them. `normalGeometry` is untouched, so the glyph grid stays welded to the
bind pose, which is the approved look.

The other side of inertness is structural and did hold exactly: the engine
tears the pool down rather than hiding it, so at 0 there is no object, no
render target pair and no draw call, and every other added node is an exact
identity (`x.mul(1)`, `mix(a, b, 0)`, `positionLocal.add(vec3(0))`).

## Morphs survive, and that is a measured claim

`NodeMaterial.setupPosition` (node_modules/three, `src/materials/nodes/NodeMaterial.js`
lines 732 to 778) pushes `morphReference()` then `skinning()` onto the stack and
only then does `positionLocal.assign(this.positionNode)`. It is an overwrite, so
a displacement written from `positionGeometry` or `normalGeometry` would discard
every viseme and all bone skinning while still looking plausible in a
screenshot of a neutral face. The smoke script drives `jaw_open` to 1 with the
breathe at its maximum and asserts the capture moves: it moves about 65,000
pixels.

`normalLocal` is used unnormalised in the displacement on purpose. A degenerate
normal normalises to NaN and `0 * NaN` is NaN, so normalising there would let
one bad triangle destroy the mesh at `pool.amount = 0`, which is the one state
that must never break. glTF normals are unit length and the amplitude is
millimetric, so the length error is noise. The shading normal has no such
choice, since `transformNormalToView` normalises internally, but it does so on
`normalLocal` plus a tiny perturbation rather than on the perturbation.

## NaN is the failure mode worth engineering against

A single non-finite texel is fatal and silent: the Laplacian spreads it across
the whole field within a second and damping never removes it, so the pool goes
blank for the rest of the session with nothing logged. `setScrollProgress` is
host-called, and a host computing `scrollY / scrollHeight` against a
zero-height container passes NaN, which `clamp01` passes straight through
because `NaN < 0` and `NaN > 1` are both false.

Guarded at both ends: the engine drops a non-finite progress rather than
clamping it, and `PoolSurface.update` re-checks the drive and the radius where
the CPU meets the GPU. Covered by a test that drives NaN and Infinity through
the public surface.

## Cost, measured with the right instrument

rAF deltas are useless here. Vsync clamps them to about 16.7 ms, and with
`--disable-gpu-vsync` they drop to 0.2 ms because the main thread stops waiting
for the GPU at all, so the pool reads as free either way. The frame-time panel
on the lab page is honest about being wall clock and is there for gross
regressions only.

The real figure comes from awaiting `device.queue.onSubmittedWorkDone()` each
frame, bracketed off-on-off so drift shows up:

| pool | GPU ms, median | mean | p95 |
| --- | --- | --- | --- |
| off | 1.90 | 1.89 | 2.2 |
| on | 2.20 | 2.22 | 2.5 |
| off again | 1.90 | 1.93 | 2.4 |

0.30 ms added, against a budget of about 1 ms. The surface is 73,728 triangles
at 192 segments a side, drawn once per frame (verified by counting
`onBeforeRender` calls; `renderer.info.render` double counts across the nested
simulation render and is not a reliable instrument here).

## Tier 1 boundary on work item 5, stated rather than skipped

"Internals fade out below the waterline rather than melting" is implemented for
the materials the library builds: the interior wall fades over a band above the
waterline, and the front surface's glass terms fade with it, while the base
glyph alpha is left alone so the face does not dissolve. That covers the
artefact that actually reads, which is the clipped cross-section exposing the
hollow inside of the shell.

The authored `mouth_interior` and `eye_trim` materials in the engine's
`KEEP_MATERIALS`, and the eyeball material, still terminate at the hard clip.
Softening them means replacing authored glTF materials with node-material
clones, which silently drops whatever maps and emissive the asset carries and
needs swap-and-restore bookkeeping the renderer's scene-walk teardown does not
cover. They are small, dark, and only cross the waterline during emergence,
which the meniscus and contact ring already dress. Deferred deliberately, noted
in the module header of `src/shaders/materials.ts`, and not counted as done.

## Smaller things worth knowing

The sponge boundary is 24 of 256 texels graded with a smoothstep, applied to
both the current and previous height every step. A hard zero border is a
Dirichlet wall: it reflects the wave back inverted and settles into a standing
checker within a couple of seconds.

Ping-pong swaps whole materials rather than writing a new texture into one
`TextureNode`. The value swap would probably work, since `sample()` clones
share their value through `referenceNode`, but two materials with fixed
bindings cost one pipeline built once and cannot silently freeze the surface.

The radial profile carries the last populated radius through an empty slice.
Without that, a gap in the vertex distribution reads as zero radius and punches
a hole in the contact contour.

`renderer.info.render.triangles` reports 204,211 with the pool on against
56,753 off, which is roughly twice what the surface actually adds. The counter
accumulates across the nested simulation render; the `onBeforeRender` count is
the trustworthy one.
