# Eye trim primitive, lacrimal drop, and the mesh-tear root cause

## Why

Three owner-reported defects from the feature-shading lab sessions
(2026-07-21):

1. The inner corner of each open eye was covered by text-carrying skin.
2. With the trim shells split out, a dark film capped the eyeball.
3. Triangular black tears flickered on the collar, crown, and skull sides at
   high glyph density (pre-existing in every shipped GLB, newly noticed).

## What

1. `M_EyeBlend` (the caruncle-corner shell, real anatomy) splits into a third
   bust primitive with its own `eye_trim` material (mouth_interior pattern),
   dialable at runtime; engine `KEEP_MATERIALS` gains `eye_trim`.
2. `M_LacrimalFluid` joins the dropped face groups: source measurement shows
   it is a tear-film band spanning the whole eye width (1.35R), not an
   inner-corner detail; opaque under a text skin it caps the eyeball.
3. Mesh tears root cause (found by exhaustive elimination: masks, other
   primitives, morphs, depth-write, colour/emissive terms, quantisation
   volume, reorder, simplify, and filters all exonerated by live A/B): int16
   quantisation of the BASE position attribute on this skinned
   multi-primitive mesh makes scattered triangles render black/void in
   three's WebGPU path. Attribute-split bisect is conclusive: position-only
   quantise reproduces, everything-but-position is clean. The pipeline now
   ships base positions as float32 and quantises everything else (morph
   deltas included); EXT_meshopt_compression keeps delivery at 1.07 MB.
4. Quantised positions were scaled 2x in shader space, and every density
   constant was tuned against that. PLANAR_DENSITY doubles (20 -> 40) to
   preserve the approved rendered look exactly; the visual eval passes
   against the unchanged baseline.

## Affected nodes

- hologlyph.asset.pipeline (build-bust.ts, optimize.ts)
- hologlyph.runtime.core (KEEP_MATERIALS)
- hologlyph.runtime.shaders (PLANAR_DENSITY)
- assets/hologlyph-bust.glb (regenerated)
- test/asset-bust.test.ts, test/shaders.test.ts
