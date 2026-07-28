# Design: liquid-glass-interior-glyphs

## Approach

The field is one extra draw call between the two glass passes, driven entirely
from the CPU. Nothing about it is clever, on purpose: it is a few hundred
sprites, and a few hundred sprites are cheaper to place on the CPU than to
argue with a vertex shader about.

Split as the pool is split, for the same reason: the maths is pure and unit
testable, the GPU object is not.

- `src/shaders/interior-glyphs.ts` - pure. Site sampling from the thickness
  field, the body axis it samples toward, the spring integrator, the drift
  field, depth dimming. Imports nothing GPU-shaped, so the engine's own test
  suite uses the real functions rather than a stub.
- `src/shaders/interior-glyph-field.ts` - the `THREE.Mesh` and its node
  material. Imported by `EngineImpl` directly, not re-exported from the shader
  barrel, exactly as `createPoolSurface` is.

### Where the sites come from

`aThickness` is normalised to [0,1] by the largest chord in the mesh, so it
says which parts of the body are thick but not how thick they are in world
units. That rules out marching inward from a vertex by its thickness: the scale
is gone and recovering it means a second raycast.

So thickness is used as a *weight*, not as a distance. A site is chosen by
picking a surface vertex with probability proportional to its thickness, then
sliding it toward the body axis at that vertex's own height by a random
fraction. The axis is a per-slice mean of x and z, the same slicing
`poolRadialProfile` already does for the waterline, so the forehead slides into
the middle of the skull rather than down into the neck, which is where a single
whole-body centroid would send it.

The thickness weighting is what keeps glyphs out of the nose, the ears and the
chin, where there is no interior to be suspended in. With no thickness bake
(over budget, or a rig that never got one) the weights fall back to uniform and
the field still populates: degrade, do not throw.

Up to `INTERIOR_GLYPH_MAX` sites are sampled once, on first activation, and the
buffers are allocated for however many came back. `count` then
picks a prefix of them, so dragging the count slider changes the draw range and
nothing else: no resample, no reallocation, and glyph identity is stable across
the whole slider travel.

### How they move

Positions are integrated in **world space**, and the target is the site carried
by the head's frame. That is the whole model:

    target = frameMatrix * (rest + drift)
    a      = (target - x) * k - v * c
    v     += a * dt
    x     += v * dt

A spring-damper chasing a moving target already *is* the fictitious force the
todo describes: turn the head and the target sweeps away from the glyph, the
spring pulls it after, the damping settles it, and an under-damped ratio gives
it a small overshoot on the way. No angular acceleration has to be estimated,
which matters, because estimating one means differentiating a quaternion twice
per frame and every jitter in the frame time comes back as a kick.

`inertia` interpolates the stiffness logarithmically between rigid and loose.
At 0 the integrator is skipped entirely and the glyph is written straight to
its target, which is exact rather than merely stiff.

The frame is the `head` bone when the rig has one. On the shipped bust the
whole body except the eyeballs skins to `head` at weight 1
(`tools/asset-pipeline/build-bust.ts`), so the head bone is the body's frame,
not just the skull's. Rest positions are mapped into it with
`boneInverse * bindMatrix`, which is what three does to skin a vertex weighted
wholly to that joint. A rig with no `head` bone falls back to the body mesh's
own parent.

### How they are drawn

A single `THREE.Mesh` holding four vertices and six indices per glyph, added
straight to the scene with an identity transform, because the positions it
carries are already world space. `frustumCulled = false`: the bounding sphere
would be a frame stale every frame.

Per frame the update writes three buffers:

- `position` - the four corners of each quad, billboarded by the camera's world
  right and up vectors.
- `aDim` - the depth dim, from the glyph's view depth normalised across the
  field's own front-to-back span that frame. Self-normalising, so the field
  reads as depth at any camera distance.
- `index` - the quads in back-to-front order.

UVs are static: each site owns one cell of the text-skin grid, inset by half a
texel so a sprite cannot bleed into its neighbour.

The material is a `MeshBasicNodeMaterial` sampling the same
`TextSkinEngine.texture` the skin samples. The cell's dim background is keyed
out by luminance, so what survives is the letterform and not a glowing square.
Brightness is the product of the sampled luminance, `interior.brightness`
(clamped to [0,1]) and the depth dim, so an interior glyph can never be
brighter than the same glyph on the canvas, and the translucent front surface
then draws over it.

`NormalBlending`, not additive. Additive is what turns a few hundred
overlapping sprites into a snow globe, which is the first risk the todo names,
and it makes the brightness cap unenforceable.

### Where it sits in the draw order

The ladder from item 1 is unchanged:

    -1    interior   back-facing far wall
     0    mask       front surface depth only
     1    internals  eyeballs, mouth cavity, eye trim
     2    skin       translucent front surface

The field goes at **-0.5**: after the far wall, so it composites over it, and
before the occlusion mask, so the mask's depth write cannot cull it. It is in
the transparent list already, so it needs nothing from
`EngineImpl.applyGlassLayering`.

A fractional render order is deliberate. The alternative is renumbering four
existing passes to make room, and those four numbers are load bearing for the
approved look.

### The gate

`interior.count` is a number gate, in the taxonomy `demo/LAB-STATUS.md` sets
out: the field is pure computation over geometry the engine already holds, so
there is no resource whose absence could be the gate. At 0 the reconciler
samples nothing, allocates nothing and adds no object to the scene, and the
sites are not sampled until the first frame that asks for one.

The reconciler `applyInteriorGlyphs` runs every frame beside `applyPoolLayer`
for the same reason that one does: `engine.vfx.setHeadConfig` is a public
surface that renders nothing itself.

## Changes

ADDED:
- `src/shaders/interior-glyphs.ts` - pure site sampling, body axis, spring
  integrator, drift, depth dim.
- `src/shaders/interior-glyph-field.ts` - `createInteriorGlyphField`, the mesh
  and its node material.
- `test/shaders-interior.test.ts` - the pure half.
- `demo/interior-glyph-lab.html`, `tools/smoke/interior-glyph-shot.mjs`.

MODIFIED:
- `src/contracts.ts` - `HeadInteriorConfig`, `HeadConfig.interior`,
  `HeadConfigOverrides.interior`, `DEFAULT_HEAD_CONFIG.interior`.
- `src/shaders/materials.ts` - `normaliseHeadConfig` normalises `interior`.
- `src/shaders/index.ts` - re-export the pure half.
- `src/core/engine.ts` - the reconciler, the per-frame update, teardown.
- `test/core.test.ts` - lifecycle and gate coverage.
- `cairn.blueprint` - claim the new test path.
- `README.md`, `CHANGELOG.md`, `demo/LAB-STATUS.md`, `tools/smoke/README.md`.

REMOVED:
- Nothing.

RENAMED:
- Nothing.
