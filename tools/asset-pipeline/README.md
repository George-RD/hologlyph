# Asset Pipeline

## Purpose

Offline build tooling for hologlyph avatar GLBs. Everything under `tools/` is
**build-time only** — it is never bundled into the runtime library (see
`dec.hologlyph-blueprint`). The pipeline has two stages:

1. **build-bust.ts** — assembles the shipped head bust from pinned source
   geometry (ICT-FaceKit).
2. **optimize.ts** — compresses any GLB (including the bust) toward the
   **< 1.5 MB delivery budget** from `dec.performance-budget`.

## Provenance

The head bust is built from [ICT-FaceKit](https://github.com/USC-ICT/ICT-FaceKit)
(USC-ICT, MIT licence), pinned at commit
`da5f95a607f5e6b37755b38d3385d7f2853732e5`. Source files are fetched
automatically to the gitignored `tools/asset-pipeline/.cache/` directory and
sha256-verified against `tools/asset-pipeline/ict-source-manifest.json`. A copy
of the MIT licence lives at `tools/asset-pipeline/ICT-FaceKit-LICENSE`.

## Build the shipped bust (two steps)

```bash
# Step 1: assemble the 27-target bust from ICT-FaceKit sources
bun tools/asset-pipeline/build-bust.ts tools/asset-pipeline/.build/hologlyph-bust.raw.glb

# Step 2: optimise (Meshopt + KTX2) toward the delivery budget
bun tools/asset-pipeline/optimize.ts tools/asset-pipeline/.build/hologlyph-bust.raw.glb assets/hologlyph-bust.glb --simplify 0.5
```

Or via the package scripts:

```bash
bun run build-asset
bun run optimize-asset -- tools/asset-pipeline/.build/hologlyph-bust.raw.glb assets/hologlyph-bust.glb --simplify 0.5
```

### Full-fidelity retention (`--full`)

Pass `--full` to `build-bust.ts` to also emit a full-fidelity intermediate at
`tools/asset-pipeline/.build/hologlyph-bust.intermediate.glb`. This retains all
57 source deltas from the manifest (every ARKit expression shape) rather than
the 27 canonical rig targets. The composition recipe lives in
`tools/asset-pipeline/build-bust.ts` (the `VISEME_RECIPE` and `EXPRESSION_RECIPE`
maps); the intermediate preserves every raw delta so the recipe can be revised
without re-fetching.

```bash
bun tools/asset-pipeline/build-bust.ts --full [out.glb]
```

## Morph recipe

The shipped bust carries 27 canonical morph targets:

- **15 visemes** — each composited as a weighted sum of ARKit expression deltas
  (per `res.morph-authoring`). For example `viseme_aa` blends `jawOpen: 1.0`
  with `mouthStretch_L/R: 0.3`; `viseme_pp` uses `mouthPress_L/R: 1.0` plus
  `mouthClose: 0.25` (the `mouthClose` weight was tuned down from 1.0 after a
  keyframe render showed lip folding at full weight).
- **12 expressions** — `exp_happy`, `exp_sad`, `exp_surprised`, `exp_angry`,
  `exp_relaxed`, `exp_blink`, `exp_blink_l`, `exp_blink_r`, `exp_brow_up`,
  `exp_brow_down`, `jaw_open`, `mouth_round`.
- `viseme_sil` and `exp_relaxed` are zero-delta targets (neutral basis /
  absence of expression).

## Skeleton and eye skinning

The rig has five bones: `root`, `neck`, `head`, `eye_l`, `eye_r`. The mesh is
split by material group so eyeball geometry (materials `M_ScleraLeft`,
`M_IrisLeft`, `M_ScleraRight`, `M_IrisRight`) skins to the eye joints and the
rest skins to `head`, giving a functional gaze skeleton.

## UV layout

The bust has a dedicated face UV island (`u` in `[0, 0.68]`) for the text-skin
material. The back-of-head island occupies `u` in `[0.70, 0.98]` and is
mirrored. Interior groups are squeezed at the right edge. Vertex normals are
smooth.

## Optimisation choice (`--simplify 0.5`)

The `--simplify 0.5` flag to `optimize.ts` was chosen after a visual keyframe
comparison: the simplified bust (654 KB) is indistinguishable from the full
intermediate (1.30 MB) at review size. The full intermediate is retained via
`--full` for any future recipe work.

## Acceptance

The canonical rig is verified by `test/asset-bust.test.ts`:
- validates the shipped GLB loads with a conformant 27-morph, 5-bone rig
- proves every morph is drivable through `buildLoadedAvatar`
- checks normal and UV vertex attributes survive optimisation
- includes a regen-from-source guard (runs when
  `tools/asset-pipeline/.cache/` is present) that rebuilds the bust from pinned
  sources and asserts the same conformant rig

Viseme end-to-end coverage is in `test/speech-e2e.test.ts`, driven by
`tools/asset-pipeline/gen-viseme-fixture.ts` (espeak-ng) and the fixture at
`test/fixtures/viseme-polly-hello.jsonl`.

## Optimise any GLB

`optimize.ts` is a general-purpose GLB optimiser and works with any source
model, not just the bust. Its original usage is retained:

```bash
bun run optimize-asset -- avatar.glb avatar.optimized.glb
```

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
