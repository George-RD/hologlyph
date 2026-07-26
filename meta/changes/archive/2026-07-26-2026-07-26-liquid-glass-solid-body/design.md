# Design: 2026-07-26-liquid-glass-solid-body

## Approach

Three parts: bake thickness, absorb by it, and draw the far wall.

### 1. Thickness bake (`src/asset/rig.ts`)

`computeThickness(geometry, budget)` casts one ray per vertex along the inward
normal and returns the distance to the first opposing surface, normalised to
`[0,1]` by the longest hit in the mesh. A uniform grid, sized at roughly one
cell per triangle, accelerates it. Two rules keep the walk honest:

- the DDA only stops once the best hit lies inside the span already traversed,
  because buckets hold triangle bounding-box overlaps and a triangle filed
  under the current cell can be hit far downrange past a nearer surface;
- each ray stamps the triangles it has tested, so a triangle spanning many
  cells is intersected once per ray rather than once per cell.

Rays that escape through an open boundary (the neck cut) inherit the mean of
their hit neighbours over three passes, then one Laplacian pass removes ring
speckle around folds. Without that the attribute has holes exactly where the
bust is cut off. A vertex with a degenerate normal, or one no face references,
is marked unresolved rather than claimed as zero-thickness.

Non-indexed geometry is a triangle soup: the indices are synthesised once
rather than refusing to bake, so a custom GLB exported without an index buffer
still gets absorption.

Every tolerance is relative to the bounding-box diagonal, so a rig authored in
millimetres behaves exactly like one authored in metres.

Four budgets keep a pathological custom rig from stalling the page. Over any of
them the bake returns zeros, absorption switches off, and the flat look stands:

| budget | value | bounds |
| --- | --- | --- |
| `THICKNESS_VERTEX_BUDGET` | 12,000 | ray count |
| `THICKNESS_TRIANGLE_BUDGET` | 40,000 | per-ray intersection cost |
| `THICKNESS_CELL_REFERENCE_BUDGET` | 320,000 | grid table size and the counting pass |
| `THICKNESS_WORK_BUDGET` | 2,000,000 | intersection tests, shared across the whole avatar |

The work budget is one object per avatar load, threaded through every
`bakeThickness` call, so a rig of many individually legal meshes cannot add up
to an unbounded stall. At the measured 100 ns per test it caps the load-time
raycast near a quarter of a second.

`bakeFeatureMasks` declares `aThickness` zeroed alongside the other seven masks
so the attribute always exists and the shader always compiles. `bakeThickness`
fills it, and the engine calls that only for meshes it dresses in the glass
skin. The raycast dominates mask baking (72 ms for the shipped bust's
7,472-vertex skin mesh, 166 ms for every mesh in the scene), and the mouth
interior, eye trim and eyeballs keep their own materials and never sample it.

### 2. Absorption and the interior wall (`src/shaders/materials.ts`)

`buildSkinMaterial` returns two materials built from one node graph:

- **front** gains `1 - exp(-thickness * GLASS_ABSORPTION)` added to its opacity,
  weighted by the headroom the base alpha leaves. Thick regions occlude the
  page; the nose and chin stay clear.
- **interior** is the same glyph surface with `side: BackSide` and
  `depthWrite: false`, its colour pushed through a tint-coloured Beer-Lambert
  term so the far wall darkens with the body it is seen through.

Absorption is achromatic on the front and tinted on the interior, and that
split is measured. Mixing the glass tint into the front glyph colour is the
obvious reading of the todo, but it flattens the glyph field exactly where the
body is thickest: yaw legibility fell from a 32.5 and 32.3 baseline to 23.8 and
22.1 against pass cutoffs of 26.0 and 25.8, a straight eval fail. A 0.22
ceiling on the mix still cost 29.7 and 27.4. Dropping it holds 32.0 and 29.3. A
text-skinned head cannot spend that much legibility for a pastel wash, so the
tinted half of Beer-Lambert lives on the interior wall, which is the light that
has genuinely travelled through the body.

Both terms are gated by `skin.glass.amount`, so amount 0 restores the flat
translucent skin exactly.

This answers the todo's open question about `NodeMaterial.clone()` by not
needing it: the two graphs reference the same uniform node objects, so
`applyConfigToBindings` still writes one place and the halves cannot drift. The
VFX binding is retired only once both materials have been disposed.

### 3. Draw order (`src/core/engine.ts`)

The interior wall must land behind the occlusion mask, which writes front
surface depth to cull the eyeballs and mouth cavity. `renderOrder` alone cannot
do it: three renders the entire opaque list before the transparent one, and the
mask was opaque. So while the glass is on, every layer is flagged transparent
and ordered by `renderOrder`:

```
-1  interior   back faces, blended, no depth write
 0  mask       front depth only, colorWrite off
 1  internals  eyeballs, mouth cavity, eye trim
 2  skin       translucent front surface
```

