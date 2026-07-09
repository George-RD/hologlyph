# Asset Pipeline

## Purpose

Offline optimisation tooling for hologlyph avatar GLBs. This lives under
`tools/` and is **build-time only** — it is never bundled into the runtime
library (see `dec.hologlyph-blueprint`). Its single job is to take a source
`.glb` and produce a delivery-ready `.glb` that meets the **< 1.5 MB GLB
delivery budget** from `dec.performance-budget`.

## Usage

```bash
# via the package script
bun run optimize-asset -- avatar.glb avatar.optimized.glb

# or directly
bun tools/asset-pipeline/optimize.ts avatar.glb avatar.optimized.glb
```

If the output path is omitted, it defaults to `<input>.optimized.glb`.

The tool applies, in order:

1. `dedup` — remove duplicate accessors/meshes/materials.
2. `prune` — drop unused properties.
3. `meshopt` — Meshopt geometry compression (quantise + encode), using the
   bundled `meshoptimizer` wasm codecs.
4. `textureCompress` (resize) — downscale textures to a max of 1024x1024.
   Requires the `sharp` image backend; without it the step is skipped with a
   clear message.
5. KTX2 / BasisU — when the KTX-Software `toktx` CLI is on `PATH`, raster
   textures are converted to Basis Universal (KTX2) for GPU-friendly,
   size-efficient sampling. If `toktx` is missing, compression is skipped with
   a clear message rather than failing.

Finally it writes the output and asserts the size budget. If the optimised GLB
exceeds 1.5 MB the process exits with code `1` and a clear message, so it can
gate a CI delivery step.

## Budget rationale

`dec.performance-budget` fixes the asset target at **< 1.5 MB GLB**, carried by
KTX2 (Basis Universal) + Meshopt compression. This is a hard delivery constraint,
not a host-site concern: the runtime expects a small, fast-to-stream bust. Keeping
the optimiser out of the browser bundle (and as static `devDependencies`) means
the compression toolchain never inflates the shipped library.
