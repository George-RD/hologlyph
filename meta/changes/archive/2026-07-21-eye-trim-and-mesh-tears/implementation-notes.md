# Implementation notes

## Deviations and discoveries

- The eye_trim primitive initially contained M_EyeBlend AND M_LacrimalFluid.
  Owner screenshot showed a dark film capping the eyeball: source
  measurement proved lacrimal is a 1.35R-wide tear-film band across the eye
  front, not inner-corner detail. It moved to the dropped set; eye_trim is
  blend-only.
- The mesh tears were NOT introduced by this change: bisect showed identical
  tears in pre-#44 and main assets; only the raw (unoptimised) build was
  clean. They were newly visible because the owner raised glyph density.
- False leads eliminated by live A/B before the real cause: zone masks
  (uniforms zeroed), mouth/eyes/trim primitives (hidden), depth-write
  ordering (disabled), morph system (fully detached), colour and emissive
  terms (forced white / zero), quantisation volume (scene), simplify
  lockBorder, meshopt level and reorder. Debug materials rendering weights,
  positions, and raw triplanar luma were all clean; the real material at
  full opacity still showed black triangles.
- Conclusive bisect: quantise POSITION only -> tears; quantise everything
  except POSITION -> clean. Mechanism inside three's WebGPU handling of
  normalized-int16 positions on skinned multi-primitive meshes; not fully
  attributed upstream, documented as a policy constraint in optimize.ts.
- Quantised positions were exactly 2x in shader-visible space (normalized
  int16 [-1,1] over a [-0.5,0.5] volume). All density constants and the
  eval baseline encoded that scale, so float positions inflated glyphs 2x.
  PLANAR_DENSITY 20 -> 40 restores parity; eval passes against the
  UNCHANGED baseline (no recalibration).
- gltf-transform simplify() gained lockBorder briefly during diagnosis; it
  neither fixed nor regressed anything and was reverted to keep the proven
  configuration.
- The regen byte-determinism test caught a stale raw intermediate during the
  final rebuild (shipped GLB built from an outdated /tmp raw); rebuilt from
  source before landing.