The mask and the authored internals are opaque in substance, so they keep
`NoBlending` and stay a straight write when they move; only the layering
changes. That is still not free: with the jaw open, moving them shifts the
mouth cavity by about 15 luma over the aperture. So the move is conditional.
`applyGlassLayering` runs each frame, guarded on the last applied state, and
unwinds the whole arrangement whenever `skin.glass.amount` reaches 0: the
internals go back to opaque and the interior mesh is hidden. It reconciles from
`sysVfx.headConfig` rather than from a setter, so it holds however the config
was changed, including straight through `engine.vfx.setHeadConfig`.

The overlays are cloned from a mesh the glass skin actually dresses, preferring
one that carries morph targets. `morphMeshes[0]` is only guaranteed to carry
canonical morphs, so on a custom rig it can be the mouth cavity or an eye.

## Changes

ADDED:
- `computeThickness`, `bakeThickness`, `thicknessOverBudget`, the budgets and
  `ThicknessBudget` in `src/asset/rig.ts`.
- `GLASS_ABSORPTION`, `INTERIOR_OPACITY`, `INTERIOR_DIM` and the interior node
  graph in `src/shaders/materials.ts`.
- `SkinMaterials` in `src/contracts.ts`.
- `cloneOverlayMesh`, `disposeOverlayMeshes` and `applyGlassLayering` in
  `src/core/engine.ts`.
- `tools/smoke/solid-body-shot.mjs`, the pose-pinned capture and cross-branch
  comparison used to verify both acceptance claims.

MODIFIED:
- `bakeFeatureMasks` declares `aThickness`; the secondary interleaved buffer
  grows from stride 3 to 4.
- `VFXEngine.createSkinMaterial` returns `SkinMaterials` rather than a single
  material. Four callers migrated, no shim.
- `EngineImpl.replaceAvatar` builds both overlay passes through one helper.

REMOVED:
- The inline mask-mesh construction in `replaceAvatar`, folded into
  `cloneOverlayMesh`.

## Verification

`bun run eval` overall pass, negative control fails as required. Against the
baselines: glyph legibility 9.979 (9.842), yaw legibility 31.993 and 29.356
(32.494 and 32.266), blend-zone ghosting 0.646 against a 0.768 cutoff
(baseline 0.640). The ghosting risk the todo flagged did not materialise.

Acceptance is measured with `tools/smoke/solid-body-shot.mjs`, which pins the
bones and every morph influence array before capturing. That matters:
`setMotionFrozen` holds whatever pose idle motion had reached, idle phases off
wall-clock time, and the thickness raycast adds about 70 ms to boot, so an
unpinned capture leaves the head a couple of milliradians away and slides every
bind-pose-welded glyph a pixel or two. That artefact read as a 5% pixel
difference before the pose was pinned.

With the pose pinned, against `glass` at the merge base:

| case | `amount = 0` vs base | `amount = 1` vs base |
| --- | --- | --- |
| neutral | 14 pixels differ, worst channel 2/255 | 43,331 (14.11%), mean signed -25.4 |
| `jaw_open = 1` | 115 pixels differ, worst channel 3/255 | 43,490 (14.16%), mean signed -23.9 |
| `exp_blink = 1` | 1 pixel differs, worst channel 1/255 | 43,684 (14.22%), mean signed -25.4 |
| camera orbit 0.6 rad | 16 pixels differ, worst channel 3/255 | see below |

In every case at amount 0, no pixel's luminance moves at all by the eval's
own 3-unit dither threshold: the differing pixels are last-bit rounding, at
most 115 of 307,200 and never more than 3/255 in one channel. The front alpha
expression is deliberately written in the pre-change order so the GPU emits the
same instruction sequence; the residue is the one extra additive term the
thickness contributes, which is exactly zero at amount 0 but still costs a
rounding step. Two captures of the same code are bit-identical, so this is a
real if invisible difference and not capture noise.

The two morph poses are there because the draw-order change is only observable
through an open aperture, and it is the reason `applyGlassLayering` unwinds at
amount 0: left unconditional it moved the mouth cavity by about 15 luma over
1,387 pixels. The camera orbit covers the "under rotation" half of the
acceptance clause, at the same 0.6 rad the visual eval uses.

At amount 1 the head gains body: the silhouette grows from 48,659 to 49,721
lit pixels head-on and from 47,207 to 50,899 at 0.6 rad, with mean silhouette
luminance rising from 49.2 to 70.7 and from 49.8 to 71.1. The systematic
negative mean signed delta is that gain.

Every capture writes a JSON manifest beside the PNGs recording the pose, the
orbit, the config, the image hashes and the deltas, so a claim of this kind is
reproducible rather than remembered. Reproduce with `bun run dev` and:

```
bun tools/smoke/solid-body-shot.mjs --out OUT --amounts 1,0 [--morph jaw_open=1] [--orbit 0.6]
bun tools/smoke/solid-body-shot.mjs --out OUT --baseline BASE_OUT --amounts 0 [...]
```
